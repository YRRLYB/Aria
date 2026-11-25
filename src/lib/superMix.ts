import type { Track } from "@/data/music";
import type { SuperMixSourceRef, SuperMixStrategy } from "./localPlaylists";

export type SuperMixBucket = {
  ref: SuperMixSourceRef;
  tracks: Track[];
};

export type SuperMixResult = {
  tracks: Track[];
  sourceCounts: Partial<Record<Track["source"], number>>;
  dedupedCount: number;
};

const QUALITY_RANK: Record<Track["quality"], number> = {
  臻品: 600,
  "Hi-Res": 550,
  FLAC: 500,
  Lossless: 480,
  "320K": 320,
  AAC: 220,
  "128K": 128,
};

/**
 * Normalizes `title + artist` for cross-source matching (NetEase / QQ / Local)
 * while keeping meaningful edition words (Live / Remix / Instrumental) apart.
 */
export function normalizeTrackFingerprint(track: Pick<Track, "title" | "artist">): string {
  const clean = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s·・'"`,.!！?？:：/\\&]+/g, " ")
      .trim();
  const title = clean(track.title);
  const artist = clean(track.artist)
    .split(/\s*(?:,|、|;)\s*/)
    .filter(Boolean)
    .sort()
    .join(" ");
  return `${title}\u0000${artist}`;
}

/**
 * Ranks higher-fidelity, non-VIP-locked copies above low-bitrate or preview copies
 * so cross-source deduplication retains the best playable version.
 */
export function trackQualityScore(track: Track): number {
  const base = QUALITY_RANK[track.quality] ?? 100;
  const bitrateBonus = track.bitrate ? Math.min(99, Math.round(track.bitrate / 50_000)) : 0;
  const sourceBonus = track.source === "local" ? 45 : track.source === "cloud" ? 30 : 0;
  const playablePenalty = track.vip ? -1000 : 0;
  const mvBonus = track.hasVideo ? 5 : 0;
  return base + bitrateBonus + sourceBonus + mvBonus + playablePenalty;
}

export function countTrackSources(tracks: Track[]): Partial<Record<Track["source"], number>> {
  const counts: Partial<Record<Track["source"], number>> = {};
  for (const track of tracks) {
    counts[track.source] = (counts[track.source] ?? 0) + 1;
  }
  return counts;
}

export function mixSuperMixTracks(
  buckets: SuperMixBucket[],
  options: {
    strategy: SuperMixStrategy;
    dedupe: boolean;
    manualTracks?: Track[];
    rng?: () => number;
  },
): SuperMixResult {
  const { strategy, dedupe, manualTracks = [], rng = Math.random } = options;
  let dedupedCount = 0;

  type PlacedSlot = { bucketIndex: number; track: Track };
  const chosenById = new Map<string, PlacedSlot>();
  const chosenByFp = new Map<string, { bucketIndex: number; slotIndex: number; track: Track }>();
  const filteredBuckets: Track[][] = buckets.map(() => []);

  const pushUniqueTrack = (bucketIndex: number, track: Track) => {
    if (!track?.id) return;
    if (chosenById.has(track.id)) {
      dedupedCount += 1;
      return;
    }

    if (dedupe) {
      const fp = normalizeTrackFingerprint(track);
      const existing = chosenByFp.get(fp);
      if (existing) {
        dedupedCount += 1;
        if (trackQualityScore(track) > trackQualityScore(existing.track)) {
          chosenById.delete(existing.track.id);
          filteredBuckets[existing.bucketIndex][existing.slotIndex] = track;
          chosenById.set(track.id, { bucketIndex: existing.bucketIndex, track });
          chosenByFp.set(fp, { bucketIndex: existing.bucketIndex, slotIndex: existing.slotIndex, track });
        }
        return;
      }
      const slotIndex = filteredBuckets[bucketIndex].length;
      filteredBuckets[bucketIndex].push(track);
      chosenById.set(track.id, { bucketIndex, track });
      chosenByFp.set(fp, { bucketIndex, slotIndex, track });
      return;
    }

    filteredBuckets[bucketIndex].push(track);
    chosenById.set(track.id, { bucketIndex, track });
  };

  buckets.forEach((bucket, bucketIndex) => {
    for (const track of bucket.tracks) {
      pushUniqueTrack(bucketIndex, track);
    }
  });

  let arranged: Track[] = [];
  if (strategy === "interleave") {
    const maxLen = filteredBuckets.reduce((max, list) => Math.max(max, list.length), 0);
    for (let row = 0; row < maxLen; row += 1) {
      for (let col = 0; col < filteredBuckets.length; col += 1) {
        const track = filteredBuckets[col][row];
        if (track) arranged.push(track);
      }
    }
  } else if (strategy === "shuffle") {
    const pool = filteredBuckets.flat();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    // Gentle anti-clump pass: if consecutive tracks share a source and an
    // upcoming track from another source is available, swap them.
    for (let index = 1; index < pool.length; index += 1) {
      if (pool[index].source !== pool[index - 1].source) continue;
      const limit = Math.min(pool.length, index + 8);
      for (let probe = index + 1; probe < limit; probe += 1) {
        if (pool[probe].source !== pool[index - 1].source) {
          [pool[index], pool[probe]] = [pool[probe], pool[index]];
          break;
        }
      }
    }
    arranged = pool;
  } else {
    arranged = filteredBuckets.flat();
  }

  for (const manual of manualTracks) {
    if (!manual?.id || chosenById.has(manual.id)) continue;
    if (dedupe && chosenByFp.has(normalizeTrackFingerprint(manual))) {
      dedupedCount += 1;
      continue;
    }
    chosenById.set(manual.id, { bucketIndex: -1, track: manual });
    if (dedupe) chosenByFp.set(normalizeTrackFingerprint(manual), { bucketIndex: -1, slotIndex: arranged.length, track: manual });
    arranged.push(manual);
  }

  return {
    tracks: arranged,
    sourceCounts: countTrackSources(arranged),
    dedupedCount,
  };
}
