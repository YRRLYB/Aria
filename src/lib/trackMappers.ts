import type { ApiScannedTrack, ProviderPlaylist, ProviderTrack } from "@/lib/api";
import { api } from "@/lib/api";
import { formatDuration, normalizeQuality, readCachedLyrics } from "@/lib/playerPresentation";
import { readCachedArtworkOverride } from "@/lib/artworkOverrides";
import type { Track } from "@/data/music";

export const localCoverPalettes = [
  "linear-gradient(135deg, #d9e7f6 0%, #5e8ab8 48%, #182338 100%)",
  "linear-gradient(135deg, #f4d4ce 0%, #c6796d 50%, #241a1a 100%)",
  "linear-gradient(135deg, #d7f1e5 0%, #5aa894 50%, #172823 100%)",
  "linear-gradient(135deg, #e4ddf5 0%, #8680b4 50%, #202036 100%)",
];

export const idleTrack: Track = {
  id: "idle",
  title: "暂无播放",
  artist: "扫描本地目录或同步网易云",
  album: "Aria",
  duration: "--:--",
  quality: "320K",
  source: "local",
  cover: "linear-gradient(135deg, #eef1f5 0%, #aeb7c6 50%, #586273 100%)",
  accent: "#7b8494",
  waveform: [18, 28, 22, 34, 26, 38, 24, 32, 28, 36, 22, 30],
  lyricStatus: "missing",
  lyrics: [{ time: "00:00", text: "暂无歌词" }],
};

export function localTrackToUiTrack(track: ApiScannedTrack, index: number): Track {
  const cachedLyrics = readCachedLyrics(track.id);
  const artworkOverride = readCachedArtworkOverride(track.id);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist ?? null,
    duration: formatDuration(track.duration),
    quality: normalizeQuality(track.quality),
    source: "local",
    streamUrl: track.streamUrl ? api.resolveUrl(track.streamUrl) : api.getTrackStreamUrl(track.id),
    coverUrl: artworkOverride ?? (track.hasCover ? api.getTrackCoverUrl(track.id) : undefined),
    trackNumber: track.trackNumber ?? null,
    discNumber: track.discNumber ?? null,
    bitrate: track.bitrate ?? null,
    sampleRate: track.sampleRate ?? null,
    bpm: null,
    libraryRoot: track.libraryRoot,
    mediaKind: track.mediaKind ?? "file",
    nativeDevice: track.nativeDevice ?? null,
    nativeStart: track.nativeStart ?? null,
    nativeEnd: track.nativeEnd ?? null,
    cdReadQuality: track.cdReadQuality ?? "high",
    requiresNativePlayback: track.requiresNativePlayback ?? false,
    currentLevel: null,
    availableLevels: [],
    cover: localCoverPalettes[index % localCoverPalettes.length],
    accent: ["#5e8ab8", "#c6796d", "#5aa894", "#8680b4"][index % 4],
    waveform: [28, 42, 64, 38, 72, 54, 46, 82, 58, 36, 68, 48],
    lyricStatus: cachedLyrics.length ? "linked" : "searchable",
    lyrics: cachedLyrics.length ? cachedLyrics : [
      { time: "00:00", text: "本地歌词等待匹配" },
      { time: "00:15", text: "可以在本地音乐页联网搜词后绑定" },
      { time: "00:30", text: "绑定后会保存到本地索引" },
    ],
  };
}

export function providerTrackToUiTrack(track: ProviderTrack, index: number): Track {
  const palette = localCoverPalettes[(index + 1) % localCoverPalettes.length];
  const accent = ["#c6796d", "#5aa894", "#8680b4", "#5e8ab8"][index % 4];
  const cachedLyrics = readCachedLyrics(`netease:${track.id}`);

  return {
    id: `netease:${track.id}`,
    providerId: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: formatDuration(track.duration),
    quality: normalizeQuality(track.quality),
    source: "netease",
    streamUrl: track.streamUrl ? api.resolveUrl(track.streamUrl) : undefined,
    coverUrl: track.coverUrl ? api.getNeteaseCoverUrl(track.coverUrl) : undefined,
    likedAt: track.likedAt ?? null,
    bpm: null,
    bitrate: track.bitrate ?? null,
    sampleRate: track.sampleRate ?? null,
    currentLevel: track.currentLevel ?? null,
    availableLevels: track.availableLevels ?? ["standard", "higher", "exhigh"],
    cover: palette,
    accent,
    waveform: [24, 40, 66, 48, 78, 56, 36, 84, 62, 42, 70, 52],
    lyricStatus: cachedLyrics.length ? "linked" : "searchable",
    lyrics: cachedLyrics.length ? cachedLyrics : [
      { time: "00:00", text: "歌词等待同步" },
      { time: "00:15", text: "网易云歌曲已接入真实账号数据" },
      { time: "00:30", text: "后续会按歌曲 ID 同步滚动歌词" },
    ],
  };
}

export function getTrackSearchSignature(tracks: Track[]) {
  return tracks
    .map((track) => [track.id, track.title, track.artist, track.album, track.quality].join("\u0000"))
    .join("\u0001");
}

export function isLikedPlaylist(playlist: ProviderPlaylist | null | undefined, index?: number) {
  if (!playlist) return false;
  return index === 0 || /喜欢|我喜欢|liked|favorite/i.test(playlist.name);
}
