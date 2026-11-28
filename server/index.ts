import cors from "cors";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { readLibrary } from "./libraryStore";
import { searchLyricCandidates } from "./lyrics";
import { bindLocalLyrics } from "./services/lyricBindingService";
import { NETEASE_NO_PLAYABLE_URL_MESSAGE, neteaseClient, sanitizeNeteaseArtistAvatar } from "./clients/neteaseClient";
import { invalidateNeteaseIdentity, normalizeRealIp } from "./clients/neteaseIdentity";
import { getProvider, listProviders } from "./providers";
import { createLibraryRouter } from "./routes/library";
import { createAriaRoomRouter } from "./routes/ariaRoom";
import { createBackupRouter } from "./routes/backup";
import { createListenTogetherRouter } from "./routes/listenTogether";
import { createLocalMetadataRouter } from "./routes/localMetadata";
import { createPrivateCloudRouter } from "./routes/privateCloud";
import { createRemoteCoverRouter } from "./routes/remoteCover";
import {
  checkNeteaseQrLogin,
  clearNeteaseCookie,
  getNeteaseAccountSummary,
  peekNeteaseAccountSummary,
  saveNeteaseCookie,
  startNeteaseQrLogin,
} from "./services/neteaseService";
import { startLibraryWatchers } from "./services/libraryWatcher";
import { readStore, updateStore } from "./store";
import { cacheDir } from "./utils/paths";
import { SourceError } from "./sources/contract";
import { getSource } from "./sources/registry";
import { proxyAudioStream } from "./sources/streamProxy";
import { createSourcesRouter } from "./routes/sources";
import { normalizeYoutubeProxyInput, youtubeCoverFetcher } from "./sources/youtube/client";
import { HttpError } from "./utils/httpError";
import { RemoteCoverCache } from "./remoteCoverCache";
import {
  extractRequestToken,
  lanAddresses,
  loadRemoteAccessConfig,
  loopbackAddress,
  matchesRemoteToken,
} from "./remoteAccess";

const app = express();
const port = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);
let remoteAccess = loadRemoteAccessConfig();
const remoteCoverCache = new RemoteCoverCache({ directory: path.join(cacheDir, "covers") });
// QQ covers use fixed-size CDN variants, so no resize parameter is appended.
const qqCoverCache = new RemoteCoverCache({
  directory: path.join(cacheDir, "covers-qq"),
  allowedHosts: ["gtimg.cn", "qpic.y.qq.com"],
  sizing: null,
  errorPrefix: "QQ_COVER",
});
const bilibiliCoverCache = new RemoteCoverCache({
  directory: path.join(cacheDir, "covers-bilibili"),
  allowedHosts: ["hdslb.com", "bilivideo.com"],
  sizing: null,
  errorPrefix: "BILIBILI_COVER",
});
// YouTube covers (i.ytimg.com) go through the user's optional proxy; the
// fetcher re-reads the proxy setting on every call, so changes apply live.
const youtubeCoverCache = new RemoteCoverCache({
  directory: path.join(cacheDir, "covers-youtube"),
  allowedHosts: ["ytimg.com", "ggpht.com", "googleusercontent.com", "usercontent.goog"],
  sizing: null,
  errorPrefix: "YOUTUBE_COVER",
  fetcher: youtubeCoverFetcher,
});

// Cover responses are binary assets and can be several megabytes each. Keep
// the on-disk cache bounded so repeated browsing cannot grow memory/disk use
// without limit. Existing oversized caches are trimmed on startup as well.
const pruneRemoteCoverCache = () => {
  remoteCoverCache.prune();
  qqCoverCache.prune();
  bilibiliCoverCache.prune();
  youtubeCoverCache.prune();
};
void pruneRemoteCoverCache();
const remoteCoverPruneTimer = setInterval(pruneRemoteCoverCache, 15 * 60_000);
remoteCoverPruneTimer.unref?.();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "aria-api" });
});

// When remote access is on, LAN clients must present the pairing token via
// the Authorization header or ?token= (media URLs inside <audio>/<img> cannot
// send headers). Loopback traffic — the desktop renderer itself — is exempt.
app.use("/api", (req, res, next) => {
  if (!remoteAccess.enabled) {
    next();
    return;
  }
  if (loopbackAddress(req.ip)) {
    next();
    return;
  }
  const provided = extractRequestToken(req.headers, req.query.token);
  if (matchesRemoteToken(remoteAccess.token, provided)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized", code: "REMOTE_TOKEN_REQUIRED" });
});

app.get("/api/remote-access", (_req, res) => {
  res.json({
    enabled: remoteAccess.enabled,
    token: remoteAccess.token,
    port,
    addresses: lanAddresses(),
  });
});

app.use("/api/library", createLibraryRouter());
app.use("/api/library/metadata", createLocalMetadataRouter());
app.use("/api/private-cloud", createPrivateCloudRouter());
app.use("/api/backup", createBackupRouter());
app.use(
  "/api/sources",
  createSourcesRouter({ coverCaches: { netease: remoteCoverCache, qq: qqCoverCache, bilibili: bilibiliCoverCache, youtube: youtubeCoverCache } }),
);

app.get("/api/settings", async (_req, res, next) => {
  try {
    const store = await readStore();
    res.json({
      hasNeteaseCookie: Boolean(store.neteaseCookie),
      // A stored cookie whose account probe reports disconnected means the
      // session expired — the settings card distinguishes this from signed-out.
      hasQqCookie: Boolean(store.qqCookie),
      hasBilibiliCookie: Boolean(store.bilibiliCookie),
      hasYoutubeCookie: Boolean(store.youtubeCookie || store.youtubeOauth?.refreshToken || store.youtubeOauth?.accessToken),
      // Never block the first renderer paint on a provider round trip. The
      // account endpoint below validates the cookie in the background.
      neteaseAccount: await peekNeteaseAccountSummary(),
      // Opt-in mainland egress IP for NetEase's 460/"环境异常" mitigation.
      neteaseRealIp: store.neteaseRealIp ?? null,
      // YouTube-only proxy (host:port); other sources always stay direct.
      youtubeProxy: store.youtubeProxy ?? null,
      lyricBindings: store.lyricBindings,
    });
  } catch (error) {
    next(error);
  }
});

const youtubeProxyBody = z.object({
  // Accepts "7890", "127.0.0.1:7890" or a full http(s) URL; empty clears it.
  proxy: z.string().trim().max(200),
});

app.put("/api/settings/youtube-proxy", async (req, res, next) => {
  try {
    const body = youtubeProxyBody.parse(req.body);
    const normalized = normalizeYoutubeProxyInput(body.proxy);
    if (body.proxy && !normalized) {
      throw new HttpError(400, "代理格式不正确：请填写端口（如 7890）、host:port 或 http:// 地址；目前仅支持 HTTP 代理", "YOUTUBE_PROXY_INVALID");
    }
    await updateStore((store) => ({ ...store, youtubeProxy: normalized }));
    res.json({ ok: true, youtubeProxy: normalized });
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings/netease-account", async (_req, res, next) => {
  try {
    res.json({ account: await getNeteaseAccountSummary() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers", async (_req, res, next) => {
  try {
    const providers = await Promise.all(
      listProviders().map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        account: await provider.getAccount(),
      })),
    );
    res.json({ providers });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/:providerId/liked", async (req, res, next) => {
  try {
    const provider = resolveProvider(req.params.providerId);
    res.json({ tracks: await provider.getLikedTracks() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/:providerId/playlists", async (req, res, next) => {
  try {
    const provider = resolveProvider(req.params.providerId);
    res.json({ playlists: await provider.getPlaylists() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/providers/netease/playlists", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1, "请输入歌单名称").max(40, "歌单名称最多 40 个字符"),
      isPrivate: z.boolean().default(false),
    }).parse(req.body);
    const playlist = await neteaseClient.createPlaylist(body.name, body.isPrivate);
    res.status(201).json({ playlist });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/providers/netease/playlists/:playlistId", async (req, res, next) => {
  try {
    res.json(await neteaseClient.deletePlaylist(req.params.playlistId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/netease/playlists/:playlistId/tracks", async (req, res, next) => {
  try {
    res.json({ tracks: await neteaseClient.getPlaylistTracks(req.params.playlistId) });
  } catch (error) {
    next(error);
  }
});

// Generic provider playlist tracks. The netease route above keeps matching
// netease first; this serves the other providers that implement the method.
app.get("/api/providers/:providerId/playlists/:playlistId/tracks", async (req, res, next) => {
  try {
    const provider = resolveProvider(req.params.providerId);
    if (!provider.getPlaylistTracks) {
      throw new HttpError(400, `${provider.name}暂不支持读取歌单内容`, "PROVIDER_PLAYLIST_TRACKS_UNSUPPORTED");
    }
    res.json({ tracks: await provider.getPlaylistTracks(req.params.playlistId) });
  } catch (error) {
    next(error);
  }
});

// Cloud library is read-only here. Upload/delete/match operations stay out of
// the desktop surface until there is an explicit confirmation flow, so merely
// opening the page cannot change a user's account.
app.get("/api/providers/netease/cloud", async (req, res, next) => {
  try {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      refresh: z.string().optional(),
    }).parse(req.query);
    res.json(await neteaseClient.getCloudTracks(query.limit, query.offset, query.refresh === "1" || query.refresh === "true"));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/cloud/:trackId", async (req, res, next) => {
  try {
    if (!/^\d{1,20}$/.test(req.params.trackId)) throw new HttpError(400, "无效的云盘歌曲 ID", "NETEASE_CLOUD_TRACK_ID_INVALID");
    res.json({ item: await neteaseClient.getCloudTrackDetail(req.params.trackId) });
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/playlists/:playlistId", async (req, res, next) => {
  try { res.json(await neteaseClient.getPlaylistDetail(req.params.playlistId)); } catch (error) { next(error); }
});

app.patch("/api/providers/netease/playlists/:playlistId", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1).max(40).optional(),
      description: z.string().max(1000).optional(),
      tags: z.array(z.string().min(1).max(30)).max(3).optional(),
    }).refine((changes) => Object.values(changes).some((value) => value !== undefined), "请选择要修改的歌单内容").parse(req.body);
    res.json(await neteaseClient.updatePlaylist(req.params.playlistId, body));
  } catch (error) { next(error); }
});

app.post("/api/providers/netease/playlists/:playlistId/tracks", async (req, res, next) => {
  try {
    const body = z.object({ trackIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(500), operation: z.enum(["add", "del"]) }).parse(req.body);
    res.json(await neteaseClient.editPlaylistTracks(req.params.playlistId, body.trackIds, body.operation));
  } catch (error) { next(error); }
});

app.put("/api/providers/netease/playlists/:playlistId/tracks/order", async (req, res, next) => {
  try {
    const body = z.object({ trackIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(5000) }).parse(req.body);
    res.json(await neteaseClient.reorderPlaylistTracks(req.params.playlistId, body.trackIds));
  } catch (error) { next(error); }
});

// A raw binary upload avoids base64 overhead and retains provider JPEG semantics.
app.put("/api/providers/netease/playlists/:playlistId/cover", express.raw({ type: ["image/*", "application/octet-stream"], limit: "8mb" }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "请选择图片文件", "NETEASE_COVER_IMAGE_REQUIRED");
    res.json(await neteaseClient.uploadPlaylistCover(req.params.playlistId, req.body));
  } catch (error) { next(error); }
});

app.post("/api/providers/netease/playlists/:playlistId/subscription", async (req, res, next) => {
  try {
    const body = z.object({ subscribed: z.boolean() }).parse(req.body);
    res.json(await neteaseClient.subscribePlaylist(req.params.playlistId, body.subscribed));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/search", async (req, res, next) => {
  try {
    const query = z.object({
      q: z.string().trim().min(1).max(120),
      mode: z.enum(["tracks", "artists", "playlists", "users", "albums", "lyrics"]),
      limit: z.coerce.number().int().min(1).max(50).default(24),
      offset: z.coerce.number().int().min(0).max(1000).default(0),
    }).parse(req.query);
    res.json(await neteaseClient.search(query.q, query.mode, query.limit, query.offset));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/search/suggestions", async (req, res, next) => {
  try {
    const query = z.object({ q: z.string().trim().min(1).max(120) }).parse(req.query);
    res.json({ suggestions: await neteaseClient.getSearchSuggestions(query.q) });
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/styles", async (_req, res, next) => {
  try { res.json(await neteaseClient.getStyleGroups()); } catch (error) { next(error); }
});

app.get("/api/providers/netease/styles/:styleId", async (req, res, next) => {
  try {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(24),
      cursor: z.coerce.number().int().min(0).max(100_000).default(0),
      sort: z.enum(["hot", "new"]).default("hot"),
    }).parse(req.query);
    res.json(await neteaseClient.getStyleDetail(req.params.styleId, query.limit, query.cursor, query.sort));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/sport-radio", async (req, res, next) => {
  try {
    const query = z.object({
      bpm: z.coerce.number().int().min(40).max(240).default(100),
      refresh: z.enum(["1", "true", "0", "false"]).optional(),
    }).parse(req.query);
    res.json(await neteaseClient.getSportRadio(query.bpm, query.refresh === "1" || query.refresh === "true"));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/discovery", async (req, res, next) => {
  try {
    const query = z.object({ limit: z.coerce.number().int().min(6).max(30).default(12) }).parse(req.query);
    res.json(await neteaseClient.getDiscovery(query.limit));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/users/:userId", async (req, res, next) => {
  try { res.json({ user: await neteaseClient.getUserDetail(req.params.userId) }); } catch (error) { next(error); }
});

app.get("/api/providers/netease/users/:userId/playlists", async (req, res, next) => {
  try {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1000).default(0) }).parse(req.query);
    res.json(await neteaseClient.getUserPlaylists(req.params.userId, query.limit, query.offset));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/albums/:albumId", async (req, res, next) => {
  try { res.json(await neteaseClient.getAlbum(req.params.albumId)); } catch (error) { next(error); }
});

app.get("/api/providers/netease/artists/:artistId", async (req, res, next) => {
  try { res.json(await neteaseClient.getArtistDetail(req.params.artistId)); } catch (error) { next(error); }
});

app.get("/api/providers/netease/artists/:artistId/albums", async (req, res, next) => {
  try {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(30), offset: z.coerce.number().int().min(0).max(1000).default(0) }).parse(req.query);
    res.json(await neteaseClient.getArtistAlbums(req.params.artistId, query.limit, query.offset));
  } catch (error) { next(error); }
});

app.get("/api/providers/:providerId/daily", async (req, res, next) => {
  try {
    const provider = resolveProvider(req.params.providerId);
    res.json(await provider.getDailyRecommendations());
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/:providerId/roam", async (req, res, next) => {
  try {
    const provider = resolveProvider(req.params.providerId);
    const query = z
      .object({
        limit: z.coerce.number().int().min(3).max(30).optional(),
        refresh: z.string().optional(),
        exclude: z.string().optional(),
      })
      .parse(req.query);
    const refresh = query.refresh === "1" || query.refresh === "true";
    const excludeIds = (query.exclude ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 120);
    res.json(await provider.getPrivateRoaming(query.limit, { refresh, excludeIds }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/netease/tracks/:trackId/encyclopedia", async (req, res, next) => {
  try {
    res.json(await neteaseClient.getSongEncyclopedia(req.params.trackId));
  } catch (error) { next(error); }
});

app.get("/api/providers/netease/tracks/:trackId/stream", async (req, res, next) => {
  try {
    const query = z
      .object({
        level: z.enum(["standard", "higher", "exhigh", "lossless", "hires", "jymaster"]).optional(),
      })
      .parse(req.query);
    await proxyAudioStream(req, res, async (attempt) => {
      const meta = await neteaseClient.getStreamMeta(req.params.trackId, query.level, attempt > 0);
      if (!meta.url) {
        throw new HttpError(404, NETEASE_NO_PLAYABLE_URL_MESSAGE, "NETEASE_URL_UNAVAILABLE");
      }
      return meta;
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/netease/tracks/:trackId/stream-meta", async (req, res, next) => {
  try {
    const query = z
      .object({
        level: z.enum(["standard", "higher", "exhigh", "lossless", "hires", "jymaster"]).optional().default("lossless"),
      })
      .parse(req.query);
    res.json(await neteaseClient.getStreamMeta(req.params.trackId, query.level));
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/netease/tracks/:trackId/lyrics", async (req, res, next) => {
  try {
    res.json({ lyrics: await neteaseClient.getLyrics(req.params.trackId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/providers/netease/tracks/:trackId/like", async (req, res, next) => {
  try {
    const body = z.object({ liked: z.boolean() }).parse(req.body);
    res.json(await neteaseClient.setLike(req.params.trackId, body.liked));
  } catch (error) {
    next(error);
  }
});

// Non-NetEase sources opt into likes through the source contract (QQ Music
// writes to dirId 201 with its signed web channel).
app.post("/api/providers/:providerId/tracks/:trackId/like", async (req, res, next) => {
  try {
    const body = z.object({ liked: z.boolean() }).parse(req.body);
    const source = await getSource(req.params.providerId);
    if (!source.setLike) {
      throw new HttpError(400, `${source.manifest.name}暂不支持同步红心`, "SOURCE_LIKE_UNSUPPORTED");
    }
    res.json(await source.setLike(req.params.trackId, body.liked));
  } catch (error) {
    next(error);
  }
});

app.post("/api/providers/netease/cache/warmup", async (req, res, next) => {
  try {
    const body = z
      .object({
        trackIds: z.array(z.union([z.string(), z.number()])).max(160),
        level: z.enum(["standard", "higher", "exhigh", "lossless", "hires", "jymaster"]).optional().default("lossless"),
      })
      .parse(req.body);
    const cached = await neteaseClient.warmupTracks(body.trackIds, body.level);
    res.json({ ok: true, cached });
  } catch (error) {
    next(error);
  }
});

app.use("/api/providers/netease/cover", createRemoteCoverRouter(remoteCoverCache));
app.use("/api/netease/listen-together", createListenTogetherRouter());
app.use("/api/aria-room", createAriaRoomRouter({ localApiPort: port }));

app.post("/api/settings/netease-cookie", async (req, res, next) => {
  try {
    const body = z.object({ cookie: z.string().min(1) }).parse(req.body);
    const account = await saveNeteaseCookie(body.cookie);
    res.json({ ok: true, account });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/settings/netease-cookie", async (_req, res, next) => {
  try {
    res.json({ ok: true, account: await clearNeteaseCookie() });
  } catch (error) {
    next(error);
  }
});

/**
 * Lets the user pin the mainland IP NetEase should see. Stored (not env-only) so
 * the desktop build exposes it in Settings; an empty value restores the real
 * connection. Requests are unaffected until the value is set.
 */
app.post("/api/settings/netease-real-ip", async (req, res, next) => {
  try {
    const body = z.object({ realIP: z.string().max(64).optional().default("") }).parse(req.body ?? {});
    const trimmed = body.realIP.trim();
    const normalized = trimmed ? normalizeRealIp(trimmed) : null;
    if (trimmed && !normalized) {
      throw new HttpError(400, "请输入有效的 IPv4 或 IPv6 地址", "NETEASE_REAL_IP_INVALID");
    }
    await updateStore((store) => ({ ...store, neteaseRealIp: normalized }));
    invalidateNeteaseIdentity();
    res.json({ ok: true, realIP: normalized });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/qq-cookie", async (req, res, next) => {
  try {
    const body = z.object({ cookie: z.string().min(1) }).parse(req.body);
    const source = await getSource("qq");
    if (!source.saveCookie) {
      throw new HttpError(400, "该播放源不支持 Cookie 登录", "SOURCE_COOKIE_UNSUPPORTED");
    }
    const account = await source.saveCookie(body.cookie);
    res.json({ ok: true, account });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/settings/qq-cookie", async (_req, res, next) => {
  try {
    const source = await getSource("qq");
    if (!source.clearCookie) {
      throw new HttpError(400, "该播放源不支持退出登录", "SOURCE_COOKIE_UNSUPPORTED");
    }
    res.json({ ok: true, account: await source.clearCookie() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/qq-qr/start", async (_req, res, next) => {
  try {
    const source = await getSource("qq");
    if (!source.startQrLogin) {
      throw new HttpError(400, "该播放源不支持扫码登录", "SOURCE_QR_UNSUPPORTED");
    }
    res.json(await source.startQrLogin());
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings/qq-qr/check", async (req, res, next) => {
  try {
    const query = z.object({ key: z.string().min(1) }).parse(req.query);
    const source = await getSource("qq");
    if (!source.checkQrLogin) {
      throw new HttpError(400, "该播放源不支持扫码登录", "SOURCE_QR_UNSUPPORTED");
    }
    res.json(await source.checkQrLogin(query.key));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/netease-qr/start", async (_req, res, next) => {
  try {
    res.json(await startNeteaseQrLogin());
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings/netease-qr/check", async (req, res, next) => {
  try {
    const query = z.object({ key: z.string().min(1) }).parse(req.query);
    res.json(await checkNeteaseQrLogin(query.key));
  } catch (error) {
    next(error);
  }
});

app.get("/api/search", async (req, res, next) => {
  try {
    const query = z
      .object({
        q: z.string().trim().min(1).max(120),
        limit: z.coerce.number().int().min(1).max(50).optional().default(24),
        mode: z.enum(["tracks", "artists", "playlists", "users", "albums", "lyrics", "local"]).optional(),
      })
      .parse(req.query);
    const normalized = query.q.trim().toLowerCase();
    const library = await readLibrary();
    const localTracks = library.tracks
      .filter((track) =>
        [track.title, track.artist, track.album, track.format, track.quality]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, query.limit);

    let neteaseTracks: Awaited<ReturnType<typeof neteaseClient.searchTracks>> = [];
    let artists: Awaited<ReturnType<typeof neteaseClient.searchArtists>> = [];
    let playlists: Awaited<ReturnType<typeof neteaseClient.searchPlaylists>> = [];
    // Keep each remote search independent. A provider can reject one result
    // type (for example when an endpoint is temporarily unavailable) while
    // the other result types remain useful to the user.
    if (query.mode) {
      if (query.mode === "local") {
        res.json({ query: query.q, localTracks, neteaseTracks, artists, playlists });
      } else {
        const result = await neteaseClient.search(query.q, query.mode, query.limit);
        res.json({ query: query.q, localTracks: query.mode === "tracks" ? localTracks : [], neteaseTracks: result.tracks, artists: result.artists, playlists: result.playlists, users: result.users, albums: result.albums, total: result.total });
      }
      return;
    }
    const [tracksResult, artistsResult, playlistsResult] = await Promise.allSettled([
      neteaseClient.searchTracks(query.q, query.limit),
      neteaseClient.searchArtists(query.q, Math.min(query.limit, 18)),
      neteaseClient.searchPlaylists(query.q, Math.min(query.limit, 18)),
    ]);
    if (tracksResult.status === "fulfilled") neteaseTracks = tracksResult.value;
    if (artistsResult.status === "fulfilled") artists = artistsResult.value;
    if (playlistsResult.status === "fulfilled") playlists = playlistsResult.value;

    res.json({ query: query.q, localTracks, neteaseTracks, artists, playlists });
  } catch (error) {
    next(error);
  }
});

app.get("/api/artists/lookup", async (req, res, next) => {
  try {
    const query = z
      .object({
        name: z.string().min(1).max(120),
      })
      .parse(req.query);
    const normalizedQuery = query.name.trim().toLowerCase();
    const candidates = await neteaseClient.searchArtists(query.name, 5);
    let artist =
      candidates.find((item) => item.name.trim().toLowerCase() === normalizedQuery && sanitizeNeteaseArtistAvatar(item.avatarUrl)) ??
      candidates.find((item) => sanitizeNeteaseArtistAvatar(item.avatarUrl)) ??
      candidates.find((item) => item.name.trim().toLowerCase() === normalizedQuery) ??
      candidates[0] ??
      null;
    if (artist) {
      const cleanAvatar = sanitizeNeteaseArtistAvatar(artist.avatarUrl);
      if (cleanAvatar !== artist.avatarUrl) {
        artist = { ...artist, avatarUrl: cleanAvatar };
      }
    }
    if (artist?.id && !artist.avatarUrl) {
      try {
        const topTracks = await neteaseClient.getArtistTopTracks(artist.id);
        const trackCover = topTracks.map((track) => sanitizeNeteaseArtistAvatar(track.coverUrl)).find(Boolean) ?? null;
        if (trackCover) {
          artist = { ...artist, avatarUrl: trackCover };
        }
      } catch {
        // Best-effort top track cover fallback.
      }
    }
    if (!artist || !artist.avatarUrl) {
      try {
        const qqSource = getSource("qq");
        const qqPage = qqSource?.search
          ? await qqSource.search({ query: query.name, mode: "artists", limit: 3, offset: 0 })
          : null;
        const qqArtists = qqPage?.artists ?? [];
        const qqMatch =
          qqArtists.find((item) => item.name.trim().toLowerCase() === normalizedQuery && item.avatarUrl) ??
          qqArtists.find((item) => Boolean(item.avatarUrl)) ??
          null;
        if (qqMatch) {
          artist = qqMatch;
        }
      } catch {
        // Best-effort QQ artist fallback.
      }
    }
    res.json({ artist });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/netease/artists/:artistId/tracks", async (req, res, next) => {
  try {
    res.json({ tracks: await neteaseClient.getArtistTopTracks(req.params.artistId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/lyrics/search", async (req, res, next) => {
  try {
    const query = z
      .object({
        title: z.string().min(1),
        artist: z.string().optional(),
        album: z.string().optional(),
      })
      .parse(req.query);
    res.json({ candidates: await searchLyricCandidates(query) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/lyrics/bind", async (req, res, next) => {
  try {
    const body = z.object({ trackId: z.string().min(1), candidateId: z.string().min(1), expectedBinding: z.string().nullable().optional() }).parse(req.body);
    res.json(await bindLocalLyrics(body.trackId, body.candidateId, body.expectedBinding));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((error as { type?: string } | null)?.type === "entity.too.large") {
    res.status(413).json({ error: "上传的文件过大，请选择小于 8 MB 的封面图片", code: "REQUEST_TOO_LARGE" });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Bad request", issues: error.issues });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  if (error instanceof SourceError) {
    const http = error.toHttpError();
    res.status(http.status).json({ error: http.message, code: http.code });
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown server error";
  res.status(500).json({ error: message });
});

function resolveProvider(providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new HttpError(404, `Unknown provider: ${providerId}`, "UNKNOWN_PROVIDER");
  }
  return provider;
}

let activeServer: ReturnType<typeof app.listen> | null = null;
let watchersStarted = false;

export async function restartAriaServer(): Promise<void> {
  remoteAccess = loadRemoteAccessConfig();
  if (activeServer) {
    const previous = activeServer;
    activeServer = null;
    await new Promise<void>((resolve) => {
      previous.close(() => resolve());
      previous.closeAllConnections?.();
    });
  }
  const listenHost = remoteAccess.enabled ? "0.0.0.0" : "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, listenHost, () => {
      activeServer = server;
      console.log(`aria-api listening on http://${listenHost}:${port} (remote access ${remoteAccess.enabled ? "enabled" : "disabled"})`);
      if (!watchersStarted) {
        watchersStarted = true;
        startLibraryWatchers();
      }
      resolve();
    });
    server.once("error", reject);
  });
}

(globalThis as { __ariaRestartServer?: () => Promise<void> }).__ariaRestartServer = restartAriaServer;
void restartAriaServer();
