import cors from "cors";
import express from "express";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { pruneDiskCache } from "./utils/diskCache";

const app = express();
const port = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);
const remoteCoverCacheDir = path.join(cacheDir, "covers");
const maxRemoteCoverBytes = 8 * 1024 * 1024;

class CoverFetchLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(work: () => Promise<T>) {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const remoteCoverFetchLimiter = new CoverFetchLimiter();
const remoteCoverRequests = new Map<string, Promise<{ body: Buffer; contentType: string; status: number }>>();

// Cover responses are binary assets and can be several megabytes each. Keep
// the on-disk cache bounded so repeated browsing cannot grow memory/disk use
// without limit. Existing oversized caches are trimmed on startup as well.
const pruneRemoteCoverCache = () =>
  pruneDiskCache(remoteCoverCacheDir, { maxBytes: 256 * 1024 * 1024, maxFiles: 800 });
void pruneRemoteCoverCache();
const remoteCoverPruneTimer = setInterval(pruneRemoteCoverCache, 15 * 60_000);
remoteCoverPruneTimer.unref?.();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "aria-api" });
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

app.get("/api/providers/netease/playlists/:playlistId/tracks", async (req, res, next) => {
  try {
    res.json({ tracks: await neteaseClient.getPlaylistTracks(req.params.playlistId) });
  } catch (error) {
    next(error);
  }
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
    const target = new URL(query.url);
    if (!target.hostname.endsWith("music.126.net")) {
      throw new HttpError(400, "Unsupported cover host", "NETEASE_COVER_HOST_UNSUPPORTED");
    }

    // Always request a bounded CDN variant. Without a size, NetEase returns
    // the original multi-megapixel artwork, which is costly to decode in the
    // renderer and quickly bloats Chromium's image cache.
    const requestedSize = normalizeCoverSize(query.size);
    const upstreamTarget = new URL(query.url);
    upstreamTarget.searchParams.set("param", requestedSize);
    const upstreamUrl = upstreamTarget.href;

    const cacheKey = createHash("sha1").update(upstreamUrl).digest("hex");
    const cachedPath = path.join(remoteCoverCacheDir, `${cacheKey}.img`);
    const cachedMetaPath = path.join(remoteCoverCacheDir, `${cacheKey}.json`);
    try {
      const rawMeta = await readFile(cachedMetaPath, "utf8");
      const meta = JSON.parse(rawMeta) as { contentType?: string };
      res.setHeader("Content-Type", meta.contentType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      res.sendFile(cachedPath, { cacheControl: false }, (error) => {
        if (error && !res.headersSent) next(error);
      });
      return;
    } catch {
      // Cache miss; continue with upstream fetch.
    }

    let coverRequest = remoteCoverRequests.get(upstreamUrl);
    if (!coverRequest) {
      coverRequest = remoteCoverFetchLimiter.run(async () => {
        const upstream = await fetch(upstreamUrl);
        if (!upstream.ok) {
          throw new HttpError(502, "Cover request failed", "NETEASE_COVER_UPSTREAM_FAILED");
        }
        const advertisedLength = Number(upstream.headers.get("content-length") || 0);
        if (advertisedLength > maxRemoteCoverBytes) {
          throw new HttpError(502, "Cover response is too large", "NETEASE_COVER_TOO_LARGE");
        }
        const contentType = upstream.headers.get("content-type") || "image/jpeg";
        const body = await readBoundedBody(upstream, maxRemoteCoverBytes);
        await mkdir(remoteCoverCacheDir, { recursive: true });
        await Promise.all([
          writeFile(cachedPath, body),
          writeFile(cachedMetaPath, JSON.stringify({ contentType }), "utf8"),
        ]);
        void pruneRemoteCoverCache();
        return { body, contentType, status: upstream.status };
      });
      remoteCoverRequests.set(upstreamUrl, coverRequest);
      void coverRequest.then(
        () => remoteCoverRequests.delete(upstreamUrl),
        () => remoteCoverRequests.delete(upstreamUrl),
      );
    }
    const { contentType, body, status } = await coverRequest;

    res.status(status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(body.byteLength));
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");

    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.sendFile(cachedPath, { cacheControl: false }, (error) => {
      if (error && !res.headersSent) next(error);
    });
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
        q: z.string().min(1).max(120),
        limit: z.coerce.number().int().min(1).max(50).optional().default(24),
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
    try {
      [neteaseTracks, artists] = await Promise.all([
        neteaseClient.searchTracks(query.q, query.limit),
        neteaseClient.searchArtists(query.q, Math.min(query.limit, 18)),
      ]);
    } catch {
      // Local search remains useful when NetEase credentials are missing or temporarily rejected.
    }

    res.json({ query: query.q, localTracks, neteaseTracks, artists });
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

app.listen(port, "127.0.0.1", () => {
  console.log(`aria-api listening on http://127.0.0.1:${port}`);
});

function normalizeCoverSize(value?: string) {
  const match = value?.match(/^(\d{2,4})[xy](\d{2,4})$/);
  if (!match) return "800y800";
  const width = Math.min(1024, Math.max(64, Number(match[1])));
  const height = Math.min(1024, Math.max(64, Number(match[2])));
  return `${width}y${height}`;
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(502, "Cover response is too large", "NETEASE_COVER_TOO_LARGE");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
