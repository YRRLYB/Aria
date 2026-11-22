import neteaseApi from "NeteaseCloudMusicApi";
import { cleanYoutubeTrackQuery } from "../src/lib/localMetadata";
import type { LyricCandidate, ScannedTrack } from "./types";
import { fetchNeteaseLyrics } from "./services/lyricService";
import { getQqLyrics, searchQqTracks } from "./sources/qq/client";

type SearchSong = {
  id: number | string;
  name: string;
  ar?: Array<{ name: string }>;
  artists?: Array<{ name: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
};

export async function searchLyricCandidates(query: {
  title: string;
  artist?: string;
  album?: string;
}, options?: { previewLimit?: number }): Promise<LyricCandidate[]> {
  const cleaned = cleanYoutubeTrackQuery(query);
  const titleQuery = cleaned.title || query.title.trim();
  const artistQuery = cleaned.artist || undefined;
  const keywords = [titleQuery, artistQuery].filter(Boolean).join(" ");
  const previewLimit = options?.previewLimit ?? 6;

  const [neteaseResult, qqResult] = await Promise.allSettled([
    neteaseApi.cloudsearch({
      keywords,
      type: 1,
      limit: 6,
    }),
    searchQqTracks(keywords, 4, 0),
  ]);

  const songs =
    neteaseResult.status === "fulfilled"
      ? (((neteaseResult.value.body?.result as { songs?: SearchSong[] } | undefined)?.songs ?? []).slice(0, 6))
      : [];
  const qqTracks = qqResult.status === "fulfilled" ? qqResult.value.slice(0, 4) : [];

  const neteaseCandidates = await Promise.all(
    songs.map(async (song, index) => {
      const lyric = index < previewLimit ? await readLyricPreview(song.id) : [];
      return {
        id: `netease:${song.id}`,
        source: "网易云" as const,
        title: song.name,
        artist: (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(" / ") || artistQuery || "未知艺人",
        album: song.al?.name ?? song.album?.name ?? cleaned.album ?? "未知专辑",
        coverUrl: song.al?.picUrl ?? song.album?.picUrl ?? null,
        score: Math.max(72, 98 - index * 5),
        preview: lyric,
      };
    }),
  );

  const remainingPreviewSlots = Math.max(0, previewLimit - neteaseCandidates.length);
  const qqCandidates = await Promise.all(
    qqTracks.map(async (track, index) => {
      const lyric = index < remainingPreviewSlots ? await readQqLyricPreview(track.id) : [];
      return {
        id: `qq:${track.id}`,
        source: "QQ音乐" as const,
        title: track.title,
        artist: track.artist || artistQuery || "未知艺人",
        album: track.album || cleaned.album || "未知专辑",
        coverUrl: track.coverUrl ?? null,
        score: Math.max(70, 96 - index * 5),
        preview: lyric,
      };
    }),
  );

  return [...neteaseCandidates, ...qqCandidates];
}

export function candidatesFromTrack(track: ScannedTrack) {
  return searchLyricCandidates({
    title: track.title,
    artist: track.artist,
    album: track.album,
  });
}

export async function resolveLyricLines(candidateId: string) {
  if (candidateId.startsWith("netease:")) {
    return fetchNeteaseLyrics(candidateId.slice("netease:".length));
  }
  if (candidateId.startsWith("qq:")) {
    return getQqLyrics(candidateId.slice("qq:".length));
  }
  return [];
}

async function readQqLyricPreview(songmid: string) {
  try {
    const lines = await getQqLyrics(songmid);
    return lines
      .map((line) => line.text.trim())
      .filter((line) => line && !line.includes("作词") && !line.includes("作曲"))
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function readLyricPreview(songId: string | number) {
  try {
    const response = await neteaseApi.lyric({ id: songId });
    const lyric = (response.body?.lrc as { lyric?: string } | undefined)?.lyric ?? "";
    return lyric
      .split("\n")
      .map((line) => line.replace(/\[[^\]]+\]/g, "").trim())
      .filter((line) => line && !line.includes("作词") && !line.includes("作曲"))
      .slice(0, 3);
  } catch {
    return [];
  }
}
