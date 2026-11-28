import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { ProviderTrack } from "../providers/musicProvider";
import {
  deletePrivateCloudInstance,
  getPrivateCloudInstance,
  getPrivateCloudPassword,
  listEnabledPrivateCloudInstances,
  listPrivateCloudInstances,
  normalizeBaseUrl,
  normalizeRootPath,
  toPublicInstance,
  updatePrivateCloudSyncMeta,
  upsertPrivateCloudInstance,
  type StoredPrivateCloudInstance,
} from "../sources/privateCloudStore";
import { encryptSecret } from "../utils/secretBox";
import {
  buildSubsonicCoverUrl,
  listSubsonicRecentTracks,
  pingSubsonic,
  scrobbleSubsonic,
} from "../sources/subsonic/client";
import { testWebdavConnection } from "../sources/webdav/client";
import { getWebdavIndexDb } from "../sources/webdav/db";
import { buildWebdavBasicAuthHeader, buildWebdavRemoteUrl, fetchWebdavWithAuthStrip, proxyWebdavStream } from "../sources/webdav/proxy";
import { getWebdavScanProgress, scanWebdavInstance } from "../sources/webdav/scanner";
import { mapWebdavRowToProviderTrack } from "../sources/webdav/source";
import { HttpError } from "../utils/httpError";

const instanceBodySchema = z.object({
  kind: z.enum(["subsonic", "webdav"]),
  name: z.string().trim().min(1).max(64),
  baseUrl: z.string().trim().min(3).max(500),
  username: z.string().trim().max(120).optional(),
  password: z.string().max(500).optional(),
  rootPath: z.string().trim().max(300).optional(),
  enabled: z.boolean().optional(),
  mobileTranscodeBitrate: z.number().int().min(64).max(320).optional(),
});

const draftTestSchema = instanceBodySchema.extend({
  name: z.string().trim().max(64).optional(),
  instanceId: z.string().trim().optional(),
});

function formatFriendlyConnectionError(reason: string, kind: "subsonic" | "webdav"): string {
  const lower = reason.toLowerCase();
  if (lower.includes("401") || lower.includes("403") || lower.includes("wrong username") || lower.includes("密码")) {
    return "账号或密码验证失败，请核对用户名与密码（若使用坚果云请填写「应用密码」）。";
  }
  if (kind === "webdav" && lower.includes("405")) {
    return "该地址不支持 WebDAV 协议；如果连接 Alist，请确认服务器地址末尾包含 /dav。";
  }
  if (lower.includes("404")) {
    return "地址路径不存在（404）：连接 Alist 请确认以 /dav 结尾，连接 Navidrome 请填写根地址（不含 /app）。";
  }
  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("etimedout") || lower.includes("fetch failed")) {
    return "无法连接服务器，请检查地址、端口号，或确认 NAS / 电脑处于同一局域网并已放行端口。";
  }
  return reason || "连接测试失败，请检查服务器地址与网络配置。";
}

export function createPrivateCloudRouter() {
  const router = express.Router();

  router.post("/test-connection", async (req, res, next) => {
    try {
      const parsed = draftTestSchema.parse(req.body);
      const existing = parsed.instanceId ? await getPrivateCloudInstance(parsed.instanceId) : null;
      const encryptedPassword =
        typeof parsed.password === "string" && parsed.password.length > 0
          ? encryptSecret(parsed.password)
          : existing?.encryptedPassword ?? "";
      const normalizedUrl = normalizeBaseUrl(parsed.baseUrl, parsed.kind);
      const transient: StoredPrivateCloudInstance = {
        id: existing?.id ?? "draft-test",
        kind: parsed.kind,
        name: parsed.name?.trim() || "测试连接",
        baseUrl: normalizedUrl,
        username: (parsed.username ?? existing?.username ?? "").trim(),
        encryptedPassword,
        rootPath: parsed.kind === "webdav" ? normalizeRootPath(parsed.rootPath ?? existing?.rootPath) : undefined,
        enabled: true,
        mobileTranscodeBitrate: parsed.mobileTranscodeBitrate ?? 192,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const result =
        transient.kind === "subsonic" ? await pingSubsonic(transient) : await testWebdavConnection(transient);
      res.json({
        ...result,
        normalizedUrl,
        ...(result.ok ? {} : { reason: formatFriendlyConnectionError(result.reason ?? "", transient.kind) }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances", async (_req, res, next) => {
    try {
      const db = getWebdavIndexDb();
      const instances = await listPrivateCloudInstances();
      res.json({
        instances: instances.map((instance) => ({
          ...toPublicInstance(instance),
          trackCount: instance.kind === "webdav" ? db.countByInstance(instance.id) : instance.trackCount ?? 0,
          scanning: instance.kind === "webdav" ? getWebdavScanProgress(instance.id).scanning : false,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances", async (req, res, next) => {
    try {
      const parsed = instanceBodySchema.parse(req.body);
      const saved = await upsertPrivateCloudInstance(parsed);
      res.json({ instance: toPublicInstance(saved) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/instances/:id", async (req, res, next) => {
    try {
      const parsed = instanceBodySchema.parse(req.body);
      const saved = await upsertPrivateCloudInstance({ ...parsed, id: req.params.id });
      res.json({ instance: toPublicInstance(saved) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/instances/:id", async (req, res, next) => {
    try {
      const existing = await getPrivateCloudInstance(req.params.id);
      if (!existing) throw new HttpError(404, "未找到该私有云实例", "PRIVATE_CLOUD_NOT_FOUND");
      await deletePrivateCloudInstance(req.params.id);
      if (existing.kind === "webdav") {
        getWebdavIndexDb().deleteInstanceTracks(req.params.id);
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances/:id/test", async (req, res, next) => {
    try {
      const instance = await getPrivateCloudInstance(req.params.id);
      if (!instance) throw new HttpError(404, "未找到该私有云实例", "PRIVATE_CLOUD_NOT_FOUND");
      const result =
        instance.kind === "subsonic" ? await pingSubsonic(instance) : await testWebdavConnection(instance);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/instances/:id/scan", async (req, res, next) => {
    try {
      const instance = await getPrivateCloudInstance(req.params.id);
      if (!instance) throw new HttpError(404, "未找到该私有云实例", "PRIVATE_CLOUD_NOT_FOUND");
      if (instance.kind === "webdav") {
        const progress = await scanWebdavInstance(instance);
        res.json({ progress });
        return;
      }
      const tracks = await listSubsonicRecentTracks(instance, "newest", 12);
      await updatePrivateCloudSyncMeta(instance.id, { lastSyncAt: Date.now(), trackCount: tracks.length });
      res.json({
        progress: {
          instanceId: instance.id,
          scanning: false,
          discovered: tracks.length,
          scanned: tracks.length,
          skipped: 0,
          errors: 0,
          lastError: null,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/instances/:id/scan-status", (req, res) => {
    res.json({ progress: getWebdavScanProgress(req.params.id) });
  });

  router.get("/tracks", async (req, res, next) => {
    try {
      const instanceId = typeof req.query.instanceId === "string" && req.query.instanceId.trim() ? req.query.instanceId.trim() : undefined;
      const albumListType =
        req.query.albumListType === "frequent" || req.query.albumListType === "random" ? req.query.albumListType : "newest";
      const enabled = await listEnabledPrivateCloudInstances();
      const targets = instanceId ? enabled.filter((item) => item.id === instanceId) : enabled;
      const tracks: ProviderTrack[] = [];
      const db = getWebdavIndexDb();

      for (const item of targets) {
        if (item.kind === "webdav") {
          tracks.push(...db.listTracks(item.id, 1000, 0).map(mapWebdavRowToProviderTrack));
        } else {
          const subTracks = await listSubsonicRecentTracks(item, albumListType, 10).catch(() => []);
          tracks.push(...subTracks);
        }
      }
      res.json({ tracks });
    } catch (error) {
      next(error);
    }
  });

  router.get("/subsonic/:instanceId/cover/:coverId", async (req, res, next) => {
    try {
      const instance = await getPrivateCloudInstance(req.params.instanceId);
      if (!instance || instance.kind !== "subsonic") {
        throw new HttpError(404, "OpenSubsonic 实例不存在", "PRIVATE_CLOUD_NOT_FOUND");
      }
      const size = Number(req.query.size);
      const url = buildSubsonicCoverUrl(instance, req.params.coverId, Number.isFinite(size) && size > 0 ? size : 300);
      const upstream = await fetch(url, { headers: { "User-Agent": "Aria/0.9.0" } });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        throw new HttpError(404, "无法获取封面", "SUBSONIC_COVER_FAILED");
      }
      res.setHeader("content-type", upstream.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>), res);
    } catch (error) {
      next(error);
    }
  });

  router.post("/subsonic/:instanceId/scrobble/:songId", async (req, res, next) => {
    try {
      const instance = await getPrivateCloudInstance(req.params.instanceId);
      if (!instance || instance.kind !== "subsonic" || instance.enabled === false) {
        throw new HttpError(404, "OpenSubsonic 实例不可用", "PRIVATE_CLOUD_NOT_FOUND");
      }
      const submission = req.body?.submission !== false;
      await scrobbleSubsonic(instance, req.params.songId, submission);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/webdav/stream/:id", async (req, res, next) => {
    try {
      const row = getWebdavIndexDb().getTrackById(req.params.id);
      if (!row) throw new HttpError(404, "WebDAV 曲目不存在", "WEBDAV_TRACK_NOT_FOUND");
      const instance = await getPrivateCloudInstance(row.instanceId);
      if (!instance || instance.kind !== "webdav" || instance.enabled === false) {
        throw new HttpError(404, "WebDAV 实例不可用", "PRIVATE_CLOUD_NOT_FOUND");
      }
      await proxyWebdavStream(req, res, instance, row.remotePath);
    } catch (error) {
      next(error);
    }
  });

  router.get("/webdav/cover/:id", async (req, res, next) => {
    try {
      const row = getWebdavIndexDb().getTrackById(req.params.id);
      if (!row?.coverPath) throw new HttpError(404, "WebDAV 封面不存在", "WEBDAV_COVER_NOT_FOUND");
      const instance = await getPrivateCloudInstance(row.instanceId);
      if (!instance || instance.kind !== "webdav") {
        throw new HttpError(404, "WebDAV 实例不存在", "PRIVATE_CLOUD_NOT_FOUND");
      }
      const password = getPrivateCloudPassword(instance);
      const authHeader = instance.username || password ? buildWebdavBasicAuthHeader(instance.username, password) : null;
      const upstream = await fetchWebdavWithAuthStrip(buildWebdavRemoteUrl(instance.baseUrl, row.coverPath), authHeader);
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        throw new HttpError(404, "读取 WebDAV 封面失败", "WEBDAV_COVER_FAILED");
      }
      res.setHeader("content-type", upstream.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>), res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
