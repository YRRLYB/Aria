import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import type { ScannedTrack } from "./types";
import { cacheDir } from "./utils/paths";
import { HttpError } from "./utils/httpError";
import { pruneDiskCache } from "./utils/diskCache";

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

export async function readOrExtractLocalCover(track: ScannedTrack): Promise<CachedLocalCover> {
  if (track.mediaKind === "audio-cd") throw new HttpError(404, "Cover art not found", "COVER_NOT_FOUND");

  const fileStat = await stat(track.path);
  const cacheKey = createHash("sha1").update(`${track.path}:${fileStat.mtimeMs}:${fileStat.size}`).digest("hex");
  const cachedPath = path.join(localCoverCacheDir, `${cacheKey}.img`);
  const cachedMetaPath = path.join(localCoverCacheDir, `${cacheKey}.json`);

  try {
    const [body, rawMeta] = await Promise.all([readFile(cachedPath), readFile(cachedMetaPath, "utf8")]);
    const meta = JSON.parse(rawMeta) as { contentType?: string };
    return { body, contentType: meta.contentType || "image/jpeg" };
  } catch {
    // Cache miss; extract once below.
  }

  const metadata = await parseFile(track.path);
  const picture = metadata.common.picture?.[0];
  if (!picture) throw new HttpError(404, "Cover art not found", "COVER_NOT_FOUND");

  const body = Buffer.from(picture.data);
  const contentType = picture.format || "image/jpeg";
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
