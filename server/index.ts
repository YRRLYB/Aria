import cors from "cors";
import express from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { clearLibrary, findTrack, readLibrary, replaceLibraryRoot } from "./libraryStore";
import { searchLyricCandidates } from "./lyrics";
import { scanMusicFolder } from "./musicScanner";
import { getProvider, listProviders } from "./providers";
import { getNeteaseAccountSummary, saveNeteaseCookie } from "./services/neteaseService";
import { readStore, updateStore } from "./store";
import { HttpError } from "./utils/httpError";

const app = express();
const port = Number(process.env.MUSICBOX_API_PORT || 3636);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "musicbox-api" });
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

app.get("/api/providers/:providerId/daily", async (req, res, next) => {
  try {
    const provider = resolveProvider(req.params.providerId);
    res.json(await provider.getDailyRecommendations());
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

app.get("/api/lyrics/search", (req, res, next) => {
  try {
    const query = z
      .object({
        title: z.string().min(1),
        artist: z.string().optional(),
        album: z.string().optional(),
      })
      .parse(req.query);
    res.json({ candidates: searchLyricCandidates(query) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/lyrics/bind", async (req, res, next) => {
  try {
    const body = z.object({ trackId: z.string().min(1), candidateId: z.string().min(1) }).parse(req.body);
    const store = await updateStore((current) => ({
      ...current,
      lyricBindings: {
        ...current.lyricBindings,
        [body.trackId]: body.candidateId,
      },
    }));
    res.json({ ok: true, lyricBindings: store.lyricBindings });
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
  console.log(`musicbox-api listening on http://127.0.0.1:${port}`);
});
