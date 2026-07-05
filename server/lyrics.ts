import neteaseApi from "NeteaseCloudMusicApi";
import type { LyricCandidate, ScannedTrack } from "./types";

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
}): Promise<LyricCandidate[]> {
  const keywords = [query.title, query.artist].filter(Boolean).join(" ");
  const response = await neteaseApi.cloudsearch({
    keywords,
    type: 1,
    limit: 6,
  });
  const songs = ((response.body?.result as { songs?: SearchSong[] } | undefined)?.songs ?? []).slice(0, 6);

  const candidates = await Promise.all(
    songs.map(async (song, index) => {
      const lyric = await readLyricPreview(song.id);
      return {
        id: `netease:${song.id}`,
        source: "网易云" as const,
        title: song.name,
        artist: (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(" / ") || query.artist || "未知艺人",
        album: song.al?.name ?? song.album?.name ?? query.album ?? "未知专辑",
        coverUrl: song.al?.picUrl ?? song.album?.picUrl ?? null,
        score: Math.max(72, 98 - index * 5),
        preview: lyric,
      };
    }),
  );

  return candidates;
}

export function candidatesFromTrack(track: ScannedTrack) {
  return searchLyricCandidates({
    title: track.title,
    artist: track.artist,
    album: track.album,
  });
}

export async function resolveLyricLines(candidateId: string) {
  if (!candidateId.startsWith("netease:")) return [];
  const songId = candidateId.slice("netease:".length);
  const response = await neteaseApi.lyric({ id: songId });
  const lyric = (response.body?.lrc as { lyric?: string } | undefined)?.lyric ?? "";
  return parseLrc(lyric);
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

function parseLrc(lyric: string) {
  return lyric
    .split("\n")
    .map((line) => {
      const match = line.match(/^\[(\d{2}):(\d{2})(?:\.\d+)?\](.*)$/);
      if (!match) return null;
      const text = match[3].trim();
      if (!text) return null;
      return {
        time: `${match[1]}:${match[2]}`,
        text,
      };
    })
    .filter((line): line is { time: string; text: string } => Boolean(line));
}
