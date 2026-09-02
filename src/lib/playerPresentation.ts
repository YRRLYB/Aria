import { navItems, type LyricLine, type Track, type ViewId } from "@/data/music";
import { readCachedArtworkOverride } from "@/lib/artworkOverrides";

export type QualityLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster";
export type CoverPalette = { primary: string; secondary: string };
export type PlayerSideView = "lyrics" | "queue";
export type AudioOutputMode = "system" | "shared" | "exclusive";

export type CachedPlayerState = {
  activeTrackId?: string;
  activeTrackSnapshot?: Track;
  activeView?: ViewId;
  playerSideView?: PlayerSideView;
  playQueueIds?: string[];
  currentTime?: number;
  volume?: number;
  qualityLevel?: QualityLevel;
  shuffleEnabled?: boolean;
  repeatMode?: "all" | "one";
  playing?: boolean;
};

const playerCacheKey = "aria-player-state";
const lyricCacheKey = "aria-lyrics-cache";
const audioSettingsKey = "aria-audio-settings";

export const qualityOptions: Array<{ value: QualityLevel; label: string }> = [
  { value: "standard", label: "标准" },
  { value: "higher", label: "较高" },
  { value: "exhigh", label: "极高" },
  { value: "lossless", label: "无损" },
  { value: "hires", label: "Hi-Res" },
  { value: "jymaster", label: "臻品" },
];

const qualityLevelLabels: Record<QualityLevel, string> = {
  standard: "标准",
  higher: "较高",
  exhigh: "320K",
  lossless: "无损",
  hires: "Hi-Res",
  jymaster: "臻品",
};

export function readCachedPlayerState(): CachedPlayerState {
  try {
    const raw = window.localStorage.getItem(playerCacheKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CachedPlayerState;
    const navIds = new Set<string>([...navItems.map((item) => item.id), "settings"]);
    const qualityIds = new Set(qualityOptions.map((item) => item.value));

    return {
      activeTrackId: typeof parsed.activeTrackId === "string" ? parsed.activeTrackId : undefined,
      activeTrackSnapshot: hydrateTrackLyrics(normalizeTrackSnapshot(parsed.activeTrackSnapshot)),
      activeView: parsed.activeView && navIds.has(parsed.activeView) ? parsed.activeView : undefined,
      playerSideView: parsed.playerSideView === "queue" ? "queue" : parsed.playerSideView === "lyrics" ? "lyrics" : undefined,
      playQueueIds: Array.isArray(parsed.playQueueIds)
        ? parsed.playQueueIds.filter((id): id is string => typeof id === "string")
        : undefined,
      currentTime: undefined,
      volume:
        typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
          ? Math.max(0, Math.min(100, parsed.volume))
          : undefined,
      qualityLevel: parsed.qualityLevel && qualityIds.has(parsed.qualityLevel) ? parsed.qualityLevel : undefined,
      shuffleEnabled: typeof parsed.shuffleEnabled === "boolean" ? parsed.shuffleEnabled : undefined,
      repeatMode: parsed.repeatMode === "one" ? "one" : parsed.repeatMode === "all" ? "all" : undefined,
      playing: false,
    };
  } catch {
    return {};
  }
}

function hydrateTrackLyrics(track?: Track): Track | undefined {
  if (!track) return undefined;
  const cachedLyrics = readCachedLyrics(track.id);
  if (!cachedLyrics.length) return track;
  const hasLyrics = track.lyrics.some((line) => line.text.trim().length > 0);
  if (hasLyrics) return track;
  return {
    ...track,
    lyrics: cachedLyrics,
    lyricStatus: "linked",
  };
}

function normalizeTrackSnapshot(value: unknown): Track | undefined {
  if (!value || typeof value !== "object") return undefined;
  const track = value as Partial<Track>;
  if (typeof track.id !== "string" || typeof track.title !== "string" || typeof track.artist !== "string") {
    return undefined;
  }

  return {
    id: track.id,
    providerId: typeof track.providerId === "string" ? track.providerId : undefined,
    title: track.title,
    artist: track.artist,
    album: typeof track.album === "string" ? track.album : "Aria",
    albumArtist: typeof track.albumArtist === "string" ? track.albumArtist : null,
    duration: typeof track.duration === "string" ? track.duration : "--:--",
    quality:
      track.quality === "Hi-Res" || track.quality === "FLAC" || track.quality === "Lossless" || track.quality === "320K"
        ? track.quality
        : "320K",
    source: track.source === "netease" || track.source === "cloud" || track.source === "local" ? track.source : "local",
    streamUrl: typeof track.streamUrl === "string" ? track.streamUrl : undefined,
    coverUrl: readCachedArtworkOverride(track.id) ?? (typeof track.coverUrl === "string" ? track.coverUrl : undefined),
    trackNumber: typeof track.trackNumber === "number" ? track.trackNumber : null,
    discNumber: typeof track.discNumber === "number" ? track.discNumber : null,
    bitrate: typeof track.bitrate === "number" ? track.bitrate : null,
    sampleRate: typeof track.sampleRate === "number" ? track.sampleRate : null,
    bpm: null,
    libraryRoot: typeof track.libraryRoot === "string" ? track.libraryRoot : undefined,
    mediaKind: track.mediaKind === "audio-cd" ? "audio-cd" : track.mediaKind === "file" ? "file" : undefined,
    nativeDevice: typeof track.nativeDevice === "string" ? track.nativeDevice : null,
    nativeStart: typeof track.nativeStart === "string" ? track.nativeStart : null,
    nativeEnd: typeof track.nativeEnd === "string" ? track.nativeEnd : null,
    cdReadQuality: track.cdReadQuality === "low" ? "low" : "high",
    requiresNativePlayback: track.requiresNativePlayback === true,
    likedAt: typeof track.likedAt === "number" ? track.likedAt : null,
    currentLevel: track.currentLevel ?? null,
    availableLevels: Array.isArray(track.availableLevels) ? track.availableLevels : [],
    cover: typeof track.cover === "string" ? track.cover : "linear-gradient(135deg, #eef1f5 0%, #aeb7c6 50%, #586273 100%)",
    accent: typeof track.accent === "string" ? track.accent : "#7b8494",
    waveform:
      Array.isArray(track.waveform) && track.waveform.some((item) => typeof item === "number")
        ? track.waveform.filter((item): item is number => typeof item === "number")
        : [24, 40, 66, 48, 78, 56, 36, 84, 62, 42, 70, 52],
    lyrics: Array.isArray(track.lyrics) ? track.lyrics : [{ time: "00:00", text: "" }],
    lyricStatus:
      track.lyricStatus === "linked" || track.lyricStatus === "searchable" || track.lyricStatus === "missing"
        ? track.lyricStatus
        : "searchable",
  };
}

export function writeCachedPlayerState(state: CachedPlayerState & { updatedAt?: number }) {
  try {
    window.localStorage.setItem(playerCacheKey, JSON.stringify(state));
  } catch {
    // Player state cache is a comfort feature; playback should continue without it.
  }
}

// The lyric cache is read once per track while building the library; keeping a
// module-level copy avoids re-parsing the whole localStorage blob per track.
let lyricsCacheState: Record<string, LyricLine[]> | null = null;

function readLyricsCache(): Record<string, LyricLine[]> {
  if (lyricsCacheState) return lyricsCacheState;
  try {
    const raw = window.localStorage.getItem(lyricCacheKey);
    lyricsCacheState = raw ? (JSON.parse(raw) as Record<string, LyricLine[]>) : {};
  } catch {
    lyricsCacheState = {};
  }
  return lyricsCacheState;
}

export function readCachedLyrics(trackId?: string) {
  if (!trackId) return [];
  const cached = readLyricsCache()[trackId];
  return Array.isArray(cached) ? cached : [];
}

export function writeCachedLyrics(trackId: string, lyrics: LyricLine[]) {
  if (!lyrics.length) return;
  try {
    const cache = Object.fromEntries(Object.entries({ ...readLyricsCache(), [trackId]: lyrics }).slice(-80));
    lyricsCacheState = cache;
    window.localStorage.setItem(lyricCacheKey, JSON.stringify(cache));
  } catch {
    // Lyric caching is best-effort.
  }
}

export function readCachedAudioSettings() {
  try {
    const raw = window.localStorage.getItem(audioSettingsKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      sinkId?: string;
      hifiEnabled?: boolean;
      exclusiveMode?: boolean;
      outputMode?: AudioOutputMode;
    };
    const outputMode =
      parsed.outputMode === "shared" || parsed.outputMode === "exclusive" || parsed.outputMode === "system"
        ? parsed.outputMode
        : parsed.exclusiveMode
          ? "exclusive"
          : "system";
    return {
      sinkId: typeof parsed.sinkId === "string" ? parsed.sinkId : "default",
      hifiEnabled: typeof parsed.hifiEnabled === "boolean" ? parsed.hifiEnabled : true,
      exclusiveMode: typeof parsed.exclusiveMode === "boolean" ? parsed.exclusiveMode : false,
      outputMode,
    };
  } catch {
    return {};
  }
}

export function writeCachedAudioSettings(settings: {
  sinkId: string;
  hifiEnabled: boolean;
  exclusiveMode: boolean;
  outputMode: AudioOutputMode;
}) {
  try {
    window.localStorage.setItem(audioSettingsKey, JSON.stringify(settings));
  } catch {
    // Audio settings are best-effort.
  }
}

export function formatDuration(seconds: number | null) {
  if (!seconds || Number.isNaN(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function parseDuration(value: string) {
  const cleanValue = value.replace(/[[\]]/g, "").trim();
  const parts = cleanValue.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function getActiveLyricIndex(lyrics: Track["lyrics"], currentTime: number) {
  if (!lyrics.length) return 0;
  let activeIndex = 0;
  lyrics.forEach((line, index) => {
    if (parseDuration(line.time) <= currentTime + 0.2) {
      activeIndex = index;
    }
  });
  return activeIndex;
}

export function extractDominantColors(image: HTMLImageElement): CoverPalette {
  const canvas = document.createElement("canvas");
  const size = 72;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");

  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const buckets = new Map<string, { count: number; saturation: number; lightness: number }>();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 510;
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (lightness > 0.9 || lightness < 0.08) continue;
    if (saturation < 0.12 && lightness > 0.62) continue;

    const bucket = [red, green, blue].map((value) => Math.round(value / 24) * 24);
    const key = rgbToHex(bucket[0], bucket[1], bucket[2]);
    const current = buckets.get(key);
    buckets.set(key, {
      count: (current?.count ?? 0) + 1,
      saturation,
      lightness,
    });
  }

  const ranked = [...buckets.entries()]
    .map(([color, item]) => ({
      color,
      score: item.count * (0.72 + item.saturation * 0.42) * (item.lightness > 0.82 ? 0.72 : 1),
    }))
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0]?.color ?? "#7b8494";
  const secondary = ranked.find((item) => colorDistance(item.color, primary) > 72)?.color ?? ranked[1]?.color ?? primary;
  return { primary, secondary };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorDistance(first: string, second: string) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return Math.hypot(a.red - b.red, a.green - b.green, a.blue - b.blue);
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function colorWithAlpha(hex: string, alpha: number) {
  const { red, green, blue } = hexToRgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function normalizeQuality(quality: string): Track["quality"] {
  if (quality === "Hi-Res" || quality === "FLAC" || quality === "Lossless" || quality === "320K") {
    return quality;
  }
  return "320K";
}

export function formatBitrate(value?: number | null, compact = false) {
  if (!value || !Number.isFinite(value)) return null;
  return compact ? `${Math.round(value / 1000)}k` : `${Math.round(value / 1000)} kbps`;
}

export function formatSampleRate(value?: number | null, compact = false) {
  if (!value || !Number.isFinite(value)) return null;
  const khz = value / 1000;
  const rendered = Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1);
  return compact ? `${rendered}kHz` : `${rendered} kHz`;
}

export function formatAudioDetail(track: Track, level?: QualityLevel, compact = true) {
  const resolvedLevel = track.currentLevel ?? level ?? null;
  const qualityLabel = resolvedLevel ? qualityLevelLabels[resolvedLevel] : track.quality;
  const bitrate = track.bitrate ? formatBitrate(track.bitrate, compact) : null;
  const sampleRate = formatSampleRate(track.sampleRate, compact);
  return [qualityLabel, bitrate, sampleRate].filter(Boolean).join(" · ");
}

export function splitArtistNames(value: string) {
  return value
    .split(/\s*(?:\/|、|,|，|&|\+| feat\. | ft\. )\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mergeTracks(tracksToMerge: Track[]) {
  const seen = new Set<string>();
  return tracksToMerge.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

export function trimTrackCache(tracksToMerge: Track[], maxItems = 1400) {
  const merged = mergeTracks(tracksToMerge);
  return merged.length > maxItems ? merged.slice(merged.length - maxItems) : merged;
}
