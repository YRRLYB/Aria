import express from "express";
import { z } from "zod";
import { AriaRoomManager } from "../ariaRoom/roomManager";
import type { AriaRoomTrackPayload } from "../ariaRoom/byteCache";
import { HttpError } from "../utils/httpError";

const capabilitiesSchema = z.object({
  netease: z.enum(["vip", "free", "none"]),
  qq: z.enum(["vip", "free", "none"]),
  bilibili: z.enum(["vip", "free", "none"]),
  youtube: z.enum(["reachable", "unreachable"]),
});

const dispatchSchema = z.object({
  mode: z.enum(["resolve_local", "direct_url", "stream_proxy"]),
  providerPeerId: z.string().min(1).max(80),
  directUrl: z.string().max(3000).nullable().optional(),
  safeHeaders: z.record(z.string(), z.string()).optional(),
  mimeType: z.string().max(120).nullable().optional(),
  expiresAt: z.number().nullable().optional(),
});

const trackPayloadSchema: z.ZodType<AriaRoomTrackPayload> = z.object({
  nonce: z.string().min(1).max(48),
  id: z.string().min(1).max(200),
  providerId: z.string().max(200).optional(),
  source: z.enum(["local", "cloud", "netease", "qq", "bilibili", "youtube"]),
  title: z.string().max(300),
  artist: z.string().max(300),
  album: z.string().max(300),
  duration: z.string().max(32),
  quality: z.enum(["臻品", "Hi-Res", "FLAC", "Lossless", "320K", "128K", "AAC"]),
  bitrate: z.number().nullable().optional(),
  sampleRate: z.number().nullable().optional(),
  currentLevel: z.enum(["standard", "higher", "exhigh", "lossless", "hires", "jymaster"]).nullable().optional(),
  availableLevels: z.array(z.enum(["standard", "higher", "exhigh", "lossless", "hires", "jymaster"])).max(8).optional(),
  coverUrl: z.string().max(1500).nullable().optional(),
  coverDataUrl: z.string().max(64_000).nullable().optional(),
  streamUrl: z.string().max(1500).nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(),
  addedByPeerId: z.string().max(80).optional(),
  addedByName: z.string().max(120).optional(),
  dispatch: dispatchSchema.nullable().optional(),
});

export function createAriaRoomRouter(options: { localApiPort: number; manager?: AriaRoomManager }) {
  const router = express.Router();
  const manager = options.manager ?? new AriaRoomManager({ localApiPort: options.localApiPort });

  router.get("/status", async (_req, res, next) => {
    try {
      const [config] = await Promise.all([
        manager.ensureConfigLoaded(),
        manager.detectLocalCapabilities(),
      ]);
      res.json({
        snapshot: manager.getSnapshot(),
        config,
        probeResults: manager.getLastProbeResults(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/events", (req, res) => {
    const detach = manager.attachSseClient(res);
    req.once("close", detach);
  });

  router.get("/config", async (_req, res, next) => {
    try {
      res.json(await manager.ensureConfigLoaded());
    } catch (error) {
      next(error);
    }
  });

  router.post("/config", async (req, res, next) => {
    try {
      const body = z
        .object({
          signalingProvider: z.enum(["cloudflare", "self-hosted"]).optional(),
          signalingUrl: z.string().max(500).optional(),
          selfHostedSignalingUrl: z.string().max(500).optional(),
          preferredIps: z.array(z.string().max(100)).max(32).optional(),
          autoPreferredIp: z.boolean().optional(),
          selectedPreferredIp: z.string().max(100).nullable().optional(),
          directPort: z.number().int().min(1024).max(65535).optional(),
          publicHost: z.string().max(255).optional(),
          turnUrls: z.array(z.string().max(300)).max(8).optional(),
          turnUsername: z.string().max(200).optional(),
          turnCredential: z.string().max(200).optional(),
        })
        .parse(req.body ?? {});
      res.json(await manager.updateConfig(body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/probe-ips", async (req, res, next) => {
    try {
      const body = z
        .object({
          signalingUrl: z.string().max(500).optional(),
          provider: z.enum(["cloudflare", "self-hosted"]).optional(),
        })
        .parse(req.body ?? {});
      const results = await manager.probePreferredIps(body.signalingUrl, body.provider);
      const config = await manager.ensureConfigLoaded();
      res.json({ results, config });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/create", async (req, res, next) => {
    try {
      const body = z
        .object({
          peerId: z.string().min(1).max(80),
          nickname: z.string().min(1).max(80),
          avatarUrl: z.string().max(80_000).nullable().optional(),
          shareEnabled: z.boolean().optional(),
          capabilities: capabilitiesSchema.optional(),
          networkMode: z.enum(["cloudflare", "direct", "hybrid"]).default("cloudflare"),
          controlMode: z.enum(["host-only", "collaborative"]).optional(),
          roomId: z.string().max(32).nullable().optional(),
          rejoin: z.boolean().optional(),
          directPort: z.number().int().min(1024).max(65535).optional(),
          publicHost: z.string().max(255).nullable().optional(),
          signalingUrl: z.string().max(500).nullable().optional(),
          preferredIp: z.string().max(100).nullable().optional(),
          track: trackPayloadSchema.nullable().optional(),
          nextTrack: trackPayloadSchema.nullable().optional(),
          queue: z.array(trackPayloadSchema).max(500).optional(),
          playing: z.boolean().optional(),
          positionSec: z.number().min(0).optional(),
        })
        .parse(req.body ?? {});
      res.json(await manager.createRoom(body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/join", async (req, res, next) => {
    try {
      const body = z
        .object({
          peerId: z.string().min(1).max(80),
          nickname: z.string().min(1).max(80),
          avatarUrl: z.string().max(80_000).nullable().optional(),
          shareEnabled: z.boolean().optional(),
          capabilities: capabilitiesSchema.optional(),
          mode: z.enum(["cloudflare", "direct"]).default("cloudflare"),
          roomId: z.string().max(64).nullable().optional(),
          directHost: z.string().max(255).nullable().optional(),
          directPort: z.number().int().min(1024).max(65535).nullable().optional(),
          directToken: z.string().max(256).nullable().optional(),
          signalingUrl: z.string().max(500).nullable().optional(),
          preferredIp: z.string().max(100).nullable().optional(),
        })
        .parse(req.body ?? {});
      res.json(await manager.joinRoom(body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/leave", async (_req, res, next) => {
    try {
      res.json(await manager.leaveRoom());
    } catch (error) {
      next(error);
    }
  });

  router.post("/presence", (req, res, next) => {
    try {
      const body = z
        .object({
          presence: z.enum(["active", "away"]),
        })
        .parse(req.body ?? {});
      manager.updateLocalPresence(body.presence);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/kick-member", (req, res, next) => {
    try {
      const body = z
        .object({
          peerId: z.string().min(1).max(80),
        })
        .parse(req.body ?? {});
      manager.kickMember(body.peerId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/host/prepare", async (req, res, next) => {
    try {
      const body = z
        .object({
          track: trackPayloadSchema.nullable(),
          nextTrack: trackPayloadSchema.nullable().optional(),
          queue: z.array(trackPayloadSchema).max(500).optional(),
          playing: z.boolean().optional(),
          positionSec: z.number().min(0).optional(),
          controlMode: z.enum(["host-only", "collaborative"]).optional(),
        })
        .parse(req.body ?? {});
      res.json(await manager.hostPrepareAndUpdateState(body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/host/sync", (req, res, next) => {
    try {
      const body = z
        .object({
          kind: z.enum(["play_at", "pause", "seek", "track_change"]),
          nonce: z.string().max(48).nullable(),
          positionSec: z.number().min(0),
          startAtHostMs: z.number().min(0),
        })
        .parse(req.body ?? {});
      res.json(manager.hostBroadcastPlaybackSync(body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/host/prefetch-next", async (req, res, next) => {
    try {
      const body = z.object({ nextTrack: trackPayloadSchema }).parse(req.body ?? {});
      res.json({ nextTrack: await manager.prefetchNextTrack(body.nextTrack) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/capabilities", (req, res, next) => {
    try {
      const body = z
        .object({
          shareEnabled: z.boolean(),
          capabilities: capabilitiesSchema.partial().optional(),
        })
        .parse(req.body ?? {});
      res.json(manager.updateShareAndCapabilities(body.shareEnabled, body.capabilities));
    } catch (error) {
      next(error);
    }
  });

  router.get("/host/tracks/:nonce/slice", async (req, res, next) => {
    const controller = new AbortController();
    req.once("aborted", () => controller.abort());
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const query = z
        .object({
          offset: z.coerce.number().int().min(0).default(0),
          length: z.coerce.number().int().min(1024).max(1024 * 1024).default(65536),
        })
        .parse(req.query);
      const slice = await manager.readHostTrackSlice(
        req.params.nonce,
        query.offset,
        query.length,
        controller.signal,
      );
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(slice.chunk.byteLength));
      res.setHeader("X-Aria-Offset", String(slice.offset));
      res.setHeader("X-Aria-Next-Offset", String(slice.offset + slice.chunk.byteLength));
      res.setHeader("X-Aria-Total-Bytes", slice.totalBytes !== null ? String(slice.totalBytes) : "");
      res.setHeader("X-Aria-Eof", slice.eof ? "1" : "0");
      res.setHeader("X-Aria-Mime-Type", slice.mimeType);
      if (slice.bitrate) res.setHeader("X-Aria-Bitrate", String(slice.bitrate));
      if (slice.sampleRate) res.setHeader("X-Aria-Sample-Rate", String(slice.sampleRate));
      if (slice.currentLevel) res.setHeader("X-Aria-Level", slice.currentLevel);
      res.send(slice.chunk);
    } catch (error) {
      if (controller.signal.aborted) return;
      next(error);
    }
  });

  router.post(
    "/guest/chunk",
    express.raw({ type: "application/octet-stream", limit: "2mb" }),
    async (req, res, next) => {
      try {
        const nonce = String(req.headers["x-aria-nonce"] ?? "").trim();
        const offset = Number(req.headers["x-aria-offset"] ?? "0");
        const eof = String(req.headers["x-aria-eof"] ?? "0") === "1";
        const rawTotal = String(req.headers["x-aria-total-bytes"] ?? "").trim();
        const totalBytes = rawTotal ? Number(rawTotal) : null;
        const mimeType = typeof req.headers["x-aria-mime-type"] === "string" ? req.headers["x-aria-mime-type"] : null;
        const bitrate = req.headers["x-aria-bitrate"] ? Number(req.headers["x-aria-bitrate"]) : null;
        const sampleRate = req.headers["x-aria-sample-rate"] ? Number(req.headers["x-aria-sample-rate"]) : null;
        const currentLevel = typeof req.headers["x-aria-level"] === "string" ? req.headers["x-aria-level"] : null;

        if (!nonce || !Number.isFinite(offset) || offset < 0) {
          throw new HttpError(400, "Invalid guest chunk headers", "INVALID_CHUNK_HEADERS");
        }
        const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const entry = await manager.ingestGuestChunk({
          nonce,
          offset,
          chunk,
          eof,
          totalBytes: totalBytes && Number.isFinite(totalBytes) ? totalBytes : null,
          mimeType,
          bitrate: bitrate && Number.isFinite(bitrate) ? bitrate : null,
          sampleRate: sampleRate && Number.isFinite(sampleRate) ? sampleRate : null,
          currentLevel,
        });
        res.json({
          ok: true,
          downloadedBytes: entry.downloadedBytes,
          totalBytes: entry.totalBytes,
          completed: entry.completed,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/guest/stream/:nonce", async (req, res, next) => {
    try {
      await manager.serveGuestTrackStream(req, res, req.params.nonce);
    } catch (error) {
      next(error);
    }
  });

  router.get("/guest/cover/:nonce", async (req, res, next) => {
    try {
      await manager.serveGuestTrackCover(req, res, req.params.nonce);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tracks/:nonce/progress", (req, res) => {
    res.json({ progress: manager.getBufferProgress(req.params.nonce) });
  });

  router.post("/signal", (req, res, next) => {
    try {
      const body = z
        .object({
          toPeerId: z.string().min(1).max(80),
          payload: z.unknown(),
        })
        .parse(req.body ?? {});
      manager.sendSignal(body.toPeerId, body.payload);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/control-request", (req, res, next) => {
    try {
      const body = z
        .object({
          action: z.string().min(1).max(40),
          payload: z.unknown().optional(),
        })
        .parse(req.body ?? {});
      manager.sendControlRequest(body.action, body.payload ?? null);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/track-ready", (req, res, next) => {
    try {
      const body = z
        .object({
          nonce: z.string().min(1).max(48),
          bufferedBytes: z.number().min(0).default(0),
        })
        .parse(req.body ?? {});
      manager.sendTrackReady(body.nonce, body.bufferedBytes);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/clock-ping", (_req, res) => {
    res.json({ pingId: manager.sendClockPing() });
  });

  return router;
}
