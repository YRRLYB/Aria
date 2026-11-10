import express from "express";
import { z } from "zod";
import type { RemoteCoverCache } from "../remoteCoverCache";
import {
  SourceError,
  isAriaLevel,
  type AriaLevel,
} from "../sources/contract";
import { getSource, listSourceStates, setSourceEnabled } from "../sources/registry";
import { proxyAudioStream } from "../sources/streamProxy";
import { handleCoverRequest } from "./remoteCover";

export type SourcesRouterOptions = {
  coverCaches: Partial<Record<string, RemoteCoverCache>>;
};

const searchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  mode: z.enum(["tracks", "artists", "playlists", "albums"]).default("tracks"),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

const enabledBody = z.object({ enabled: z.boolean() });

/** Manifests plus runtime flags, so the UI can grey out a disabled source. */
async function describeSources() {
  const states = await listSourceStates();
  return states.map((state) => ({
    ...state.manifest,
    enabled: state.enabled,
    unavailableUntil: state.unavailableUntil,
  }));
}

/**
 * Unified built-in source routes. Source implementations are loaded lazily by
 * the registry; unknown ids fail as `SOURCE_UNAVAILABLE` without touching any
 * platform API.
 */
export function createSourcesRouter(options: SourcesRouterOptions) {
  const router = express.Router();

  router.get("/", async (_req, res, next) => {
    try {
      res.json({ sources: await describeSources() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:sourceId/enabled", async (req, res, next) => {
    try {
      const body = enabledBody.parse(req.body);
      const states = await setSourceEnabled(req.params.sourceId, body.enabled);
      res.json({
        ok: true,
        sources: states.map((state) => ({
          ...state.manifest,
          enabled: state.enabled,
          unavailableUntil: state.unavailableUntil,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/search", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      const query = searchQuery.parse(req.query);
      const page = await source.search({
        query: query.q,
        mode: query.mode,
        limit: query.limit,
        offset: query.offset,
      });
      res.json({ sourceId: req.params.sourceId, ...page });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/artists/:artistId", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getArtistDetail) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}暂不支持歌手详情`, { source: source.manifest.id });
      }
      res.json(await source.getArtistDetail(req.params.artistId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/artists/:artistId/albums", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getArtistAlbums) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}暂不支持歌手专辑`, { source: source.manifest.id });
      }
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(80).default(30),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      }).parse(req.query);
      res.json(await source.getArtistAlbums(req.params.artistId, query.limit, query.offset));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/artists/:artistId/tracks", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getArtistTracks) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}暂不支持歌手曲目`, { source: source.manifest.id });
      }
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(60),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      }).parse(req.query);
      res.json(await source.getArtistTracks(req.params.artistId, query.limit, query.offset));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/albums/:albumId", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getAlbum) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}暂不支持专辑详情`, { source: source.manifest.id });
      }
      res.json(await source.getAlbum(req.params.albumId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/tracks/:trackId/stream-meta", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      const level = parseLevelQuery(req.query.level);
      const meta = await source.resolveStreamMeta(req.params.trackId, { level });
      // Upstream headers may contain cookies; they are proxy-only secrets.
      const { headers, ...publicMeta } = meta;
      void headers;
      res.json(publicMeta);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/tracks/:trackId/stream", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      const level = parseLevelQuery(req.query.level);
      await proxyAudioStream(req, res, async (attempt) => {
        const meta = await source.resolveStreamMeta(req.params.trackId, {
          level,
          refresh: attempt > 0,
        });
        return meta;
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/tracks/:trackId/video-meta", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.resolveVideoMeta) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}不提供视频流`, { source: source.manifest.id });
      }
      const level = parseLevelQuery(req.query.level);
      const meta = await source.resolveVideoMeta(req.params.trackId, { level });
      const { headers, ...publicMeta } = meta;
      void headers;
      res.json(publicMeta);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/tracks/:trackId/video", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.resolveVideoMeta) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}不提供视频流`, { source: source.manifest.id });
      }
      const level = parseLevelQuery(req.query.level);
      await proxyAudioStream(req, res, async (attempt) => {
        const meta = await source.resolveVideoMeta!(req.params.trackId, {
          level,
          refresh: attempt > 0,
        });
        return meta;
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/tracks/:trackId/lyrics", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getLyrics) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}不提供歌词`, { source: source.manifest.id });
      }
      res.json({ lyrics: await source.getLyrics(req.params.trackId) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/account", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getAccount) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}不支持账号`, { source: source.manifest.id });
      }
      res.json({ account: await source.getAccount() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/cover", async (req, res, next) => {
    try {
      const cache = options.coverCaches[req.params.sourceId];
      if (!cache) {
        throw new SourceError("UNAVAILABLE", `未知的播放源封面代理: ${req.params.sourceId}`);
      }
      await handleCoverRequest(cache, req, res);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/daily", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getDailyRecommendTracks) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}暂不支持每日推荐`, { source: source.manifest.id });
      }
      res.json({ sourceId: req.params.sourceId, tracks: await source.getDailyRecommendTracks() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:sourceId/roam", async (req, res, next) => {
    try {
      const source = await getSource(req.params.sourceId);
      if (!source.getRoamTracks) {
        throw new SourceError("UNSUPPORTED", `${source.manifest.name}暂不支持私人漫游`, { source: source.manifest.id });
      }
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(50).default(30),
        exclude: z.string().optional(),
      }).parse(req.query);
      const excludeIds = (query.exclude ?? "").split(",").map((id) => id.trim()).filter(Boolean);
      res.json({ sourceId: req.params.sourceId, tracks: await source.getRoamTracks(query.limit, excludeIds) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseLevelQuery(value: unknown): AriaLevel | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !isAriaLevel(value)) {
    throw new SourceError("UNSUPPORTED", `无效的音质档位: ${String(value)}`);
  }
  return value;
}
