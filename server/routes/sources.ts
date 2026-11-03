import express from "express";
import { z } from "zod";
import type { RemoteCoverCache } from "../remoteCoverCache";
import {
  SourceError,
  isAriaLevel,
  type AriaLevel,
} from "../sources/contract";
import { getSource, listSourceManifests } from "../sources/registry";
import { proxyAudioStream } from "../sources/streamProxy";
import { handleCoverRequest } from "./remoteCover";

export type SourcesRouterOptions = {
  coverCaches: Partial<Record<string, RemoteCoverCache>>;
};

const searchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  mode: z.enum(["tracks", "artists", "playlists"]).default("tracks"),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

/**
 * Unified built-in source routes. Source implementations are loaded lazily by
 * the registry; unknown ids fail as `SOURCE_UNAVAILABLE` without touching any
 * platform API.
 */
export function createSourcesRouter(options: SourcesRouterOptions) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({ sources: listSourceManifests() });
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

  return router;
}

function parseLevelQuery(value: unknown): AriaLevel | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !isAriaLevel(value)) {
    throw new SourceError("UNSUPPORTED", `无效的音质档位: ${String(value)}`);
  }
  return value;
}
