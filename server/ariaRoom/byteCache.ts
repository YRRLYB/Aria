import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { findTrack } from "../libraryStore";
import { readOrExtractLocalCover } from "../localCoverCache";
import { isSourceId, parseTrackKey, type AriaLevel } from "../sources/contract";
import { getSource } from "../sources/registry";
import { HttpError } from "../utils/httpError";

export type AriaRoomCapabilities = {
  netease: "vip" | "free" | "none";
  qq: "vip" | "free" | "none";
  bilibili: "vip" | "free" | "none";
  youtube: "reachable" | "unreachable";
};

export type AriaRoomDeliveryMode = "resolve_local" | "direct_url" | "stream_proxy";

export type AriaRoomTrackDispatch = {
  mode: AriaRoomDeliveryMode;
  providerPeerId: string;
  directUrl?: string | null;
  safeHeaders?: Record<string, string>;
  mimeType?: string | null;
  expiresAt?: number | null;
};

export type AriaRoomTrackPayload = {
  nonce: string;
  id: string;
  providerId?: string;
  source: "local" | "cloud" | "netease" | "qq" | "bilibili" | "youtube";
  title: string;
  artist: string;
  album: string;
  duration: string;
  quality: "臻品" | "Hi-Res" | "FLAC" | "Lossless" | "320K" | "128K" | "AAC";
  bitrate?: number | null;
  sampleRate?: number | null;
  currentLevel?: AriaLevel | null;
  availableLevels?: AriaLevel[];
  coverUrl?: string | null;
  coverDataUrl?: string | null;
  streamUrl?: string | null;
  mimeType?: string | null;
  addedByPeerId?: string;
  addedByName?: string;
  dispatch?: AriaRoomTrackDispatch | null;
};

export type BufferedTrackEntry = {
  nonce: string;
  track: AriaRoomTrackPayload;
  kind: "local-file" | "temp-file";
  filePath: string;
  mimeType: string;
  bitrate: number | null;
  sampleRate: number | null;
  currentLevel: string | null;
  totalBytes: number | null;
  downloadedBytes: number;
  completed: boolean;
  failedError: string | null;
  createdAt: number;
  lastAccessAt: number;
  abortController: AbortController | null;
  waiters: Set<() => void>;
  writeHandle?: Awaited<ReturnType<typeof fs.open>> | null;
  writeQueue?: Promise<void>;
};

export type HostSliceResult = {
  chunk: Buffer;
  offset: number;
  totalBytes: number | null;
  eof: boolean;
  mimeType: string;
  bitrate: number | null;
  sampleRate: number | null;
  currentLevel: string | null;
};

type CachedCover = {
  body: Buffer;
  contentType: string;
  fetchedAt: number;
};

const MAX_RETAINED_TRACKS = 3;
const MAX_CACHED_COVERS = 6;
const SLICE_WAIT_TIMEOUT_MS = 15_000;

function isYoutubeArtworkUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return ["ytimg.com", "ggpht.com", "googleusercontent.com", "googleusercontent.goog", "youtube.com", "googlevideo.com"].some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

function parseCoverDataUrl(dataUrl: string | null | undefined): { body: Buffer; contentType: string } | null {
  if (!dataUrl) return null;
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const body = Buffer.from(match[2], "base64");
  if (body.byteLength === 0 || body.byteLength > 64 * 1024) return null;
  return { body, contentType: match[1] };
}

function sanitizeNonce(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
}

export function mimeFromFormat(format: string | null | undefined): string {
  const normalized = (format ?? "").toLowerCase();
  if (normalized.includes("flac")) return "audio/flac";
  if (normalized.includes("wav")) return "audio/wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "audio/mpeg";
  if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "audio/mp4";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "audio/ogg";
  if (normalized.includes("ape")) return "audio/ape";
  return "application/octet-stream";
}

function parseByteRange(rangeHeader: string, totalBytes: number | null): { start: number; end: number | null } | "invalid" {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return "invalid";
  const rawStart = match[1];
  const rawEnd = match[2];

  if (!rawStart && !rawEnd) return "invalid";
  if (!rawStart && rawEnd) {
    if (totalBytes === null) return "invalid";
    const suffixLen = Number(rawEnd);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return "invalid";
    const start = Math.max(0, totalBytes - suffixLen);
    return { start, end: totalBytes - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : totalBytes !== null ? totalBytes - 1 : null;
  if (!Number.isFinite(start) || start < 0) return "invalid";
  if (end !== null && (!Number.isFinite(end) || end < start)) return "invalid";
  if (totalBytes !== null && start >= totalBytes) return "invalid";
  return {
    start,
    end: totalBytes !== null && end !== null ? Math.min(end, totalBytes - 1) : end,
  };
}

function createConnectSignal(parentSignal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal.reason ?? new Error("Aborted"));
  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason ?? new Error("Aborted"));
    return { signal: controller.signal, clear: () => undefined };
  }
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Upstream connect timeout")), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

function waitForResponseDrain(res: ServerResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onAbort);
      res.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Aborted"));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    res.once("drain", onDrain);
    res.once("close", onAbort);
    res.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function notifyEntryWaiters(entry: BufferedTrackEntry): void {
  if (entry.waiters.size === 0) return;
  const current = Array.from(entry.waiters);
  entry.waiters.clear();
  for (const wake of current) {
    wake();
  }
}

function waitForEntryProgress(
  entry: BufferedTrackEntry,
  signal: AbortSignal,
  timeoutMs = SLICE_WAIT_TIMEOUT_MS,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error("Aborted"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.waiters.delete(wake);
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const wake = () => finish();
    const onAbort = () => finish(new Error("Aborted"));
    const timer = setTimeout(() => finish(new Error("Stream buffer wait timeout")), timeoutMs);

    entry.waiters.add(wake);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const SAFE_DIRECT_HEADER_KEYS = new Set(["referer", "origin", "user-agent"]);

/**
 * Strips all private auth credentials (Cookie, Authorization, X-Real-IP, etc.)
 * before any direct CDN metadata crosses the Aria Room signaling channel.
 */
export function sanitizeSafeHeaders(raw?: Record<string, string> | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    const lower = key.trim().toLowerCase();
    if (!SAFE_DIRECT_HEADER_KEYS.has(lower) || typeof val !== "string" || !val.trim()) continue;
    const headerName =
      lower === "referer" ? "Referer" : lower === "origin" ? "Origin" : "User-Agent";
    clean[headerName] = val.trim();
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export async function resolveExternalUpstream(
  track: AriaRoomTrackPayload,
  localApiPort: number,
  refresh = false,
): Promise<{
  url: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  currentLevel?: AriaLevel | null;
  availableLevels?: AriaLevel[];
  quality?: AriaRoomTrackPayload["quality"] | null;
  isTrial?: boolean;
  trialDurationSec?: number | null;
  fetcher?: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
}> {
  const trimmedStreamUrl = track.streamUrl?.trim() ?? "";
  const localLoopbackMatch = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/api\/.*)$/i.exec(
    trimmedStreamUrl,
  );
  const normalizedApiPath = trimmedStreamUrl.startsWith("/api/")
    ? trimmedStreamUrl
    : localLoopbackMatch?.[1] ?? "";

  if (isSourceId(track.source)) {
    const parsed = parseTrackKey(track.id);
    const externalId = parsed?.externalId ?? (track.providerId || track.id);
    try {
      const source = await getSource(track.source);
      const targetLevel: AriaLevel =
        track.source === "youtube"
          ? "exhigh"
          : track.source === "netease" && track.currentLevel === "jymaster"
            ? "jymaster"
            : "hires";
      const meta = await source.resolveStreamMeta(externalId, {
        level: targetLevel,
        refresh,
      });
      return {
        url: meta.url,
        headers: meta.headers,
        mimeType: meta.mimeType ?? track.mimeType ?? null,
        bitrate: meta.bitrate ?? track.bitrate ?? null,
        sampleRate: meta.sampleRate ?? track.sampleRate ?? null,
        currentLevel: meta.currentLevel ?? track.currentLevel ?? null,
        availableLevels: meta.availableLevels ?? track.availableLevels,
        quality: meta.quality ?? track.quality ?? null,
        isTrial: meta.isTrial,
        trialDurationSec: meta.trialDurationSec ?? null,
        fetcher: meta.fetcher,
      };
    } catch (error) {
      if (!normalizedApiPath) {
        throw error;
      }
    }
  }

  if (normalizedApiPath) {
    return {
      url: `http://127.0.0.1:${localApiPort}${normalizedApiPath}`,
      mimeType: track.mimeType ?? null,
      bitrate: track.bitrate ?? null,
      sampleRate: track.sampleRate ?? null,
      currentLevel: track.currentLevel ?? null,
      quality: track.quality ?? null,
    };
  }

  throw new HttpError(400, `Unsupported track source for Aria Room: ${track.source}`, "ARIA_ROOM_UNSUPPORTED_TRACK");
}

export class TrackByteCache {
  private readonly cacheDir: string;
  private readonly entries = new Map<string, BufferedTrackEntry>();
  private readonly covers = new Map<string, CachedCover>();
  private pinnedNonces = new Set<string>();

  constructor(sessionKey = crypto.randomBytes(6).toString("hex")) {
    this.cacheDir = path.join(os.tmpdir(), "aria-room-cache", sessionKey);
  }

  setPinnedNonces(nonces: string[]): void {
    this.pinnedNonces = new Set(nonces.map(sanitizeNonce).filter(Boolean));
  }

  getEntry(nonce: string): BufferedTrackEntry | null {
    const clean = sanitizeNonce(nonce);
    const entry = this.entries.get(clean) ?? null;
    if (entry) entry.lastAccessAt = Date.now();
    return entry;
  }

  hasNonce(nonce: string): boolean {
    return this.entries.has(sanitizeNonce(nonce));
  }

  getProgressSnapshot(nonce: string): {
    downloadedBytes: number;
    totalBytes: number | null;
    completed: boolean;
    failedError: string | null;
  } | null {
    const entry = this.getEntry(nonce);
    if (!entry) return null;
    return {
      downloadedBytes: entry.downloadedBytes,
      totalBytes: entry.totalBytes,
      completed: entry.completed,
      failedError: entry.failedError,
    };
  }

  /**
   * Starts host-side resolution + bit-exact progressive temp caching (or direct
   * file mapping for local library tracks).
   */
  async prepareHostTrack(
    track: AriaRoomTrackPayload,
    localApiPort: number,
  ): Promise<BufferedTrackEntry> {
    const cleanNonce = sanitizeNonce(track.nonce);
    if (!cleanNonce) {
      throw new HttpError(400, "Invalid track nonce", "INVALID_NONCE");
    }

    const existing = this.entries.get(cleanNonce);
    if (existing && !existing.failedError) {
      existing.lastAccessAt = Date.now();
      return existing;
    }

    if (track.source === "local") {
      const localTrack = await findTrack(track.id);
      if (!localTrack) {
        throw new HttpError(404, "Local track not found", "TRACK_NOT_FOUND");
      }
      if (localTrack.requiresNativePlayback || localTrack.mediaKind === "audio-cd") {
        throw new HttpError(409, "CD/native tracks cannot be streamed to Aria Room", "NATIVE_PLAYBACK_REQUIRED");
      }
      const fileStat = await fs.stat(localTrack.path);
      const entry: BufferedTrackEntry = {
        nonce: cleanNonce,
        track: {
          ...track,
          bitrate: track.bitrate ?? localTrack.bitrate ?? null,
          sampleRate: track.sampleRate ?? localTrack.sampleRate ?? null,
        },
        kind: "local-file",
        filePath: localTrack.path,
        mimeType: mimeFromFormat(localTrack.format),
        bitrate: track.bitrate ?? localTrack.bitrate ?? null,
        sampleRate: track.sampleRate ?? localTrack.sampleRate ?? null,
        currentLevel: track.currentLevel ?? null,
        totalBytes: fileStat.size,
        downloadedBytes: fileStat.size,
        completed: true,
        failedError: null,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        abortController: null,
        waiters: new Set(),
      };
      this.entries.set(cleanNonce, entry);
      await this.evictOldEntries();
      return entry;
    }

    await fs.mkdir(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, `${cleanNonce}.bin`);
    const abortController = new AbortController();

    const entry: BufferedTrackEntry = {
      nonce: cleanNonce,
      track,
      kind: "temp-file",
      filePath,
      mimeType: track.mimeType || "application/octet-stream",
      bitrate: track.bitrate ?? null,
      sampleRate: track.sampleRate ?? null,
      currentLevel: track.currentLevel ?? null,
      totalBytes: null,
      downloadedBytes: 0,
      completed: false,
      failedError: null,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      abortController,
      waiters: new Set(),
    };

    this.entries.set(cleanNonce, entry);
    await this.evictOldEntries();

    const readyPromise = this.pumpUpstreamToTempFile(entry, localApiPort, abortController.signal);
    void readyPromise.catch(() => undefined);

    // Wait briefly so HTTP headers (Content-Length / MIME / Bitrate / initial bytes)
    // are known right when track_ready is announced, without blocking slow tracks forever.
    await Promise.race([
      this.waitForMinimumBytes(entry, 64 * 1024, abortController.signal).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_500)),
    ]);

    return entry;
  }

  private async waitForMinimumBytes(
    entry: BufferedTrackEntry,
    bytesNeeded: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (!entry.completed && !entry.failedError && entry.downloadedBytes < bytesNeeded) {
      await waitForEntryProgress(entry, signal, 4_000);
    }
  }

  private async writeResponseStreamToEntry(
    entry: BufferedTrackEntry,
    response: globalThis.Response,
    resolvedMeta: {
      mimeType?: string | null;
      bitrate?: number | null;
      sampleRate?: number | null;
      currentLevel?: string | null;
    },
    signal: AbortSignal,
  ): Promise<void> {
    if (!response.ok || !response.body) {
      throw new Error(`Upstream failed (${response.status})`);
    }

    const contentType = resolvedMeta.mimeType || response.headers.get("content-type");
    if (contentType) entry.mimeType = contentType;
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    if (Number.isFinite(contentLength) && contentLength > 0) {
      entry.totalBytes = contentLength;
    }

    const headerBitrate = Number(response.headers.get("x-aria-bitrate"));
    const headerSampleRate = Number(response.headers.get("x-aria-sample-rate"));
    const headerLevel = response.headers.get("x-aria-level");

    if (resolvedMeta.bitrate) entry.bitrate = resolvedMeta.bitrate;
    else if (Number.isFinite(headerBitrate) && headerBitrate > 0) entry.bitrate = headerBitrate;

    if (resolvedMeta.sampleRate) entry.sampleRate = resolvedMeta.sampleRate;
    else if (Number.isFinite(headerSampleRate) && headerSampleRate > 0) entry.sampleRate = headerSampleRate;

    if (resolvedMeta.currentLevel) entry.currentLevel = resolvedMeta.currentLevel;
    else if (headerLevel) entry.currentLevel = headerLevel;

    const handle = await fs.open(entry.filePath, "w");
    let writeOffset = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        if (signal.aborted) throw new Error("Aborted");
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        await handle.write(buf, 0, buf.byteLength, writeOffset);
        writeOffset += buf.byteLength;
        entry.downloadedBytes = writeOffset;
        notifyEntryWaiters(entry);
      }
      if (entry.totalBytes === null) {
        entry.totalBytes = entry.downloadedBytes;
      }
      entry.completed = true;
      notifyEntryWaiters(entry);
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async prepareDirectUrlTrack(
    track: AriaRoomTrackPayload,
    url: string,
    headers?: Record<string, string>,
    meta?: {
      mimeType?: string | null;
      bitrate?: number | null;
      sampleRate?: number | null;
      currentLevel?: string | null;
      fetcher?: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
      sanitizeHeaders?: boolean;
    },
  ): Promise<BufferedTrackEntry> {
    const cleanNonce = sanitizeNonce(track.nonce);
    if (!cleanNonce) {
      throw new HttpError(400, "Invalid track nonce", "INVALID_NONCE");
    }

    const existing = this.entries.get(cleanNonce);
    if (existing && !existing.failedError) {
      existing.lastAccessAt = Date.now();
      return existing;
    }
    if (existing?.failedError) {
      await this.deleteEntry(cleanNonce);
    }

    await fs.mkdir(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, `direct-${cleanNonce}.bin`);
    const abortController = new AbortController();

    const entry: BufferedTrackEntry = {
      nonce: cleanNonce,
      track,
      kind: "temp-file",
      filePath,
      mimeType: meta?.mimeType || track.mimeType || "application/octet-stream",
      bitrate: meta?.bitrate ?? track.bitrate ?? null,
      sampleRate: meta?.sampleRate ?? track.sampleRate ?? null,
      currentLevel: meta?.currentLevel ?? track.currentLevel ?? null,
      totalBytes: null,
      downloadedBytes: 0,
      completed: false,
      failedError: null,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      abortController,
      waiters: new Set(),
    };

    this.entries.set(cleanNonce, entry);
    await this.evictOldEntries();

    const safeHeaders = meta?.sanitizeHeaders === false ? headers : sanitizeSafeHeaders(headers);
    const upstreamFetch = meta?.fetcher ?? fetch;
    const runFetch = async () => {
      const connect = createConnectSignal(abortController.signal, 8_000);
      try {
        const response = await upstreamFetch(url, {
          headers: safeHeaders,
          signal: connect.signal,
        });
        connect.clear();
        await this.writeResponseStreamToEntry(
          entry,
          response,
          {
            mimeType: meta?.mimeType ?? track.mimeType ?? null,
            bitrate: meta?.bitrate ?? track.bitrate ?? null,
            sampleRate: meta?.sampleRate ?? track.sampleRate ?? null,
            currentLevel: meta?.currentLevel ?? track.currentLevel ?? null,
          },
          abortController.signal,
        );
      } catch (error) {
        connect.clear();
        if (!abortController.signal.aborted) {
          entry.failedError = error instanceof Error ? error.message : String(error);
        }
        notifyEntryWaiters(entry);
      }
    };
    void runFetch();
    return entry;
  }

  private async pumpUpstreamToTempFile(
    entry: BufferedTrackEntry,
    localApiPort: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      let response: globalThis.Response | null = null;
      let resolved: Awaited<ReturnType<typeof resolveExternalUpstream>> | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        resolved = await resolveExternalUpstream(entry.track, localApiPort, attempt > 0);
        if (resolved.isTrial) {
          throw new HttpError(403, "Source returned trial clip", "TRIAL_ONLY");
        }
        const upstreamFetch = resolved.fetcher ?? fetch;
        const connect = createConnectSignal(signal, 8_000);
        try {
          response = await upstreamFetch(resolved.url, {
            headers: resolved.headers,
            signal: connect.signal,
          });
        } finally {
          connect.clear();
        }
        if (response.ok) break;
        if ((response.status === 403 || response.status === 410) && attempt === 0) {
          await response.body?.cancel();
          response = null;
          continue;
        }
        break;
      }

      if (!response || !resolved || !response.ok || !response.body) {
        throw new Error(`Upstream failed (${response?.status ?? "network"})`);
      }

      await this.writeResponseStreamToEntry(entry, response, resolved, signal);
    } catch (error) {
      if (!signal.aborted) {
        entry.failedError = error instanceof Error ? error.message : String(error);
      }
      notifyEntryWaiters(entry);
    }
  }

  /**
   * Reads a raw bit-exact slice on the Host to send over WebRTC `media` channel.
   */
  async readHostSlice(
    nonce: string,
    offset: number,
    length: number,
    signal: AbortSignal,
  ): Promise<HostSliceResult> {
    const entry = this.getEntry(nonce);
    if (!entry) {
      throw new HttpError(404, "Buffered track nonce not found", "ARIA_ROOM_TRACK_NOT_FOUND");
    }

    while (
      !entry.completed &&
      !entry.failedError &&
      entry.downloadedBytes <= offset &&
      (entry.totalBytes === null || offset < entry.totalBytes)
    ) {
      await waitForEntryProgress(entry, signal);
    }

    if (entry.failedError && entry.downloadedBytes <= offset) {
      throw new HttpError(502, entry.failedError, "ARIA_ROOM_STREAM_FAILED");
    }

    const effectiveEnd = entry.totalBytes !== null ? Math.min(entry.downloadedBytes, entry.totalBytes) : entry.downloadedBytes;
    if (offset >= effectiveEnd && entry.completed) {
      return {
        chunk: Buffer.alloc(0),
        offset,
        totalBytes: entry.totalBytes ?? entry.downloadedBytes,
        eof: true,
        mimeType: entry.mimeType,
        bitrate: entry.bitrate,
        sampleRate: entry.sampleRate,
        currentLevel: entry.currentLevel,
      };
    }

    const toRead = Math.min(Math.max(1, length), Math.max(0, effectiveEnd - offset));
    if (toRead === 0) {
      return {
        chunk: Buffer.alloc(0),
        offset,
        totalBytes: entry.totalBytes,
        eof: entry.completed,
        mimeType: entry.mimeType,
        bitrate: entry.bitrate,
        sampleRate: entry.sampleRate,
        currentLevel: entry.currentLevel,
      };
    }

    const fh = await fs.open(entry.filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(toRead);
      const { bytesRead } = await fh.read(buffer, 0, toRead, offset);
      const slice = bytesRead === toRead ? buffer : buffer.subarray(0, bytesRead);
      const nextOffset = offset + bytesRead;
      const eof = Boolean(entry.completed && nextOffset >= (entry.totalBytes ?? entry.downloadedBytes));
      return {
        chunk: slice,
        offset,
        totalBytes: entry.totalBytes,
        eof,
        mimeType: entry.mimeType,
        bitrate: entry.bitrate,
        sampleRate: entry.sampleRate,
        currentLevel: entry.currentLevel,
      };
    } finally {
      await fh.close();
    }
  }

  /**
   * Initializes or updates a guest-side P2P chunk cache entry.
   */
  async ensureGuestReceiveEntry(
    track: AriaRoomTrackPayload,
    meta?: {
      mimeType?: string | null;
      bitrate?: number | null;
      sampleRate?: number | null;
      currentLevel?: string | null;
      totalBytes?: number | null;
    },
  ): Promise<BufferedTrackEntry> {
    const cleanNonce = sanitizeNonce(track.nonce);
    if (!cleanNonce) {
      throw new HttpError(400, "Invalid track nonce", "INVALID_NONCE");
    }

    let entry = this.entries.get(cleanNonce);
    if (!entry) {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const filePath = path.join(this.cacheDir, `guest-${cleanNonce}.bin`);
      await fs.writeFile(filePath, Buffer.alloc(0));
      entry = {
        nonce: cleanNonce,
        track,
        kind: "temp-file",
        filePath,
        mimeType: meta?.mimeType || track.mimeType || "application/octet-stream",
        bitrate: meta?.bitrate ?? track.bitrate ?? null,
        sampleRate: meta?.sampleRate ?? track.sampleRate ?? null,
        currentLevel: meta?.currentLevel ?? track.currentLevel ?? null,
        totalBytes: meta?.totalBytes ?? null,
        downloadedBytes: 0,
        completed: false,
        failedError: null,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        abortController: null,
        waiters: new Set(),
        writeHandle: null,
      };
      this.entries.set(cleanNonce, entry);
      await this.evictOldEntries();
    } else {
      entry.lastAccessAt = Date.now();
      if (meta?.mimeType) entry.mimeType = meta.mimeType;
      if (meta?.bitrate) entry.bitrate = meta.bitrate;
      if (meta?.sampleRate) entry.sampleRate = meta.sampleRate;
      if (meta?.currentLevel) entry.currentLevel = meta.currentLevel;
      if (meta?.totalBytes !== undefined && meta.totalBytes !== null) entry.totalBytes = meta.totalBytes;
    }
    return entry;
  }

  async appendGuestChunk(params: {
    track: AriaRoomTrackPayload;
    offset: number;
    chunk: Buffer;
    eof: boolean;
    totalBytes?: number | null;
    mimeType?: string | null;
    bitrate?: number | null;
    sampleRate?: number | null;
    currentLevel?: string | null;
  }): Promise<BufferedTrackEntry> {
    const entry = await this.ensureGuestReceiveEntry(params.track, {
      mimeType: params.mimeType,
      bitrate: params.bitrate,
      sampleRate: params.sampleRate,
      currentLevel: params.currentLevel,
      totalBytes: params.totalBytes,
    });

    const prevQueue = entry.writeQueue ?? Promise.resolve();
    const runWrite = prevQueue.catch(() => undefined).then(async () => {
      if (this.entries.get(entry.nonce) !== entry) return;

      if (params.chunk.byteLength > 0) {
        if (!entry.writeHandle) {
          entry.writeHandle = await fs.open(entry.filePath, "r+");
        }
        await entry.writeHandle.write(params.chunk, 0, params.chunk.byteLength, params.offset);
        const newExtent = params.offset + params.chunk.byteLength;
        if (newExtent > entry.downloadedBytes) {
          entry.downloadedBytes = newExtent;
        }
      }

      if (params.eof) {
        if (entry.writeHandle) {
          const handle = entry.writeHandle;
          entry.writeHandle = null;
          await handle.close().catch(() => undefined);
        }
        if (entry.totalBytes === null) {
          entry.totalBytes = entry.downloadedBytes;
        }
        entry.completed = true;
      }

      notifyEntryWaiters(entry);
    });
    entry.writeQueue = runWrite;
    await runWrite;
    return entry;
  }

  async waitForEntry(nonce: string, signal: AbortSignal, timeoutMs = 8_000): Promise<BufferedTrackEntry | null> {
    const cleanNonce = sanitizeNonce(nonce);
    const existing = this.getEntry(cleanNonce);
    if (existing) return existing;

    const deadline = Date.now() + timeoutMs;
    while (!signal.aborted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const found = this.getEntry(cleanNonce);
      if (found) return found;
    }
    return null;
  }

  /**
   * Serves HTTP 200 / 206 Partial Content from either a host local/temp entry
   * or a guest P2P progressively buffered entry. Works on both raw Node HTTP
   * and Express response objects.
   */
  async serveEntryHttpRange(req: IncomingMessage, res: ServerResponse, entry: BufferedTrackEntry): Promise<void> {
    entry.lastAccessAt = Date.now();
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", onClose);
    res.once("close", onClose);

    try {
      // Wait briefly until at least headers or some bytes exist.
      while (!entry.completed && !entry.failedError && entry.downloadedBytes === 0 && entry.totalBytes === null) {
        await waitForEntryProgress(entry, controller.signal, 10_000);
      }
      if (entry.failedError && entry.downloadedBytes === 0) {
        throw new HttpError(502, entry.failedError, "ARIA_ROOM_STREAM_FAILED");
      }

      const totalBytes = entry.totalBytes ?? (entry.completed ? entry.downloadedBytes : null);
      const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;

      res.setHeader("Accept-Ranges", totalBytes !== null ? "bytes" : "none");
      res.setHeader("Content-Type", entry.mimeType || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      if (entry.bitrate) res.setHeader("X-Aria-Bitrate", String(entry.bitrate));
      if (entry.sampleRate) res.setHeader("X-Aria-Sample-Rate", String(entry.sampleRate));
      if (entry.currentLevel) res.setHeader("X-Aria-Level", entry.currentLevel);

      let start = 0;
      let end = totalBytes !== null ? totalBytes - 1 : null;

      if (rangeHeader && totalBytes !== null) {
        const parsed = parseByteRange(rangeHeader, totalBytes);
        if (parsed === "invalid") {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${totalBytes}`);
          res.end();
          return;
        }
        start = parsed.start;
        end = parsed.end;
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end ?? totalBytes - 1}/${totalBytes}`);
        res.setHeader("Content-Length", String((end ?? totalBytes - 1) - start + 1));
      } else {
        res.statusCode = 200;
        if (totalBytes !== null) {
          res.setHeader("Content-Length", String(totalBytes));
        }
      }

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      if (entry.completed) {
        const stream = createReadStream(entry.filePath, end !== null ? { start, end } : { start });
        await new Promise<void>((resolve, reject) => {
          stream.on("error", reject);
          res.on("finish", resolve);
          res.on("close", resolve);
          stream.pipe(res);
        });
        return;
      }

      // Pre-buffer up to 256 KB (or 1.5s max) on sequential start so progressive playback doesn't choke at 64 KB.
      if (!entry.completed && !entry.failedError && start === 0) {
        const prebufferTarget =
          entry.totalBytes !== null ? Math.min(256 * 1024, entry.totalBytes) : 256 * 1024;
        const prebufferDeadline = Date.now() + 1_500;
        while (
          !controller.signal.aborted &&
          !entry.completed &&
          !entry.failedError &&
          entry.downloadedBytes < prebufferTarget
        ) {
          const remainingMs = prebufferDeadline - Date.now();
          if (remainingMs <= 0) break;
          try {
            await waitForEntryProgress(entry, controller.signal, remainingMs);
          } catch {
            if (controller.signal.aborted) throw new Error("Aborted");
            break;
          }
        }
      }

      // Progressive streaming while bytes arrive.
      let cursor = start;
      const fh = await fs.open(entry.filePath, "r");
      try {
        const chunkBuf = Buffer.allocUnsafe(64 * 1024);
        while (!controller.signal.aborted) {
          const maxTarget = end !== null ? end + 1 : Number.MAX_SAFE_INTEGER;
          if (cursor >= maxTarget) break;

          const available = entry.totalBytes !== null ? Math.min(entry.downloadedBytes, entry.totalBytes) : entry.downloadedBytes;
          if (cursor < available) {
            const want = Math.min(chunkBuf.byteLength, available - cursor, maxTarget - cursor);
            const { bytesRead } = await fh.read(chunkBuf, 0, want, cursor);
            if (bytesRead > 0) {
              const out = bytesRead === chunkBuf.byteLength ? Buffer.from(chunkBuf) : Buffer.from(chunkBuf.subarray(0, bytesRead));
              if (!res.write(out)) {
                await waitForResponseDrain(res, controller.signal);
              }
              cursor += bytesRead;
              continue;
            }
          }

          if (entry.completed) break;
          if (entry.failedError) {
            throw new HttpError(502, entry.failedError, "ARIA_ROOM_STREAM_FAILED");
          }
          const waitTimeoutMs =
            !entry.completed && cursor > entry.downloadedBytes + 512 * 1024
              ? 10_000
              : SLICE_WAIT_TIMEOUT_MS;
          await waitForEntryProgress(entry, controller.signal, waitTimeoutMs);
        }
      } finally {
        await fh.close();
      }
      if (!res.writableEnded) res.end();
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    } finally {
      req.off("aborted", onClose);
      res.off("close", onClose);
    }
  }

  async resolveCover(
    nonce: string,
    localApiPort: number,
    fallbackTrack?: AriaRoomTrackPayload | null,
    options?: { skipYoutubeRemote?: boolean },
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const cleanNonce = sanitizeNonce(nonce);
    const cached = this.covers.get(cleanNonce);
    if (cached) return { body: cached.body, contentType: cached.contentType };

    const entry = this.getEntry(cleanNonce);
    const track = entry?.track ?? fallbackTrack ?? null;
    if (!track) return null;

    let body: Buffer | null = null;
    let contentType = "image/jpeg";

    if (track.source === "local") {
      const localTrack = await findTrack(track.id).catch(() => null);
      if (localTrack) {
        const extracted = await readOrExtractLocalCover(localTrack, 768).catch(() => null);
        if (extracted) {
          body = extracted.body;
          contentType = extracted.contentType;
        }
      }
      if (!body || body.byteLength === 0) {
        const decoded = parseCoverDataUrl(track.coverDataUrl);
        if (decoded) {
          body = decoded.body;
          contentType = decoded.contentType;
        }
      }
    } else {
      const skipYoutubeRemoteFetch = Boolean(
        options?.skipYoutubeRemote &&
          (track.source === "youtube" || (track.coverUrl && isYoutubeArtworkUrl(track.coverUrl))),
      );
      if (track.coverUrl && !skipYoutubeRemoteFetch) {
        let targetUrl: string | null = null;
        if (track.coverUrl.startsWith("/api/")) {
          targetUrl = localApiPort > 0 ? `http://127.0.0.1:${localApiPort}${track.coverUrl}` : null;
        } else if (/^https?:\/\//i.test(track.coverUrl)) {
          targetUrl =
            (track.source === "youtube" || isYoutubeArtworkUrl(track.coverUrl)) && localApiPort > 0
              ? `http://127.0.0.1:${localApiPort}/api/sources/youtube/cover?url=${encodeURIComponent(track.coverUrl)}`
              : track.coverUrl;
        }
        if (targetUrl) {
          const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(6_000) }).catch(() => null);
          if (resp?.ok) {
            const arr = Buffer.from(await resp.arrayBuffer());
            if (arr.byteLength > 0) {
              body = arr;
              contentType = resp.headers.get("content-type") || "image/jpeg";
            }
          }
        }
      }
      if (!body || body.byteLength === 0) {
        const decoded = parseCoverDataUrl(track.coverDataUrl);
        if (decoded) {
          body = decoded.body;
          contentType = decoded.contentType;
        }
      }
    }

    if (!body || body.byteLength === 0) return null;

    if (this.covers.size >= MAX_CACHED_COVERS) {
      const oldestKey = this.covers.keys().next().value;
      if (oldestKey) this.covers.delete(oldestKey);
    }
    this.covers.set(cleanNonce, { body, contentType, fetchedAt: Date.now() });
    return { body, contentType };
  }

  async encodeCoverThumbnailDataUrl(
    nonce: string,
    localApiPort: number,
    fallbackTrack?: AriaRoomTrackPayload | null,
  ): Promise<string | null> {
    const cover = await this.resolveCover(nonce, localApiPort, fallbackTrack).catch(() => null);
    if (!cover || cover.body.byteLength === 0) return null;

    let encodedBuf: Buffer | null = null;
    let encodedMime = "image/jpeg";
    try {
      const { default: sharp } = await import("sharp");
      sharp.cache(false);
      sharp.concurrency(1);
      encodedBuf = await sharp(cover.body, { limitInputPixels: 40_000_000, animated: false })
        .rotate()
        .resize(256, 256, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
    } catch {
      if (cover.body.byteLength <= 40 * 1024) {
        encodedBuf = cover.body;
        encodedMime = cover.contentType || "image/jpeg";
      }
    }

    if (!encodedBuf || encodedBuf.byteLength === 0) return null;
    const dataUrl = `data:${encodedMime};base64,${encodedBuf.toString("base64")}`;
    return dataUrl.length <= 56_000 ? dataUrl : null;
  }

  private async evictOldEntries(): Promise<void> {
    if (this.entries.size <= MAX_RETAINED_TRACKS) return;
    const candidates = Array.from(this.entries.values())
      .filter((entry) => !this.pinnedNonces.has(entry.nonce))
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt);

    for (const entry of candidates) {
      if (this.entries.size <= MAX_RETAINED_TRACKS) break;
      await this.deleteEntry(entry.nonce);
    }
  }

  async deleteEntry(nonce: string): Promise<void> {
    const clean = sanitizeNonce(nonce);
    const entry = this.entries.get(clean);
    if (!entry) return;
    this.entries.delete(clean);
    entry.abortController?.abort();
    notifyEntryWaiters(entry);
    if (entry.writeHandle) {
      const handle = entry.writeHandle;
      entry.writeHandle = null;
      await handle.close().catch(() => undefined);
    }
    if (entry.kind === "temp-file") {
      await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
    }
  }

  async clearAll(): Promise<void> {
    for (const nonce of Array.from(this.entries.keys())) {
      await this.deleteEntry(nonce);
    }
    this.covers.clear();
    await fs.rm(this.cacheDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
