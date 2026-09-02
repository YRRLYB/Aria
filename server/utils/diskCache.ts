import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

type DiskCacheOptions = {
  maxBytes: number;
  maxFiles: number;
  extension?: string;
};

const pruneJobs = new Map<string, Promise<void>>();

/** Keep binary response caches bounded across long-lived desktop sessions. */
export function pruneDiskCache(directory: string, options: DiskCacheOptions) {
  const existing = pruneJobs.get(directory);
  if (existing) return existing;

  const job = pruneDiskCacheNow(directory, options).catch(() => undefined);
  pruneJobs.set(directory, job);
  void job.finally(() => {
    if (pruneJobs.get(directory) === job) pruneJobs.delete(directory);
  });
  return job;
}

async function pruneDiskCacheNow(directory: string, options: DiskCacheOptions) {
  const extension = options.extension ?? ".img";
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        try {
          const details = await stat(filePath);
          return { filePath, size: details.size, mtimeMs: details.mtimeMs };
        } catch {
          return null;
        }
      }),
  );

  const candidates = files.filter((file): file is NonNullable<typeof file> => Boolean(file));
  let totalBytes = candidates.reduce((sum, file) => sum + file.size, 0);
  let fileCount = candidates.length;
  if (totalBytes <= options.maxBytes && fileCount <= options.maxFiles) return;

  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of candidates) {
    if (totalBytes <= options.maxBytes && fileCount <= options.maxFiles) break;
    try {
      await unlink(file.filePath);
      await unlink(file.filePath.slice(0, -extension.length) + ".json").catch(() => undefined);
      totalBytes -= file.size;
      fileCount -= 1;
    } catch {
      // A concurrent request may still be writing/reading this cache entry.
    }
  }
}
