import type { Track } from "@/data/music";

export const LOCAL_PLAYLISTS_STORAGE_KEY = "aria-local-playlists-v1";

export type LocalPlaylist = {
  id: string;
  name: string;
  trackIds: string[];
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

export function createLocalPlaylist(name: string, trackIds: string[] = [], now = Date.now()): LocalPlaylist {
  return {
    id: createPlaylistId(),
    name: name.trim().slice(0, 80) || "未命名歌单",
    trackIds: [...new Set(trackIds)],
    createdAt: now,
    updatedAt: now,
  };
}

export function sanitizeLocalPlaylists(value: unknown): LocalPlaylist[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<LocalPlaylist>;
    if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.name !== "string") return [];
    const now = Date.now();
    return [{
      id: candidate.id,
      name: candidate.name.trim().slice(0, 80) || "未命名歌单",
      trackIds: Array.isArray(candidate.trackIds)
        ? [...new Set(candidate.trackIds.filter((id): id is string => typeof id === "string" && Boolean(id)))].slice(0, 20_000)
        : [],
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
    storage.setItem(LOCAL_PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists));
    return true;
  } catch {
    return false;
  }
}

export function resolveLocalPlaylistTracks(playlist: LocalPlaylist | null | undefined, tracks: Track[]) {
  if (!playlist) return [];
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return playlist.trackIds.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));
}
