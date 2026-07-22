export const memoryLimits = {
  neteaseWarmup: 220,
  artistRequest: 160,
  artistAvatarLookup: 220,
  artistAvatarCache: 128,
  localCoverWarmup: 260,
} as const;

export const warmupBatchLimits = {
  neteaseTracks: 72,
  neteaseMetadataPlaying: 8,
  neteaseMetadataIdle: 16,
  localCovers: 36,
  preloadedImages: 24,
} as const;

export function trimStringSet(ref: { current: Set<string> }, maxItems = 600) {
  if (ref.current.size <= maxItems) return;
  const deleteCount = ref.current.size - maxItems;
  const iterator = ref.current.values();
  for (let index = 0; index < deleteCount; index += 1) {
    const value = iterator.next().value;
    if (value === undefined) break;
    ref.current.delete(value);
  }
}

export function trimRecordCache<T>(value: Record<string, T>, maxItems: number) {
  const entries = Object.entries(value);
  if (entries.length <= maxItems) return value;
  return Object.fromEntries(entries.slice(-maxItems)) as Record<string, T>;
}
