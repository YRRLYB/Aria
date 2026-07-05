import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheDir } from "./paths";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type CacheFile = {
  entries: Record<string, CacheEntry<unknown>>;
};

const cachePath = path.join(cacheDir, "persistent-cache.json");
let cacheState: CacheFile | null = null;
let loadPromise: Promise<CacheFile> | null = null;
let writeQueue = Promise.resolve();

async function loadCacheFile(): Promise<CacheFile> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    const entries = parsed.entries ?? {};
    const now = Date.now();
    for (const key of Object.keys(entries)) {
      if ((entries[key]?.expiresAt ?? 0) <= now) delete entries[key];
    }
    return { entries };
  } catch {
    return { entries: {} };
  }
}

async function readCache(): Promise<CacheFile> {
  if (cacheState) return cacheState;
  loadPromise ??= loadCacheFile();
  cacheState = await loadPromise;
  return cacheState;
}

async function writeCache() {
  const cache = await readCache();
  const snapshot = JSON.stringify(cache);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, snapshot, "utf8");
  });
  await writeQueue;
}

export async function getPersistent<T>(key: string): Promise<T | null> {
  const cache = await readCache();
  const entry = cache.entries[key] as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

export async function setPersistent<T>(key: string, ttlMs: number, value: T) {
  const cache = await readCache();
  cache.entries[key] = { value, expiresAt: Date.now() + ttlMs };
  await writeCache();
}

export async function rememberPersistent<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = await getPersistent<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await setPersistent(key, ttlMs, value);
  return value;
}

export async function clearPersistent(prefix?: string) {
  const cache = await readCache();
  if (!prefix) {
    cache.entries = {};
  } else {
    for (const key of Object.keys(cache.entries)) {
      if (key.startsWith(prefix)) delete cache.entries[key];
    }
  }
  await writeCache();
}
