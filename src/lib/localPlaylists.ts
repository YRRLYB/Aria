import type { Track } from "@/data/music";
import { createCachedQueueSnapshots } from "@/lib/playerPresentation";

export const LOCAL_PLAYLISTS_STORAGE_KEY = "aria-local-playlists-v1";

/**
 * A referenced platform playlist (currently Bilibili favourite folders and
 * collections). Aria keeps a mirrored track list and can re-sync it on demand,
 * so following someone else's public folder does not become a one-time copy.
 */
export type LocalPlaylistRemoteRef = {
  source: "bilibili";
  url: string;
  kind: "folder" | "playlist";
  title?: string;
  /** Last successful mirror timestamp (ms). */
  syncedAt?: number;
};

export type LocalPlaylistKind = "standard" | "super-mix";

export type SuperMixStrategy = "interleave" | "shuffle" | "sequential";

export type SuperMixSourceRef = {
  key: string;
  source: "local" | "netease" | "qq" | "bilibili" | "youtube";
  playlistId: string;
  name: string;
  coverUrl?: string | null;
  trackCount?: number;
};

export type LocalPlaylistSuperMix = {
  sources: SuperMixSourceRef[];
  strategy: SuperMixStrategy;
  dedupe: boolean;
  manualTrackIds?: string[];
  syncedAt?: number;
  dedupedCount?: number;
  sourceCounts?: Partial<Record<Track["source"], number>>;
};

export type LocalPlaylist = {
  id: string;
  name: string;
  kind?: LocalPlaylistKind;
  trackIds: string[];
  /**
   * Remote tracks need their metadata/stream route after a restart, before the
   * source view has loaded. Local files are always resolved from the live
   * library and do not need a snapshot.
   */
  trackSnapshots?: Record<string, Track>;
  remoteRef?: LocalPlaylistRemoteRef;
  superMix?: LocalPlaylistSuperMix;
  createdAt: number;
  updatedAt: number;
};

type PlaylistStorage = Pick<Storage, "getItem" | "setItem">;

/** Empty selections open the online search flow, not a local-track dialog. */
export function shouldUseLocalPlaylistDialog(tracks: Array<Pick<Track, "source">>) {
  return tracks.length > 0 && tracks.every((track) => track.source === "local");
}

function defaultStorage(): PlaylistStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createPlaylistId() {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `local-playlist:${uuid}`;
}

export function createLocalPlaylist(
  name: string,
  trackIds: string[] = [],
  now = Date.now(),
  trackSnapshots?: Record<string, Track>,
  remoteRef?: LocalPlaylistRemoteRef,
  superMix?: LocalPlaylistSuperMix,
): LocalPlaylist {
  return {
    id: createPlaylistId(),
    name: name.trim().slice(0, 80) || "未命名歌单",
    ...(superMix ? { kind: "super-mix" as const } : {}),
    trackIds: [...new Set(trackIds)],
    ...(trackSnapshots && Object.keys(trackSnapshots).length ? { trackSnapshots } : {}),
    ...(remoteRef ? { remoteRef } : {}),
    ...(superMix ? { superMix } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** Compact snapshots for remote tracks; local files resolve from the library. */
export function createPlaylistTrackSnapshots(tracks: Track[]): Record<string, Track> {
  const remote = tracks.filter((track) => track.source !== "local");
  if (!remote.length) return {};
  return Object.fromEntries(createCachedQueueSnapshots(remote).map((track) => [track.id, track]));
}

function sanitizeSnapshots(value: unknown, trackIds: Set<string>): Record<string, Track> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidates = Object.values(value as Record<string, unknown>).filter(
    (item): item is Track => Boolean(item) && typeof item === "object",
  );
  const compact = createCachedQueueSnapshots(
    candidates.filter((track) => typeof track.id === "string" && trackIds.has(track.id)),
  );
  return compact.length ? Object.fromEntries(compact.map((track) => [track.id, track])) : undefined;
}

function sanitizeRemoteRef(value: unknown): LocalPlaylistRemoteRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<LocalPlaylistRemoteRef>;
  if (candidate.source !== "bilibili" || typeof candidate.url !== "string" || !candidate.url.trim()) return undefined;
  return {
    source: "bilibili",
    url: candidate.url.trim().slice(0, 2048),
    kind: candidate.kind === "playlist" ? "playlist" : "folder",
    ...(typeof candidate.title === "string" && candidate.title.trim() ? { title: candidate.title.trim().slice(0, 120) } : {}),
    ...(typeof candidate.syncedAt === "number" && Number.isFinite(candidate.syncedAt) ? { syncedAt: candidate.syncedAt } : {}),
  };
}

const VALID_SUPER_MIX_SOURCES = new Set<SuperMixSourceRef["source"]>(["local", "netease", "qq", "bilibili", "youtube"]);
const VALID_SUPER_MIX_STRATEGIES = new Set<SuperMixStrategy>(["interleave", "shuffle", "sequential"]);

function sanitizeSuperMix(value: unknown): LocalPlaylistSuperMix | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<LocalPlaylistSuperMix>;
  if (!Array.isArray(candidate.sources)) return undefined;
  const seenKeys = new Set<string>();
  const sources: SuperMixSourceRef[] = [];
  for (const item of candidate.sources.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<SuperMixSourceRef>;
    if (
      typeof raw.source !== "string" ||
      !VALID_SUPER_MIX_SOURCES.has(raw.source as SuperMixSourceRef["source"]) ||
      typeof raw.playlistId !== "string" ||
      !raw.playlistId.trim() ||
      typeof raw.name !== "string"
    ) {
      continue;
    }
    const key = typeof raw.key === "string" && raw.key.trim() ? raw.key.trim() : `${raw.source}:${raw.playlistId.trim()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    sources.push({
      key: key.slice(0, 240),
      source: raw.source as SuperMixSourceRef["source"],
      playlistId: raw.playlistId.trim().slice(0, 200),
      name: raw.name.trim().slice(0, 120) || "未命名来源",
      ...(typeof raw.coverUrl === "string" && raw.coverUrl.trim() && !raw.coverUrl.startsWith("data:")
        ? { coverUrl: raw.coverUrl.trim().slice(0, 2048) }
        : {}),
      ...(typeof raw.trackCount === "number" && Number.isFinite(raw.trackCount) && raw.trackCount >= 0
        ? { trackCount: Math.round(raw.trackCount) }
        : {}),
    });
  }
  const strategy: SuperMixStrategy =
    typeof candidate.strategy === "string" && VALID_SUPER_MIX_STRATEGIES.has(candidate.strategy as SuperMixStrategy)
      ? (candidate.strategy as SuperMixStrategy)
      : "interleave";
  const sourceCounts =
    candidate.sourceCounts && typeof candidate.sourceCounts === "object"
      ? Object.fromEntries(
          Object.entries(candidate.sourceCounts).filter(
            ([src, count]) =>
              (src === "local" || src === "cloud" || src === "netease" || src === "qq" || src === "bilibili" || src === "youtube") &&
              typeof count === "number" &&
              Number.isFinite(count) &&
              count > 0,
          ),
        )
      : undefined;
  const manualTrackIds = Array.isArray(candidate.manualTrackIds)
    ? [...new Set(candidate.manualTrackIds.filter((id): id is string => typeof id === "string" && Boolean(id)))].slice(0, 2_000)
    : undefined;
  return {
    sources,
    strategy,
    dedupe: candidate.dedupe !== false,
    ...(manualTrackIds?.length ? { manualTrackIds } : {}),
    ...(typeof candidate.syncedAt === "number" && Number.isFinite(candidate.syncedAt) ? { syncedAt: candidate.syncedAt } : {}),
    ...(typeof candidate.dedupedCount === "number" && Number.isFinite(candidate.dedupedCount) && candidate.dedupedCount > 0
      ? { dedupedCount: Math.round(candidate.dedupedCount) }
      : {}),
    ...(sourceCounts && Object.keys(sourceCounts).length ? { sourceCounts } : {}),
  };
}

export function sanitizeLocalPlaylists(value: unknown): LocalPlaylist[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<LocalPlaylist>;
    if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.name !== "string") return [];
    const now = Date.now();
    const trackIds = Array.isArray(candidate.trackIds)
      ? [...new Set(candidate.trackIds.filter((id): id is string => typeof id === "string" && Boolean(id)))].slice(0, 20_000)
      : [];
    const trackSnapshots = sanitizeSnapshots(candidate.trackSnapshots, new Set(trackIds));
    const remoteRef = sanitizeRemoteRef(candidate.remoteRef);
    const superMix = sanitizeSuperMix(candidate.superMix);
    const kind: LocalPlaylistKind | undefined =
      candidate.kind === "super-mix" || superMix ? "super-mix" : undefined;
    return [{
      id: candidate.id,
      name: candidate.name.trim().slice(0, 80) || "未命名歌单",
      ...(kind ? { kind } : {}),
      trackIds,
      ...(trackSnapshots ? { trackSnapshots } : {}),
      ...(remoteRef ? { remoteRef } : {}),
      ...(superMix ? { superMix } : {}),
      createdAt: typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) ? candidate.createdAt : now,
      updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : now,
    }];
  });
}

/**
 * 镜像同步的合并规则：B站来源的部分整体替换为远端最新列表；用户手动
 * 混入的本地/网易云/QQ 音乐歌曲保留在列表末尾，不会被刷新冲掉。
 * 手动加进来的B站歌曲视为镜像内容的一部分（与收藏夹远端合并去重）。
 */
export function mergeReferenceSync(
  playlist: LocalPlaylist,
  tracksToSync: Track[],
  title: string | undefined,
  now: number = Date.now(),
): LocalPlaylist {
  const snapshots = createPlaylistTrackSnapshots(tracksToSync);
  const trimmedTitle = title?.trim().slice(0, 120);
  const syncedIds = new Set(tracksToSync.map((track) => track.id));
  const manualTracks = playlist.trackIds
    .filter((trackId) => !syncedIds.has(trackId))
    .filter((trackId) => {
      const snapshot = playlist.trackSnapshots?.[trackId];
      const source = snapshot?.source ?? (trackId.split(":")[0] as Track["source"]);
      return source !== "bilibili";
    });
  const manualSnapshots = manualTracks.length && playlist.trackSnapshots
    ? Object.fromEntries(Object.entries(playlist.trackSnapshots).filter(([trackId]) => manualTracks.includes(trackId)))
    : {};
  return {
    ...playlist,
    name: trimmedTitle || playlist.name,
    trackIds: [...syncedIds, ...manualTracks],
    trackSnapshots: { ...snapshots, ...manualSnapshots },
    remoteRef: playlist.remoteRef
      ? {
          ...playlist.remoteRef,
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
          syncedAt: now,
        }
      : undefined,
    updatedAt: now,
  };
}

export function readLocalPlaylists(storage: PlaylistStorage | null = defaultStorage()): LocalPlaylist[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_PLAYLISTS_STORAGE_KEY);
    return raw ? sanitizeLocalPlaylists(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeLocalPlaylists(playlists: LocalPlaylist[], storage: PlaylistStorage | null = defaultStorage()) {
  if (!storage) return false;
  try {
    // Re-compact snapshots on every write so lyrics, waveforms and data-URL
    // artwork never accumulate in localStorage.
    const compact = playlists.map((playlist) => {
      const trackSnapshots = playlist.trackSnapshots
        ? createPlaylistTrackSnapshots(Object.values(playlist.trackSnapshots))
        : undefined;
      return {
        id: playlist.id,
        name: playlist.name,
        ...(playlist.kind === "super-mix" || playlist.superMix ? { kind: "super-mix" as const } : {}),
        trackIds: playlist.trackIds,
        ...(trackSnapshots && Object.keys(trackSnapshots).length ? { trackSnapshots } : {}),
        ...(playlist.remoteRef ? { remoteRef: playlist.remoteRef } : {}),
        ...(playlist.superMix ? { superMix: playlist.superMix } : {}),
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
      } satisfies LocalPlaylist;
    });
    storage.setItem(LOCAL_PLAYLISTS_STORAGE_KEY, JSON.stringify(compact));
    return true;
  } catch {
    return false;
  }
}

export type PlaylistInsertPosition = "top" | "bottom";

/**
 * Merges newly picked track IDs into an existing playlist while preserving the
 * user's selection order (`1, 2, 3...`) and avoiding duplicate entries.
 */
export function mergePlaylistTrackIds(
  existingIds: string[],
  addedIds: string[],
  position: PlaylistInsertPosition = "top",
): string[] {
  const existingSet = new Set(existingIds);
  const newOnly = [...new Set(addedIds)].filter((id) => Boolean(id) && !existingSet.has(id));
  if (!newOnly.length) return existingIds;
  return position === "top" ? [...newOnly, ...existingIds] : [...existingIds, ...newOnly];
}

export function resolveLocalPlaylistTracks(playlist: LocalPlaylist | null | undefined, tracks: Track[]) {
  if (!playlist) return [];
  const liveById = new Map(tracks.map((track) => [track.id, track]));
  const snapshotsById = new Map(
    (playlist.trackSnapshots ? Object.values(playlist.trackSnapshots) : []).map((track) => [track.id, track]),
  );
  return playlist.trackIds.flatMap((id) => {
    const live = liveById.get(id);
    const cached = snapshotsById.get(id);
    // Prefer a playable copy, but keep a metadata-only live row so unavailable
    // songs remain visible instead of silently disappearing from the playlist.
    const track = live?.streamUrl ? live : cached?.streamUrl ? cached : live ?? cached;
    return track ? [track] : [];
  });
}
