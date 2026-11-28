import crypto from "node:crypto";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { getPrivateCloudPassword, updatePrivateCloudSyncMeta, type StoredPrivateCloudInstance } from "../privateCloudStore";
import { propfindDirectory, type WebdavEntry } from "./client";
import { getWebdavIndexDb, type WebdavIndexDb, type WebdavTrackRow } from "./db";
import { buildWebdavBasicAuthHeader, buildWebdavRemoteUrl, fetchWebdavWithAuthStrip } from "./proxy";

const AUDIO_EXTS = new Set([".flac", ".wav", ".mp3", ".m4a", ".opus", ".ogg", ".ape", ".alac"]);
const COVER_FILENAMES = new Set(["cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "folder.png", "front.jpg", "front.png"]);
const HEAD_PROBE_BYTES = 131_072; // 128 KB
const TAIL_PROBE_BYTES = 65_536;  // 64 KB
const MAX_SCAN_DEPTH = 12;

export type WebdavScanProgress = {
  instanceId: string;
  scanning: boolean;
  discovered: number;
  scanned: number;
  skipped: number;
  errors: number;
  lastError: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

const scanProgressMap = new Map<string, WebdavScanProgress>();

export function getWebdavScanProgress(instanceId: string): WebdavScanProgress {
  return (
    scanProgressMap.get(instanceId) ?? {
      instanceId,
      scanning: false,
      discovered: 0,
      scanned: 0,
      skipped: 0,
      errors: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    }
  );
}

export function computeWebdavTrackId(instanceId: string, remotePath: string): string {
  return crypto.createHash("sha1").update(`${instanceId}\0${remotePath}`, "utf8").digest("hex");
}

function guessMimeFromExt(ext: string): string {
  switch (ext) {
    case ".flac":
      return "audio/flac";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
    case ".alac":
      return "audio/mp4";
    case ".opus":
    case ".ogg":
      return "audio/ogg";
    case ".ape":
      return "audio/ape";
    default:
      return "application/octet-stream";
  }
}

export function inferMetadataFromPath(remotePath: string): { title: string; artist: string | null; album: string | null } {
  const parts = remotePath.split("/").filter(Boolean);
  const fileName = parts.pop() || "Untitled";
  const album = parts.length >= 1 ? parts[parts.length - 1] : null;
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/^\d{1,3}[\s._-]+/, "").trim();
  const dashSplit = stem.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashSplit) {
    return {
      artist: dashSplit[1].trim() || null,
      title: dashSplit[2].trim() || stem,
      album,
    };
  }
  return { title: stem || fileName, artist: parts.length >= 2 ? parts[parts.length - 2] : null, album };
}

export async function probeWebdavAudioMetadata(
  instance: StoredPrivateCloudInstance,
  entry: WebdavEntry,
  signal?: AbortSignal,
): Promise<{
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrateKbps: number | null;
  format: string;
}> {
  const ext = path.posix.extname(entry.remotePath).toLowerCase();
  const format = ext.replace(/^\./, "") || "raw";
  const inferred = inferMetadataFromPath(entry.remotePath);
  const mimeType = guessMimeFromExt(ext);
  const password = getPrivateCloudPassword(instance);
  const authHeader = instance.username || password ? buildWebdavBasicAuthHeader(instance.username, password) : null;
  const targetUrl = buildWebdavRemoteUrl(instance.baseUrl, entry.remotePath);

  try {
    const headEnd = entry.size > 0 ? Math.min(HEAD_PROBE_BYTES - 1, entry.size - 1) : HEAD_PROBE_BYTES - 1;
    const res = await fetchWebdavWithAuthStrip(targetUrl, authHeader, {
      method: "GET",
      headers: { Range: `bytes=0-${headEnd}` },
      signal,
    });

    if (res.status !== 206) {
      // Server does not support Range requests: immediately abort body so full file is never downloaded.
      await res.body?.cancel();
      return {
        ...inferred,
        durationMs: 0,
        sampleRate: null,
        bitDepth: null,
        bitrateKbps: null,
        format,
      };
    }

    const headBuffer = Buffer.from(await res.arrayBuffer());
    let parsed = await parseBuffer(headBuffer, { mimeType, size: entry.size || undefined }, { duration: true, skipCovers: true }).catch(() => null);

    // Optional tail 64 KB probe when M4A/MP3 metadata/moov lives at the end of a large file.
    if (
      (ext === ".m4a" || ext === ".mp3") &&
      entry.size > HEAD_PROBE_BYTES &&
      (!parsed?.common?.title || !parsed?.format?.duration)
    ) {
      const tailStart = Math.max(HEAD_PROBE_BYTES, entry.size - TAIL_PROBE_BYTES);
      const tailRes = await fetchWebdavWithAuthStrip(targetUrl, authHeader, {
        method: "GET",
        headers: { Range: `bytes=${tailStart}-${entry.size - 1}` },
        signal,
      }).catch(() => null);
      if (tailRes?.status === 206) {
        const tailBuf = Buffer.from(await tailRes.arrayBuffer());
        const tailParsed = await parseBuffer(tailBuf, { mimeType }, { duration: true, skipCovers: true }).catch(() => null);
        if (tailParsed?.common?.title || tailParsed?.format?.duration) {
          parsed = tailParsed;
        }
      } else {
        await tailRes?.body?.cancel();
      }
    }

    const common = parsed?.common;
    const fmt = parsed?.format;
    return {
      title: common?.title?.trim() || inferred.title,
      artist: common?.artist?.trim() || common?.albumartist?.trim() || inferred.artist,
      album: common?.album?.trim() || inferred.album,
      durationMs: typeof fmt?.duration === "number" && Number.isFinite(fmt.duration) ? Math.round(fmt.duration * 1000) : 0,
      sampleRate: typeof fmt?.sampleRate === "number" ? Math.round(fmt.sampleRate) : null,
      bitDepth: typeof fmt?.bitsPerSample === "number" ? Math.round(fmt.bitsPerSample) : null,
      bitrateKbps: typeof fmt?.bitrate === "number" ? Math.round(fmt.bitrate / 1000) : null,
      format: fmt?.container?.toLowerCase() || format,
    };
  } catch {
    return {
      ...inferred,
      durationMs: 0,
      sampleRate: null,
      bitDepth: null,
      bitrateKbps: null,
      format,
    };
  }
}

export async function scanWebdavInstance(
  instance: StoredPrivateCloudInstance,
  db: WebdavIndexDb = getWebdavIndexDb(),
  signal?: AbortSignal,
): Promise<WebdavScanProgress> {
  const progress: WebdavScanProgress = {
    instanceId: instance.id,
    scanning: true,
    discovered: 0,
    scanned: 0,
    skipped: 0,
    errors: 0,
    lastError: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  scanProgressMap.set(instance.id, progress);

  try {
    const visitedDirs = new Set<string>();
    const dirQueue: Array<{ path: string; depth: number }> = [{ path: instance.rootPath || "/", depth: 0 }];
    const existingEtags = db.getExistingEtags(instance.id);
    const keepPaths = new Set<string>();
    const pendingUpserts: WebdavTrackRow[] = [];

    while (dirQueue.length > 0) {
      if (signal?.aborted) break;
      const current = dirQueue.shift()!;
      if (visitedDirs.has(current.path) || current.depth > MAX_SCAN_DEPTH) continue;
      visitedDirs.add(current.path);

      let entries: WebdavEntry[] = [];
      try {
        entries = await propfindDirectory(instance, current.path, 1, signal);
      } catch (error) {
        progress.errors += 1;
        progress.lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      const lrcByStem = new Map<string, string>();
      let folderCoverPath: string | null = null;
      const audioEntries: WebdavEntry[] = [];

      for (const entry of entries) {
        if (entry.isDir) {
          if (!visitedDirs.has(entry.remotePath) && current.depth + 1 <= MAX_SCAN_DEPTH) {
            dirQueue.push({ path: entry.remotePath, depth: current.depth + 1 });
          }
          continue;
        }
        const lowerName = entry.name.toLowerCase();
        const ext = path.posix.extname(lowerName);
        if (ext === ".lrc") {
          const stem = entry.remotePath.slice(0, -4).toLowerCase();
          lrcByStem.set(stem, entry.remotePath);
          continue;
        }
        if (COVER_FILENAMES.has(lowerName) && !folderCoverPath) {
          folderCoverPath = entry.remotePath;
          continue;
        }
        if (AUDIO_EXTS.has(ext)) {
          audioEntries.push(entry);
        }
      }

      progress.discovered += audioEntries.length;

      for (const audio of audioEntries) {
        if (signal?.aborted) break;
        keepPaths.add(audio.remotePath);
        const ext = path.posix.extname(audio.remotePath);
        const stem = audio.remotePath.slice(0, audio.remotePath.length - ext.length).toLowerCase();
        const lyricPath = lrcByStem.get(stem) ?? null;
        const cached = existingEtags.get(audio.remotePath);

        if (cached && cached.etag === audio.etag && cached.fileSize === audio.size) {
          progress.skipped += 1;
          continue;
        }

        const meta = await probeWebdavAudioMetadata(instance, audio, signal);
        pendingUpserts.push({
          id: computeWebdavTrackId(instance.id, audio.remotePath),
          instanceId: instance.id,
          remotePath: audio.remotePath,
          etag: audio.etag,
          fileSize: audio.size,
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          durationMs: meta.durationMs,
          sampleRate: meta.sampleRate,
          bitDepth: meta.bitDepth,
          bitrateKbps: meta.bitrateKbps,
          format: meta.format,
          lyricPath,
          coverPath: folderCoverPath,
          updatedAt: Date.now(),
        });
        progress.scanned += 1;

        if (pendingUpserts.length >= 40) {
          db.upsertTracks(pendingUpserts.splice(0, pendingUpserts.length));
        }
      }
    }

    if (pendingUpserts.length > 0) {
      db.upsertTracks(pendingUpserts);
    }
    if (!signal?.aborted) {
      db.pruneMissingPaths(instance.id, keepPaths);
    }
    const trackCount = db.countByInstance(instance.id);
    await updatePrivateCloudSyncMeta(instance.id, { lastSyncAt: Date.now(), trackCount });
  } finally {
    progress.scanning = false;
    progress.finishedAt = Date.now();
    scanProgressMap.set(instance.id, { ...progress });
  }

  return progress;
}
