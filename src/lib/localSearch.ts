import type { Track } from "../data/music";

export function createLocalTrackSearchIndex(tracks: Track[]) {
  return new Map(tracks.map((track) => [track.id,
    [track.title, track.artist, track.album, track.quality].join(" ").toLowerCase(),
  ]));
}

export function searchLocalTrackIndex(tracks: Track[], index: Map<string, string>, query: string, limit = 60) {
  const text = query.trim().toLowerCase();
  const matches: Track[] = [];
  if (!text || limit <= 0) return matches;
  for (const track of tracks) {
    if (!index.get(track.id)?.includes(text)) continue;
    matches.push(track);
    if (matches.length >= limit) break;
  }
  return matches;
}
