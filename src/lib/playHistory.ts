import type { Track } from "@/data/music";
import { readCachedLyrics } from "@/lib/playerPresentation";

export type PlayHistoryEntry = {
  track: Track;
  playedAt: number;
  count: number;
};

const playHistoryCacheKey = "aria-play-history";

export function createPlayerCacheSnapshot(track: Track): Track {
  return { ...track };
}

function hydrateHistoryTrack(track: Track): Track {
  const cachedLyrics = readCachedLyrics(track.id);
  if (!cachedLyrics.length) return track;
  const hasLyrics = track.lyrics.some((line) => line.text.trim().length > 0);
  if (hasLyrics) return track;
  return {
    ...track,
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
      .slice(0, 200);
  } catch {
    return [];
  }
}

export function writePlayHistory(history: PlayHistoryEntry[]) {
  try {
    window.localStorage.setItem(playHistoryCacheKey, JSON.stringify(history.slice(0, 200)));
  } catch {
    // History should never block playback.
  }
}
