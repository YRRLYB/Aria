import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Cloud,
  Cookie,
  FolderOpen,
  Heart,
  Languages,
  ListMusic,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ariaIconUrl from "../build/icon.png";
import {
  capabilities,
  navItems,
  type LyricCandidate,
  type Track,
  type ViewId,
} from "@/data/music";
import { api, type ApiScannedTrack, type NeteaseAccountSummary, type ProviderPlaylist, type ProviderTrack } from "@/lib/api";
import { cn } from "@/lib/utils";

const sourceLabel: Record<Track["source"], string> = {
  local: "本地",
  cloud: "云盘",
  netease: "网易云",
};

type QualityLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster";
type CoverPalette = { primary: string; secondary: string };
type PlayerSideView = "lyrics" | "queue";
type NativeAudioState = {
  supported: boolean;
  ready: boolean;
  active: boolean;
  trackId: string | null;
  url: string | null;
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  exclusive: boolean;
  deviceId: string;
  bitrate: number | null;
  kind?: string;
};
type CachedPlayerState = {
  activeTrackId?: string;
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
const bpmCacheKey = "aria-bpm-cache";
const lyricCacheKey = "aria-lyrics-cache";
const audioSettingsKey = "aria-audio-settings";
const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

const qualityOptions: Array<{ value: QualityLevel; label: string }> = [
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

function readCachedPlayerState(): CachedPlayerState {
  try {
    const raw = window.localStorage.getItem(playerCacheKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CachedPlayerState;
    const navIds = new Set(navItems.map((item) => item.id));
    const qualityIds = new Set(qualityOptions.map((item) => item.value));

    return {
      activeTrackId: typeof parsed.activeTrackId === "string" ? parsed.activeTrackId : undefined,
      activeView: parsed.activeView && navIds.has(parsed.activeView) ? parsed.activeView : undefined,
      playerSideView: parsed.playerSideView === "queue" ? "queue" : parsed.playerSideView === "lyrics" ? "lyrics" : undefined,
      playQueueIds: Array.isArray(parsed.playQueueIds)
        ? parsed.playQueueIds.filter((id): id is string => typeof id === "string")
        : undefined,
      currentTime:
        typeof parsed.currentTime === "number" && Number.isFinite(parsed.currentTime)
          ? Math.max(0, parsed.currentTime)
          : undefined,
      volume: typeof parsed.volume === "number" && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(100, parsed.volume)) : undefined,
      qualityLevel: parsed.qualityLevel && qualityIds.has(parsed.qualityLevel) ? parsed.qualityLevel : undefined,
      shuffleEnabled: typeof parsed.shuffleEnabled === "boolean" ? parsed.shuffleEnabled : undefined,
      repeatMode: parsed.repeatMode === "one" ? "one" : parsed.repeatMode === "all" ? "all" : undefined,
      playing: typeof parsed.playing === "boolean" ? parsed.playing : undefined,
    };
  } catch {
    return {};
  }
}

function readCachedLyrics(trackId?: string) {
  if (!trackId) return [];
  try {
    const raw = window.localStorage.getItem(lyricCacheKey);
    if (!raw) return [];
    const cache = JSON.parse(raw) as Record<string, Array<{ time: string; text: string }>>;
    return Array.isArray(cache[trackId]) ? cache[trackId] : [];
  } catch {
    return [];
  }
}

function writeCachedLyrics(trackId: string, lyrics: Array<{ time: string; text: string }>) {
  if (!lyrics.length) return;
  try {
    const raw = window.localStorage.getItem(lyricCacheKey);
    const cache = raw ? (JSON.parse(raw) as Record<string, Array<{ time: string; text: string }>>) : {};
    const entries = Object.entries({ ...cache, [trackId]: lyrics }).slice(-80);
    window.localStorage.setItem(lyricCacheKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Lyric caching is best-effort.
  }
}

function readCachedAudioSettings() {
  try {
    const raw = window.localStorage.getItem(audioSettingsKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { sinkId?: string; hifiEnabled?: boolean; exclusiveMode?: boolean };
    return {
      sinkId: typeof parsed.sinkId === "string" ? parsed.sinkId : "default",
      hifiEnabled: typeof parsed.hifiEnabled === "boolean" ? parsed.hifiEnabled : true,
      exclusiveMode: typeof parsed.exclusiveMode === "boolean" ? parsed.exclusiveMode : false,
    };
  } catch {
    return {};
  }
}

function readCachedBpm(trackId?: string) {
  if (!trackId) return null;
  try {
    const raw = window.localStorage.getItem(bpmCacheKey);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<string, number>;
    const bpm = cache[trackId];
    return typeof bpm === "number" && bpm >= 40 && bpm <= 240 ? bpm : null;
  } catch {
    return null;
  }
}

function writeCachedBpm(trackId: string, bpm: number) {
  try {
    const raw = window.localStorage.getItem(bpmCacheKey);
    const cache = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    cache[trackId] = Math.round(bpm);
    window.localStorage.setItem(bpmCacheKey, JSON.stringify(cache));
  } catch {
    // Keep BPM caching best-effort.
  }
}

const panelVariants = {
  initial: { opacity: 0, y: 18, filter: "blur(18px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -16, filter: "blur(16px)" },
};

const localCoverPalettes = [
  "linear-gradient(135deg, #d9e7f6 0%, #5e8ab8 48%, #182338 100%)",
  "linear-gradient(135deg, #f4d4ce 0%, #c6796d 50%, #241a1a 100%)",
  "linear-gradient(135deg, #d7f1e5 0%, #5aa894 50%, #172823 100%)",
  "linear-gradient(135deg, #e4ddf5 0%, #8680b4 50%, #202036 100%)",
];

const idleTrack: Track = {
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

function formatDuration(seconds: number | null) {
  if (!seconds || Number.isNaN(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function parseDuration(value: string) {
  const cleanValue = value.replace(/[[\]]/g, "").trim();
  const parts = cleanValue.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function getActiveLyricIndex(lyrics: Track["lyrics"], currentTime: number) {
  if (!lyrics.length) return 0;
  let activeIndex = 0;
  lyrics.forEach((line, index) => {
    if (parseDuration(line.time) <= currentTime + 0.2) {
      activeIndex = index;
    }
  });
  return activeIndex;
}

function extractDominantColors(image: HTMLImageElement): CoverPalette {
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

function colorWithAlpha(hex: string, alpha: number) {
  const { red, green, blue } = hexToRgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizeQuality(quality: string): Track["quality"] {
  if (quality === "Hi-Res" || quality === "FLAC" || quality === "Lossless" || quality === "320K") {
    return quality;
  }
  return "320K";
}

const qualityLevelBitrates: Record<QualityLevel, string> = {
  standard: "128 kbps",
  higher: "192 kbps",
  exhigh: "320 kbps",
  lossless: "1411 kbps",
  hires: "24bit / 96 kHz",
  jymaster: "24bit / 192 kHz",
};

function formatBitrate(value?: number | null, compact = false) {
  if (!value || !Number.isFinite(value)) return null;
  return compact ? `${Math.round(value / 1000)}k` : `${Math.round(value / 1000)} kbps`;
}

function formatSampleRate(value?: number | null, compact = false) {
  if (!value || !Number.isFinite(value)) return null;
  const khz = value / 1000;
  const rendered = Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1);
  return compact ? `${rendered}kHz` : `${rendered} kHz`;
}

function formatAudioDetail(track: Track, level?: QualityLevel, compact = true) {
  const resolvedLevel = track.currentLevel ?? level ?? null;
  const qualityLabel = resolvedLevel ? qualityLevelLabels[resolvedLevel] : track.quality;
  const bitrate = track.bitrate ? formatBitrate(track.bitrate, compact) : null;
  const sampleRate = formatSampleRate(track.sampleRate, compact);
  return [qualityLabel, bitrate, sampleRate].filter(Boolean).join(" · ");
}

function localTrackToUiTrack(track: ApiScannedTrack, index: number): Track {
  const cachedLyrics = readCachedLyrics(track.id);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: formatDuration(track.duration),
    quality: normalizeQuality(track.quality),
    source: "local",
    streamUrl: api.getTrackStreamUrl(track.id),
    coverUrl: track.hasCover ? api.getTrackCoverUrl(track.id) : undefined,
    bitrate: track.bitrate ?? null,
    sampleRate: track.sampleRate ?? null,
    bpm: track.bpm ?? readCachedBpm(track.id),
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

function providerTrackToUiTrack(track: ProviderTrack, index: number): Track {
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
    bpm: track.bpm ?? readCachedBpm(`netease:${track.id}`) ?? readCachedBpm(track.id),
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

function mergeTracks(tracksToMerge: Track[]) {
  const seen = new Set<string>();
  return tracksToMerge.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function isLikedPlaylist(playlist: ProviderPlaylist | null | undefined, index?: number) {
  if (!playlist) return false;
  return index === 0 || /喜欢|我喜欢|liked|favorite/i.test(playlist.name);
}

export default function App() {
  const [initialPlayerCache] = useState(readCachedPlayerState);
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [activeTrackId, setActiveTrackId] = useState(initialPlayerCache.activeTrackId ?? idleTrack.id);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(initialPlayerCache.volume ?? 72);
  const [currentTime, setCurrentTime] = useState(initialPlayerCache.currentTime ?? 0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [spectrum] = useState<number[]>([]);
  const [shuffleEnabled, setShuffleEnabled] = useState(initialPlayerCache.shuffleEnabled ?? false);
  const [repeatMode, setRepeatMode] = useState<"all" | "one">(initialPlayerCache.repeatMode ?? "all");
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [likedTrackIds, setLikedTrackIds] = useState<Record<string, true>>({});
  const [neteaseLikedIds, setNeteaseLikedIds] = useState<Record<string, true>>({});
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [activePalette, setActivePalette] = useState<CoverPalette>({ primary: idleTrack.accent, secondary: "#aeb7c6" });
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(initialPlayerCache.qualityLevel ?? "lossless");
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [neteaseTracks, setNeteaseTracks] = useState<Track[]>([]);
  const [neteaseLikedTracks, setNeteaseLikedTracks] = useState<Track[]>([]);
  const [dailyTracks, setDailyTracks] = useState<Track[]>([]);
  const [roamTracks, setRoamTracks] = useState<Track[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [playQueueIds, setPlayQueueIds] = useState<string[]>(initialPlayerCache.playQueueIds ?? []);
  const [selectedPlaylist, setSelectedPlaylist] = useState<ProviderPlaylist | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [providerPlaylists, setProviderPlaylists] = useState<ProviderPlaylist[]>([]);
  const [libraryMeta, setLibraryMeta] = useState({ roots: 0, updatedAt: null as string | null });
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === "visible");
  const [backgroundEnabled, setBackgroundEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("aria-background-enabled") === "true";
    } catch {
      return false;
    }
  });
  const [playerSideView, setPlayerSideView] = useState<PlayerSideView>(initialPlayerCache.playerSideView ?? "lyrics");
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountSummary | null>(null);
  const [lyricBindings, setLyricBindings] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [folderName, setFolderName] = useState("未选择");
  const [audioOutputDevices, setAudioOutputDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [nativeAudioSupported, setNativeAudioSupported] = useState(() => Boolean(window.ariaDesktop?.nativeAudio?.supported));
  const [nativeAudioState, setNativeAudioState] = useState<NativeAudioState | null>(null);
  const [selectedSinkId, setSelectedSinkId] = useState(() => readCachedAudioSettings().sinkId ?? "default");
  const [hifiEnabled, setHifiEnabled] = useState(() => readCachedAudioSettings().hifiEnabled ?? true);
  const [exclusiveMode, setExclusiveMode] = useState(() => readCachedAudioSettings().exclusiveMode ?? false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const bpmPeaksRef = useRef<number[]>([]);
  const bpmSamplesRef = useRef<number[]>([]);
  const bpmEnergyRef = useRef(0);
  const bpmLockedRef = useRef(false);
  const lastBpmStateRef = useRef(0);
  const countedTrackRef = useRef<string | null>(null);
  const navCloseTimer = useRef<number | null>(null);
  const lyricSyncingRef = useRef<Set<string>>(new Set());
  const artworkSyncingRef = useRef<Set<string>>(new Set());
  const neteaseWarmupRef = useRef<Set<string>>(new Set());
  const bpmSavedRef = useRef<Record<string, number>>({});
  const audioErrorRef = useRef({ count: 0, lastAt: 0 });
  const pendingSeekRef = useRef(initialPlayerCache.currentTime ?? 0);
  const lastPlayerCacheWriteRef = useRef(0);
  const nativeLoadedUrlRef = useRef<string | null>(null);

  const neteaseConnected = Boolean(neteaseAccount?.connected);
  const nativePlaybackEnabled = nativeAudioSupported;
  const desktopExclusiveActive = Boolean(nativeAudioSupported && exclusiveMode);
  const exclusiveReady = Boolean(desktopExclusiveActive && nativeAudioState?.exclusive);
  const nativePlaybackVolume = volume;
  const allTracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...roamTracks, ...playlistTracks]),
    [localTracks, neteaseTracks, roamTracks, playlistTracks],
  );
  const requestedActiveTrack = allTracks.find((track) => track.id === activeTrackId);
  const activeTrack =
    requestedActiveTrack ??
    (activeTrackId === idleTrack.id ? allTracks[0] ?? idleTrack : idleTrack);
  const effectiveQualityLevel = useMemo(() => {
    if (!hifiEnabled || activeTrack.source !== "netease") return qualityLevel;
    const levels = activeTrack.availableLevels ?? [];
    return levels.at(-1) ?? qualityLevel;
  }, [activeTrack.availableLevels, activeTrack.source, hifiEnabled, qualityLevel]);
  const activeStreamUrl = useMemo(() => {
    if (!activeTrack.streamUrl) return null;
    const url = new URL(api.resolveUrl(activeTrack.streamUrl), window.location.href);
    if (activeTrack.source !== "netease") return url.href;

    url.searchParams.set("level", effectiveQualityLevel);
    return url.href;
  }, [activeTrack, effectiveQualityLevel]);
  const visibleTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return allTracks;

    return allTracks.filter((track) =>
      [track.title, track.artist, track.album, track.quality, sourceLabel[track.source]]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [allTracks, query]);
  const playbackTracks = useMemo(
    () => allTracks.filter((track) => Boolean(track.streamUrl) && track.id !== idleTrack.id),
    [allTracks],
  );
  const visibleLocalTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return localTracks;

    return localTracks.filter((track) =>
      [track.title, track.artist, track.album, track.quality].join(" ").toLowerCase().includes(normalized),
    );
  }, [localTracks, query]);
  const localLikedTracks = useMemo(
    () => localTracks.filter((track) => likedTrackIds[track.id]),
    [localTracks, likedTrackIds],
  );
  const neteaseLikedDisplayTracks = useMemo(
    () => [...neteaseLikedTracks].sort((left, right) => (right.likedAt ?? 0) - (left.likedAt ?? 0)),
    [neteaseLikedTracks],
  );
  const likedDisplayTracks = useMemo(
    () => mergeTracks([...localLikedTracks, ...neteaseLikedDisplayTracks]),
    [localLikedTracks, neteaseLikedDisplayTracks],
  );
  const contextualQueueTracks = useMemo(() => {
    switch (activeView) {
      case "local":
        return visibleLocalTracks;
      case "liked":
        return likedDisplayTracks;
      case "playlists":
        return playlistTracks;
      case "daily":
        return dailyTracks;
      case "radar":
        return roamTracks;
      case "home":
        return visibleTracks;
      default:
        return [];
    }
  }, [activeView, dailyTracks, likedDisplayTracks, playlistTracks, roamTracks, visibleLocalTracks, visibleTracks]);
  const playQueueTracks = useMemo(() => {
    const byId = new Map(allTracks.map((track) => [track.id, track]));
    return playQueueIds
      .map((id) => byId.get(id))
      .filter((track): track is Track => Boolean(track?.streamUrl));
  }, [allTracks, playQueueIds]);
  const linkedLyricCount = useMemo(
    () => allTracks.filter((track) => track.lyricStatus === "linked").length,
    [allTracks],
  );
  const lyricProgress = useMemo(
    () => (allTracks.length ? Math.round((linkedLyricCount / allTracks.length) * 100) : 0),
    [allTracks.length, linkedLyricCount],
  );

  async function refreshNeteaseData() {
    const [liked, daily, roam, playlists] = await Promise.all([
      api.getProviderLiked(),
      api.getProviderDaily(),
      api.getProviderRoam(),
      api.getProviderPlaylists(),
    ]);
    const dailyUiTracks = daily.tracks.map(providerTrackToUiTrack);
    const roamUiTracks = roam.tracks.map((track, index) => providerTrackToUiTrack(track, index + dailyUiTracks.length));
    const likedUiTracks = liked.tracks.map((track, index) =>
      providerTrackToUiTrack(track, index + dailyUiTracks.length + roamUiTracks.length),
    );
    const merged = mergeTracks([...dailyUiTracks, ...roamUiTracks, ...likedUiTracks]);

    setDailyTracks(dailyUiTracks);
    setRoamTracks(roamUiTracks);
    setNeteaseLikedTracks(likedUiTracks);
    setNeteaseLikedIds(Object.fromEntries(likedUiTracks.map((track) => [track.id, true])));
    setNeteaseTracks(merged);
    setProviderPlaylists(playlists.playlists);
    warmNeteaseTrackCache(merged);
    if (activeTrackId === idleTrack.id && !localTracks.length && merged[0]) {
      setActiveTrackId(merged[0].id);
    }
  }

  function warmNeteaseTrackCache(tracksToWarm: Track[]) {
    const warmupLevel = hifiEnabled ? "jymaster" : qualityLevel;
    const warmupItems = tracksToWarm
      .filter((track) => track.source === "netease" && track.providerId)
      .map((track) => ({ id: track.providerId as string, key: `${warmupLevel}:${track.providerId}` }))
      .filter((item) => !neteaseWarmupRef.current.has(item.key))
      .slice(0, 300);
    const ids = warmupItems.map((item) => item.id);
    if (!ids.length) return;
    warmupItems.forEach((item) => neteaseWarmupRef.current.add(item.key));
    api.warmNeteaseCache(ids, warmupLevel).catch(() => {
      warmupItems.forEach((item) => neteaseWarmupRef.current.delete(item.key));
    });
  }

  useEffect(() => {
    const tracksToWarm = playQueueTracks.length ? playQueueTracks : visibleTracks.slice(0, 80);
    warmNeteaseTrackCache(tracksToWarm);
  }, [hifiEnabled, qualityLevel, playQueueTracks, visibleTracks]);

  useEffect(() => {
    api
      .getLibrary()
      .then((library) => {
        setLocalTracks(library.tracks.map(localTrackToUiTrack));
        setLibraryMeta({ roots: library.roots.length, updatedAt: library.updatedAt });
      })
      .catch(() => {
        setLibraryMeta({ roots: 0, updatedAt: null });
      });
  }, []);

  useEffect(() => {
    const boundTracks = localTracks
      .filter((track) => lyricBindings[track.id] && track.lyricStatus !== "linked" && !lyricSyncingRef.current.has(track.id))
      .slice(0, 8);
    if (!boundTracks.length) return;

    boundTracks.forEach((track) => {
      lyricSyncingRef.current.add(track.id);
      api
        .bindLyric(track.id, lyricBindings[track.id])
        .then((result) => {
          applyLyricsToTrack(track.id, result.lyrics);
        })
        .catch(() => {
          // Keep using cached placeholder if rebinding fails.
        })
        .finally(() => {
          lyricSyncingRef.current.delete(track.id);
        });
    });
  }, [localTracks, lyricBindings]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("aria-play-counts");
      if (raw) {
        setPlayCounts(JSON.parse(raw) as Record<string, number>);
      }
    } catch {
      // Ignore broken local playback stats and start fresh.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("aria-liked-track-ids");
      if (raw) {
        setLikedTrackIds(JSON.parse(raw) as Record<string, true>);
      }
    } catch {
      // Ignore broken favorite state and start fresh.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("aria-play-counts", JSON.stringify(playCounts));
  }, [playCounts]);

  useEffect(() => {
    window.localStorage.setItem("aria-liked-track-ids", JSON.stringify(likedTrackIds));
  }, [likedTrackIds]);

  useEffect(() => {
    window.localStorage.setItem("aria-background-enabled", String(backgroundEnabled));
    window.ariaDesktop?.setBackgroundEnabled?.(backgroundEnabled);
  }, [backgroundEnabled]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    const disposeDesktopVisibility = window.ariaDesktop?.onWindowVisibilityChange?.((visible) => {
      setPageVisible(visible);
    });
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      disposeDesktopVisibility?.();
    };
  }, []);

  useEffect(() => {
    if (activeTrack.id === idleTrack.id || activeTrack.id !== activeTrackId) return;

    const now = Date.now();
    if (now - lastPlayerCacheWriteRef.current < 900) return;
    lastPlayerCacheWriteRef.current = now;

    try {
      window.localStorage.setItem(
        playerCacheKey,
        JSON.stringify({
          activeTrackId: activeTrack.id,
          activeView,
          playerSideView,
          playQueueIds,
          currentTime,
          volume,
          qualityLevel,
          shuffleEnabled,
          repeatMode,
          playing,
          updatedAt: now,
        }),
      );
    } catch {
      // Player state cache is a comfort feature; playback should continue without it.
    }
  }, [activeTrack.id, activeTrackId, activeView, currentTime, playQueueIds, playerSideView, playing, qualityLevel, repeatMode, shuffleEnabled, volume]);

  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        setNeteaseAccount(settings.neteaseAccount);
        setLyricBindings(settings.lyricBindings);
        if (settings.neteaseAccount.connected) {
          refreshNeteaseData().catch(() => {
            setNeteaseTracks([]);
            setNeteaseLikedTracks([]);
            setDailyTracks([]);
            setRoamTracks([]);
            setPlaylistTracks([]);
            setProviderPlaylists([]);
          });
        }
      })
      .catch(() => setNeteaseAccount(null));
  }, []);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (nativeAudio?.supported) {
      nativeAudio
        .isSupported?.()
        .then((supported) => {
          setNativeAudioSupported(Boolean(supported));
          if (!supported) return [];
          return nativeAudio.listDevices?.() ?? [];
        })
        .then((devices) => {
          if (Array.isArray(devices) && devices.length) {
            setAudioOutputDevices(devices);
          }
        })
        .catch(() => {
          setNativeAudioSupported(false);
        });
      return;
    }

    if (!navigator.mediaDevices?.enumerateDevices) return;

    let cancelled = false;
    const refreshDevices = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          const outputs = devices
            .filter((device) => device.kind === "audiooutput")
            .map((device, index) => ({
              id: device.deviceId || `output-${index}`,
              label: device.label || `播放设备 ${index + 1}`,
            }));
          setAudioOutputDevices([{ id: "default", label: "系统默认" }, ...outputs.filter((device) => device.id !== "default")]);
        })
        .catch(() => {
          if (!cancelled) setAudioOutputDevices([{ id: "default", label: "系统默认" }]);
        });
    };

    refreshDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        audioSettingsKey,
        JSON.stringify({ sinkId: selectedSinkId, hifiEnabled, exclusiveMode }),
      );
    } catch {
      // Audio settings are a comfort feature.
    }
  }, [exclusiveMode, hifiEnabled, selectedSinkId]);

  useEffect(() => {
    if (!audioOutputDevices.length) return;
    if (audioOutputDevices.some((device) => device.id === selectedSinkId)) return;
    setSelectedSinkId("default");
  }, [audioOutputDevices, selectedSinkId]);

  const syncNativeAudioState = useEffectEvent((state: NativeAudioState) => {
    setNativeAudioState(state);
    const currentTrackMatches = Boolean(state.trackId && state.trackId === activeTrackId);
    const shouldSyncPlayback =
      currentTrackMatches &&
      (state.active ||
        state.kind === "loading" ||
        state.kind === "loaded" ||
        state.kind === "pause" ||
        state.kind === "seek" ||
        state.kind === "progress" ||
        state.kind === "ended");

    if (shouldSyncPlayback) {
      if (typeof state.duration === "number" && state.duration > 0) {
        setDurationSeconds(state.duration);
      }
      if (typeof state.position === "number") {
        setCurrentTime(state.position);
      }
      if (typeof state.paused === "boolean") {
        setPlaying(!state.paused);
      }
    }
    if (state.kind === "ended") {
      handleTrackEnded();
    }
  });

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativeAudio?.supported) return;

    let cancelled = false;
    nativeAudio
      .getState?.()
      .then((state) => {
        if (!cancelled && state) syncNativeAudioState(state as NativeAudioState);
      })
      .catch(() => undefined);

    const dispose = nativeAudio.onEvent?.((payload) => {
      if (!cancelled) syncNativeAudioState(payload as NativeAudioState);
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [syncNativeAudioState]);

  useEffect(() => {
    if (nativePlaybackEnabled) return;
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (!audio?.setSinkId) return;
    audio.setSinkId(selectedSinkId === "default" ? "" : selectedSinkId).catch(() => {
      // Device switching is optional; keep current output if the platform rejects it.
    });
  }, [nativePlaybackEnabled, selectedSinkId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = nativePlaybackEnabled;
    audio.volume = nativePlaybackEnabled ? 0 : Math.max(0, Math.min(1, nativePlaybackVolume / 100));
    audio.preload = hifiEnabled ? "auto" : "metadata";

    if (!activeStreamUrl) {
      audio.pause();
      return;
    }

    const nextSrc = new URL(activeStreamUrl, window.location.href).href;
    if (audio.src !== nextSrc) {
      audio.src = nextSrc;
      setDurationSeconds(0);
    }

    if (playing) {
      audio.play().catch(() => {
        if (!nativePlaybackEnabled) setPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [activeStreamUrl, hifiEnabled, nativePlaybackEnabled, nativePlaybackVolume, playing]);

  useEffect(() => {
    if (!nativePlaybackEnabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    const desiredTime = nativeAudioState?.position ?? currentTime;
    if (!Number.isFinite(desiredTime)) return;
    if (Math.abs((audio.currentTime || 0) - desiredTime) < 0.45) return;
    audio.currentTime = Math.max(0, desiredTime);
  }, [currentTime, nativeAudioState?.position, nativePlaybackEnabled]);

  useEffect(() => {
    if (activeTrack.source !== "netease" || !activeTrack.providerId) return;

    let cancelled = false;
    api
      .getNeteaseStreamMeta(activeTrack.providerId, effectiveQualityLevel)
      .then((meta) => {
        if (cancelled) return;
        applyStreamMetaToTrack(activeTrack.id, meta);
      })
      .catch(() => {
        // Keep the previous metadata when the provider temporarily rejects the request.
      });

    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.providerId, activeTrack.source, effectiveQualityLevel]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativeAudio?.supported) return;
    if (nativePlaybackEnabled) return;
    nativeLoadedUrlRef.current = null;
    nativeAudio.stop?.().catch(() => undefined);
  }, [nativePlaybackEnabled]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    pendingSeekRef.current = currentTime;
    nativeLoadedUrlRef.current = null;
  }, [exclusiveMode, nativePlaybackEnabled, selectedSinkId]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;

    if (!activeStreamUrl || activeTrack.id === idleTrack.id) {
      nativeLoadedUrlRef.current = null;
      nativeAudio.stop?.().catch(() => undefined);
      return;
    }

    const nextUrl = new URL(activeStreamUrl, window.location.href).href;
    if (nativeLoadedUrlRef.current === nextUrl && nativeAudioState?.trackId === activeTrack.id) return;

    nativeLoadedUrlRef.current = nextUrl;
    nativeAudio
      .load?.({
        trackId: activeTrack.id,
        url: nextUrl,
        position: pendingSeekRef.current || 0,
        paused: !playing,
        volume: nativePlaybackVolume,
        exclusive: exclusiveMode,
        deviceId: selectedSinkId,
      })
      .then((state) => {
        if (state) syncNativeAudioState(state as NativeAudioState);
      })
      .catch(() => {
        nativeLoadedUrlRef.current = null;
      });
  }, [
    activeStreamUrl,
    activeTrack.id,
    nativePlaybackEnabled,
    nativeAudioState?.trackId,
    playing,
    selectedSinkId,
    syncNativeAudioState,
    exclusiveMode,
    nativePlaybackVolume,
  ]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    nativeAudio.setPaused?.(!playing).catch(() => undefined);
  }, [nativePlaybackEnabled, playing]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    nativeAudio.setVolume?.(nativePlaybackVolume).catch(() => undefined);
  }, [nativePlaybackEnabled, nativePlaybackVolume]);

  useEffect(() => {
    if (!activeTrack.coverUrl) {
      setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      try {
        setActivePalette(extractDominantColors(image));
      } catch {
        setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      }
    };
    image.onerror = () => {
      if (!cancelled) setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
    };
    image.src = activeTrack.coverUrl;

    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.coverUrl, activeTrack.accent]);

  useEffect(() => {
    if (activeTrack.id === idleTrack.id) return;
    if (activeTrack.id !== activeTrackId) return;
    if (countedTrackRef.current === activeTrack.id) return;

    countedTrackRef.current = activeTrack.id;
    setPlayCounts((current) => ({
      ...current,
      [activeTrack.id]: (current[activeTrack.id] ?? 0) + 1,
    }));
  }, [activeTrack.id]);

  useEffect(() => {
    setDetectedBpm(activeTrack.bpm ?? null);
    bpmPeaksRef.current = [];
    bpmSamplesRef.current = [];
    bpmEnergyRef.current = 0;
    bpmLockedRef.current = Boolean(activeTrack.bpm);
    lastBpmStateRef.current = 0;
  }, [activeTrack.id, activeTrack.bpm]);

  useEffect(() => {
    if (!playing || !activeStreamUrl || !pageVisible) {
      if (visualizerFrameRef.current) {
        window.cancelAnimationFrame(visualizerFrameRef.current);
        visualizerFrameRef.current = null;
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    if (!audioSourceRef.current) {
      audioSourceRef.current = context.createMediaElementSource(audio);
      analyserRef.current = context.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.58;
      analyserRef.current.minDecibels = -92;
      analyserRef.current.maxDecibels = -10;
      audioSourceRef.current.connect(analyserRef.current);
      if (!nativePlaybackEnabled) {
        analyserRef.current.connect(context.destination);
      }
    }

    context.resume();
    const analyser = analyserRef.current;
    if (!analyser) return;

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(frequencyData);
      const nextSpectrum = Array.from({ length: 28 }, (_, index) => {
        const start = Math.floor((index / 28) * frequencyData.length * 0.78);
        const end = Math.max(start + 1, Math.floor(((index + 1) / 28) * frequencyData.length * 0.78));
        let energy = 0;
        for (let cursor = start; cursor < end; cursor += 1) {
          energy += frequencyData[cursor] ?? 0;
        }
        return Math.round((energy / Math.max(1, end - start)) / 2.55);
      });
      let lowEnergy = 0;
      const lowBandEnd = Math.min(18, frequencyData.length);
      for (let index = 1; index < lowBandEnd; index += 1) {
        lowEnergy += frequencyData[index] ?? 0;
      }
      lowEnergy /= Math.max(1, lowBandEnd - 1);
      const baseline = bpmEnergyRef.current ? bpmEnergyRef.current * 0.95 + lowEnergy * 0.05 : lowEnergy;
      const now = performance.now();
      bpmEnergyRef.current = baseline;

      if (!bpmLockedRef.current && lowEnergy > baseline * 1.3 && lowEnergy > 34) {
        const peaks = bpmPeaksRef.current;
        if (!peaks.length || now - peaks[peaks.length - 1] > 280) {
          bpmPeaksRef.current = [...peaks, now].slice(-24);
        }
      }

      if (!bpmLockedRef.current && now - lastBpmStateRef.current > 2600 && bpmPeaksRef.current.length >= 5) {
        const intervals = bpmPeaksRef.current
          .slice(1)
          .map((peak, index) => peak - bpmPeaksRef.current[index])
          .filter((interval) => interval >= 330 && interval <= 950)
          .sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        if (median) {
          const bpm = Math.round(60000 / median);
          if (bpm >= 60 && bpm <= 190) {
            const nextSamples = [...bpmSamplesRef.current, bpm].slice(-3);
            bpmSamplesRef.current = nextSamples;
            const spread = Math.max(...nextSamples) - Math.min(...nextSamples);
            if (nextSamples.length >= 3 && spread <= 3) {
              const stableBpm = Math.round(nextSamples.reduce((sum, value) => sum + value, 0) / nextSamples.length);
              bpmLockedRef.current = true;
              setDetectedBpm(stableBpm);
              applyBpmToTrack(activeTrack.id, stableBpm);
            }
            lastBpmStateRef.current = now;
          }
        }
      }
      visualizerFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (visualizerFrameRef.current) {
        window.cancelAnimationFrame(visualizerFrameRef.current);
        visualizerFrameRef.current = null;
      }
    };
  }, [activeStreamUrl, activeTrack.id, nativePlaybackEnabled, pageVisible, playing]);

  useEffect(() => {
    if (activeTrack.id === idleTrack.id || activeTrack.lyricStatus === "linked") return;
    if (lyricSyncingRef.current.has(activeTrack.id)) return;

    lyricSyncingRef.current.add(activeTrack.id);
    syncLyricsForTrack(activeTrack)
      .catch(() => {
        // Keep the track searchable; the manual lyrics panel can retry.
      })
      .finally(() => {
        lyricSyncingRef.current.delete(activeTrack.id);
      });
  }, [activeTrack.id, activeTrack.lyricStatus]);

  useEffect(() => {
    const candidates = localTracks.filter((track) => !track.coverUrl && !artworkSyncingRef.current.has(track.id)).slice(0, 24);
    if (!candidates.length) return;

    candidates.forEach((track) => {
      artworkSyncingRef.current.add(track.id);
      api
        .searchLyrics({ title: track.title, artist: track.artist, album: track.album })
        .then((result) => {
          applyArtworkToTrack(track.id, result.candidates[0]?.coverUrl);
        })
        .catch(() => {
          // Keep the clean generated poster when online artwork lookup fails.
        });
    });
  }, [localTracks]);

  async function scanBackendPath(folderPath: string) {
    const result = await api.scanLibrary(folderPath);
    const nextTracks = result.library?.tracks ?? result.tracks;
    const nextUiTracks = nextTracks.map(localTrackToUiTrack);
    pendingSeekRef.current = 0;
    setLocalTracks(nextUiTracks);
    setPlayQueueIds(nextUiTracks.filter((track) => track.streamUrl).map((track) => track.id));
    setLibraryMeta({
      roots: result.library?.roots.length ?? 1,
      updatedAt: result.library?.updatedAt ?? new Date().toISOString(),
    });
    if (nextTracks[0]) setActiveTrackId(nextTracks[0].id);
    setActiveView("local");
  }

  async function openPlaylist(playlist: ProviderPlaylist) {
    setSelectedPlaylist(playlist);
    setPlaylistLoading(true);
    try {
      const result = await api.getNeteasePlaylistTracks(playlist.id);
      const uiTracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
      setPlaylistTracks(uiTracks);
      setNeteaseTracks((current) => mergeTracks([...current, ...uiTracks]));
      warmNeteaseTrackCache(uiTracks);
    } finally {
      setPlaylistLoading(false);
    }
  }

  function chooseRandomTrack(excludeId?: string) {
    const queue = playQueueTracks.length ? playQueueTracks : playbackTracks.length ? playbackTracks : visibleTracks;
    const candidates = queue.filter((track) => track.id !== excludeId);
    if (!candidates.length) return queue[0] ?? null;
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }

  function pickRelativeTrack(direction: 1 | -1) {
    const queue = playQueueTracks.length ? playQueueTracks : playbackTracks.length ? playbackTracks : visibleTracks;
    if (!queue.length) return;
    pendingSeekRef.current = 0;
    if (shuffleEnabled) {
      const randomTrack = chooseRandomTrack(activeTrack.id);
      if (randomTrack) {
        if (randomTrack.id === activeTrack.id) {
          if (nativePlaybackEnabled) {
            seekTo(0);
          } else if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => setPlaying(false));
          }
        }
        setActiveTrackId(randomTrack.id);
        setCurrentTime(0);
        setPlaying(true);
      }
      return;
    }
    const currentIndex = queue.findIndex((track) => track.id === activeTrack.id);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + queue.length) % queue.length;
    const nextTrack = queue[nextIndex];
    if (nextTrack.id === activeTrack.id) {
      if (nativePlaybackEnabled) {
        seekTo(0);
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setPlaying(false));
      }
    }
    setActiveTrackId(nextTrack.id);
    setCurrentTime(0);
    setPlaying(true);
  }

  function restartActiveTrack() {
    pendingSeekRef.current = 0;
    setCurrentTime(0);
    setPlaying(true);
    if (nativePlaybackEnabled) {
      window.ariaDesktop?.nativeAudio?.seek?.(0).catch(() => undefined);
      window.ariaDesktop?.nativeAudio?.setPaused?.(false).catch(() => undefined);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => setPlaying(false));
  }

  function handleTrackEnded() {
    if (repeatMode === "one") {
      restartActiveTrack();
      return;
    }
    pickRelativeTrack(1);
  }

  function handleAudioError() {
    if (nativePlaybackEnabled) return;
    if (!activeStreamUrl || !playing) return;

    const now = Date.now();
    const previous = audioErrorRef.current;
    const nextCount = now - previous.lastAt > 6000 ? 1 : previous.count + 1;
    audioErrorRef.current = { count: nextCount, lastAt: now };

    if (nextCount >= 3 || (playQueueTracks.length || playbackTracks.length) <= 1) {
      setPlaying(false);
      return;
    }

    window.setTimeout(() => pickRelativeTrack(1), 650);
  }

  function seekTo(nextTime: number) {
    if (nativePlaybackEnabled) {
      pendingSeekRef.current = nextTime;
      setCurrentTime(nextTime);
      window.ariaDesktop?.nativeAudio?.seek?.(nextTime).catch(() => undefined);
      if (!playing) setPlaying(true);
      return;
    }

    if (!audioRef.current) return;
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (!playing) setPlaying(true);
  }

  function resolveQueueForTrack(trackId: string) {
    const playable = (tracks: Track[]) => tracks.filter((track) => track.streamUrl);
    const currentQueue = playable(contextualQueueTracks);
    if (activeView !== "home" && activeView !== "player" && currentQueue.some((track) => track.id === trackId)) {
      return currentQueue;
    }

    const candidateQueues = [
      playQueueTracks,
      dailyTracks,
      roamTracks,
      playlistTracks,
      neteaseLikedDisplayTracks,
      visibleLocalTracks,
      visibleTracks,
    ].map(playable);
    return candidateQueues.find((tracks) => tracks.some((track) => track.id === trackId)) ?? currentQueue;
  }

  function chooseTrack(trackId: string) {
    const playableIds = resolveQueueForTrack(trackId).map((track) => track.id);
    if (playableIds.length) setPlayQueueIds(playableIds);
    pendingSeekRef.current = 0;
    setActiveTrackId(trackId);
    setCurrentTime(0);
    setPlaying(true);
  }

  function toggleLikeTrack(trackId: string) {
    const track = allTracks.find((item) => item.id === trackId);
    if (track?.source === "netease") {
      toggleNeteaseLike(track);
      return;
    }
    setLikedTrackIds((current) => {
      if (current[trackId]) {
        const next = { ...current };
        delete next[trackId];
        return next;
      }
      return { ...current, [trackId]: true };
    });
  }

  function toggleNeteaseLike(track: Track) {
    const providerId = track.providerId;
    if (!providerId) return;

    const wasLiked = Boolean(neteaseLikedIds[track.id]);
    const nextLiked = !wasLiked;
    const likedTrack = { ...track, likedAt: nextLiked ? Date.now() : track.likedAt };
    setNeteaseLikedIds((current) => {
      const next = { ...current };
      if (nextLiked) next[track.id] = true;
      else delete next[track.id];
      return next;
    });
    setNeteaseLikedTracks((current) =>
      nextLiked
        ? mergeTracks([likedTrack, ...current]).sort((left, right) => (right.likedAt ?? 0) - (left.likedAt ?? 0))
        : current.filter((item) => item.id !== track.id),
    );
    setProviderPlaylists((current) =>
      current.map((playlist, index) =>
        isLikedPlaylist(playlist, index)
          ? { ...playlist, trackCount: Math.max(0, playlist.trackCount + (nextLiked ? 1 : -1)) }
          : playlist,
      ),
    );
    if (isLikedPlaylist(selectedPlaylist)) {
      setPlaylistTracks((current) =>
        nextLiked
          ? mergeTracks([likedTrack, ...current]).sort((left, right) => (right.likedAt ?? 0) - (left.likedAt ?? 0))
          : current.filter((item) => item.id !== track.id),
      );
    }

    api.setNeteaseLike(providerId, nextLiked).catch(() => {
      setNeteaseLikedIds((current) => {
        const next = { ...current };
        if (wasLiked) next[track.id] = true;
        else delete next[track.id];
        return next;
      });
      setNeteaseLikedTracks((current) =>
        wasLiked
          ? mergeTracks([track, ...current]).sort((left, right) => (right.likedAt ?? 0) - (left.likedAt ?? 0))
          : current.filter((item) => item.id !== track.id),
      );
      setProviderPlaylists((current) =>
        current.map((playlist, index) =>
          isLikedPlaylist(playlist, index)
            ? { ...playlist, trackCount: Math.max(0, playlist.trackCount + (wasLiked ? 1 : -1)) }
            : playlist,
        ),
      );
      if (isLikedPlaylist(selectedPlaylist)) {
        setPlaylistTracks((current) =>
          wasLiked
            ? mergeTracks([track, ...current]).sort((left, right) => (right.likedAt ?? 0) - (left.likedAt ?? 0))
            : current.filter((item) => item.id !== track.id),
        );
      }
    });
  }

  function applyLyricsToTrack(trackId: string, lyrics: Track["lyrics"]) {
    if (!lyrics.length) return;
    writeCachedLyrics(trackId, lyrics);
    const updateTrack = (track: Track) =>
      track.id === trackId ? { ...track, lyrics, lyricStatus: "linked" as const } : track;
    setLocalTracks((current) => current.map(updateTrack));
    setNeteaseTracks((current) => current.map(updateTrack));
    setDailyTracks((current) => current.map(updateTrack));
    setRoamTracks((current) => current.map(updateTrack));
    setNeteaseLikedTracks((current) => current.map(updateTrack));
    setPlaylistTracks((current) => current.map(updateTrack));
  }

  function applyArtworkToTrack(trackId: string, coverUrl?: string | null) {
    if (!coverUrl) return;
    const proxiedCoverUrl = api.getNeteaseCoverUrl(coverUrl);
    const updateTrack = (track: Track) => (track.id === trackId ? { ...track, coverUrl: proxiedCoverUrl } : track);
    setLocalTracks((current) => current.map(updateTrack));
    setNeteaseTracks((current) => current.map(updateTrack));
    setDailyTracks((current) => current.map(updateTrack));
    setRoamTracks((current) => current.map(updateTrack));
    setNeteaseLikedTracks((current) => current.map(updateTrack));
    setPlaylistTracks((current) => current.map(updateTrack));
  }

  function applyBpmToTrack(trackId: string, bpm: number) {
    const safeBpm = Math.round(bpm);
    const updateTrack = (track: Track) => (track.id === trackId ? { ...track, bpm: safeBpm } : track);
    writeCachedBpm(trackId, safeBpm);
    setLocalTracks((current) => current.map(updateTrack));
    setNeteaseTracks((current) => current.map(updateTrack));
    setDailyTracks((current) => current.map(updateTrack));
    setRoamTracks((current) => current.map(updateTrack));
    setNeteaseLikedTracks((current) => current.map(updateTrack));
    setPlaylistTracks((current) => current.map(updateTrack));

    const track = allTracks.find((item) => item.id === trackId);
    if (track?.source === "netease" && track.providerId && bpmSavedRef.current[track.id] !== safeBpm) {
      bpmSavedRef.current[track.id] = safeBpm;
      writeCachedBpm(track.providerId, safeBpm);
      api.saveNeteaseBpm(track.providerId, safeBpm).catch(() => {
        delete bpmSavedRef.current[track.id];
      });
    }
  }

  function applyStreamMetaToTrack(
    trackId: string,
    meta: {
      quality: Track["quality"];
      bitrate: number | null;
      sampleRate: number | null;
      currentLevel: Track["currentLevel"];
      availableLevels: NonNullable<Track["availableLevels"]>;
    },
  ) {
    const updateTrack = (track: Track) =>
      track.id === trackId
        ? {
            ...track,
            quality: meta.quality,
            bitrate: meta.bitrate,
            sampleRate: meta.sampleRate,
            currentLevel: meta.currentLevel ?? track.currentLevel ?? null,
            availableLevels: meta.availableLevels.length ? meta.availableLevels : track.availableLevels,
          }
        : track;

    setLocalTracks((current) => current.map(updateTrack));
    setNeteaseTracks((current) => current.map(updateTrack));
    setDailyTracks((current) => current.map(updateTrack));
    setRoamTracks((current) => current.map(updateTrack));
    setNeteaseLikedTracks((current) => current.map(updateTrack));
    setPlaylistTracks((current) => current.map(updateTrack));
  }

  async function syncLyricsForTrack(track: Track) {
    if (track.source === "netease" && track.providerId) {
      const result = await api.getNeteaseLyrics(track.providerId);
      applyLyricsToTrack(track.id, result.lyrics);
      return;
    }

    if (track.source === "local") {
      const candidates = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      const best = candidates.candidates[0];
      if (!best) return;
      applyArtworkToTrack(track.id, best.coverUrl);
      const result = await api.bindLyric(track.id, best.id);
      applyLyricsToTrack(track.id, result.lyrics);
    }
  }

  return (
    <main className="relative h-screen overflow-hidden bg-[#f5f6f8] text-neutral-950">
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload={hifiEnabled ? "auto" : "metadata"}
        onTimeUpdate={(event) => {
          if (nativePlaybackEnabled) return;
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onLoadedMetadata={(event) => {
          audioErrorRef.current = { count: 0, lastAt: 0 };
          const duration = event.currentTarget.duration || 0;
          if (!nativePlaybackEnabled) setDurationSeconds(duration);
          if (pendingSeekRef.current > 0) {
            const nextTime = Math.min(pendingSeekRef.current, Math.max(0, duration - 1));
            event.currentTarget.currentTime = nextTime;
            if (!nativePlaybackEnabled) setCurrentTime(nextTime);
            pendingSeekRef.current = 0;
          }
        }}
        onEnded={() => {
          if (nativePlaybackEnabled) return;
          handleTrackEnded();
        }}
        onError={handleAudioError}
      />
      <div className="noise" />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error Chromium directory picker support.
        webkitdirectory=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          const path = file?.webkitRelativePath || file?.name || "";
          setFolderName(path.split("/")[0] || "已选择");
          setFolderName(path.split("/")[0] || "已选择");
          setActiveView("local");
        }}
      />

      <div className="app-shell relative z-10 flex h-full w-full flex-col overflow-hidden bg-white/64 backdrop-blur-3xl">
        <header
          className="flex h-20 shrink-0 items-center justify-between gap-3 border-b border-white/70 px-4 sm:px-6"
          style={dragRegionStyle}
        >
          <div className="flex min-w-0 items-center gap-3" style={noDragRegionStyle}>
            <button
              className="flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-left transition hover:bg-white/65"
              onClick={() => setActiveView("home")}
            >
              <img src={ariaIconUrl} alt="" className="size-10 shrink-0 rounded-2xl object-cover" />
              <p className="truncate text-3xl font-semibold">Aria</p>
            </button>
          </div>

          <nav
            className="hidden rounded-full border border-white/70 bg-white/45 p-1 shadow-sm backdrop-blur-xl xl:flex"
            style={noDragRegionStyle}
          >
            {navItems.slice(0, 5).map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;

              return (
                <button
                  key={item.id}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-neutral-500 transition hover:text-neutral-950",
                    active && "bg-white text-neutral-950 shadow-sm",
                  )}
                  onClick={() => setActiveView(item.id)}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/70 bg-white/58 px-3 py-2 shadow-sm sm:max-w-lg"
            style={noDragRegionStyle}
          >
            <Search className="size-4 shrink-0 text-neutral-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索音乐、歌手、专辑"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
            <Button variant="ghost" size="icon" aria-label="设置" onClick={() => setSettingsOpen(true)}>
              <Settings2 />
            </Button>
          </div>

          <div className="flex items-center gap-2" style={noDragRegionStyle}>
            <div className="relative">
            <Button
              variant="glass"
              size="icon"
              aria-label="账号与设置"
              onClick={() => setAccountOpen((value) => !value)}
            >
              {neteaseAccount?.avatarUrl ? (
                <img
                  src={neteaseAccount.avatarUrl}
                  alt={neteaseAccount.nickname ?? "account"}
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <UserRound />
              )}
            </Button>
            <span
              className={cn(
                "absolute right-0 top-0 size-2.5 rounded-full ring-2 ring-white",
                neteaseConnected ? "bg-[#28c840]" : "bg-neutral-300",
              )}
            />
            <AnimatePresence>
              {accountOpen && (
                <AccountPanel
                  onClose={() => setAccountOpen(false)}
                  onOpenSettings={() => {
                    setAccountOpen(false);
                    setSettingsOpen(true);
                  }}
                  onAccountChange={(account) => {
                    setNeteaseAccount(account);
                    if (account.connected) refreshNeteaseData();
                  }}
                />
              )}
            </AnimatePresence>
            </div>

            <div className="flex items-center rounded-full border border-white/70 bg-white/58 p-1 shadow-sm">
              <button
                className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white hover:text-neutral-950"
                aria-label="Minimize window"
                onClick={() => window.ariaDesktop?.minimizeWindow?.()}
              >
                <Minus className="size-4" />
              </button>
              <button
                className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white hover:text-neutral-950"
                aria-label="Maximize window"
                onClick={() => window.ariaDesktop?.toggleMaximizeWindow?.()}
              >
                <Maximize2 className="size-4" />
              </button>
              <button
                className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition hover:bg-[#111111] hover:text-white"
                aria-label="Close window"
                onClick={() => window.ariaDesktop?.closeWindow?.()}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </header>

        <section
          className={cn(
            "grid min-h-0 flex-1 gap-4 p-4",
            activeView === "player"
              ? "lg:grid-cols-[minmax(0,1fr)_minmax(360px,22vw)]"
              : "lg:grid-cols-[minmax(0,1fr)_minmax(320px,20vw)]",
          )}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-0 min-w-0"
            >
              {activeView === "home" && (
                <HomeSurface
                  activeTrack={activeTrack}
                  tracks={visibleTracks}
                  dailyTracks={dailyTracks}
                  roamTracks={roamTracks}
                  playCounts={playCounts}
                  playing={playing}
                  onTogglePlay={() => setPlaying((value) => !value)}
                  onPickTrack={chooseTrack}
                  onOpenPlayer={() => setActiveView("player")}
                />
              )}
              {activeView === "player" && (
                <PlayerSurface
                  activeTrack={activeTrack}
                  palette={activePalette}
                  playing={playing}
                  visualizerActive={pageVisible}
                  shuffleEnabled={shuffleEnabled}
                  repeatMode={repeatMode}
                  onTogglePlay={() => setPlaying((value) => !value)}
                  onToggleShuffle={() => setShuffleEnabled((value) => !value)}
                  onCycleRepeatMode={() => setRepeatMode((current) => (current === "all" ? "one" : "all"))}
                  onNext={() => pickRelativeTrack(1)}
                  onPrevious={() => pickRelativeTrack(-1)}
                  liked={activeTrack.source === "netease" ? Boolean(neteaseLikedIds[activeTrack.id]) : Boolean(likedTrackIds[activeTrack.id])}
                  onToggleLike={() => toggleLikeTrack(activeTrack.id)}
                  volume={volume}
                  onVolumeChange={setVolume}
                  qualityLevel={effectiveQualityLevel}
                  onQualityLevelChange={(level) => {
                    setQualityLevel(level);
                    if (hifiEnabled) setHifiEnabled(false);
                  }}
                  hifiEnabled={hifiEnabled}
                  exclusiveMode={exclusiveMode}
                  currentTime={currentTime}
                  durationSeconds={durationSeconds}
                  spectrum={spectrum}
                  analyserRef={analyserRef}
                  detectedBpm={detectedBpm}
                  onSeek={seekTo}
                />
              )}
              {activeView === "local" && (
                <LibrarySurface
                  folderName={folderName}
                  onChooseFolder={() => fileInputRef.current?.click()}
                  tracks={visibleLocalTracks}
                  localTrackCount={localTracks.length}
                  libraryMeta={libraryMeta}
                  activeTrackId={activeTrackId}
                  onPickTrack={chooseTrack}
                  onScanPath={scanBackendPath}
                  onLyricsBound={applyLyricsToTrack}
                  onArtworkBound={applyArtworkToTrack}
                />
              )}
              {activeView === "liked" && (
                <LikedSurface
                  localTracks={localLikedTracks}
                  neteaseTracks={neteaseLikedDisplayTracks}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "playlists" && (
                <PlaylistSurface
                  playlists={providerPlaylists}
                  selectedPlaylist={selectedPlaylist}
                  tracks={playlistTracks}
                  playCounts={playCounts}
                  loading={playlistLoading}
                  onOpenPlaylist={openPlaylist}
                  onClosePlaylist={() => setSelectedPlaylist(null)}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "daily" && (
                <CollectionSurface
                  title="每日推荐"
                  subtitle="30 首"
                  icon={<Sparkles className="size-5" />}
                  tracks={dailyTracks}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "radar" && (
                <CollectionSurface
                  title="私人漫游"
                  subtitle="基于最近偏好漫游"
                  icon={<Radio className="size-5" />}
                  tracks={roamTracks}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "cloud" && <CloudSurface />}
              {activeView === "stats" && <StatsSurface tracks={allTracks} playCounts={playCounts} />}
            </motion.div>
          </AnimatePresence>

          {activeView === "player" ? (
            <PlayerSidePanel
              mode={playerSideView}
              onModeChange={setPlayerSideView}
              track={activeTrack}
              palette={activePalette}
              currentTime={currentTime}
              tracks={playQueueTracks.length ? playQueueTracks : visibleTracks}
              activeTrackId={activeTrackId}
              onPickTrack={chooseTrack}
              onSeek={seekTo}
            />
          ) : (
          <aside className="glass hidden min-h-0 flex-col rounded-[1.5rem] p-4 lg:flex">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">
                  Queue
                </p>
                <h2 className="mt-1 text-xl font-semibold">下一首</h2>
              </div>
              <Button variant="ghost" size="icon" aria-label="展开队列">
                <ListMusic />
              </Button>
            </div>

            <QueueList tracks={playQueueTracks.length ? playQueueTracks : visibleTracks} activeTrackId={activeTrackId} onPickTrack={chooseTrack} />

            <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-white/70 bg-white/55 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                    Library
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">本地与云端状态</p>
                </div>
                <Badge>Ready</Badge>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
                <Metric value={String(allTracks.length)} label="曲目" />
                <Metric value={String(linkedLyricCount)} label="歌词" />
                <Metric value={String(allTracks.filter((track) => track.quality !== "320K").length)} label="无损" />
              </div>

              <div className="mt-4 rounded-2xl bg-white/56 p-3">
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>歌词匹配</span>
                  <span>{lyricProgress}%</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-950/8">
                  <div className="h-full rounded-full bg-neutral-950/55" style={{ width: `${lyricProgress}%` }} />
                </div>
              </div>
            </div>
          </aside>
          )}
        </section>

        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              backgroundEnabled={backgroundEnabled}
              onBackgroundEnabledChange={setBackgroundEnabled}
              neteaseAccount={neteaseAccount}
              libraryMeta={libraryMeta}
              trackCount={allTracks.length}
              likedCount={localLikedTracks.length + neteaseLikedDisplayTracks.length}
              lyricProgress={lyricProgress}
              volume={volume}
              onVolumeChange={setVolume}
              audioOutputDevices={audioOutputDevices}
              selectedSinkId={selectedSinkId}
              onSelectedSinkIdChange={setSelectedSinkId}
              hifiEnabled={hifiEnabled}
              onHifiEnabledChange={setHifiEnabled}
              nativeAudioSupported={nativeAudioSupported}
              nativeAudioState={nativeAudioState}
              exclusiveMode={exclusiveMode}
              onExclusiveModeChange={setExclusiveMode}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </AnimatePresence>

        <FloatingNav
          activeView={activeView}
          open={navOpen}
          onOpenChange={(nextOpen) => {
            if (navCloseTimer.current) {
              window.clearTimeout(navCloseTimer.current);
              navCloseTimer.current = null;
            }
            setNavOpen(nextOpen);
          }}
          onRequestClose={() => {
            if (navCloseTimer.current) {
              window.clearTimeout(navCloseTimer.current);
            }
            navCloseTimer.current = window.setTimeout(() => {
              setNavOpen(false);
              navCloseTimer.current = null;
            }, 180);
          }}
          onPick={(id) => {
            setActiveView(id);
            setNavOpen(false);
          }}
        />
      </div>
    </main>
  );
}

function HomeSurface({
  activeTrack,
  tracks: homeTracks,
  dailyTracks,
  roamTracks,
  playCounts,
  playing,
  onTogglePlay,
  onPickTrack,
  onOpenPlayer,
}: {
  activeTrack: Track;
  tracks: Track[];
  dailyTracks: Track[];
  roamTracks: Track[];
  playCounts: Record<string, number>;
  playing: boolean;
  onTogglePlay: () => void;
  onPickTrack: (id: string) => void;
  onOpenPlayer: () => void;
}) {
  const rankedTracks = useMemo(
    () =>
      [...homeTracks]
        .sort((left, right) => {
          const byCount = (playCounts[right.id] ?? 0) - (playCounts[left.id] ?? 0);
          if (byCount !== 0) return byCount;
          return left.title.localeCompare(right.title, "zh-CN");
        })
        .slice(0, 20),
    [homeTracks, playCounts],
  );
  const mixedTracks = useMemo(
    () => mergeTracks([...roamTracks.slice(0, 4), ...dailyTracks.slice(0, 6), ...homeTracks]).slice(0, 8),
    [dailyTracks, homeTracks, roamTracks],
  );
  const totalPlays = useMemo(() => Object.values(playCounts).reduce((sum, count) => sum + count, 0), [playCounts]);
  const neteaseCount = useMemo(() => homeTracks.filter((track) => track.source === "netease").length, [homeTracks]);
  const favoriteArtist = rankedTracks[0]?.artist ?? "等待播放";

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.86fr)_minmax(0,1.14fr)] gap-4 overflow-hidden">
      <section className="glass grid min-h-0 overflow-hidden rounded-[1.5rem] lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="p-5 sm:p-7">
          <Badge>Home</Badge>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            今天想听点什么
          </h1>
          <p className="mt-3 max-w-xl text-neutral-500">
            把本地音乐、网易云喜欢、每日推荐和云盘放在同一个主页里。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <StatTile label="本周播放" value={String(totalPlays)} />
            <StatTile label="网易云" value={String(neteaseCount)} />
            <StatTile label="常听歌手" value={favoriteArtist} compact />
          </div>
        </div>
        <button
          className="group relative m-4 min-h-72 overflow-hidden rounded-[1.65rem] border border-neutral-950/10 bg-neutral-950 p-0 text-left shadow-[0_24px_70px_rgba(20,24,35,0.18)]"
          onClick={onOpenPlayer}
        >
          <CoverArt track={activeTrack} className="absolute inset-0 size-full rounded-[1.65rem]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/24 to-transparent" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.14),transparent_34%,rgba(0,0,0,0.24))]" />
          <div className="absolute right-5 top-5 z-20">
            <Button
              className="bg-white text-neutral-950 shadow-[0_14px_34px_rgba(0,0,0,0.18)] hover:bg-white/92"
              size="iconLg"
              aria-label={playing ? "pause" : "play"}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePlay();
              }}
            >
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </Button>
          </div>
          <div className="absolute bottom-5 left-5 right-5 z-20">
            <h2 className="line-clamp-2 text-3xl font-semibold leading-tight text-white drop-shadow">{activeTrack.title}</h2>
            <p className="mt-2 truncate text-base font-medium text-white/84">{activeTrack.artist}</p>
            <p className="mt-1 truncate text-xs font-medium uppercase tracking-[0.16em] text-white/58">
              {activeTrack.album} · {sourceLabel[activeTrack.source]} · {formatAudioDetail(activeTrack)}
            </p>
          </div>
          <div className="hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-full border border-white/26 bg-white/12 px-3 py-1.5 text-xs font-medium text-white/88 backdrop-blur-md">
                {playing ? "播放中" : "暂停中"}
              </div>
              <Button className="bg-white text-neutral-950 shadow-sm hover:bg-white/90" size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={(event) => {
                event.stopPropagation();
                onTogglePlay();
              }}>
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
            </div>
            <div className="max-w-[24rem]">
              <p className="text-sm text-white/75">正在播放</p>
              <h2 className="mt-2 line-clamp-2 max-w-[22rem] text-3xl font-semibold leading-tight text-white">{activeTrack.title}</h2>
              <p className="mt-1 text-white/75">{activeTrack.artist}</p>
              <p className="mt-3 line-clamp-2 max-w-md text-sm leading-6 text-white/72">
                {activeTrack.album} · {sourceLabel[activeTrack.source]} · {formatAudioDetail(activeTrack)} · {activeTrack.duration}
              </p>
            </div>
          </div>
        </button>
      </section>

      <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <div className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">听歌排行</h2>
            <Badge>周榜</Badge>
          </div>
          <div className="no-scrollbar mt-4 grid max-h-[calc(100%-3.5rem)] gap-2 overflow-y-auto pr-1">
            {rankedTracks.map((track, index) => (
              <button
                key={track.id}
                className="grid grid-cols-[2rem_3rem_1fr_auto] items-center gap-3 rounded-[1.1rem] p-2 text-left transition hover:bg-white/65"
                onClick={() => onPickTrack(track.id)}
              >
                <span className="text-center text-sm font-semibold text-neutral-400">{index + 1}</span>
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{track.title}</p>
                  <p className="truncate text-xs text-neutral-500">{track.artist}</p>
                </div>
                <span className="text-sm text-neutral-500">{playCounts[track.id] ? `${playCounts[track.id]} 次` : track.duration}</span>
              </button>
            ))}
            {!rankedTracks.length && <EmptyState text="扫描本地目录或绑定网易云 Cookie 后显示排行。" />}
          </div>
        </div>

        <div className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">每日混合</h2>
            <Badge>Radar</Badge>
          </div>
          <div className="no-scrollbar mt-4 grid max-h-[calc(100%-3.5rem)] gap-3 overflow-y-auto pr-1">
            {mixedTracks.map((track, index) => (
              <button
                key={track.id}
                className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 rounded-[1.2rem] bg-white/52 p-3 text-left shadow-sm transition hover:bg-white"
                onClick={() => onPickTrack(track.id)}
              >
                <CoverArt track={track} className="size-14 rounded-2xl" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{track.title}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {index === 0 ? "私人漫游" : index === 1 ? "每日推荐" : "相似单曲"}
                  </p>
                </div>
                <Badge>{formatAudioDetail(track)}</Badge>
              </button>
            ))}
            {!mixedTracks.length && <EmptyState text="暂无推荐数据，先同步网易云每日推荐。" />}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-[1.15rem] bg-white/58 p-4 shadow-sm">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className={cn("mt-2 truncate font-semibold", compact ? "text-xl" : "text-3xl")}>{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[1.15rem] border border-dashed border-neutral-300/70 bg-white/45 p-5 text-sm text-neutral-500">
      {text}
    </div>
  );
}

function QueueList({
  tracks,
  activeTrackId,
  onPickTrack,
}: {
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string) => void;
}) {
  const displayTracks = useMemo(() => {
    const firstTracks = tracks.slice(0, 80);
    if (firstTracks.some((track) => track.id === activeTrackId)) return firstTracks;
    const activeTrack = tracks.find((track) => track.id === activeTrackId);
    return activeTrack ? [activeTrack, ...firstTracks.slice(0, 79)] : firstTracks;
  }, [activeTrackId, tracks]);
  const hiddenCount = Math.max(0, tracks.length - displayTracks.length);

  return (
    <div className="no-scrollbar relative mt-4 flex-1 space-y-2 overflow-y-auto">
      {displayTracks.map((track) => (
        <button
          key={track.id}
          className={cn(
            "flex w-full items-center gap-3 rounded-3xl p-2 text-left transition hover:bg-white/65",
            activeTrackId === track.id && "bg-white shadow-sm",
          )}
          onClick={() => onPickTrack(track.id)}
        >
          <CoverArt track={track} className="size-14 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{track.title}</p>
            <p className="truncate text-xs text-neutral-500">{track.artist}</p>
          </div>
          <Badge className="shrink-0">{formatAudioDetail(track)}</Badge>
        </button>
      ))}
      {hiddenCount > 0 && (
        <div className="rounded-2xl bg-white/45 px-3 py-2 text-center text-xs text-neutral-500">
          还有 {hiddenCount} 首，使用搜索快速定位
        </div>
      )}
      {!tracks.length && <EmptyState text="暂无队列，先扫描本地目录或同步网易云。" />}
      <div className="pointer-events-none sticky bottom-0 h-10 bg-gradient-to-t from-white/70 to-transparent" />
    </div>
  );
}

function PlayerSidePanel({
  mode,
  onModeChange,
  track,
  palette,
  currentTime,
  tracks,
  activeTrackId,
  onPickTrack,
  onSeek,
}: {
  mode: "lyrics" | "queue";
  onModeChange: (mode: "lyrics" | "queue") => void;
  track: Track;
  palette: CoverPalette;
  currentTime: number;
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string) => void;
  onSeek: (time: number) => void;
}) {
  return (
    <aside className="glass hidden min-h-0 flex-col rounded-[1.5rem] p-4 lg:flex">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">
            {mode === "lyrics" ? "Lyrics" : "Queue"}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{mode === "lyrics" ? "同步歌词" : "下一首"}</h2>
        </div>
        <div className="flex rounded-full bg-white/60 p-1 shadow-sm">
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
              mode === "lyrics" && "bg-neutral-950 text-white",
            )}
            onClick={() => onModeChange("lyrics")}
          >
            歌词
          </button>
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
              mode === "queue" && "bg-neutral-950 text-white",
            )}
            onClick={() => onModeChange("queue")}
          >
            下一首
          </button>
        </div>
      </div>

      {mode === "lyrics" ? (
        <SidebarLyrics track={track} palette={palette} currentTime={currentTime} onSeek={onSeek} />
      ) : (
        <QueueList tracks={tracks} activeTrackId={activeTrackId} onPickTrack={onPickTrack} />
      )}
    </aside>
  );
}

function SidebarLyrics({
  track,
  palette,
  currentTime,
  onSeek,
}: {
  track: Track;
  palette: CoverPalette;
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const activeLyricIndex = getActiveLyricIndex(track.lyrics, currentTime);
  const lines = track.lyrics;
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const manualScrollUntilRef = useRef(0);

  useEffect(() => {
    if (Date.now() < manualScrollUntilRef.current) return;
    lineRefs.current[activeLyricIndex]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLyricIndex, track.id]);

  const holdManualScroll = () => {
    manualScrollUntilRef.current = Date.now() + 3500;
  };

  return (
    <div className="relative mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] bg-white p-4 shadow-sm">
      <div className="relative z-10 mb-3 min-w-0">
        <p className="truncate text-sm font-semibold">{track.title}</p>
        <p className="truncate text-xs text-neutral-500">{track.artist}</p>
      </div>
      <div
        className="no-scrollbar relative z-10 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
        onWheel={holdManualScroll}
        onTouchStart={holdManualScroll}
        onPointerDown={holdManualScroll}
      >
        <div className="h-12 shrink-0" />
        {track.lyrics.map((line, index) => {
          const active = index === activeLyricIndex;
          return (
            <motion.button
              key={`${track.id}-${line.time}-${line.text}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node;
              }}
              layout
              className={cn(
                "grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-3 py-2 text-left text-neutral-500 transition hover:bg-neutral-950/[0.04]",
                active && "text-neutral-950 shadow-sm",
              )}
              style={active ? { backgroundColor: `${palette.primary}18` } : undefined}
              onClick={() => {
                manualScrollUntilRef.current = 0;
                onSeek(parseDuration(line.time));
              }}
            >
              <span className="text-sm font-medium text-neutral-400">{line.time}</span>
              <span className={cn("min-w-0 whitespace-pre-wrap break-words leading-7", active ? "text-2xl font-semibold" : "text-base")}>
                {line.text}
              </span>
            </motion.button>
          );
        })}
        {!lines.length && <p className="text-center text-sm text-neutral-500">歌词同步中</p>}
      </div>
    </div>
  );
}

function SpectrumCanvas({
  analyserRef,
  playing,
  active,
  palette,
  fallback,
}: {
  analyserRef: { current: AnalyserNode | null };
  playing: boolean;
  active: boolean;
  palette: CoverPalette;
  fallback: number[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsRef = useRef<number[]>(Array.from({ length: 42 }, () => 0.1));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active && !playing) return;

    let frame = 0;
    let frequencyData = new Uint8Array(0);
    let timeData = new Uint8Array(0);
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const analyser = analyserRef.current;
      if (analyser) {
        if (frequencyData.length !== analyser.frequencyBinCount) {
          frequencyData = new Uint8Array(analyser.frequencyBinCount);
        }
        if (timeData.length !== analyser.fftSize) {
          timeData = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteFrequencyData(frequencyData);
        analyser.getByteTimeDomainData(timeData);
      }

      const barCount = levelsRef.current.length;
      const now = performance.now();
      const globalWave = analyser
        ? timeData.reduce((sum, value) => sum + Math.abs(value - 128), 0) / timeData.length / 48
        : 0;

      context.clearRect(0, 0, width, height);
      const background = context.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, colorWithAlpha(palette.primary, 0.08));
      background.addColorStop(1, colorWithAlpha(palette.secondary, 0.04));
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const gap = 6 * dpr;
      const barWidth = Math.max(2 * dpr, (width - gap * (barCount - 1)) / barCount);
      const baseline = height * 0.82;
      const maxBarHeight = height * 0.58;
      const barGradient = context.createLinearGradient(0, baseline - maxBarHeight, 0, baseline);
      barGradient.addColorStop(0, colorWithAlpha(palette.secondary, 0.9));
      barGradient.addColorStop(0.75, colorWithAlpha(palette.primary, 0.82));
      barGradient.addColorStop(1, colorWithAlpha(palette.primary, 0.56));

      context.strokeStyle = colorWithAlpha(palette.primary, 0.2);
      context.lineWidth = 1 * dpr;
      context.beginPath();
      context.moveTo(0, baseline + 0.5 * dpr);
      context.lineTo(width, baseline + 0.5 * dpr);
      context.stroke();

      for (let index = 0; index < barCount; index += 1) {
        const logStart = Math.floor(Math.pow(index / barCount, 1.18) * frequencyData.length * 0.82);
        const logEnd = Math.max(
          logStart + 1,
          Math.floor(Math.pow((index + 1) / barCount, 1.18) * frequencyData.length * 0.82),
        );
        const foldedBand = Math.max(1, Math.floor(frequencyData.length * 0.42));
        const foldedIndex = frequencyData.length
          ? (index * 3 + Math.floor(index / 4)) % foldedBand
          : 0;
        const linearIndex = Math.min(
          frequencyData.length - 1,
          Math.floor((index / Math.max(1, barCount - 1)) * (frequencyData.length - 1)),
        );
        const mirrorIndex = Math.max(0, frequencyData.length - 1 - linearIndex);
        let bandEnergy = 0;
        for (let cursor = logStart; cursor < logEnd; cursor += 1) {
          bandEnergy += frequencyData[cursor] ?? 0;
        }
        const timeIndex = timeData.length ? Math.floor((index / barCount) * timeData.length) : 0;
        const timeEnergy = timeData.length ? Math.abs((timeData[timeIndex] ?? 128) - 128) / 96 : 0;
        const spectralEnergy = analyser
          ? (bandEnergy / (logEnd - logStart) +
              (frequencyData[linearIndex] ?? 0) * 0.28 +
              (frequencyData[mirrorIndex] ?? 0) * 0.08 +
              (frequencyData[foldedIndex] ?? 0) * 0.36 +
              (frequencyData[Math.max(1, foldedIndex - 1)] ?? 0) * 0.16) /
            (255 * 1.6)
          : (fallback[index % fallback.length] ?? 18) / 100;
        const energy = analyser
          ? Math.pow(Math.min(1, spectralEnergy * 1.7 + timeEnergy * 0.3 + globalWave * 0.12), 0.88)
          : spectralEnergy;

        const phase = Math.sin(now / (210 + index * 3.2) + index * 0.42);
        const breathing = playing
          ? (phase + 1) * 0.032 + Math.abs(Math.sin(now / 320 + index * 0.42)) * 0.028
          : 0;
        const target = playing
          ? Math.min(1, Math.max(0.08, energy * 0.86 + globalWave * 0.24 + breathing))
          : Math.max(0.05, levelsRef.current[index] * 0.92);
        levelsRef.current[index] = levelsRef.current[index] * 0.72 + target * 0.28;

        const x = index * (barWidth + gap);
        const barHeight = Math.max(3 * dpr, levelsRef.current[index] * maxBarHeight);
        const radius = Math.min(barWidth / 2, 10 * dpr);

        context.fillStyle = barGradient;
        roundedRect(context, x, baseline - barHeight, barWidth, barHeight, radius);
        context.fill();
      }

      frame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, analyserRef, fallback, palette.primary, palette.secondary, playing]);

  return <canvas ref={canvasRef} className="block h-36 w-full sm:h-40 2xl:h-48" aria-hidden="true" />;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function PlayerSurface({
  activeTrack,
  palette,
  playing,
  visualizerActive,
  shuffleEnabled,
  repeatMode,
  onTogglePlay,
  onToggleShuffle,
  onCycleRepeatMode,
  onNext,
  onPrevious,
  liked,
  onToggleLike,
  volume,
  onVolumeChange,
  qualityLevel,
  onQualityLevelChange,
  hifiEnabled,
  exclusiveMode,
  currentTime,
  durationSeconds,
  spectrum,
  analyserRef,
  detectedBpm,
  onSeek,
}: {
  activeTrack: Track;
  palette: CoverPalette;
  playing: boolean;
  visualizerActive: boolean;
  shuffleEnabled: boolean;
  repeatMode: "all" | "one";
  onTogglePlay: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onNext: () => void;
  onPrevious: () => void;
  liked: boolean;
  onToggleLike: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  hifiEnabled: boolean;
  exclusiveMode: boolean;
  currentTime: number;
  durationSeconds: number;
  spectrum: number[];
  analyserRef: { current: AnalyserNode | null };
  detectedBpm: number | null;
  onSeek: (time: number) => void;
}) {
  const visualizerBars = spectrum.length ? spectrum : activeTrack.waveform;
  const themePrimary = colorWithAlpha(palette.primary, 0.34);
  const themeSecondary = colorWithAlpha(palette.secondary, 0.24);
  const themeSoft = colorWithAlpha(palette.primary, 0.12);
  const bpmLabel = activeTrack.bpm ? `${activeTrack.bpm} BPM` : detectedBpm ? `${detectedBpm} BPM` : "BPM --";
  const resolvedQualityLevel = activeTrack.currentLevel ?? qualityLevel;
  const resolvedDuration = durationSeconds || parseDuration(activeTrack.duration);
  const progressPercent = resolvedDuration ? Math.min(100, Math.max(0, (currentTime / resolvedDuration) * 100)) : 0;

  return (
    <div
      className="relative h-full min-h-[620px] overflow-hidden rounded-[1.5rem] border border-white/55 shadow-[0_22px_70px_rgba(47,55,76,0.12)]"
      style={{
        ["--track-accent" as string]: palette.primary,
        background: `linear-gradient(135deg, ${themePrimary}, rgba(255,255,255,0.26) 42%, ${themeSecondary})`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: `radial-gradient(circle at 28% 32%, ${palette.primary}38, transparent 24rem), radial-gradient(circle at 82% 78%, ${palette.secondary}28, transparent 18rem)`,
        }}
      />
      <div className="relative grid h-full min-h-[620px] lg:grid-cols-[0.95fr_1.05fr]">
        <div
          className="relative min-h-[420px] overflow-hidden bg-neutral-950"
          style={{
            background: `linear-gradient(145deg, ${palette.primary}30, ${palette.secondary}18, rgba(255,255,255,0.48))`,
          }}
        >
          <div
            className="absolute inset-0 opacity-18 blur-3xl scale-110"
            style={{ background: activeTrack.cover }}
          />
          <motion.div
            key={`artwork-${activeTrack.id}`}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.42 }}
            className="absolute inset-0"
          >
            <CoverArt track={activeTrack} className="size-full" fit="cover" />
          </motion.div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/6 via-transparent to-black/10" />
          <div className="hidden">
          <div className="pointer-events-none absolute left-6 top-6 z-20 rounded-full border border-white/16 bg-black/42 px-3 py-1.5 text-xs font-medium text-white/86">
            {sourceLabel[activeTrack.source]} 路 {activeTrack.quality}
          </div>
          <Button
            className="absolute right-6 top-6 z-20 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(0,0,0,0.2)] hover:bg-white/92"
            size="iconLg"
            aria-label={playing ? "pause" : "play"}
            onClick={onTogglePlay}
          >
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Button>
          <div className="pointer-events-none absolute inset-x-6 bottom-6 z-20 text-white">
            <p className="line-clamp-3 text-4xl font-semibold leading-tight drop-shadow sm:text-5xl">{activeTrack.title}</p>
            <p className="mt-3 truncate text-lg font-medium text-white/82">{activeTrack.artist}</p>
            <p className="mt-2 truncate text-xs font-medium uppercase tracking-[0.16em] text-white/58">
              {activeTrack.album} 路 {activeTrack.duration} 路 {activeTrack.quality}
            </p>
          </div>
          <div className="hidden">
            <motion.div
              key={activeTrack.id}
              initial={{ opacity: 0, scale: 0.96, filter: "blur(18px)" }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.42 }}
              className="relative aspect-square w-[min(86%,520px)] overflow-hidden rounded-[1.45rem] bg-neutral-950 shadow-[0_34px_90px_rgba(20,24,35,0.26)]"
            >
              <CoverArt track={activeTrack} className="size-full rounded-[1.45rem]" large />
              <div className="pointer-events-none absolute inset-0 z-40 rounded-[1.45rem] border border-white/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" />
              <div className="pointer-events-none absolute left-5 top-5 z-50 rounded-full border border-white/18 bg-black/46 px-3 py-1.5 text-xs font-medium text-white/88">
                {sourceLabel[activeTrack.source]} · {activeTrack.quality}
              </div>
              <Button
                className="absolute right-5 top-5 z-50 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(0,0,0,0.2)] hover:bg-white/92"
                size="iconLg"
                aria-label={playing ? "pause" : "play"}
                onClick={onTogglePlay}
              >
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
              <div className="pointer-events-none absolute inset-x-5 bottom-5 z-50 rounded-[1.1rem] border border-white/16 bg-black/52 px-5 py-4 shadow-[0_20px_52px_rgba(0,0,0,0.28)]">
                <p className="line-clamp-2 text-2xl font-semibold leading-tight text-white drop-shadow">{activeTrack.title}</p>
                <p className="mt-1 truncate text-xs text-white/70">{activeTrack.artist} · {activeTrack.album}</p>
              </div>
            </motion.div>
          </div>
        </div>
        </div>

        <div
          className="flex min-h-0 flex-col justify-between p-5 sm:p-8"
          style={{ background: `linear-gradient(160deg, rgba(255,255,255,0.36), ${themeSoft} 48%, ${themeSecondary})` }}
        >
          <div className="min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{sourceLabel[activeTrack.source]}</Badge>
              <Badge>{formatAudioDetail(activeTrack, resolvedQualityLevel)}</Badge>
              <Badge>{activeTrack.duration}</Badge>
              <Badge>{bpmLabel}</Badge>
              {hifiEnabled && <Badge>HiFi</Badge>}
              {exclusiveMode && <Badge>直通</Badge>}
            </div>
            <h1 className="mt-6 line-clamp-3 max-w-xl text-[clamp(2.2rem,4.3vw,4.6rem)] font-semibold leading-[1.02] text-neutral-950">
              {activeTrack.title}
            </h1>
            <p className="mt-3 truncate text-xl text-neutral-500">{activeTrack.artist}</p>
            <p className="mt-1 text-sm text-neutral-400">{activeTrack.album}</p>
          </div>

          <div className="mt-4">
            <div className="px-1">
              <SpectrumCanvas
                analyserRef={analyserRef}
                playing={playing}
                active={visualizerActive}
                palette={palette}
                fallback={visualizerBars}
              />
              <div
                className="hidden"
                style={{ background: `linear-gradient(180deg, ${themeSoft}, ${colorWithAlpha(palette.secondary, 0.08)})` }}
              >
                <div className="absolute inset-x-0 top-3 h-px bg-gradient-to-r from-transparent via-neutral-950/10 to-transparent" />
                {visualizerBars.map((height, index) => (
                  <motion.div
                    key={`${activeTrack.id}-${index}`}
                    initial={{ height: 8 }}
                    animate={{ height: `${playing ? Math.max(8, height) : Math.max(6, height * 0.45)}%` }}
                    transition={{
                      delay: index * 0.025,
                      duration: 0.18,
                      ease: "easeInOut",
                    }}
                    className="relative z-10 min-w-2 flex-1 rounded-full"
                    style={{ backgroundColor: palette.primary }}
                  />
                ))}
              </div>
              <div className="mt-3">
              <input
                aria-label="播放进度"
                type="range"
                min="0"
                max={Math.max(1, durationSeconds || 0)}
                value={Math.min(currentTime, durationSeconds || currentTime || 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="player-range w-full"
                style={
                  {
                    "--range-color": palette.primary,
                    "--range-value": `${progressPercent}%`,
                  } as CSSProperties
                }
              />
              <div className="mt-2 flex items-center justify-between text-xs font-medium text-neutral-500">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(durationSeconds || parseDuration(activeTrack.duration))}</span>
              </div>
              </div>
            </div>

            <div
              className="mt-4 rounded-[1.35rem] border border-white/35 p-4 shadow-sm"
              style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.34), ${themeSoft})` }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 rounded-full bg-white/72 p-2 shadow-sm">
                  <Button
                    variant={shuffleEnabled ? "default" : "ghost"}
                    size="icon"
                    aria-label="随机播放"
                    onClick={onToggleShuffle}
                  >
                    <Shuffle />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="上一首" onClick={onPrevious}>
                    <SkipBack />
                  </Button>
                  <Button size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
                    {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="下一首" onClick={onNext}>
                    <SkipForward />
                  </Button>
                  <Button
                    className="relative rounded-full"
                    variant={repeatMode === "one" ? "default" : "ghost"}
                    size="icon"
                    aria-label="循环播放"
                    onClick={onCycleRepeatMode}
                  >
                    <Repeat2 />
                    {repeatMode === "one" && <span className="absolute right-1 top-1 text-[10px] font-semibold">1</span>}
                  </Button>
                  <Button
                    variant={liked ? "default" : "ghost"}
                    size="icon"
                    aria-label={liked ? "取消喜欢" : "喜欢"}
                    onClick={onToggleLike}
                  >
                    <Heart className={cn(liked && "fill-current")} />
                  </Button>
                </div>
                <div className="flex min-w-0 items-center gap-3 rounded-full bg-white/72 px-4 py-3 shadow-sm">
                  <Volume2 className="size-4 text-neutral-500" />
                  <input
                    aria-label="音量"
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(event) => onVolumeChange(Number(event.target.value))}
                    className="player-range w-36"
                    style={
                      {
                        "--range-color": palette.primary,
                        "--range-value": `${volume}%`,
                      } as CSSProperties
                    }
                  />
                  <span className="w-8 text-right text-xs font-medium text-neutral-500">{volume}</span>
                </div>
              </div>
            </div>

            <div
              className="mt-3 rounded-[1.25rem] border border-white/35 p-3 shadow-sm"
              style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.28), ${colorWithAlpha(palette.secondary, 0.1)})` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Quality</p>
                <div className="flex items-center gap-2">
                  {hifiEnabled && <Badge>HiFi 优先</Badge>}
                  <div className="flex flex-wrap gap-1 rounded-full bg-white/60 p-1">
                  {qualityOptions.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
                        resolvedQualityLevel === option.value && "bg-neutral-950 text-white shadow-sm",
                        (activeTrack.source !== "netease" || !activeTrack.availableLevels?.includes(option.value)) && "opacity-45",
                      )}
                      disabled={activeTrack.source !== "netease" || !activeTrack.availableLevels?.includes(option.value)}
                      onClick={() => onQualityLevelChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function LibrarySurface({
  folderName,
  onChooseFolder,
  tracks: libraryTracks,
  localTrackCount,
  libraryMeta,
  activeTrackId,
  onPickTrack,
  onScanPath,
  onLyricsBound,
  onArtworkBound,
}: {
  folderName: string;
  onChooseFolder: () => void;
  tracks: Track[];
  localTrackCount: number;
  libraryMeta: { roots: number; updatedAt: string | null };
  activeTrackId: string;
  onPickTrack: (id: string) => void;
  onScanPath: (folderPath: string) => Promise<void>;
  onLyricsBound: (trackId: string, lyrics: Track["lyrics"]) => void;
  onArtworkBound: (trackId: string, coverUrl?: string | null) => void;
}) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [boundCandidateId, setBoundCandidateId] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState("");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error">("idle");
  const candidateTarget =
    libraryTracks.find((track) => track.lyricStatus !== "linked") ?? libraryTracks[0];

  async function submitScanPath() {
    if (!scanPath.trim()) return;
    setScanState("scanning");
    try {
      await onScanPath(scanPath.trim());
      setScanState("idle");
    } catch {
      setScanState("error");
    }
  }

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Folder</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">本地音乐</h1>
          <p className="mt-3 text-neutral-500">{folderName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" onClick={() => setLookupOpen((value) => !value)}>
            {lookupOpen ? <X /> : <Languages />}
            {lookupOpen ? "收起搜词" : "联网搜词"}
          </Button>
          <Button onClick={onChooseFolder}>
            <FolderOpen />
            选择文件夹
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <LyricLookupCard label="索引曲目" value={`${localTrackCount} 首本地音乐`} />
        <LyricLookupCard label="目录数量" value={`${libraryMeta.roots} 个目录`} />
        <LyricLookupCard
          label="更新时间"
          value={libraryMeta.updatedAt ? new Date(libraryMeta.updatedAt).toLocaleString() : "尚未扫描"}
        />
      </div>

      <div className="mt-5 rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">
              Backend Scan
            </p>
            <input
              value={scanPath}
              onChange={(event) => setScanPath(event.target.value)}
              placeholder="输入本机音乐目录路径，例如 E:\\Music"
              className="mt-2 w-full rounded-full border border-white/70 bg-white/70 px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
            />
          </div>
          <Button onClick={submitScanPath} disabled={scanState === "scanning"}>
            <RefreshCw className={cn(scanState === "scanning" && "animate-spin")} />
            {scanState === "scanning" ? "扫描中" : "扫描目录"}
          </Button>
        </div>
        {scanState === "error" && (
          <p className="mt-3 text-sm text-neutral-500">扫描失败，请确认路径存在且后端服务正在运行。</p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {lookupOpen && candidateTarget && (
          <LyricLookupPanel
            track={candidateTarget}
            boundCandidateId={boundCandidateId}
            onBind={setBoundCandidateId}
            onLyricsBound={onLyricsBound}
            onArtworkBound={onArtworkBound}
          />
        )}
      </AnimatePresence>

      <div className="mt-8 grid gap-3">
        {libraryTracks.map((track, index) => (
          <button
            key={track.id}
            className={cn(
              "grid grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-[1.5rem] bg-white/45 p-3 text-left transition hover:bg-white/75",
              activeTrackId === track.id && "bg-white shadow-sm",
            )}
            onClick={() => onPickTrack(track.id)}
          >
            <span className="text-center text-sm font-medium text-neutral-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <CoverArt track={track} className="size-14 rounded-2xl" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{track.title}</p>
              <p className="truncate text-sm text-neutral-500">
                {track.artist} · {track.album}
              </p>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Badge>{track.lyricStatus === "linked" ? "有歌词" : "待匹配"}</Badge>
              <Badge>{formatAudioDetail(track)}</Badge>
              <span className="w-12 text-right text-sm text-neutral-500">{track.duration}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LyricLookupCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] bg-white/52 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-700">{value}</p>
    </div>
  );
}

function LyricLookupPanel({
  track,
  boundCandidateId,
  onBind,
  onLyricsBound,
  onArtworkBound,
}: {
  track: Track;
  boundCandidateId: string | null;
  onBind: (id: string) => void;
  onLyricsBound: (trackId: string, lyrics: Track["lyrics"]) => void;
  onArtworkBound: (trackId: string, coverUrl?: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<LyricCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchLyrics() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      setCandidates(result.candidates);
    } catch {
      setCandidates([]);
      setError("歌词搜索失败，请确认后端服务正在运行");
    } finally {
      setLoading(false);
    }
  }

  async function bindLyric(candidateId: string) {
    onBind(candidateId);
    onArtworkBound(track.id, candidates.find((candidate) => candidate.id === candidateId)?.coverUrl);
    try {
      const result = await api.bindLyric(track.id, candidateId);
      onLyricsBound(track.id, result.lyrics);
    } catch {
      setError("后端保存失败，歌词绑定未写入本地索引");
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -10, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(10px)" }}
      transition={{ duration: 0.26 }}
      className="mt-5 rounded-[1.35rem] border border-white/70 bg-white/50 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
            Online Lyrics
          </p>
          <h2 className="mt-1 truncate text-xl font-semibold">{track.title}</h2>
          <p className="truncate text-sm text-neutral-500">
            {track.artist} · {track.album}
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={searchLyrics} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
          {loading ? "搜索中" : "重新搜索"}
        </Button>
      </div>
      {error && <p className="mt-3 text-xs text-neutral-500">{error}</p>}

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {candidates.map((candidate) => (
          <LyricCandidateCard
            key={candidate.id}
            candidate={candidate}
            selected={boundCandidateId === candidate.id}
            onBind={() => bindLyric(candidate.id)}
          />
        ))}
      </div>
      {!candidates.length && !loading && <EmptyState text="暂无歌词候选，点击重新搜索获取网易云结果。" />}
    </motion.section>
  );
}

function LyricCandidateCard({
  candidate,
  selected,
  onBind,
}: {
  candidate: LyricCandidate;
  selected: boolean;
  onBind: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-[1.15rem] bg-white/62 p-4 shadow-sm transition",
        selected && "bg-neutral-950 text-white",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge className={cn(selected && "border-white/20 bg-white/12 text-white")}>
            {candidate.source}
          </Badge>
          <h3 className="mt-3 truncate font-semibold">{candidate.title}</h3>
          <p className={cn("truncate text-xs", selected ? "text-white/64" : "text-neutral-500")}>
            {candidate.artist} · {candidate.album}
          </p>
        </div>
        <span className={cn("text-2xl font-semibold", selected ? "text-white" : "text-neutral-950")}>
          {candidate.score}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {candidate.preview.map((line) => (
          <p
            key={line}
            className={cn(
              "truncate text-sm",
              selected ? "text-white/72" : "text-neutral-600",
            )}
          >
            {line}
          </p>
        ))}
      </div>
      <Button
        className="mt-4 w-full"
        variant={selected ? "subtle" : "default"}
        size="sm"
        onClick={onBind}
      >
        <Languages />
        {selected ? "已绑定" : "绑定歌词"}
      </Button>
    </article>
  );
}

function CollectionSurface({
  title,
  subtitle,
  icon,
  tracks: collectionTracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-full bg-white shadow-sm">
          {icon}
        </div>
        <div>
          <p className="text-neutral-500">{subtitle}</p>
          <h1 className="text-4xl font-semibold sm:text-6xl">{title}</h1>
        </div>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {collectionTracks.map((track) => (
          <button
            key={track.id}
            className="group overflow-hidden rounded-[1.75rem] bg-white/54 p-3 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
            onClick={() => onPickTrack(track.id)}
          >
            <CoverArt track={track} className="aspect-square w-full rounded-[1.35rem]" />
            <div className="p-2">
              <p className="truncate font-semibold">{track.title}</p>
              <p className="truncate text-sm text-neutral-500">{track.artist}</p>
            </div>
          </button>
        ))}
      </div>
      {!collectionTracks.length && <EmptyState text="暂无同步数据，绑定有效 Cookie 后再刷新。" />}
    </div>
  );
}

function LikedSurface({
  localTracks,
  neteaseTracks,
  onPickTrack,
}: {
  localTracks: Track[];
  neteaseTracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Favorite</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">我喜欢</h1>
          <p className="mt-3 text-neutral-500">本地红心和网易云红心分开放，后面同步时不会混乱。</p>
        </div>
        <Button variant="glass">
          <Heart className="fill-current" />
          同步红心
        </Button>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <LikedColumn title="本地我喜欢" subtitle="来自本地音乐库" tracks={localTracks} onPickTrack={onPickTrack} />
        <LikedColumn title="网易云我喜欢" subtitle="Cookie 登录后读取" tracks={neteaseTracks} onPickTrack={onPickTrack} />
      </div>
    </div>
  );
}

function LikedColumn({
  title,
  subtitle,
  tracks: likedTracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  tracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <section className="rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <Badge>{likedTracks.length} 首</Badge>
      </div>
      <div className="mt-4 grid gap-2">
        {likedTracks.map((track) => (
          <button
            key={track.id}
            className="grid grid-cols-[3rem_minmax(0,1fr)_1.75rem] items-center gap-3 rounded-[1rem] p-2 text-left transition hover:bg-white/75"
            onClick={() => onPickTrack(track.id)}
          >
            <CoverArt track={track} className="size-12 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{track.title}</p>
              <p className="truncate text-xs text-neutral-500">{track.artist}</p>
            </div>
            <span className="flex size-7 items-center justify-center rounded-full bg-white/70">
              <Heart className="size-4 fill-neutral-950" />
            </span>
          </button>
        ))}
        {!likedTracks.length && <EmptyState text="暂无歌曲，先扫描本地目录或同步网易云。" />}
      </div>
    </section>
  );
}

function PlaylistSurface({
  playlists,
  selectedPlaylist,
  tracks,
  playCounts,
  loading,
  onOpenPlaylist,
  onClosePlaylist,
  onPickTrack,
}: {
  playlists: ProviderPlaylist[];
  selectedPlaylist: ProviderPlaylist | null;
  tracks: Track[];
  playCounts: Record<string, number>;
  loading: boolean;
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  onClosePlaylist: () => void;
  onPickTrack: (id: string) => void;
}) {
  const [sortMode, setSortMode] = useState<"added-desc" | "added-asc" | "title-asc" | "title-desc" | "plays-desc">("added-desc");
  const sortedTracks = useMemo(() => {
    const indexed = tracks.map((track, index) => ({ track, index }));
    switch (sortMode) {
      case "added-asc":
        return [...indexed].reverse().map((item) => item.track);
      case "title-asc":
        return [...indexed]
          .sort((left, right) => left.track.title.localeCompare(right.track.title, "zh-CN"))
          .map((item) => item.track);
      case "title-desc":
        return [...indexed]
          .sort((left, right) => right.track.title.localeCompare(left.track.title, "zh-CN"))
          .map((item) => item.track);
      case "plays-desc":
        return [...indexed]
          .sort((left, right) => {
            const byCount = (playCounts[right.track.id] ?? 0) - (playCounts[left.track.id] ?? 0);
            if (byCount !== 0) return byCount;
            return left.index - right.index;
          })
          .map((item) => item.track);
      default:
        return indexed.map((item) => item.track);
    }
  }, [playCounts, sortMode, tracks]);

  if (selectedPlaylist) {
    return (
      <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" onClick={onClosePlaylist}>
              <ChevronDown className="rotate-90" />
              返回歌单
            </Button>
            <h1 className="mt-4 truncate text-3xl font-semibold sm:text-5xl">{selectedPlaylist.name}</h1>
            <p className="mt-2 text-sm text-neutral-500">{tracks.length} 首 · 原始顺序来自歌单</p>
          </div>
          <Badge>{loading ? "读取中" : "Ready"}</Badge>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["added-desc", "添加倒序"],
            ["added-asc", "添加正序"],
            ["title-asc", "名字 A-Z"],
            ["title-desc", "名字 Z-A"],
            ["plays-desc", "听的次数"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition",
                sortMode === value ? "border-neutral-950 bg-neutral-950 text-white" : "border-white/70 bg-white/65 text-neutral-500",
              )}
              onClick={() => setSortMode(value as typeof sortMode)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-6 grid gap-2">
          {sortedTracks.map((track, index) => (
            <button
              key={track.id}
              className="grid grid-cols-[2rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.1rem] bg-white/52 p-3 text-left shadow-sm transition hover:bg-white"
              onClick={() => onPickTrack(track.id)}
            >
              <span className="text-center text-sm text-neutral-400">{index + 1}</span>
              <CoverArt track={track} className="size-14 rounded-2xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{track.title}</p>
                <p className="truncate text-sm text-neutral-500">{track.artist}</p>
              </div>
              <Badge>{formatAudioDetail(track)}</Badge>
            </button>
          ))}
          {!tracks.length && !loading && <EmptyState text="这个歌单暂时没有读取到曲目。" />}
        </div>
      </div>
    );
  }

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Badge>Playlist</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">歌单</h1>
        </div>
        <Button>
          <Plus />
          新建
        </Button>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className="min-h-48 overflow-hidden rounded-[1.75rem] bg-white/52 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
            onClick={() => onOpenPlaylist(playlist)}
          >
            {playlist.coverUrl ? (
              <img src={playlist.coverUrl} alt="" className="size-16 rounded-2xl object-cover shadow-sm" />
            ) : (
              <Cloud className="size-6 text-neutral-500" />
            )}
            <h2 className="mt-8 text-2xl font-semibold">{playlist.name}</h2>
            <p className="mt-2 text-sm text-neutral-500">{playlist.trackCount} 首</p>
            <Badge className="mt-5">{playlist.subscribed ? "收藏歌单" : "创建歌单"}</Badge>
          </button>
        ))}
      </div>
      {!playlists.length && <EmptyState text="暂无歌单数据，绑定有效网易云 Cookie 后同步。" />}
      {selectedPlaylist && (
        <section className="mt-6 rounded-[1.35rem] bg-white/52 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">Playlist Tracks</p>
              <h2 className="mt-1 truncate text-2xl font-semibold">{selectedPlaylist.name}</h2>
            </div>
            <Badge>{loading ? "读取中" : `${tracks.length} 首`}</Badge>
          </div>
          <div className="mt-4 grid gap-2">
            {tracks.map((track, index) => (
              <button
                key={track.id}
                className="grid grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] p-2 text-left transition hover:bg-white/75"
                onClick={() => onPickTrack(track.id)}
              >
                <span className="text-center text-sm text-neutral-400">{index + 1}</span>
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{track.title}</p>
                  <p className="truncate text-xs text-neutral-500">{track.artist}</p>
                </div>
                <Badge>{formatAudioDetail(track)}</Badge>
              </button>
            ))}
            {!tracks.length && !loading && <EmptyState text="这个歌单暂时没有读取到曲目。" />}
          </div>
        </section>
      )}
    </div>
  );
}

function CloudSurface() {
  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <Badge>Cloud</Badge>
      <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">音乐云盘</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {capabilities.map((item) => (
          <div key={item.title} className="rounded-[1.75rem] bg-white/54 p-5 shadow-sm">
            <h2 className="text-xl font-semibold">{item.title}</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">{item.desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button>
          <Cloud />
          上传
        </Button>
        <Button variant="glass">
          <ChevronDown />
          下载
        </Button>
      </div>
    </div>
  );
}

function StatsSurface({ tracks, playCounts }: { tracks: Track[]; playCounts: Record<string, number> }) {
  const mostPlayed = [...tracks]
    .sort((left, right) => (playCounts[right.id] ?? 0) - (playCounts[left.id] ?? 0))
    .slice(0, 3);

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <Badge>Stats</Badge>
      <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">听歌统计</h1>
      <div className="mt-10 grid gap-3">
        {[
          ["全部", String(tracks.length), tracks[0]?.title ?? "暂无歌曲"],
          ["本地", String(tracks.filter((track) => track.source === "local").length), tracks.find((track) => track.source === "local")?.title ?? "暂无歌曲"],
          ["网易云", String(tracks.filter((track) => track.source === "netease").length), tracks.find((track) => track.source === "netease")?.title ?? "暂无歌曲"],
        ].map(([label, count, top]) => (
          <div
            key={label}
            className="grid grid-cols-[5rem_1fr] gap-4 rounded-[1.75rem] bg-white/54 p-5 shadow-sm sm:grid-cols-[7rem_1fr_auto]"
          >
            <p className="font-semibold">{label}</p>
            <p className="text-neutral-500">{top}</p>
            <p className="text-3xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-[1.5rem] bg-white/54 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">播放次数</h2>
          <Badge>{mostPlayed.length} 首</Badge>
        </div>
        <div className="mt-4 grid gap-3">
          {mostPlayed.map((track, index) => (
            <div
              key={track.id}
              className="grid grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.15rem] bg-white/72 p-3"
            >
              <span className="text-center text-sm font-semibold text-neutral-400">{index + 1}</span>
              <CoverArt track={track} className="size-12 rounded-xl" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{track.title}</p>
                <p className="truncate text-xs text-neutral-500">{track.artist}</p>
              </div>
              <span className="text-sm font-medium text-neutral-500">{playCounts[track.id] ?? 0} 次</span>
            </div>
          ))}
          {!mostPlayed.length && <EmptyState text="先播放几首歌，统计就会开始累计。" />}
        </div>
      </div>
    </div>
  );
}

function FloatingNav({
  activeView,
  open,
  onOpenChange,
  onRequestClose,
  onPick,
}: {
  activeView: ViewId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: () => void;
  onPick: (id: ViewId) => void;
}) {
  const nodes = (["player", "daily", "radar", "cloud", "stats"] as ViewId[])
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  const nodePositions = [
    { x: 120, y: 24 },
    { x: 120, y: 78 },
    { x: 120, y: 132 },
    { x: 120, y: 186 },
    { x: 120, y: 240 },
  ];
  const center = { x: 42, y: 304 };

  return (
    <div
      className="absolute bottom-8 left-7 z-40 h-[340px] w-[188px]"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={onRequestClose}
    >
      <button
        className="absolute z-30 flex size-16 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_18px_50px_rgba(47,55,76,0.16)]"
        style={{ left: center.x - 32, top: center.y - 32 }}
        aria-label="副导航"
        onClick={() => onOpenChange(!open)}
      >
        <div
          className={cn(
            "grid size-7 grid-cols-2 gap-1 transition duration-200",
            open && "rotate-45 scale-[0.85]",
          )}
        >
          {[0, 1, 2, 3].map((dot) => (
            <span key={dot} className="rounded-full bg-neutral-950" />
          ))}
        </div>
      </button>

      <svg
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full overflow-visible transition duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      >
        {nodePositions.map((pos, index) => {
          const midX = center.x + (pos.x - center.x) * 0.48;
          const midY = center.y + (pos.y - center.y) * 0.58;
          const wave = index % 2 === 0 ? 10 : -10;
          const path = `M ${center.x} ${center.y} C ${midX - 8} ${midY + 10}, ${midX + wave} ${midY - 10}, ${pos.x} ${pos.y}`;

          return (
            <g key={`${pos.x}-${pos.y}`}>
              <path
                d={path}
                className="nav-wave-base"
                style={{ transitionDelay: open ? `${index * 35}ms` : "0ms" }}
              />
              <path
                d={path}
                className="nav-wave-flow"
                style={{ animationDelay: `${index * 120}ms` }}
              />
            </g>
          );
        })}
      </svg>

      <div className={cn("absolute inset-0", !open && "pointer-events-none")}>
        {nodes.map((item, index) => {
          const pos = nodePositions[index];
          const Icon = item.icon;
          const active = activeView === item.id;

          return (
            <div key={item.id} className="absolute">
              <button
                className={cn(
                  "group absolute flex size-14 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(47,55,76,0.13)] transition duration-200 hover:border-neutral-300 hover:bg-neutral-50",
                  open ? "scale-100 opacity-100" : "scale-50 opacity-0",
                  active && "!bg-neutral-950 !text-white hover:!bg-neutral-900",
                )}
                style={{
                  left: pos.x - 28,
                  top: pos.y - 28,
                  transitionDelay: open ? `${index * 35}ms` : "0ms",
                }}
                aria-label={item.label}
                onClick={() => onPick(item.id)}
              >
                <Icon className="size-5" />
                <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition group-hover:opacity-100">
                  {item.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsPanel({
  backgroundEnabled,
  onBackgroundEnabledChange,
  neteaseAccount,
  libraryMeta,
  trackCount,
  likedCount,
  lyricProgress,
  volume,
  onVolumeChange,
  audioOutputDevices,
  selectedSinkId,
  onSelectedSinkIdChange,
  hifiEnabled,
  onHifiEnabledChange,
  nativeAudioSupported,
  nativeAudioState,
  exclusiveMode,
  onExclusiveModeChange,
  onClose,
}: {
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (value: boolean) => void;
  neteaseAccount: NeteaseAccountSummary | null;
  libraryMeta: { roots: number; updatedAt: string | null };
  trackCount: number;
  likedCount: number;
  lyricProgress: number;
  volume: number;
  onVolumeChange: (value: number) => void;
  audioOutputDevices: Array<{ id: string; label: string }>;
  selectedSinkId: string;
  onSelectedSinkIdChange: (value: string) => void;
  hifiEnabled: boolean;
  onHifiEnabledChange: (value: boolean) => void;
  nativeAudioSupported: boolean;
  nativeAudioState: NativeAudioState | null;
  exclusiveMode: boolean;
  onExclusiveModeChange: (value: boolean) => void;
  onClose: () => void;
}) {
  const [apiState, setApiState] = useState<"checking" | "online" | "offline">("checking");
  const desktopReady = Boolean(window.ariaDesktop);
  const deviceSwitchSupported = audioOutputDevices.length > 0;
  const exclusiveReady = Boolean(exclusiveMode && nativeAudioSupported && nativeAudioState?.exclusive);

  function refreshApiState() {
    setApiState("checking");
    api
      .health()
      .then(() => setApiState("online"))
      .catch(() => setApiState("offline"));
  }

  useEffect(() => {
    let mounted = true;
    setApiState("checking");
    api
      .health()
      .then(() => {
        if (mounted) setApiState("online");
      })
      .catch(() => {
        if (mounted) setApiState("offline");
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <motion.div
      className="absolute inset-0 z-[70] flex justify-end bg-white/28 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        initial={{ x: 34, opacity: 0, filter: "blur(12px)" }}
        animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
        exit={{ x: 28, opacity: 0, filter: "blur(12px)" }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="m-3 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.7rem] border border-white/75 bg-white/78 shadow-[0_24px_80px_rgba(47,55,76,0.18)] backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-950/6 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Settings</p>
            <h2 className="mt-1 text-2xl font-semibold">Aria 设置</h2>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭设置" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Runtime</p>
                <h3 className="mt-1 text-base font-semibold">后台托管</h3>
              </div>
              <button
                className={cn(
                  "flex h-8 w-14 items-center rounded-full p-1 transition",
                  backgroundEnabled ? "bg-neutral-950" : "bg-neutral-200",
                )}
                onClick={() => onBackgroundEnabledChange(!backgroundEnabled)}
                aria-label="切换后台托管"
              >
                <span
                  className={cn(
                    "size-6 rounded-full bg-white shadow-sm transition",
                    backgroundEnabled && "translate-x-6",
                  )}
                />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={desktopReady ? "Desktop" : "Web"} label="模式" />
              <Metric value={apiState === "online" ? "Online" : apiState === "offline" ? "Offline" : "..."} label="后端" />
              <Metric value={backgroundEnabled ? "ON" : "OFF"} label="托管" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1"
                variant="subtle"
                size="sm"
                disabled={!desktopReady}
                onClick={() => window.ariaDesktop?.minimizeToTray?.()}
              >
                <Settings2 />
                托管到后台
              </Button>
              <Button
                className="flex-1"
                variant="ghost"
                size="sm"
                onClick={refreshApiState}
              >
                <RefreshCw />
                刷新状态
              </Button>
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Library</p>
                <h3 className="mt-1 text-base font-semibold">曲库状态</h3>
              </div>
              <Badge>{libraryMeta.roots} 个目录</Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
              <Metric value={String(trackCount)} label="曲目" />
              <Metric value={String(likedCount)} label="喜欢" />
              <Metric value={`${lyricProgress}%`} label="歌词" />
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-950/8">
              <div className="h-full rounded-full bg-neutral-950/65" style={{ width: `${lyricProgress}%` }} />
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Account</p>
                <h3 className="mt-1 truncate text-base font-semibold">{neteaseAccount?.nickname ?? "网易云未绑定"}</h3>
              </div>
              <Badge>{neteaseAccount?.connected ? "Ready" : "Cookie"}</Badge>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              {neteaseAccount?.avatarUrl ? (
                <img src={neteaseAccount.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-white shadow-sm">
                  <UserRound className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {neteaseAccount?.connected ? neteaseAccount.userId : "等待绑定 Cookie"}
                </p>
                <p className="mt-1 truncate text-xs text-neutral-500">{neteaseAccount?.cookiePreview ?? "右上角头像里绑定"}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-white/70 bg-white/62 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Audio</p>
                <h3 className="mt-1 text-base font-semibold">默认音量</h3>
              </div>
              <Badge>{volume}</Badge>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Volume2 className="size-4 shrink-0 text-neutral-500" />
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                className="aria-range w-full"
                style={
                  {
                    "--range-color": "#171717",
                    "--range-value": `${volume}%`,
                  } as CSSProperties
                }
              />
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Output</p>
                <Badge>{nativeAudioSupported ? "WASAPI" : deviceSwitchSupported ? "Device" : "Default"}</Badge>
              </div>
              <select
                value={selectedSinkId}
                disabled={!deviceSwitchSupported}
                onChange={(event) => onSelectedSinkIdChange(event.target.value)}
                className="w-full rounded-[0.95rem] border border-white/70 bg-white/80 px-3 py-2 text-sm outline-none disabled:opacity-50"
              >
                {audioOutputDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500">
                {nativeAudioSupported
                  ? "独占模式会使用这里选择的 WASAPI 输出设备。"
                  : deviceSwitchSupported
                    ? "切换到指定播放设备后会即时生效。"
                    : "当前环境不支持在应用内切换播放设备。"}
              </p>
            </div>
            <div className="mt-4 rounded-[1rem] bg-neutral-950/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">HiFi 优先</p>
                  <p className="mt-1 text-xs text-neutral-500">自动请求当前歌曲可用的最高音质。</p>
                </div>
                <button
                  className={cn(
                    "flex h-8 w-14 items-center rounded-full p-1 transition",
                    hifiEnabled ? "bg-neutral-950" : "bg-neutral-200",
                  )}
                  onClick={() => onHifiEnabledChange(!hifiEnabled)}
                  aria-label="切换 HiFi 优先"
                >
                  <span
                    className={cn(
                      "size-6 rounded-full bg-white shadow-sm transition",
                      hifiEnabled && "translate-x-6",
                    )}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">独占输出</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {nativeAudioSupported
                      ? exclusiveMode
                        ? exclusiveReady
                          ? "已进入原生 WASAPI Exclusive，当前仍允许软件音量调节。"
                          : "正在请求独占输出或设备拒绝独占，请检查设备属性里的独占权限。"
                        : "关闭时仍使用应用内标准播放链路。"
                      : "需要桌面版内置原生音频引擎，Web 预览里不会启用。"}
                  </p>
                </div>
                <Badge>{exclusiveReady ? "Locked" : exclusiveMode ? "Pending" : "Shared"}</Badge>
              </div>
              <div className="mt-2 text-[11px] leading-5 text-neutral-500">
                {exclusiveMode && nativeAudioSupported
                  ? "直通模式下播放由原生宿主完成，频谱和进度由分析器与宿主状态共同驱动。"
                  : "普通模式下也会继续使用原生宿主播放，只是不申请独占设备。"}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs text-neutral-500">
                    {nativeAudioState?.deviceId ? `当前设备: ${nativeAudioState.deviceId}` : "当前设备: --"}
                  </p>
                </div>
                <button
                  className={cn(
                    "flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-45",
                    exclusiveMode ? "bg-neutral-950" : "bg-neutral-200",
                  )}
                  disabled={!nativeAudioSupported}
                  onClick={() => onExclusiveModeChange(!exclusiveMode)}
                  aria-label="切换独占输出"
                >
                  <span
                    className={cn(
                      "size-6 rounded-full bg-white shadow-sm transition",
                      exclusiveMode && "translate-x-6",
                    )}
                  />
                </button>
              </div>
            </div>
          </section>
        </div>
      </motion.aside>
    </motion.div>
  );
}

function AccountPanel({
  onClose,
  onOpenSettings,
  onAccountChange,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  onAccountChange?: (account: NeteaseAccountSummary) => void;
}) {
  const [cookie, setCookie] = useState("");
  const [account, setAccount] = useState<NeteaseAccountSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((settings) => {
        if (mounted) {
          setAccount(settings.neteaseAccount);
          onAccountChange?.(settings.neteaseAccount);
        }
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function bindCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveNeteaseCookie(cookie.trim());
      setAccount(result.account);
      onAccountChange?.(result.account);
      setCookie("");
      setMessage("Cookie 已保存");
    } catch {
      setMessage("保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(12px)" }}
      transition={{ duration: 0.22 }}
      className="glass absolute right-0 top-14 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-[1.4rem] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="size-12 rounded-full object-cover shadow-sm" />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-950 text-white">
              <UserRound className="size-5" />
            </div>
          )}
          <div>
            <p className="font-semibold">{account?.nickname ?? "网易云账号"}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {account?.connected ? account.cookiePreview : "Cookie 未绑定"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mt-4 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
        <label className="text-xs font-medium text-neutral-500" htmlFor="cookie">
          网易云 Cookie
        </label>
        <textarea
          id="cookie"
          value={cookie}
          onChange={(event) => setCookie(event.target.value)}
          rows={4}
          placeholder="MUSIC_U=...; NMTID=..."
          className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            <Settings2 />
            设置
          </Button>
          <Button size="sm" onClick={bindCookie} disabled={saving}>
            <Cookie />
            {saving ? "保存中" : "绑定"}
          </Button>
        </div>
      </div>
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
        <Metric value={account?.connected ? "ON" : "--"} label="状态" />
        <Metric value={account?.userId ?? "--"} label="用户" />
        <Metric value={account?.connected ? "Ready" : "--"} label="同步" />
      </div>
    </motion.div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/62 px-2 py-3">
      <p className="text-base font-semibold text-neutral-950">{value}</p>
      <p className="mt-1">{label}</p>
    </div>
  );
}

function CoverArt({
  track,
  className,
  large = false,
  fit = "cover",
}: {
  track: Track;
  className?: string;
  large?: boolean;
  fit?: "cover" | "contain";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(track.coverUrl) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [track.id, track.coverUrl]);

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden bg-neutral-950", className)}
      style={{ background: track.cover }}
      aria-hidden="true"
    >
      {hasImage ? (
        <>
          {fit === "contain" && (
            <img
              key={`blur-${track.coverUrl}`}
              src={track.coverUrl}
              alt=""
              className="absolute inset-0 size-full scale-110 object-cover opacity-55 blur-2xl"
              onError={() => setImageFailed(true)}
            />
          )}
          <img
            key={track.coverUrl}
            src={track.coverUrl}
            alt=""
            className={cn("absolute inset-0 size-full", fit === "contain" ? "object-contain" : "object-cover")}
            onError={() => setImageFailed(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-white/8" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 opacity-95" style={{ background: track.cover }} />
          <div className="absolute inset-0 bg-gradient-to-br from-white/22 via-transparent to-black/32" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.12),transparent_42%,rgba(0,0,0,0.18))]" />
          {large && (
            <div className="absolute inset-x-7 bottom-7 z-10 text-white">
              <p className="line-clamp-3 text-3xl font-semibold leading-tight drop-shadow">{track.title}</p>
              <p className="mt-2 truncate text-sm font-medium text-white/74">{track.artist}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
