import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cookie,
  FolderOpen,
  Heart,
  Languages,
  ListMusic,
  Maximize2,
  Minus,
  Pause,
  Play,
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
import {
  CloudSurface,
  CollectionSurface,
  LikedSurface,
  PlaylistSurface,
  StatsSurface,
} from "@/components/music/CollectionSurfaces";
import { SpectrumCanvas } from "@/components/music/SpectrumCanvas";
import { ArtistAvatar, CoverArt, EmptyState, Metric, StatTile } from "@/components/music/shared";
import ariaIconUrl from "../build/icon.png";
import { navItems, type LyricCandidate, type Track, type ViewId } from "@/data/music";
import {
  api,
  type ApiScannedTrack,
  type NeteaseAccountSummary,
  type NeteaseQrStart,
  type ProviderArtist,
  type ProviderPlaylist,
  type ProviderTrack,
} from "@/lib/api";
import {
  colorWithAlpha,
  estimateBpmFromPeaks,
  extractDominantColors,
  formatAudioDetail,
  formatDuration,
  getActiveLyricIndex,
  mergeTracks,
  normalizeQuality,
  parseDuration,
  qualityOptions,
  readCachedAudioSettings,
  readCachedBpm,
  readCachedLyrics,
  readCachedPlayerState,
  splitArtistNames,
  trimTrackCache,
  writeCachedBpm,
  writeCachedAudioSettings,
  writeCachedLyrics,
  writeCachedPlayerState,
  type AudioOutputMode,
  type CoverPalette,
  type PlayerSideView,
  type QualityLevel,
} from "@/lib/playerPresentation";
import { materializeQueueIds, orderedQueueIds, playableTracks } from "@/lib/playQueue";
import { cn } from "@/lib/utils";

const sourceLabel: Record<Track["source"], string> = {
  local: "本地",
  cloud: "云盘",
  netease: "网易云",
};

type ArtistSummary = {
  id: string;
  name: string;
  source: "local" | "netease" | "mixed";
  avatarUrl?: string | null;
  trackCount: number;
  albumCount?: number | null;
  providerId?: string | null;
};
type SearchBundle = {
  localTracks: Track[];
  neteaseTracks: Track[];
  artists: ArtistSummary[];
};
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
const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

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

function providerArtistToUiArtist(artist: ProviderArtist): ArtistSummary {
  return {
    id: `${artist.source}:${artist.id}`,
    name: artist.name,
    source: artist.source === "netease" ? "netease" : "mixed",
    avatarUrl: artist.avatarUrl ? api.getNeteaseCoverUrl(artist.avatarUrl) : null,
    trackCount: artist.trackCount ?? 0,
    albumCount: artist.albumCount ?? null,
    providerId: artist.id,
  };
}

function mergeArtists(artistsToMerge: ArtistSummary[]) {
  const byName = new Map<string, ArtistSummary>();
  for (const artist of artistsToMerge) {
    const key = artist.name.toLowerCase();
    const current = byName.get(key);
    if (!current) {
      byName.set(key, artist);
      continue;
    }
    byName.set(key, {
      ...current,
      source: current.source === artist.source ? current.source : "mixed",
      avatarUrl: current.avatarUrl ?? artist.avatarUrl,
      trackCount: Math.max(current.trackCount, artist.trackCount),
      albumCount: Math.max(current.albumCount ?? 0, artist.albumCount ?? 0),
      providerId: current.providerId ?? artist.providerId,
    });
  }
  return [...byName.values()];
}

function getTrackSearchSignature(tracks: Track[]) {
  return tracks
    .map((track) => [track.id, track.title, track.artist, track.album, track.quality].join("\u0000"))
    .join("\u0001");
}

function createLocalArtistSummaries(tracks: Track[]) {
  const artists = new Map<string, ArtistSummary & { albums: Set<string> }>();
  for (const track of tracks) {
    for (const artistName of splitArtistNames(track.artist)) {
      const key = artistName.toLowerCase();
      const current =
        artists.get(key) ??
        ({
          id: `artist:${key}`,
          name: artistName,
          source: "local" as const,
          avatarUrl: null,
          trackCount: 0,
          albumCount: 0,
          providerId: null,
          albums: new Set<string>(),
        } satisfies ArtistSummary & { albums: Set<string> });
      current.trackCount += 1;
      current.albums.add(track.album);
      artists.set(key, current);
    }
  }
  return [...artists.values()].map(({ albums, ...artist }) => ({ ...artist, albumCount: albums.size }));
}

function artistSourceLabel(source: ArtistSummary["source"]) {
  if (source === "local") return "本地";
  if (source === "netease") return "网易云";
  return "混合";
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
  const [searchBundle, setSearchBundle] = useState<SearchBundle>({ localTracks: [], neteaseTracks: [], artists: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<ArtistSummary | null>(null);
  const [artistTracks, setArtistTracks] = useState<Track[]>([]);
  const [artistAvatarCache, setArtistAvatarCache] = useState<Record<string, string | null>>({});
  const [folderName, setFolderName] = useState("未选择");
  const [audioOutputDevices, setAudioOutputDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [nativeAudioSupported, setNativeAudioSupported] = useState(() => Boolean(window.ariaDesktop?.nativeAudio?.supported));
  const [nativeAudioState, setNativeAudioState] = useState<NativeAudioState | null>(null);
  const [selectedSinkId, setSelectedSinkId] = useState(() => readCachedAudioSettings().sinkId ?? "default");
  const [hifiEnabled, setHifiEnabled] = useState(() => readCachedAudioSettings().hifiEnabled ?? true);
  const [audioOutputMode, setAudioOutputMode] = useState<AudioOutputMode>(() => readCachedAudioSettings().outputMode ?? "system");
  const [nativePlaybackFailed, setNativePlaybackFailed] = useState(false);
  const [nativeAnalyserWakeToken, setNativeAnalyserWakeToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const nativeSilenceGainRef = useRef<GainNode | null>(null);
  const analyserOutputModeRef = useRef<"audible" | "silent" | null>(null);
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
  const artistRequestRef = useRef<Set<string>>(new Set());
  const artistAvatarLookupRef = useRef<Set<string>>(new Set());
  const artistAvatarCacheRef = useRef<Record<string, string | null>>({});
  const bpmSavedRef = useRef<Record<string, number>>({});
  const audioErrorRef = useRef({ count: 0, lastAt: 0 });
  const localTracksRef = useRef<Track[]>([]);
  const pendingSeekRef = useRef(initialPlayerCache.currentTime ?? 0);
  const lastPlayerCacheWriteRef = useRef(0);
  const nativeLoadedUrlRef = useRef<string | null>(null);
  const nativeAnalyserDelayUntilRef = useRef(0);
  const nativeLoadSequenceRef = useRef(0);
  const lastNativeRenderRef = useRef({ at: 0, position: initialPlayerCache.currentTime ?? 0 });
  const lastCurrentTimeRenderRef = useRef({ at: 0, time: initialPlayerCache.currentTime ?? 0 });
  const rendererDiagnosticRef = useRef<Record<string, unknown>>({});

  const neteaseConnected = Boolean(neteaseAccount?.connected);
  const nativePlaybackRequested = Boolean(nativeAudioSupported && audioOutputMode !== "system");
  const nativePlaybackEnabled = Boolean(nativePlaybackRequested && !nativePlaybackFailed);
  const exclusiveMode = audioOutputMode === "exclusive";
  const desktopExclusiveActive = Boolean(nativeAudioSupported && exclusiveMode);
  const exclusiveReady = Boolean(desktopExclusiveActive && nativeAudioState?.exclusive);
  const nativePlaybackVolume = volume;
  const localSearchSignature = useMemo(() => getTrackSearchSignature(localTracks), [localTracks]);
  const allTracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...roamTracks, ...playlistTracks]),
    [localTracks, neteaseTracks, roamTracks, playlistTracks],
  );
  const artistSummaries = useMemo(() => {
    const artists = new Map<string, ArtistSummary & { albums: Set<string>; sources: Set<Track["source"]> }>();
    for (const track of allTracks) {
      for (const artistName of splitArtistNames(track.artist)) {
        const key = artistName.toLowerCase();
        const current =
          artists.get(key) ??
          ({
            id: `artist:${key}`,
            name: artistName,
            source: track.source === "netease" ? "netease" : "local",
            avatarUrl: null,
            trackCount: 0,
            albumCount: 0,
            providerId: null,
            albums: new Set<string>(),
            sources: new Set<Track["source"]>(),
          } satisfies ArtistSummary & { albums: Set<string>; sources: Set<Track["source"]> });
        current.trackCount += 1;
        current.albums.add(track.album);
        current.sources.add(track.source);
        current.source = current.sources.size > 1 ? "mixed" : current.sources.has("netease") ? "netease" : "local";
        current.avatarUrl = current.avatarUrl ?? (track.source === "netease" ? track.coverUrl : null);
        artists.set(key, current);
      }
    }
    return [...artists.values()]
      .map(({ albums, sources, ...artist }) => ({ ...artist, albumCount: albums.size }))
      .sort((left, right) => right.trackCount - left.trackCount || left.name.localeCompare(right.name, "zh-CN"));
  }, [allTracks]);
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
  const audioElementStreamUrl = useMemo(() => {
    if (!activeTrack.streamUrl) return null;
    const url = new URL(api.resolveUrl(activeTrack.streamUrl), window.location.href);
    if (activeTrack.source === "netease") {
      url.searchParams.set("level", nativePlaybackEnabled ? "exhigh" : effectiveQualityLevel);
    }
    return url.href;
  }, [activeTrack, effectiveQualityLevel, nativePlaybackEnabled]);
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
      case "artists":
        return artistTracks;
      case "home":
        return visibleTracks;
      default:
        return [];
    }
  }, [activeView, artistTracks, dailyTracks, likedDisplayTracks, playlistTracks, roamTracks, visibleLocalTracks, visibleTracks]);
  const playQueueTracks = useMemo(() => {
    const byId = new Map(allTracks.map((track) => [track.id, track]));
    return playQueueIds
      .map((id) => byId.get(id))
      .filter((track): track is Track => Boolean(track?.streamUrl));
  }, [allTracks, playQueueIds]);
  useEffect(() => {
    rendererDiagnosticRef.current = {
      activeTrackId: activeTrack.id,
      activeTrackTitle: activeTrack.title,
      activeView,
      audioOutputMode,
      nativePlaybackEnabled,
      playing,
      queueLength: playQueueTracks.length,
      shuffleEnabled,
    };
  }, [activeTrack.id, activeTrack.title, activeView, audioOutputMode, nativePlaybackEnabled, playQueueTracks.length, playing, shuffleEnabled]);
  useEffect(() => {
    const log = window.ariaDesktop?.log;
    if (!log) return;

    const logError = (source: string, error: unknown, extra: Record<string, unknown> = {}) => {
      const maybeError = error instanceof Error ? error : null;
      log({
        level: "error",
        source,
        message: maybeError?.message ?? String(error),
        stack: maybeError?.stack,
        context: {
          ...rendererDiagnosticRef.current,
          ...extra,
        },
      }).catch(() => undefined);
    };

    const onError = (event: ErrorEvent) => {
      logError("window.error", event.error ?? event.message, {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logError("window.unhandledrejection", event.reason);
    };

    log({
      level: "info",
      source: "renderer.lifecycle",
      message: "renderer mounted",
      context: rendererDiagnosticRef.current,
    }).catch(() => undefined);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);
  const linkedLyricCount = useMemo(
    () => allTracks.filter((track) => track.lyricStatus === "linked").length,
    [allTracks],
  );
  const lyricProgress = useMemo(
    () => (allTracks.length ? Math.round((linkedLyricCount / allTracks.length) * 100) : 0),
    [allTracks.length, linkedLyricCount],
  );

  function commitCurrentTime(nextTime: number, force = false) {
    const safeTime = Math.max(0, Number(nextTime) || 0);
    const now = performance.now();
    const previous = lastCurrentTimeRenderRef.current;
    if (!force && Math.abs(safeTime - previous.time) < 0.3 && now - previous.at < 320) {
      return;
    }
    lastCurrentTimeRenderRef.current = { at: now, time: safeTime };
    setCurrentTime(safeTime);
  }

  function trimStringSet(ref: { current: Set<string> }, maxItems = 600) {
    if (ref.current.size <= maxItems) return;
    ref.current = new Set([...ref.current].slice(-Math.floor(maxItems * 0.72)));
  }

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
    if (neteaseWarmupRef.current.size > 1200) {
      neteaseWarmupRef.current = new Set([...neteaseWarmupRef.current].slice(-700));
    }
    api.warmNeteaseCache(ids, warmupLevel).catch(() => {
      warmupItems.forEach((item) => neteaseWarmupRef.current.delete(item.key));
    });
  }

  useEffect(() => {
    const sourceTracks = playQueueTracks.length ? playQueueTracks : visibleTracks;
    const tracksToWarm = sourceTracks.slice(0, playing ? 24 : 80);
    const timer = window.setTimeout(() => warmNeteaseTrackCache(tracksToWarm), playing ? 1600 : 260);
    return () => window.clearTimeout(timer);
  }, [hifiEnabled, playing, qualityLevel, playQueueTracks, visibleTracks]);

  useEffect(() => {
    localTracksRef.current = localTracks;
  }, [localTracks]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setSearchBundle({ localTracks: [], neteaseTracks: [], artists: [] });
      setSearchLoading(false);
      return;
    }

    const currentLocalTracks = localTracksRef.current;
    const localMatches = currentLocalTracks.filter((track) =>
      [track.title, track.artist, track.album, track.quality].join(" ").toLowerCase().includes(text.toLowerCase()),
    );
    const localArtists = createLocalArtistSummaries(currentLocalTracks)
      .filter((artist) => artist.name.toLowerCase().includes(text.toLowerCase()))
      .slice(0, 10);
    setSearchBundle((current) => ({
      localTracks: localMatches.slice(0, 24),
      neteaseTracks: current.neteaseTracks.filter((track) =>
        [track.title, track.artist, track.album].join(" ").toLowerCase().includes(text.toLowerCase()),
      ),
      artists: mergeArtists([
        ...localArtists,
        ...current.artists.filter(
          (artist) => artist.source !== "local" && artist.name.toLowerCase().includes(text.toLowerCase()),
        ),
      ]).slice(0, 18),
    }));
    setSearchLoading(true);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchLibraryAndStream(text, 24)
        .then((result) => {
          if (cancelled) return;
          const neteaseUiTracks = result.neteaseTracks.map((track, index) => providerTrackToUiTrack(track, index));
          const localUiTracks = result.localTracks.map(localTrackToUiTrack);
          const remoteArtists = result.artists.map(providerArtistToUiArtist);
          setNeteaseTracks((current) => trimTrackCache([...current, ...neteaseUiTracks]));
          setSearchBundle({
            localTracks: mergeTracks([...localMatches, ...localUiTracks]).slice(0, 28),
            neteaseTracks: neteaseUiTracks,
            artists: mergeArtists([...localArtists, ...remoteArtists]).slice(0, 18),
          });
        })
        .catch(() => {
          if (!cancelled) {
            setSearchBundle({
              localTracks: localMatches.slice(0, 28),
              neteaseTracks: [],
              artists: localArtists,
            });
          }
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 360);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [localSearchSignature, query]);

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
    if (!selectedArtist) {
      setArtistTracks([]);
      return;
    }

    const localArtistTracks = allTracks.filter((track) =>
      splitArtistNames(track.artist).some((artistName) => artistName.toLowerCase() === selectedArtist.name.toLowerCase()),
    );
    setArtistTracks(localArtistTracks);

    let cancelled = false;
    const providerId = selectedArtist.providerId;
    if (providerId) {
      const requestKey = `tracks:${providerId}`;
      if (!artistRequestRef.current.has(requestKey)) {
        artistRequestRef.current.add(requestKey);
        trimStringSet(artistRequestRef, 360);
        api
          .getNeteaseArtistTracks(providerId)
          .then((result) => {
            if (cancelled) return;
            const remoteTracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
            setNeteaseTracks((current) => trimTrackCache([...current, ...remoteTracks]));
            setArtistTracks(mergeTracks([...localArtistTracks, ...remoteTracks]));
          })
          .catch(() => {
            artistRequestRef.current.delete(requestKey);
          });
      }
    } else if (!selectedArtist.avatarUrl && !artistAvatarCacheRef.current[selectedArtist.name.toLowerCase()]) {
      const requestKey = `lookup:${selectedArtist.name.toLowerCase()}`;
      if (!artistRequestRef.current.has(requestKey)) {
        artistRequestRef.current.add(requestKey);
        trimStringSet(artistRequestRef, 360);
        api
          .lookupArtist(selectedArtist.name)
          .then((result) => {
            if (cancelled || !result.artist) return;
            const remoteArtist = providerArtistToUiArtist(result.artist);
            setArtistAvatarCache((current) => ({
              ...current,
              [selectedArtist.name.toLowerCase()]: remoteArtist.avatarUrl ?? null,
            }));
            setSelectedArtist((current) =>
              current?.name === selectedArtist.name
                ? { ...current, ...remoteArtist, source: current.source === "local" ? "mixed" : current.source }
                : current,
            );
          })
          .catch(() => {
            artistRequestRef.current.delete(requestKey);
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [allTracks, selectedArtist]);

  useEffect(() => {
    const candidates = artistSummaries
      .filter((artist) => {
        const key = artist.name.toLowerCase();
        return !artist.avatarUrl && !(key in artistAvatarCacheRef.current) && !artistAvatarLookupRef.current.has(key);
      })
      .slice(0, 6);
    if (!candidates.length) return;

    let cancelled = false;
    candidates.forEach((artist) => artistAvatarLookupRef.current.add(artist.name.toLowerCase()));
    trimStringSet(artistAvatarLookupRef, 520);
    Promise.allSettled(
      candidates.map(async (artist) => {
        const result = await api.lookupArtist(artist.name);
        const remoteArtist = result.artist ? providerArtistToUiArtist(result.artist) : null;
        return [artist.name.toLowerCase(), remoteArtist?.avatarUrl ?? null] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const entries = results.map((result, index) =>
        result.status === "fulfilled" ? result.value : ([candidates[index].name.toLowerCase(), null] as const),
      );
      setArtistAvatarCache((current) => {
        const next = { ...current };
        for (const [key, avatarUrl] of entries) {
          next[key] = avatarUrl;
        }
        return Object.fromEntries(Object.entries(next).slice(-260));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [artistSummaries]);

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
    artistAvatarCacheRef.current = artistAvatarCache;
  }, [artistAvatarCache]);

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
    return () => {
      if (visualizerFrameRef.current) {
        window.cancelAnimationFrame(visualizerFrameRef.current);
        visualizerFrameRef.current = null;
      }
      try {
        audioSourceRef.current?.disconnect();
      } catch {
        // Ignore audio graph shutdown errors.
      }
      try {
        analyserRef.current?.disconnect();
      } catch {
        // Ignore audio graph shutdown errors.
      }
      try {
        nativeSilenceGainRef.current?.disconnect();
      } catch {
        // Ignore audio graph shutdown errors.
      }
      audioSourceRef.current = null;
      analyserRef.current = null;
      nativeSilenceGainRef.current = null;
      analyserOutputModeRef.current = null;
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeTrack.id === idleTrack.id || activeTrack.id !== activeTrackId) return;

    const now = Date.now();
    if (now - lastPlayerCacheWriteRef.current < 900) return;
    lastPlayerCacheWriteRef.current = now;

    writeCachedPlayerState({
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
    });
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
    writeCachedAudioSettings({
      sinkId: selectedSinkId,
      hifiEnabled,
      exclusiveMode,
      outputMode: audioOutputMode,
    });
  }, [audioOutputMode, exclusiveMode, hifiEnabled, selectedSinkId]);

  useEffect(() => {
    setNativePlaybackFailed(false);
    nativeLoadedUrlRef.current = null;
    if (!nativePlaybackRequested) {
      nativeAnalyserDelayUntilRef.current = 0;
      setNativeAnalyserWakeToken((value) => value + 1);
      return;
    }

    nativeAnalyserDelayUntilRef.current = performance.now() + 520;
    const timer = window.setTimeout(() => {
      setNativeAnalyserWakeToken((value) => value + 1);
    }, 560);
    return () => window.clearTimeout(timer);
  }, [activeTrack.id, activeStreamUrl, audioOutputMode, nativePlaybackRequested, selectedSinkId]);

  useEffect(() => {
    if (!audioOutputDevices.length) return;
    if (audioOutputDevices.some((device) => device.id === selectedSinkId)) return;
    setSelectedSinkId("default");
  }, [audioOutputDevices, selectedSinkId]);

  const syncNativeAudioState = useEffectEvent((state: NativeAudioState) => {
    const now = performance.now();
    const previousNativeRender = lastNativeRenderRef.current;
    const shouldRenderNativeState =
      state.kind !== "progress" ||
      now - previousNativeRender.at > 500 ||
      Math.abs((state.position ?? 0) - previousNativeRender.position) > 0.8;
    if (shouldRenderNativeState) {
      lastNativeRenderRef.current = { at: now, position: state.position ?? previousNativeRender.position };
      setNativeAudioState(state);
    }
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
        commitCurrentTime(state.position, state.kind === "loaded" || state.kind === "seek" || state.kind === "ended");
      }
      if (state.kind === "pause" && typeof state.paused === "boolean") {
        setPlaying(!state.paused);
      }
    }
    if (state.kind === "ended" && currentTrackMatches && nativePlaybackEnabled) {
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
    const nativeAnalyserBridgeReady = Boolean(nativePlaybackEnabled && audioSourceRef.current && nativeSilenceGainRef.current);
    const nativeAnalyserReady =
      !nativePlaybackEnabled ||
      Boolean(
        nativeAudioState?.trackId === activeTrack.id &&
          nativeAudioState.active &&
          performance.now() >= nativeAnalyserDelayUntilRef.current,
      );
    audio.muted = nativePlaybackEnabled && !nativeAnalyserBridgeReady;
    audio.volume = nativePlaybackEnabled ? (nativeAnalyserBridgeReady ? 1 : 0) : Math.max(0, Math.min(1, nativePlaybackVolume / 100));
    audio.preload = nativePlaybackEnabled ? (nativeAnalyserReady ? "metadata" : "none") : hifiEnabled ? "auto" : "metadata";

    if (!audioElementStreamUrl || !nativeAnalyserReady) {
      audio.pause();
      if (nativePlaybackEnabled && audio.src) {
        audio.removeAttribute("src");
        audio.load();
      }
      return;
    }

    const nextSrc = new URL(audioElementStreamUrl, window.location.href).href;
    if (audio.src !== nextSrc) {
      audio.pause();
      if (audio.src) {
        audio.removeAttribute("src");
        audio.load();
      }
      audio.src = nextSrc;
      audio.load();
      setDurationSeconds(0);
    }

    if (playing) {
      audio.play().catch(() => {
        if (!nativePlaybackEnabled) setPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [
    audioElementStreamUrl,
    activeTrack.id,
    hifiEnabled,
    nativeAudioState?.active,
    nativeAudioState?.trackId,
    nativeAnalyserWakeToken,
    nativePlaybackEnabled,
    nativePlaybackVolume,
    playing,
  ]);

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
    if (nativeLoadedUrlRef.current === nextUrl) return;

    let cancelled = false;
    const loadSequence = nativeLoadSequenceRef.current + 1;
    nativeLoadSequenceRef.current = loadSequence;
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
        if (cancelled || nativeLoadSequenceRef.current !== loadSequence) return;
        if (state) syncNativeAudioState(state as NativeAudioState);
      })
      .catch(() => {
        if (cancelled || nativeLoadSequenceRef.current !== loadSequence) return;
        nativeLoadedUrlRef.current = null;
        setNativePlaybackFailed(true);
      });
    return () => {
      cancelled = true;
    };
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
    if (!playing || !audioElementStreamUrl || !pageVisible) {
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
      try {
        audioSourceRef.current = context.createMediaElementSource(audio);
      } catch {
        return;
      }
      analyserRef.current = context.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.58;
      analyserRef.current.minDecibels = -92;
      analyserRef.current.maxDecibels = -10;
      audioSourceRef.current.connect(analyserRef.current);
    }

    context.resume();
    const analyser = analyserRef.current;
    if (!analyser) return;

    const desiredOutputMode = nativePlaybackEnabled ? "silent" : "audible";
    if (analyserOutputModeRef.current !== desiredOutputMode) {
      try {
        analyser.disconnect();
      } catch {
        // Ignore graph cleanup errors; reconnect below.
      }
      try {
        nativeSilenceGainRef.current?.disconnect();
      } catch {
        // The silent sink may already be disconnected.
      }

      if (nativePlaybackEnabled) {
        const silentGain = nativeSilenceGainRef.current ?? context.createGain();
        silentGain.gain.value = 0;
        nativeSilenceGainRef.current = silentGain;
        analyser.connect(silentGain);
        silentGain.connect(context.destination);
      } else {
        analyser.connect(context.destination);
      }
      analyserOutputModeRef.current = desiredOutputMode;
    }
    if (nativePlaybackEnabled) {
      audio.muted = false;
      audio.volume = 1;
    }

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(frequencyData);
      let lowEnergy = 0;
      const lowBandEnd = Math.min(18, frequencyData.length);
      for (let index = 1; index < lowBandEnd; index += 1) {
        lowEnergy += frequencyData[index] ?? 0;
      }
      lowEnergy /= Math.max(1, lowBandEnd - 1);
      const baseline = bpmEnergyRef.current ? bpmEnergyRef.current * 0.95 + lowEnergy * 0.05 : lowEnergy;
      const now = performance.now();
      bpmEnergyRef.current = baseline;

      if (!bpmLockedRef.current && lowEnergy > baseline * 1.18 && lowEnergy > 24) {
        const peaks = bpmPeaksRef.current;
        if (!peaks.length || now - peaks[peaks.length - 1] > 250) {
          bpmPeaksRef.current = [...peaks, now].slice(-36);
        }
      }

      if (!bpmLockedRef.current && now - lastBpmStateRef.current > 1800 && bpmPeaksRef.current.length >= 5) {
        const bpm = estimateBpmFromPeaks(bpmPeaksRef.current);
        if (bpm) {
          setDetectedBpm(bpm);
          const nextSamples = [...bpmSamplesRef.current, bpm].slice(-4);
          bpmSamplesRef.current = nextSamples;
          const spread = Math.max(...nextSamples) - Math.min(...nextSamples);
          if (nextSamples.length >= 2 && spread <= 8) {
            const stableBpm = Math.round(nextSamples.reduce((sum, value) => sum + value, 0) / nextSamples.length);
            bpmLockedRef.current = true;
            setDetectedBpm(stableBpm);
            applyBpmToTrack(activeTrack.id, stableBpm);
          }
          lastBpmStateRef.current = now;
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
  }, [audioElementStreamUrl, activeTrack.id, nativePlaybackEnabled, pageVisible, playing]);

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
    setPlayQueueIds(materializeQueueIds(nextUiTracks, nextUiTracks[0]?.id ?? activeTrack.id, shuffleEnabled));
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

  function pickRelativeTrack(direction: 1 | -1) {
    const fallbackQueue = playQueueTracks.length ? playQueueTracks : playbackTracks.length ? playbackTracks : visibleTracks;
    const shouldRefreshShuffleQueue =
      shuffleEnabled && (!playQueueTracks.length || !playQueueTracks.some((track) => track.id === activeTrack.id));
    const nextQueueIds = shouldRefreshShuffleQueue
      ? materializeQueueIds(fallbackQueue, activeTrack.id, true)
      : orderedQueueIds(playQueueTracks.length ? playQueueTracks : fallbackQueue);
    const byId = new Map([...playQueueTracks, ...fallbackQueue].map((track) => [track.id, track]));
    const queue = nextQueueIds.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));
    if (!queue.length) return;
    if (shouldRefreshShuffleQueue) setPlayQueueIds(nextQueueIds);
    pendingSeekRef.current = 0;
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
    const currentQueue = playableTracks(contextualQueueTracks);
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
    ].map(playableTracks);
    return candidateQueues.find((tracks) => tracks.some((track) => track.id === trackId)) ?? currentQueue;
  }

  function chooseTrack(trackId: string) {
    const queue = resolveQueueForTrack(trackId);
    const playableIds = materializeQueueIds(queue, trackId, shuffleEnabled);
    if (playableIds.length) setPlayQueueIds(playableIds);
    pendingSeekRef.current = 0;
    setActiveTrackId(trackId);
    setCurrentTime(0);
    setPlaying(true);
  }

  function toggleShuffleQueue() {
    const nextShuffleEnabled = !shuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);
    const queue = resolveQueueForTrack(activeTrack.id);
    const playableIds = materializeQueueIds(queue.length ? queue : playQueueTracks, activeTrack.id, nextShuffleEnabled);
    if (playableIds.length) setPlayQueueIds(playableIds);
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
          commitCurrentTime(event.currentTarget.currentTime || 0);
        }}
        onLoadedMetadata={(event) => {
          audioErrorRef.current = { count: 0, lastAt: 0 };
          const duration = event.currentTarget.duration || 0;
          if (!nativePlaybackEnabled) setDurationSeconds(duration);
          if (pendingSeekRef.current > 0) {
            const nextTime = Math.min(pendingSeekRef.current, Math.max(0, duration - 1));
            event.currentTarget.currentTime = nextTime;
            if (!nativePlaybackEnabled) commitCurrentTime(nextTime, true);
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
              onClick={() => {
                setQuery("");
                setActiveView("home");
              }}
            >
              <img src={ariaIconUrl} alt="" className="size-10 shrink-0 rounded-2xl object-cover" />
              <p className="truncate text-3xl font-semibold">Aria</p>
            </button>
          </div>

          <nav
            className="hidden rounded-full border border-white/70 bg-white/45 p-1 shadow-sm backdrop-blur-xl xl:flex"
            style={noDragRegionStyle}
          >
            {navItems.slice(0, 6).map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;

              return (
                <button
                  key={item.id}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-neutral-500 transition hover:text-neutral-950",
                    active && "bg-white text-neutral-950 shadow-sm",
                  )}
                  onClick={() => {
                    setQuery("");
                    setActiveView(item.id);
                  }}
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
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
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
            "grid min-h-0 flex-1 gap-4 p-4 2xl:gap-5 2xl:p-5",
            activeView === "player"
              ? "xl:grid-cols-[minmax(0,1fr)_minmax(380px,18vw)]"
              : "xl:grid-cols-[minmax(0,1fr)_minmax(340px,18vw)]",
          )}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={query.trim() ? "search" : activeView}
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-0 min-w-0"
            >
              {query.trim() ? (
                <SearchSurface
                  query={query.trim()}
                  loading={searchLoading}
                  localTracks={searchBundle.localTracks}
                  neteaseTracks={searchBundle.neteaseTracks}
                  artists={searchBundle.artists}
                  artistAvatarCache={artistAvatarCache}
                  onPickTrack={(id) => {
                    chooseTrack(id);
                    setQuery("");
                  }}
                  onPickArtist={(artist) => {
                    setSelectedArtist(artist);
                    setActiveView("artists");
                    setQuery("");
                  }}
                />
              ) : (
                <>
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
                  onToggleShuffle={toggleShuffleQueue}
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
                  visualizerMode={nativePlaybackEnabled ? audioOutputMode : "system"}
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
              {activeView === "artists" && (
                <ArtistsSurface
                  artists={artistSummaries}
                  selectedArtist={selectedArtist}
                  tracks={artistTracks}
                  artistAvatarCache={artistAvatarCache}
                  onPickArtist={(artist) => setSelectedArtist(artist)}
                  onBack={() => setSelectedArtist(null)}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "cloud" && <CloudSurface />}
              {activeView === "stats" && <StatsSurface tracks={allTracks} playCounts={playCounts} />}
                </>
              )}
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
              audioOutputMode={audioOutputMode}
              onAudioOutputModeChange={setAudioOutputMode}
              exclusiveMode={exclusiveMode}
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
            setQuery("");
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

function SearchSurface({
  query,
  loading,
  localTracks,
  neteaseTracks,
  artists,
  artistAvatarCache,
  onPickTrack,
  onPickArtist,
}: {
  query: string;
  loading: boolean;
  localTracks: Track[];
  neteaseTracks: Track[];
  artists: ArtistSummary[];
  artistAvatarCache: Record<string, string | null>;
  onPickTrack: (id: string) => void;
  onPickArtist: (artist: ArtistSummary) => void;
}) {
  const tracks = useMemo(() => mergeTracks([...localTracks, ...neteaseTracks]).slice(0, 36), [localTracks, neteaseTracks]);

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
      <section className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Badge>{loading ? "搜索中" : "Search"}</Badge>
            <h1 className="mt-3 truncate text-3xl font-semibold">搜索：{query}</h1>
            <p className="mt-2 text-sm text-neutral-500">本地音乐和网易云结果会合并显示，点击歌曲直接播放。</p>
          </div>
          <Search className="size-6 shrink-0 text-neutral-400" />
        </div>
        <div className="no-scrollbar mt-5 grid max-h-[calc(100%-6.5rem)] gap-2 overflow-y-auto pr-1">
          {tracks.map((track) => (
            <button
              key={track.id}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.2rem] bg-white/50 p-3 text-left shadow-sm transition hover:bg-white"
              onClick={() => onPickTrack(track.id)}
            >
              <CoverArt track={track} className="size-14 rounded-2xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{track.title}</p>
                <p className="truncate text-sm text-neutral-500">{track.artist}</p>
                <p className="mt-1 truncate text-xs text-neutral-400">{track.album}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge>{sourceLabel[track.source]}</Badge>
                <span className="text-xs text-neutral-500">{formatAudioDetail(track)}</span>
              </div>
            </button>
          ))}
          {!tracks.length && <EmptyState text={loading ? "正在搜索曲库和网易云。" : "没有找到相关歌曲。"} />}
        </div>
      </section>

      <section className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">Artists</p>
            <h2 className="mt-1 text-2xl font-semibold">歌手</h2>
          </div>
          <Badge>{artists.length}</Badge>
        </div>
        <div className="no-scrollbar mt-5 grid max-h-[calc(100%-5rem)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {artists.map((artist) => (
            <ArtistCard
              key={artist.id}
              artist={artist}
              avatarUrl={artist.avatarUrl ?? artistAvatarCache[artist.name.toLowerCase()] ?? null}
              onPick={onPickArtist}
            />
          ))}
          {!artists.length && <EmptyState text={loading ? "正在查找歌手头像和资料。" : "没有找到相关歌手。"} />}
        </div>
      </section>
    </div>
  );
}

function ArtistsSurface({
  artists,
  selectedArtist,
  tracks,
  artistAvatarCache,
  onPickArtist,
  onBack,
  onPickTrack,
}: {
  artists: ArtistSummary[];
  selectedArtist: ArtistSummary | null;
  tracks: Track[];
  artistAvatarCache: Record<string, string | null>;
  onPickArtist: (artist: ArtistSummary) => void;
  onBack: () => void;
  onPickTrack: (id: string) => void;
}) {
  const featuredArtists = artists.slice(0, 80);

  if (selectedArtist) {
    const avatarUrl = selectedArtist.avatarUrl ?? artistAvatarCache[selectedArtist.name.toLowerCase()] ?? null;
    return (
      <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(420px,0.82fr)_minmax(0,1.18fr)]">
        <section className="glass relative min-h-0 overflow-hidden rounded-[1.5rem] p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-white/30 to-neutral-200/45" />
          <div className="relative z-10 flex h-full min-h-0 flex-col">
            <button
              className="w-fit rounded-full bg-white/70 px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-white"
              onClick={onBack}
            >
              返回歌手墙
            </button>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8 text-center">
              <ArtistAvatar
                name={selectedArtist.name}
                avatarUrl={avatarUrl}
                className="size-64 rounded-[2.4rem] 2xl:size-80"
              />
              <Badge className="mt-7">{artistSourceLabel(selectedArtist.source)}</Badge>
              <h1 className="mt-4 max-w-[26rem] break-words text-4xl font-semibold leading-tight 2xl:text-5xl">{selectedArtist.name}</h1>
              <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-3">
                <Metric value={String(tracks.length || selectedArtist.trackCount || 0)} label="曲目" />
                <Metric value={String(selectedArtist.albumCount ?? 0)} label="专辑" />
              </div>
            </div>
          </div>
        </section>
        <section className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">Tracks</p>
              <h2 className="mt-1 text-2xl font-semibold">歌曲</h2>
            </div>
            <Badge>{tracks.length}</Badge>
          </div>
          <div className="no-scrollbar mt-5 grid max-h-[calc(100%-5rem)] gap-2 overflow-y-auto pr-1">
            {tracks.map((track) => (
              <button
                key={track.id}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.2rem] bg-white/50 p-3 text-left shadow-sm transition hover:bg-white"
                onClick={() => onPickTrack(track.id)}
              >
                <CoverArt track={track} className="size-14 rounded-2xl" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{track.title}</p>
                  <p className="truncate text-sm text-neutral-500">{track.album}</p>
                </div>
                <Badge>{formatAudioDetail(track)}</Badge>
              </button>
            ))}
            {!tracks.length && <EmptyState text="正在整理这个歌手的歌曲。" />}
          </div>
        </section>
      </div>
    );
  }

  return (
    <section className="glass h-full min-h-0 overflow-hidden rounded-[1.5rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Badge>Artists</Badge>
          <h1 className="mt-3 text-3xl font-semibold">歌手</h1>
          <p className="mt-2 text-sm text-neutral-500">本地与网易云曲库合并统计，头像会从线上轻量补全。</p>
        </div>
        <UserRound className="size-7 text-neutral-400" />
      </div>
      <div className="no-scrollbar mt-5 grid max-h-[calc(100%-6.5rem)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {featuredArtists.map((artist) => (
          <ArtistCard
            key={artist.id}
            artist={artist}
            avatarUrl={artist.avatarUrl ?? artistAvatarCache[artist.name.toLowerCase()] ?? null}
            onPick={onPickArtist}
          />
        ))}
        {!featuredArtists.length && <EmptyState text="导入音乐或同步网易云后会生成歌手页。" />}
      </div>
    </section>
  );
}

function ArtistCard({
  artist,
  avatarUrl,
  onPick,
}: {
  artist: ArtistSummary;
  avatarUrl: string | null;
  onPick: (artist: ArtistSummary) => void;
}) {
  return (
    <button
      className="group grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-[1.25rem] bg-white/55 p-3 text-left shadow-sm transition hover:bg-white"
      onClick={() => onPick({ ...artist, avatarUrl: artist.avatarUrl ?? avatarUrl })}
    >
      <ArtistAvatar name={artist.name} avatarUrl={avatarUrl} className="size-16 rounded-2xl" />
      <div className="min-w-0">
        <p className="truncate font-semibold group-hover:text-neutral-700">{artist.name}</p>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {artistSourceLabel(artist.source)} · {artist.trackCount || 0} 首
        </p>
        <p className="mt-1 truncate text-xs text-neutral-400">{artist.albumCount ?? 0} 张专辑</p>
      </div>
    </button>
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
  visualizerMode,
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
  visualizerMode: AudioOutputMode;
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
      className="relative h-full min-h-[620px] overflow-hidden rounded-[1.5rem] border border-white/55 shadow-[0_22px_70px_rgba(47,55,76,0.12)] 2xl:min-h-[calc(100vh-7.5rem)]"
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
      <div className="relative grid h-full min-h-[620px] lg:grid-cols-[minmax(360px,0.9fr)_minmax(460px,1.1fr)] 2xl:grid-cols-[minmax(520px,0.95fr)_minmax(680px,1.05fr)]">
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
            <CoverArt track={activeTrack} className="size-full" fit="cover" large />
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
          className="flex min-h-0 flex-col justify-between p-5 sm:p-8 2xl:p-10"
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
                outputMode={visualizerMode}
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

            <div className="mt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 rounded-full bg-white/78 p-2 shadow-[0_14px_42px_rgba(47,55,76,0.12)]">
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
                <div className="flex min-w-0 items-center gap-3 rounded-full bg-white/78 px-4 py-3 shadow-[0_14px_42px_rgba(47,55,76,0.1)]">
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
  const nodes = (["player", "artists", "daily", "radar", "stats"] as ViewId[])
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
  audioOutputMode,
  onAudioOutputModeChange,
  exclusiveMode,
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
  audioOutputMode: AudioOutputMode;
  onAudioOutputModeChange: (value: AudioOutputMode) => void;
  exclusiveMode: boolean;
  onClose: () => void;
}) {
  const [apiState, setApiState] = useState<"checking" | "online" | "offline">("checking");
  const desktopReady = Boolean(window.ariaDesktop);
  const deviceSwitchSupported = audioOutputDevices.length > 0;
  const exclusiveReady = Boolean(exclusiveMode && nativeAudioSupported && nativeAudioState?.exclusive);
  const outputModeLabel =
    audioOutputMode === "exclusive" ? "WASAPI Exclusive" : audioOutputMode === "shared" ? "WASAPI Shared" : "System";

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
            <div className="mt-4 rounded-[1.15rem] border border-white/70 bg-white/54 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Output</p>
                  <p className="mt-1 text-sm font-semibold">音频输出链路</p>
                </div>
                <Badge>{exclusiveReady ? "Locked" : outputModeLabel}</Badge>
              </div>
              <div className="mt-3 grid gap-2">
                {[
                  {
                    mode: "system" as const,
                    label: "系统音频",
                    badge: "兼容",
                    desc: "HTMLAudio 输出，频谱直接跟随播放器。",
                    Icon: Volume2,
                  },
                  {
                    mode: "shared" as const,
                    label: "WASAPI 共享",
                    badge: "HiFi",
                    desc: "后端 mpv 播放，不独占设备。",
                    Icon: Radio,
                  },
                  {
                    mode: "exclusive" as const,
                    label: "WASAPI 独占",
                    badge: exclusiveReady ? "Locked" : "直通",
                    desc: "独占端点，适合 DAC 或声卡直连。",
                    Icon: Sparkles,
                  },
                ].map(({ mode, label, badge, desc, Icon }) => {
                  const disabled = mode !== "system" && !nativeAudioSupported;
                  const active = audioOutputMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      className={cn(
                        "grid grid-cols-[2.4rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_34px_rgba(23,23,23,0.16)]"
                          : "border-white/72 bg-white/72 text-neutral-950 hover:bg-white",
                      )}
                      onClick={() => onAudioOutputModeChange(mode)}
                    >
                      <span
                        className={cn(
                          "flex size-10 items-center justify-center rounded-full",
                          active ? "bg-white/14 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{label}</span>
                        <span className={cn("mt-0.5 block truncate text-xs", active ? "text-white/62" : "text-neutral-500")}>
                          {desc}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          active ? "bg-white text-neutral-950" : "bg-white/80 text-neutral-500 shadow-sm",
                        )}
                      >
                        {badge}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="no-scrollbar mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                {audioOutputDevices.map((device) => {
                  const active = selectedSinkId === device.id;
                  return (
                    <button
                      key={device.id}
                      type="button"
                      disabled={!deviceSwitchSupported}
                      onClick={() => onSelectedSinkIdChange(device.id)}
                      className={cn(
                        "grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[0.95rem] border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_12px_30px_rgba(23,23,23,0.12)]"
                          : "border-white/70 bg-white/70 hover:bg-white",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full",
                          active ? "bg-white/15 text-white" : "bg-neutral-950/[0.045] text-neutral-500",
                        )}
                      >
                        <Volume2 className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{device.label}</span>
                        <span className={cn("mt-0.5 block truncate text-xs", active ? "text-white/60" : "text-neutral-400")}>
                          {device.id === "default" ? "跟随系统默认输出" : device.id}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          active ? "bg-white text-neutral-950" : "bg-white/80 text-neutral-500 shadow-sm",
                        )}
                      >
                        {active ? "当前" : "选择"}
                      </span>
                    </button>
                  );
                })}
                {!audioOutputDevices.length && (
                  <div className="rounded-[0.95rem] bg-white/65 px-3 py-4 text-sm text-neutral-500">没有检测到可用输出设备。</div>
                )}
              </div>
              <p className="mt-2 truncate text-xs text-neutral-500">
                {nativeAudioState?.deviceId ? `当前设备: ${nativeAudioState.deviceId}` : "当前设备: 默认输出"}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-[1rem] bg-neutral-950/[0.03] p-3">
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
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-950/6 px-5 py-3 text-xs text-neutral-400">
          <span>Aria Desktop</span>
          <span>v{__APP_VERSION__}</span>
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
  const [qrLogin, setQrLogin] = useState<NeteaseQrStart | null>(null);
  const [qrStatus, setQrStatus] = useState("点击生成二维码后，用网易云音乐扫码登录。");
  const [showCookie, setShowCookie] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
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

  useEffect(() => {
    if (!qrLogin || account?.connected) return;

    let cancelled = false;
    const check = async () => {
      try {
        const result = await api.checkNeteaseQrLogin(qrLogin.key);
        if (cancelled) return;

        if (result.status === "success" && result.account) {
          setAccount(result.account);
          onAccountChange?.(result.account);
          setQrLogin(null);
          setQrStatus("登录成功，账号信息已同步。");
          setMessage("网易云账号已登录");
          return;
        }

        if (result.status === "expired") {
          setQrStatus("二维码已过期，请重新生成。");
          return;
        }

        setQrStatus(result.status === "scanned" ? "已扫码，请在手机上确认登录。" : "等待扫码确认。");
      } catch {
        if (!cancelled) setQrStatus("扫码状态获取失败，稍后会自动重试。");
      }
    };

    check();
    const timer = window.setInterval(check, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [account?.connected, onAccountChange, qrLogin]);

  async function startQrLogin() {
    setQrLoading(true);
    setMessage(null);
    try {
      const result = await api.startNeteaseQrLogin();
      setQrLogin(result);
      setQrStatus("请用网易云音乐 App 扫码。");
    } catch {
      setMessage("二维码生成失败，请确认后端正在运行。");
    } finally {
      setQrLoading(false);
    }
  }

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
      className="glass absolute right-0 top-14 z-50 w-[min(25rem,calc(100vw-2rem))] rounded-[1.4rem] p-4"
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
              {account?.connected ? "已登录并同步 Cookie" : "扫码登录更适合日常使用"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mt-4 rounded-[1.2rem] border border-white/70 bg-white/64 p-3 shadow-sm">
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1rem] bg-white shadow-inner">
            {qrLogin?.qrImage ? (
              <img src={qrLogin.qrImage} alt="网易云扫码登录二维码" className="size-full object-contain p-2" />
            ) : account?.avatarUrl ? (
              <img src={account.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              <UserRound className="size-9 text-neutral-300" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{account?.connected ? "账号已同步" : "扫码登录"}</p>
            <p className="mt-1 min-h-10 text-xs leading-relaxed text-neutral-500">{qrStatus}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={startQrLogin} disabled={qrLoading}>
                <RefreshCw />
                {qrLoading ? "生成中" : qrLogin ? "刷新二维码" : "生成二维码"}
              </Button>
              <Button variant="ghost" size="sm" onClick={onOpenSettings}>
                <Settings2 />
                设置
              </Button>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="mt-3 flex w-full items-center justify-between rounded-[1rem] bg-white/50 px-3 py-2 text-left text-sm font-medium shadow-sm transition hover:bg-white/72"
        onClick={() => setShowCookie((value) => !value)}
      >
        <span className="flex items-center gap-2">
          <Cookie className="size-4" />
          Cookie 备用绑定
        </span>
        <span className="text-xs text-neutral-400">{showCookie ? "收起" : "展开"}</span>
      </button>

      {showCookie && (
        <div className="mt-3 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
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
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={bindCookie} disabled={saving}>
              <Cookie />
              {saving ? "保存中" : "绑定 Cookie"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
        <Metric value={account?.connected ? "ON" : "--"} label="状态" />
        <Metric value={account?.userId ?? "--"} label="用户" />
        <Metric value={account?.connected ? "Ready" : "--"} label="同步" />
      </div>
    </motion.div>
  );
}
