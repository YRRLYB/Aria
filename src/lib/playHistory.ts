import type { Track } from "@/data/music";
import { readCachedArtworkOverride } from "@/lib/artworkOverrides";
import { readCachedLyrics } from "@/lib/playerPresentation";

export type PlayHistoryEntry = {
  track: Track;
  playedAt: number;
  count: number;
};

const playHistoryCacheKey = "aria-play-history";

export function createPlayerCacheSnapshot(track: Track): Track {
  const snapshot = { ...track };
  // Artwork overrides are persisted separately. Avoid duplicating up to
  // ~900KB data URLs in every history/player snapshot.
  if (snapshot.coverUrl?.startsWith("data:")) {
    snapshot.coverUrl = undefined;
  }
  return snapshot;
}

function hydrateHistoryTrack(track: Track): Track {
  const artworkOverride = readCachedArtworkOverride(track.id);
  const cachedLyrics = readCachedLyrics(track.id);
  const withArtwork = artworkOverride && !track.coverUrl ? { ...track, coverUrl: artworkOverride } : track;
  if (!cachedLyrics.length) return withArtwork;
  const hasLyrics = withArtwork.lyrics.some((line) => line.text.trim().length > 0);
  if (hasLyrics) return withArtwork;
  return {
    ...withArtwork,
    lyrics: cachedLyrics,
    lyricStatus: "linked",
  };
}

export function readPlayHistory(): PlayHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(playHistoryCacheKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlayHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry?.track?.id && typeof entry.playedAt === "number")
      .map((entry) => ({
        track: hydrateHistoryTrack(createPlayerCacheSnapshot(entry.track)),
        playedAt: entry.playedAt,
        count: typeof entry.count === "number" && entry.count > 0 ? Math.round(entry.count) : 1,
      }))
      .slice(0, 80);
  } catch {
    return [];
  }
}

export function writePlayHistory(history: PlayHistoryEntry[]) {
  try {
    const compactHistory = history.slice(0, 80).map((entry) => ({
      ...entry,
      track: createPlayerCacheSnapshot(entry.track),
    }));
    window.localStorage.setItem(playHistoryCacheKey, JSON.stringify(compactHistory));
  } catch {
    // History should never block playback.
  }
}
