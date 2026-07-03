import cors from "cors";
import express from "express";
import { z } from "zod";
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
    const body = z.object({ folderPath: z.string().min(1) }).parse(req.body);
    const tracks = await scanMusicFolder(body.folderPath);
    res.json({ tracks });
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

app.listen(port, "127.0.0.1", () => {
  console.log(`musicbox-api listening on http://127.0.0.1:${port}`);
});
