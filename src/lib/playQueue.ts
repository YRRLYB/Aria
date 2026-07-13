import type { Track } from "@/data/music";

export function playableTracks(tracks: Track[]) {
  return tracks.filter((track) => Boolean(track.streamUrl));
}

export function orderedQueueIds(tracks: Track[]) {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const track of playableTracks(tracks)) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    ids.push(track.id);
  }
  return ids;
}

export function shuffleQueueIds(tracks: Track[], anchorId?: string) {
  const ids = orderedQueueIds(tracks);
  const anchor = anchorId && ids.includes(anchorId) ? anchorId : ids[0];
  const rest = ids.filter((id) => id !== anchor);

  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[swapIndex]] = [rest[swapIndex], rest[index]];
  }

  return anchor ? [anchor, ...rest] : rest;
}

export function materializeQueueIds(tracks: Track[], activeTrackId: string, shuffled: boolean) {
  return shuffled ? shuffleQueueIds(tracks, activeTrackId) : orderedQueueIds(tracks);
}
