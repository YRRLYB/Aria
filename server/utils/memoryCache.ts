type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();
const maxCacheEntries = 800;

export async function remember<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  trimExpired(now);

  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }

  const inflight = pending.get(key) as Promise<T> | undefined;
  if (inflight) return inflight;

  const request = loader()
    .then((value) => {
      cache.delete(key);
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      trimCache();
      return value;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, request);
  return request;
}

export function clearCache(prefix?: string) {
  if (!prefix) {
    cache.clear();
    pending.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
}

function trimExpired(now: number) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function trimCache() {
  if (cache.size <= maxCacheEntries) return;
  const deleteCount = cache.size - maxCacheEntries;
  const keys = cache.keys();
  for (let index = 0; index < deleteCount; index += 1) {
    const key = keys.next().value;
    if (key === undefined) break;
    cache.delete(key);
  }
}
