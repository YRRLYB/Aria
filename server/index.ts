import cors from "cors";
import express from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseFile } from "music-metadata";
import { z } from "zod";
import { clearLibrary, findTrack, readLibrary, replaceLibraryRoot } from "./libraryStore";
import { resolveLyricLines, searchLyricCandidates } from "./lyrics";
import { scanMusicFolder } from "./musicScanner";
import { neteaseClient } from "./clients/neteaseClient";
import { getProvider, listProviders } from "./providers";
import { getNeteaseAccountSummary, saveNeteaseCookie } from "./services/neteaseService";
import { readStore, updateStore } from "./store";
import { HttpError } from "./utils/httpError";

const app = express();
const port = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "aria-api" });
});

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
      })
      .parse(req.query);
    res.json(await provider.getPrivateRoaming(query.limit));
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
    const url = await neteaseClient.getSongUrl(req.params.trackId, query.level);
    if (!url) {
      throw new HttpError(404, "Playable URL is unavailable", "NETEASE_URL_UNAVAILABLE");
    }
    const upstream = await fetch(url, {
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
    res.setHeader("Cache-Control", "no-store");

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

app.get("/api/providers/netease/tracks/:trackId/lyrics", async (req, res, next) => {
  try {
    res.json({ lyrics: await neteaseClient.getLyrics(req.params.trackId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/providers/netease/cover", async (req, res, next) => {
  try {
    const query = z.object({ url: z.string().url() }).parse(req.query);
    const target = new URL(query.url);
    if (!target.hostname.endsWith("music.126.net")) {
      throw new HttpError(400, "Unsupported cover host", "NETEASE_COVER_HOST_UNSUPPORTED");
    }

    const upstream = await fetch(query.url);
    if (!upstream.ok) {
      throw new HttpError(502, "Cover request failed", "NETEASE_COVER_UPSTREAM_FAILED");
    }

    res.status(upstream.status);
    for (const header of ["content-type", "content-length"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");

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

app.get("/api/library/tracks/:trackId/cover", async (req, res, next) => {
  try {
    const track = await findTrack(req.params.trackId);
    if (!track) throw new HttpError(404, "Track not found", "TRACK_NOT_FOUND");

    const metadata = await parseFile(track.path);
    const picture = metadata.common.picture?.[0];
    if (!picture) throw new HttpError(404, "Cover art not found", "COVER_NOT_FOUND");

    res.setHeader("Content-Type", picture.format || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(picture.data));
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

app.post("/api/library/scan", async (req, res, next) => {
  try {
    const body = z
      .object({
        folderPath: z.string().min(1),
        persist: z.boolean().optional().default(true),
      })
      .parse(req.body);
    const tracks = await scanMusicFolder(body.folderPath);
    const library = body.persist ? await replaceLibraryRoot(body.folderPath, tracks) : null;
    res.json({ tracks, library });
  } catch (error) {
    next(error);
  }
});

app.get("/api/library", async (_req, res, next) => {
  try {
    res.json(await readLibrary());
  } catch (error) {
    next(error);
  }
});

app.delete("/api/library", async (_req, res, next) => {
  try {
    res.json(await clearLibrary());
  } catch (error) {
    next(error);
  }
});

app.get("/api/library/tracks/:trackId/stream", async (req, res, next) => {
  try {
    const track = await findTrack(req.params.trackId);
    if (!track) throw new HttpError(404, "Track not found", "TRACK_NOT_FOUND");

    const fileStat = await stat(track.path);
    const range = req.headers.range;
    const contentType = mimeFromFormat(track.format);

    if (!range) {
      res.writeHead(200, {
        "Content-Length": fileStat.size,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      createReadStream(track.path).pipe(res);
      return;
    }

    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) throw new HttpError(416, "Invalid range", "INVALID_RANGE");

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : fileStat.size - 1;
    if (start > end || end >= fileStat.size) {
      throw new HttpError(416, "Range not satisfiable", "RANGE_NOT_SATISFIABLE");
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": contentType,
    });
    createReadStream(track.path, { start, end }).pipe(res);
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

function mimeFromFormat(format: string) {
  const normalized = format.toLowerCase();
  if (normalized.includes("flac")) return "audio/flac";
  if (normalized.includes("wave") || normalized.includes("wav")) return "audio/wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "audio/mpeg";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "audio/mp4";
  if (normalized.includes("ogg")) return "audio/ogg";
  return "application/octet-stream";
}

app.listen(port, "127.0.0.1", () => {
  console.log(`aria-api listening on http://127.0.0.1:${port}`);
});
