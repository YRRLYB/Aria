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

export type LocalPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
  /**
   * Remote tracks need their metadata/stream route after a restart, before the
   * source view has loaded. Local files are always resolved from the live
   * library and do not need a snapshot.
   */
  trackSnapshots?: Record<string, Track>;
  remoteRef?: LocalPlaylistRemoteRef;
  createdAt: number;
  updatedAt: number;
};

type PlaylistStorage = Pick<Storage, "getItem" | "setItem">;

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
): LocalPlaylist {
  return {
    id: createPlaylistId(),
    name: name.trim().slice(0, 80) || "未命名歌单",
    trackIds: [...new Set(trackIds)],
    ...(trackSnapshots && Object.keys(trackSnapshots).length ? { trackSnapshots } : {}),
    ...(remoteRef ? { remoteRef } : {}),
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
    return [{
      id: candidate.id,
      name: candidate.name.trim().slice(0, 80) || "未命名歌单",
      trackIds,
      ...(trackSnapshots ? { trackSnapshots } : {}),
      ...(remoteRef ? { remoteRef } : {}),
      createdAt: typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) ? candidate.createdAt : now,
      updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : now,
    }];
  });
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
        trackIds: playlist.trackIds,
        ...(trackSnapshots && Object.keys(trackSnapshots).length ? { trackSnapshots } : {}),
        ...(playlist.remoteRef ? { remoteRef: playlist.remoteRef } : {}),
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
