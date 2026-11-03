import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";

export const NETEASE_SNAPSHOT_STORAGE_KEY = "aria-netease-snapshot-v1";
const snapshotVersion = 1;
const maxSnapshotAge = 14 * 24 * 60 * 60_000;
const maxTracksPerList = 400;

export type NeteaseSnapshot = {
  version: 1;
  userId: string | null;
  savedAt: number;
  dailyTracks: Track[];
  roamTracks: Track[];
  likedTracks: Track[];
  neteaseTracks: Track[];
  playlists: ProviderPlaylist[];
};

type SnapshotStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): SnapshotStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function compactTrack(track: Track): Track {
  // Lyrics and long waveform arrays are reloaded from their own caches. The
  // startup snapshot only needs enough data to paint the first screen.
  return {
    ...track,
    lyrics: [],
    waveform: Array.isArray(track.waveform) ? track.waveform.slice(0, 12) : [],
  };
}

function sanitizeTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const track = value as Partial<Track>;
  if (typeof track.id !== "string" || !track.id || typeof track.title !== "string") return null;
  return {
    id: track.id,
    providerId: typeof track.providerId === "string" ? track.providerId : undefined,
    albumId: typeof track.albumId === "string" ? track.albumId : null,
    artistIds: Array.isArray(track.artistIds) ? track.artistIds.filter((id): id is string => typeof id === "string") : [],
    matchedLyric: typeof track.matchedLyric === "string" ? track.matchedLyric : null,
    title: track.title,
    artist: typeof track.artist === "string" ? track.artist : "",
    album: typeof track.album === "string" ? track.album : "",
    duration: typeof track.duration === "string" ? track.duration : "--:--",
    quality: track.quality ?? "320K",
    source: "netease",
    coverUrl: typeof track.coverUrl === "string" ? track.coverUrl : undefined,
    likedAt: typeof track.likedAt === "number" ? track.likedAt : null,
    bpm: typeof track.bpm === "number" ? track.bpm : null,
    bitrate: typeof track.bitrate === "number" ? track.bitrate : null,
    sampleRate: typeof track.sampleRate === "number" ? track.sampleRate : null,
    currentLevel: track.currentLevel ?? null,
    availableLevels: Array.isArray(track.availableLevels) ? track.availableLevels : [],
    cover: typeof track.cover === "string" ? track.cover : "linear-gradient(135deg, #e4ddf5 0%, #8680b4 50%, #202036 100%)",
    accent: typeof track.accent === "string" ? track.accent : "#8680b4",
    waveform: Array.isArray(track.waveform) ? track.waveform.slice(0, 12) : [],
    lyricStatus: track.lyricStatus === "linked" || track.lyricStatus === "searchable" ? track.lyricStatus : "searchable",
    lyrics: [],
  };
}

function sanitizePlaylist(value: unknown): ProviderPlaylist | null {
  if (!value || typeof value !== "object") return null;
  const playlist = value as Partial<ProviderPlaylist>;
  if (typeof playlist.id !== "string" || !playlist.id || typeof playlist.name !== "string") return null;
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: typeof playlist.trackCount === "number" ? playlist.trackCount : 0,
    subscribed: Boolean(playlist.subscribed),
    ownerId: typeof playlist.ownerId === "string" ? playlist.ownerId : null,
    owned: Boolean(playlist.owned),
    canEdit: Boolean(playlist.canEdit),
    coverColor: typeof playlist.coverColor === "string" ? playlist.coverColor : "#8680b4",
    coverUrl: typeof playlist.coverUrl === "string" ? playlist.coverUrl : null,
    description: typeof playlist.description === "string" ? playlist.description : undefined,
    creatorName: typeof playlist.creatorName === "string" ? playlist.creatorName : undefined,
    tags: Array.isArray(playlist.tags) ? playlist.tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}

function sanitizeTrackList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((track) => {
      const sanitized = sanitizeTrack(track);
      return sanitized ? [sanitized] : [];
    })
    .slice(0, maxTracksPerList);
}

export function sanitizeNeteaseSnapshot(value: unknown): NeteaseSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<NeteaseSnapshot>;
  if (snapshot.version !== snapshotVersion) return null;
  const savedAt = typeof snapshot.savedAt === "number" ? snapshot.savedAt : 0;
  if (!savedAt || Date.now() - savedAt > maxSnapshotAge) return null;
  return {
    version: 1,
    userId: typeof snapshot.userId === "string" ? snapshot.userId : null,
    savedAt,
    dailyTracks: sanitizeTrackList(snapshot.dailyTracks),
    roamTracks: sanitizeTrackList(snapshot.roamTracks),
    likedTracks: sanitizeTrackList(snapshot.likedTracks),
    neteaseTracks: sanitizeTrackList(snapshot.neteaseTracks),
    playlists: Array.isArray(snapshot.playlists)
      ? snapshot.playlists.flatMap((playlist) => {
          const sanitized = sanitizePlaylist(playlist);
          return sanitized ? [sanitized] : [];
        }).slice(0, 200)
      : [],
  };
}

export function readNeteaseSnapshot(storage: SnapshotStorage | null = defaultStorage()): NeteaseSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(NETEASE_SNAPSHOT_STORAGE_KEY);
    return raw ? sanitizeNeteaseSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeNeteaseSnapshot(
  snapshot: Omit<NeteaseSnapshot, "version" | "savedAt">,
  storage: SnapshotStorage | null = defaultStorage(),
) {
  if (!storage) return false;
  try {
    const compacted: NeteaseSnapshot = {
      version: 1,
      userId: snapshot.userId,
      savedAt: Date.now(),
      dailyTracks: snapshot.dailyTracks.slice(0, maxTracksPerList).map(compactTrack),
      roamTracks: snapshot.roamTracks.slice(0, maxTracksPerList).map(compactTrack),
      likedTracks: snapshot.likedTracks.slice(0, maxTracksPerList).map(compactTrack),
      neteaseTracks: snapshot.neteaseTracks.slice(-maxTracksPerList).map(compactTrack),
      playlists: snapshot.playlists.slice(0, 200),
    };
    storage.setItem(NETEASE_SNAPSHOT_STORAGE_KEY, JSON.stringify(compacted));
    return true;
  } catch {
    return false;
  }
}

export function clearNeteaseSnapshot(storage: SnapshotStorage | null = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(NETEASE_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private browsing; the in-memory state is still cleared.
  }
}
