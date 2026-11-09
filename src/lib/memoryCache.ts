export const memoryLimits = {
  neteaseWarmup: 120,
  artistRequest: 80,
  artistAvatarLookup: 96,
  artistAvatarCache: 64,
  localCoverWarmup: 120,
  artworkSyncing: 240,
} as const;

export const warmupBatchLimits = {
  // 预取只是后台优化；网易云对播放地址解析有频控，宁可少预取也不能
  // 让用户正在点的歌被 405/460 挡住。
  neteaseTracks: 10,
  neteaseMetadataPlaying: 2,
  neteaseMetadataIdle: 4,
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
