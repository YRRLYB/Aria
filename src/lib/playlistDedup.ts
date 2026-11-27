import type { Track } from "@/data/music";

const QUALITY_RANK: Record<Track["quality"], number> = {
  "臻品": 700,
  "Hi-Res": 600,
  "FLAC": 500,
  "Lossless": 450,
  "320K": 300,
  "AAC": 200,
  "128K": 100,
};

export function normalizeTrackDedupKey(track: Pick<Track, "title" | "artist">): string {
  const title = track.title.toLowerCase().replace(/\s+/g, " ").trim();
  if (!title) return "";
  const primaryArtist = (track.artist.split(/[/,&、]/)[0] ?? track.artist)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `${title}::${primaryArtist}`;
}

export function scoreTrackQuality(track: Track): number {
  const tier = QUALITY_RANK[track.quality] ?? 100;
  const sampleScore = Math.min(100, (track.sampleRate ?? 0) / 2000);
  const bitrateScore = Math.min(50, (track.bitrate ?? 0) / 40);
  const localBonus = track.source === "local" ? 20 : 0;
  const streamBonus = track.streamUrl ? 50 : 0;
  return tier + sampleScore + bitrateScore + localBonus + streamBonus;
}

export function findPlaylistDuplicates(tracks: Track[]): {
  duplicateCount: number;
  keptTracks: Track[];
  removableTracks: Track[];
} {
  const bestByKey = new Map<string, { index: number; score: number }>();

  tracks.forEach((track, index) => {
    const key = normalizeTrackDedupKey(track);
    if (!key) return;
    const score = scoreTrackQuality(track);
    const existing = bestByKey.get(key);
    if (!existing || score > existing.score) {
      bestByKey.set(key, { index, score });
    }
  });

  const keptTracks: Track[] = [];
  const removableTracks: Track[] = [];

  tracks.forEach((track, index) => {
    const key = normalizeTrackDedupKey(track);
    if (!key) {
      keptTracks.push(track);
      return;
    }
    const winner = bestByKey.get(key);
    if (winner && winner.index === index) {
      keptTracks.push(track);
    } else {
      removableTracks.push(track);
    }
  });

  return {
    duplicateCount: removableTracks.length,
    keptTracks,
    removableTracks,
  };
}
