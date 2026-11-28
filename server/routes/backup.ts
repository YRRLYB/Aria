import express from "express";
import { z } from "zod";
import { getPrivateCloudInstance } from "../sources/privateCloudStore";
import { getWebdavFileText, putWebdavFileText } from "../sources/webdav/client";
import { HttpError } from "../utils/httpError";

const webdavSyncBodySchema = z.object({
  instanceId: z.string().trim().min(1).max(120),
  remotePath: z.string().trim().min(1).max(300).default("/aria-backup.json"),
});

const webdavPushBodySchema = webdavSyncBodySchema.extend({
  snapshot: z.unknown(),
});

function sanitizeBackupRemotePath(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/");
  const withLead = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  if (withLead.includes("..")) {
    throw new HttpError(400, "无效的 WebDAV 备份路径", "INVALID_BACKUP_PATH");
  }
  return withLead;
}

export function createBackupRouter() {
  const router = express.Router();

  router.post("/webdav/push", async (req, res, next) => {
    try {
      const parsed = webdavPushBodySchema.parse(req.body);
      const instance = await getPrivateCloudInstance(parsed.instanceId);
      if (!instance || instance.kind !== "webdav") {
        throw new HttpError(404, "未找到对应的 WebDAV 实例", "PRIVATE_CLOUD_NOT_FOUND");
      }
      const targetPath = sanitizeBackupRemotePath(parsed.remotePath);
      const serialized = `${JSON.stringify(parsed.snapshot, null, 2)}\n`;
      await putWebdavFileText(instance, targetPath, serialized);
      res.json({ ok: true, remotePath: targetPath, bytes: Buffer.byteLength(serialized, "utf8") });
    } catch (error) {
      next(error);
    }
  });

  router.post("/webdav/pull", async (req, res, next) => {
    try {
      const parsed = webdavSyncBodySchema.parse(req.body);
      const instance = await getPrivateCloudInstance(parsed.instanceId);
      if (!instance || instance.kind !== "webdav") {
        throw new HttpError(404, "未找到对应的 WebDAV 实例", "PRIVATE_CLOUD_NOT_FOUND");
      }
      const targetPath = sanitizeBackupRemotePath(parsed.remotePath);
      const text = await getWebdavFileText(instance, targetPath);
      const snapshot = JSON.parse(text) as unknown;
      res.json({ ok: true, remotePath: targetPath, snapshot });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
