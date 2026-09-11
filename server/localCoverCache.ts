import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import type { ScannedTrack } from "./types";
import { cacheDir } from "./utils/paths";
import { HttpError } from "./utils/httpError";
import { pruneDiskCache } from "./utils/diskCache";
import { createCoverThumbnail } from "./coverThumbnail";

export type CachedLocalCover = {
  body: Buffer;
  contentType: string;
};

const localCoverCacheDir = path.join(cacheDir, "local-covers");
const pruneLocalCoverCache = () =>
  pruneDiskCache(localCoverCacheDir, { maxBytes: 128 * 1024 * 1024, maxFiles: 400 });

void pruneLocalCoverCache();
const localCoverPruneTimer = setInterval(pruneLocalCoverCache, 15 * 60_000);
localCoverPruneTimer.unref?.();

const pendingCovers = new Map<string, Promise<CachedLocalCover>>();

export async function readOrExtractLocalCover(track: ScannedTrack, size?: 320 | 768): Promise<CachedLocalCover> {
  if (track.mediaKind === "audio-cd") throw new HttpError(404, "Cover art not found", "COVER_NOT_FOUND");

  const fileStat = await stat(track.path);
  const cacheKey = createHash("sha1").update(`${track.path}:${fileStat.mtimeMs}:${fileStat.size}`).digest("hex") + (size ? `-${size}` : "");
  const pending = pendingCovers.get(cacheKey);
  if (pending) return pending;
  const request = loadCover(track, cacheKey, size);
  pendingCovers.set(cacheKey, request);
  try {
    return await request;
  } finally {
    pendingCovers.delete(cacheKey);
  }
}

async function loadCover(track: ScannedTrack, cacheKey: string, size?: 320 | 768): Promise<CachedLocalCover> {
  const cachedPath = path.join(localCoverCacheDir, `${cacheKey}.img`);
  const cachedMetaPath = path.join(localCoverCacheDir, `${cacheKey}.json`);

  try {
    const [body, rawMeta] = await Promise.all([readFile(cachedPath), readFile(cachedMetaPath, "utf8")]);
    const meta = JSON.parse(rawMeta) as { contentType?: string };
    return { body, contentType: meta.contentType || "image/jpeg" };
  } catch {
    // Cache miss; extract once below.
  }

  let body: Buffer;
  let contentType: string;
  if (size) {
    const original = await readOrExtractLocalCover(track);
    try {
      body = await createCoverThumbnail(original.body, size);
      contentType = "image/webp";
    } catch {
      // Preserve support for artwork that Chromium can decode but libvips cannot.
      return original;
    }
  } else {
    const metadata = await parseFile(track.path, { duration: false });
    const picture = metadata.common.picture?.[0];
    if (!picture) throw new HttpError(404, "Cover art not found", "COVER_NOT_FOUND");
    body = Buffer.from(picture.data.buffer, picture.data.byteOffset, picture.data.byteLength);
    contentType = picture.format || "image/jpeg";
  }
  await mkdir(localCoverCacheDir, { recursive: true });
  await Promise.all([
    writeFile(cachedPath, body),
    writeFile(cachedMetaPath, JSON.stringify({ contentType }), "utf8"),
  ]);
  void pruneLocalCoverCache();

  return { body, contentType };
}

export async function warmLocalCovers(tracks: ScannedTrack[], limit = 48) {
  const candidates = tracks.filter((track) => track.hasCover && track.mediaKind !== "audio-cd").slice(0, limit);
  let warmed = 0;

  await mapWithConcurrency(candidates, 3, async (track) => {
    try {
      await readOrExtractLocalCover(track);
      warmed += 1;
    } catch {
      // Cover warmup should never block library use.
    }
  });

  return warmed;
}

async function mapWithConcurrency<T>(items: T[], limit: number, mapper: (item: T) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
