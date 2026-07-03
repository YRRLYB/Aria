import { createHash } from "node:crypto";
import type { LyricCandidate, ScannedTrack } from "./types";

const sources: LyricCandidate["source"][] = ["网易云", "QQ音乐", "酷狗"];

export function searchLyricCandidates(query: {
  title: string;
  artist?: string;
  album?: string;
}): LyricCandidate[] {
  const artist = query.artist || "未知艺人";
  const album = query.album || "未知专辑";

  return sources.map((source, index) => ({
    id: createHash("sha1")
      .update(`${source}:${query.title}:${artist}:${album}`)
      .digest("hex")
      .slice(0, 12),
    source,
    title: query.title,
    artist,
    album: index === 1 ? `${album} · 精确匹配` : album,
    score: Math.max(76, 96 - index * 8),
    preview: buildPreviewLines(query.title, artist, source),
  }));
}

export function candidatesFromTrack(track: ScannedTrack) {
  return searchLyricCandidates({
    title: track.title,
    artist: track.artist,
    album: track.album,
  });
}

function buildPreviewLines(title: string, artist: string, source: LyricCandidate["source"]) {
  return [
    `${title} 的第一句歌词预览`,
    `${artist} 的匹配结果来自 ${source}`,
    "绑定后会保存到本地曲目记录",
  ];
}
