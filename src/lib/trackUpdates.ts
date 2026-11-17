import type { Track } from "@/data/music";

/** Update only the requested track and keep untouched lists/rows referentially stable. */
export function updateTracksById(tracks: Track[], trackId: string, update: (track: Track) => Track): Track[] {
  let next: Track[] | null = null;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track.id !== trackId) continue;
    const updated = update(track);
    if (updated === track) continue;
    if (!next) next = tracks.slice();
    next[index] = updated;
  }
  return next ?? tracks;
}
