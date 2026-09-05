export const memoryLimits = {
  neteaseWarmup: 120,
  artistRequest: 80,
  artistAvatarLookup: 96,
  artistAvatarCache: 64,
  localCoverWarmup: 120,
  artworkSyncing: 240,
} as const;

export const warmupBatchLimits = {
  neteaseTracks: 24,
  neteaseMetadataPlaying: 4,
  neteaseMetadataIdle: 8,
  localCovers: 12,
  // Keep eager image work small; visible rows already use native lazy loading.
  preloadedImages: 4,
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
