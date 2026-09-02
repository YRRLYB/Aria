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
// Hard entry ceiling so a long-lived backend cannot grow the cache (and its
// in-memory copy) without bound; soonest-expiring entries are evicted first.
const maxPersistentEntries = 2000;
const writeDelayMs = 750;

let cacheState: CacheFile | null = null;
let loadPromise: Promise<CacheFile> | null = null;
let writeQueue = Promise.resolve();
let writeTimer: NodeJS.Timeout | null = null;
let dirty = false;
const pendingLoads = new Map<string, Promise<unknown>>();

async function loadCacheFile(): Promise<CacheFile> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    const entries = parsed.entries ?? {};
    const now = Date.now();
    for (const key of Object.keys(entries)) {
      if ((entries[key]?.expiresAt ?? 0) <= now) delete entries[key];
    }
    trimCache({ entries });
    return { entries };
  } catch {
    return { entries: {} };
  }
}

function trimCache(cache: CacheFile) {
  const now = Date.now();
  for (const key of Object.keys(cache.entries)) {
    if ((cache.entries[key]?.expiresAt ?? 0) <= now) delete cache.entries[key];
  }
  let overflow = Object.keys(cache.entries).length - maxPersistentEntries;
  if (overflow > 0) {
    const byExpiry = Object.entries(cache.entries).sort((left, right) => left[1].expiresAt - right[1].expiresAt);
    for (let index = 0; index < overflow; index += 1) delete cache.entries[byExpiry[index][0]];
  }
}

async function readCache(): Promise<CacheFile> {
  if (cacheState) return cacheState;
  loadPromise ??= loadCacheFile();
  cacheState = await loadPromise;
  return cacheState;
}

async function flushWrite() {
  const cache = await readCache();
  const snapshot = JSON.stringify(cache);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, snapshot, "utf8");
  });
  await writeQueue;
}

// Writes are coalesced: every set marks the cache dirty and a single timer
// flushes the whole file once, instead of re-serializing everything per write.
function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!dirty) return;
    dirty = false;
    void flushWrite().catch(() => undefined);
  }, writeDelayMs);
  writeTimer.unref?.();
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
  trimCache(cache);
  scheduleWrite();
}

export async function rememberPersistent<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = await getPersistent<T>(key);
  if (cached !== null) return cached;
  const existing = pendingLoads.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = loader()
    .then(async (value) => {
      await setPersistent(key, ttlMs, value);
      return value;
    })
    .finally(() => {
      pendingLoads.delete(key);
    });
  pendingLoads.set(key, request);
  return request;
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
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  for (const key of pendingLoads.keys()) {
    if (!prefix || key.startsWith(prefix)) pendingLoads.delete(key);
  }
  dirty = false;
  await flushWrite();
}
