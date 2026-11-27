export const SEARCH_HISTORY_STORAGE_KEY = "aria-search-history-v1";
export const MAX_SEARCH_HISTORY = 8;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function sanitizeSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, 120);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_SEARCH_HISTORY) break;
  }
  return result;
}

export function readSearchHistory(storage?: StorageLike | null): string[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeSearchHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeSearchHistory(items: string[], storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(sanitizeSearchHistory(items)));
    return true;
  } catch {
    return false;
  }
}

export function recordSearchHistory(items: string[], query: string): string[] {
  const trimmed = query.trim().slice(0, 120);
  if (!trimmed) return sanitizeSearchHistory(items);
  const key = trimmed.toLowerCase();
  const next = [trimmed, ...items.filter((entry) => entry.trim().toLowerCase() !== key)];
  return sanitizeSearchHistory(next);
}

export function removeSearchHistoryItem(items: string[], query: string): string[] {
  const key = query.trim().toLowerCase();
  return sanitizeSearchHistory(items.filter((entry) => entry.trim().toLowerCase() !== key));
}
