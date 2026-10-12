import cors from "cors";
import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { readLibrary } from "./libraryStore";
import { resolveLyricLines, searchLyricCandidates } from "./lyrics";
import { neteaseClient } from "./clients/neteaseClient";
import { getProvider, listProviders } from "./providers";
import { createLibraryRouter } from "./routes/library";
import {
  checkNeteaseQrLogin,
  getNeteaseAccountSummary,
  saveNeteaseCookie,
  startNeteaseQrLogin,
} from "./services/neteaseService";
import { readStore, updateStore } from "./store";
import { cacheDir } from "./utils/paths";
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
const remoteAccess = loadRemoteAccessConfig();
const remoteCoverCache = new RemoteCoverCache({ directory: path.join(cacheDir, "covers") });

// Cover responses are binary assets and can be several megabytes each. Keep
// the on-disk cache bounded so repeated browsing cannot grow memory/disk use
// without limit. Existing oversized caches are trimmed on startup as well.
const pruneRemoteCoverCache = () => remoteCoverCache.prune();
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

app.get("/api/settings", async (_req, res, next) => {
  try {
    const store = await readStore();
    res.json({
      hasNeteaseCookie: Boolean(store.neteaseCookie),
      neteaseAccount: await getNeteaseAccountSummary(),
      lyricBindings: store.lyricBindings,
    });
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

app.get("/api/providers/netease/playlists/:playlistId/tracks", async (req, res, next) => {
  try {
    res.json({ tracks: await neteaseClient.getPlaylistTracks(req.params.playlistId) });
  } catch (error) {
    next(error);
  }
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

app.get("/api/providers/netease/tracks/:trackId/stream", async (req, res, next) => {
  try {
    const query = z
      .object({
        level: z.enum(["standard", "higher", "exhigh", "lossless", "hires", "jymaster"]).optional(),
      })
      .parse(req.query);
    const meta = await neteaseClient.getStreamMeta(req.params.trackId, query.level);
    if (!meta.url) {
      throw new HttpError(404, "Playable URL is unavailable", "NETEASE_URL_UNAVAILABLE");
    }
    const upstream = await fetch(meta.url, {
      headers: req.headers.range ? { Range: req.headers.range } : undefined,
    });
    if (!upstream.ok && upstream.status !== 206) {
      throw new HttpError(502, "Upstream audio request failed", "NETEASE_AUDIO_UPSTREAM_FAILED");
    }

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (meta.bitrate) res.setHeader("x-aria-bitrate", String(meta.bitrate));
    if (meta.sampleRate) res.setHeader("x-aria-sample-rate", String(meta.sampleRate));
    if (meta.currentLevel) res.setHeader("x-aria-level", meta.currentLevel);
    res.setHeader("Cache-Control", "private, max-age=600");

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(upstream.body), res);
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

app.get("/api/providers/netease/cover", async (req, res, next) => {
  try {
    const query = z
      .object({ url: z.string().url(), size: z.string().regex(/^\d{2,4}[xy]\d{2,4}$/).optional() })
      .parse(req.query);
    const { contentType, byteLength, etag, filePath, body } = await remoteCoverCache.read(query.url, query.size);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(byteLength));
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("ETag", etag);
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.fresh) {
      res.status(304).end();
      return;
    }
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    if (filePath) {
      res.sendFile(filePath, { cacheControl: false }, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } else {
      res.send(body);
    }
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/netease-cookie", async (req, res, next) => {
  try {
    const body = z.object({ cookie: z.string().min(1) }).parse(req.body);
    const account = await saveNeteaseCookie(body.cookie);
    res.json({ ok: true, account });
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
    const [artist] = await neteaseClient.searchArtists(query.name, 1);
    res.json({ artist: artist ?? null });
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
    const body = z.object({ trackId: z.string().min(1), candidateId: z.string().min(1) }).parse(req.body);
    const lyrics = await resolveLyricLines(body.candidateId);
    const store = await updateStore((current) => ({
      ...current,
      lyricBindings: {
        ...current.lyricBindings,
        [body.trackId]: body.candidateId,
      },
    }));
    res.json({ ok: true, lyricBindings: store.lyricBindings, lyrics });
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

const listenHost = remoteAccess.enabled ? "0.0.0.0" : "127.0.0.1";
app.listen(port, listenHost, () => {
  console.log(`aria-api listening on http://${listenHost}:${port} (remote access ${remoteAccess.enabled ? "enabled" : "disabled"})`);
});
