import type { LyricLine } from "./lyricTypes";

export type LocalMetadataOverride = {
  candidateId: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  artworkUpdatedAt?: string;
  lyrics?: LyricLine[];
  lyricCandidateId?: string;
  updatedAt: string;
};

export type LocalMetadataCandidate = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string | null;
  preview: string[];
  score: number;
  confidence: "high" | "medium" | "low";
};

export type LocalMetadataPreviewRow = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  candidates: LocalMetadataCandidate[];
  error?: string;
};

export type LocalMetadataPreview = {
  previewId: string;
  rows: LocalMetadataPreviewRow[];
};

export type LocalMetadataApplyOptions = {
  info: boolean;
  artwork: boolean;
  lyrics: boolean;
  replaceExisting: boolean;
};

/** Do not treat provider search position as match confidence. These scores
 * compare the user's tags with the returned text, and leave version labels
 * such as Live / Remix intact. */
export function metadataMatchScore(
  local: { title: string; artist?: string; album?: string },
  candidate: { title: string; artist?: string; album?: string },
) {
  const title = textSimilarity(local.title, candidate.title);
  const knownArtist = Boolean(normalizedText(local.artist ?? "")) && !isUnknownTag(local.artist);
  const artist = knownArtist ? artistSimilarity(local.artist!, candidate.artist ?? "") : 0;
  const knownAlbum = Boolean(normalizedText(local.album ?? "")) && !isUnknownTag(local.album);
  const album = knownAlbum ? textSimilarity(local.album!, candidate.album ?? "") : 0;
  // Unknown artists never qualify for bulk high-confidence selection.
  const score = knownArtist ? title * 65 + artist * 30 + (knownAlbum ? album * 5 : 5) : title * 75;
  // A small Live/Remix suffix on a long title can produce a very high fuzzy
  // similarity. Require an exact normalized title for automatic selection.
  const ceiling = normalizedText(local.title) === normalizedText(candidate.title) ? 100 : 91;
  return Math.max(0, Math.min(ceiling, Math.round(score)));
}

export function metadataConfidence(score: number): LocalMetadataCandidate["confidence"] {
  return score >= 92 ? "high" : score >= 78 ? "medium" : "low";
}

export function selectAutomaticMetadataCandidate<T extends { title: string; artist?: string; album?: string }>(
  track: { title: string; artist?: string; album?: string },
  candidates: T[],
): T | undefined {
  const ranked = candidates.map((candidate) => ({ candidate, score: metadataMatchScore(track, candidate) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 92 || (ranked[1] && best.score - ranked[1].score < 3)) return undefined;
  return best.candidate;
}

export function isUnknownTag(value?: string | null) {
  return !value || /^(?:unknown(?: artist| album)?|未知(?:艺人|歌手|专辑)?|无专辑|untitled)$/i.test(value.trim());
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

function textSimilarity(left: string, right: string) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (value: string) => new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
  const ap = pairs(a);
  const bp = pairs(b);
  const shared = [...ap].filter((pair) => bp.has(pair)).length;
  return (2 * shared) / (ap.size + bp.size);
}

function artistSimilarity(left: string, right: string) {
  const split = (value: string) => value.split(/\s*(?:\/|、|&|;|,|，| feat\.? | ft\.? )\s*/i).filter(Boolean);
  const a = split(left);
  const b = split(right);
  if (!a.length || !b.length) return 0;
  return a.reduce((sum, artist) => sum + Math.max(...b.map((other) => textSimilarity(artist, other))), 0) / a.length;
}
