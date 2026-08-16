import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListMusic, Maximize2, Minus, Radio, Search, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CloudSurface,
  CollectionSurface,
  LikedSurface,
  PlaylistSurface,
  StatsSurface,
} from "@/components/music/CollectionSurfaces";
import { LibrarySurface as LibrarySurfacePanel } from "@/components/music/LibrarySurface";
import { HomeSurface } from "@/components/music/HomeSurfaces";
import { SearchSurface, ArtistsSurface } from "@/components/music/DiscoverySurfaces";
import { PlayerSidePanel, QueueList } from "@/components/music/PlayerSidePanels";
import { ImmersivePlayerView, PlayerSurface } from "@/components/music/PlayerViews";
import { FloatingNav } from "@/components/music/FloatingNav";
import { AccountPanel, SettingsPanel } from "@/components/music/SettingsPanels";
import ariaIconUrl from "../build/icon.png";
import { navItems, type Track, type ViewId } from "@/data/music";
import {
  createLocalArtistSummaries,
  mergeArtists,
  providerArtistToUiArtist,
  type ArtistSummary,
} from "@/lib/artists";
import type { NativeAudioState } from "@/lib/audioTypes";
import { createArtworkOverrideDataUrl, readCachedArtworkOverride, writeCachedArtworkOverride } from "@/lib/artworkOverrides";
import { memoryLimits, trimRecordCache, trimStringSet, warmupBatchLimits } from "@/lib/memoryCache";
import {
  createPlayerCacheSnapshot,
  readPlayHistory,
  writePlayHistory,
  type PlayHistoryEntry,
} from "@/lib/playHistory";
import {
  api,
  type ApiScannedTrack,
  type NeteaseAccountSummary,
  type ProviderPlaylist,
  type ProviderTrack,
} from "@/lib/api";
import {
  extractDominantColors,
  formatDuration,
  mergeTracks,
  normalizeQuality,
  readCachedAudioSettings,
  readCachedLyrics,
  readCachedPlayerState,
  splitArtistNames,
  trimTrackCache,
  writeCachedAudioSettings,
  writeCachedLyrics,
  writeCachedPlayerState,
  type AudioOutputMode,
  type CoverPalette,
  type PlayerSideView,
  type QualityLevel,
} from "@/lib/playerPresentation";
import { materializeQueueIds, orderedQueueIds, playableTracks } from "@/lib/playQueue";
import { configureSpectrumAnalyser } from "@/lib/spectrumEngine";
import { sourceLabel } from "@/lib/trackLabels";
import { cn } from "@/lib/utils";
type SearchBundle = {
  localTracks: Track[];
  neteaseTracks: Track[];
  artists: ArtistSummary[];
};
const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

const panelVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
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

function getTrackSearchSignature(tracks: Track[]) {
  return tracks
    .map((track) => [track.id, track.title, track.artist, track.album, track.quality].join("\u0000"))
    .join("\u0001");
}

function isLikedPlaylist(playlist: ProviderPlaylist | null | undefined, index?: number) {
  if (!playlist) return false;
  return index === 0 || /喜欢|我喜欢|liked|favorite/i.test(playlist.name);
}

export default function App() {
  const [initialPlayerCache] = useState(readCachedPlayerState);
  const [cachedActiveTrackSnapshot] = useState(() => initialPlayerCache.activeTrackSnapshot);
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [activeTrackId, setActiveTrackId] = useState(
    initialPlayerCache.activeTrackId ?? cachedActiveTrackSnapshot?.id ?? idleTrack.id,
  );
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(initialPlayerCache.volume ?? 72);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(initialPlayerCache.shuffleEnabled ?? false);
  const [repeatMode, setRepeatMode] = useState<"all" | "one">(initialPlayerCache.repeatMode ?? "all");
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>(readPlayHistory);
  const [likedTrackIds, setLikedTrackIds] = useState<Record<string, true>>({});
  const [neteaseLikedIds, setNeteaseLikedIds] = useState<Record<string, true>>({});
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
  const [roamRefreshing, setRoamRefreshing] = useState(false);
  const [providerPlaylists, setProviderPlaylists] = useState<ProviderPlaylist[]>([]);
  const [libraryMeta, setLibraryMeta] = useState({ roots: 0, updatedAt: null as string | null });
  const [navOpen, setNavOpen] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === "visible");
  const [backgroundEnabled, setBackgroundEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("aria-background-enabled") === "true";
    } catch {
      return false;
    }
  });
  const [globalArrowKeysEnabled, setGlobalArrowKeysEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("aria-global-arrow-keys") !== "false";
    } catch {
      return true;
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
  const countedTrackRef = useRef<string | null>(null);
  const navCloseTimer = useRef<number | null>(null);
  const lyricSyncingRef = useRef<Set<string>>(new Set());
  const artworkSyncingRef = useRef<Set<string>>(new Set());
  const localCoverWarmupRef = useRef<Set<string>>(new Set());
  const immersiveFullscreenRef = useRef(false);
  const neteaseWarmupRef = useRef<Set<string>>(new Set());
  const artistRequestRef = useRef<Set<string>>(new Set());
  const artistAvatarLookupRef = useRef<Set<string>>(new Set());
  const artistAvatarCacheRef = useRef<Record<string, string | null>>({});
  const audioErrorRef = useRef({ count: 0, lastAt: 0 });
  const localTracksRef = useRef<Track[]>([]);
  const pendingSeekRef = useRef(0);
  const lastPlayerCacheWriteRef = useRef(0);
  const nativeLoadedUrlRef = useRef<string | null>(null);
  const nativeAnalyserDelayUntilRef = useRef(0);
  const nativeLoadSequenceRef = useRef(0);
  const lastNativeRenderRef = useRef({ at: 0, position: 0 });
  const lastCurrentTimeRenderRef = useRef({ at: 0, time: 0 });
  const rendererDiagnosticRef = useRef<Record<string, unknown>>({});

  const neteaseConnected = Boolean(neteaseAccount?.connected);
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
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
  }, [allTracks]);
  const requestedActiveTrack = allTracks.find((track) => track.id === activeTrackId);
  const activeTrack =
    requestedActiveTrack ??
    (cachedActiveTrackSnapshot?.id === activeTrackId ? cachedActiveTrackSnapshot : null) ??
    (activeTrackId === idleTrack.id ? allTracks[0] ?? idleTrack : idleTrack);
  const nativePlaybackRequested = Boolean(
    nativeAudioSupported && (audioOutputMode !== "system" || activeTrack.requiresNativePlayback),
  );
  const nativePlaybackEnabled = Boolean(nativePlaybackRequested && !nativePlaybackFailed);
  const visualizerPlaying = nativePlaybackEnabled
    ? Boolean(playing || (nativeAudioState?.active && !nativeAudioState.paused))
    : playing;
  const effectiveQualityLevel = useMemo(() => {
    if (!hifiEnabled || activeTrack.source !== "netease") return qualityLevel;
    const levels = activeTrack.availableLevels ?? [];
    return levels.at(-1) ?? qualityLevel;
  }, [activeTrack.availableLevels, activeTrack.source, hifiEnabled, qualityLevel]);
  const activeStreamUrl = useMemo(() => {
    if (!activeTrack.streamUrl) return null;
    const resolvedUrl = api.resolveUrl(activeTrack.streamUrl);
    if (activeTrack.source !== "netease") return resolvedUrl;

    const url = new URL(resolvedUrl, window.location.href);
    url.searchParams.set("level", effectiveQualityLevel);
    return url.href;
  }, [activeTrack, effectiveQualityLevel]);
  const audioElementStreamUrl = useMemo(() => {
    if (!activeTrack.streamUrl || activeTrack.requiresNativePlayback) return null;
    const resolvedUrl = api.resolveUrl(activeTrack.streamUrl);
    if (activeTrack.source !== "netease") return resolvedUrl;

    const url = new URL(resolvedUrl, window.location.href);
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
      case "history":
        return playHistory.map((entry) => entry.track);
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
  }, [activeView, artistTracks, dailyTracks, likedDisplayTracks, playHistory, playlistTracks, roamTracks, visibleLocalTracks, visibleTracks]);
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

  const handlePlaybackCommand = useEffectEvent((command: "toggle" | "previous" | "next") => {
    if (command === "toggle") {
      togglePlayback();
      return;
    }
    if (command === "previous") {
      pickRelativeTrack(-1);
      return;
    }
    pickRelativeTrack(1);
  });

  useEffect(() => {
    return window.ariaDesktop?.onPlaybackCommand?.(handlePlaybackCommand);
  }, [handlePlaybackCommand]);

  useEffect(() => {
    const updateTaskbarPlayback = window.ariaDesktop?.updateTaskbarPlayback;
    if (!updateTaskbarPlayback) return;

    updateTaskbarPlayback({
      title: activeTrack.id === idleTrack.id ? "" : activeTrack.title,
      artist: activeTrack.id === idleTrack.id ? "" : activeTrack.artist,
      playing,
    }).catch(() => undefined);
  }, [activeTrack.artist, activeTrack.id, activeTrack.title, playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (activeTrack.id === idleTrack.id) {
      session.metadata = null;
      return;
    }
    session.metadata = new MediaMetadata({
      title: activeTrack.title,
      artist: activeTrack.artist,
      album: activeTrack.album,
      artwork: activeTrack.coverUrl ? [{ src: activeTrack.coverUrl, sizes: "512x512" }] : [],
    });
    session.setActionHandler("play", () => setPlaying(true));
    session.setActionHandler("pause", () => setPlaying(false));
    session.setActionHandler("previoustrack", () => pickRelativeTrack(-1));
    session.setActionHandler("nexttrack", () => pickRelativeTrack(1));
  }, [activeTrack.album, activeTrack.artist, activeTrack.coverUrl, activeTrack.id, activeTrack.title]);

  async function openImmersiveView() {
    setImmersiveOpen(true);
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    try {
      await document.documentElement.requestFullscreen();
      immersiveFullscreenRef.current = true;
    } catch {
      immersiveFullscreenRef.current = false;
    }
  }

  async function closeImmersiveView() {
    setImmersiveOpen(false);
    if (!immersiveFullscreenRef.current || !document.fullscreenElement || !document.exitFullscreen) return;
    immersiveFullscreenRef.current = false;
    try {
      await document.exitFullscreen();
    } catch {
      // Fullscreen exit can reject when the OS already handled it.
    }
  }

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && immersiveFullscreenRef.current) {
        immersiveFullscreenRef.current = false;
        setImmersiveOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      if (!element) return false;
      return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === " " || event.code === "Space" || event.key === "MediaPlayPause") {
        event.preventDefault();
        handlePlaybackCommand("toggle");
        return;
      }
      if (event.key === "MediaTrackNext" || (event.altKey && event.key === "ArrowRight") || (globalArrowKeysEnabled && event.key === "ArrowRight")) {
        event.preventDefault();
        handlePlaybackCommand("next");
        return;
      }
      if (event.key === "MediaTrackPrevious" || (event.altKey && event.key === "ArrowLeft") || (globalArrowKeysEnabled && event.key === "ArrowLeft")) {
        event.preventDefault();
        handlePlaybackCommand("previous");
        return;
      }
      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (immersiveOpen) {
          void closeImmersiveView();
        } else {
          void openImmersiveView();
        }
        return;
      }
      if (event.key === "Escape") {
        void closeImmersiveView();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [globalArrowKeysEnabled, handlePlaybackCommand, immersiveOpen]);

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

  async function refreshRoamData() {
    if (roamRefreshing) return;
    setRoamRefreshing(true);
    try {
      const currentSignature = trackIdSignature(roamTracks);
      let excludeIds = providerIdsForTracks(roamTracks);
      let nextRoamTracks: Track[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const roam = await api.getProviderRoam("netease", 30, { refresh: true, excludeIds });
        const candidateTracks = mergeTracks(
          roam.tracks.map((track, index) => providerTrackToUiTrack(track, index + dailyTracks.length + attempt * 30)),
        );
        if (!candidateTracks.length) continue;

        nextRoamTracks = candidateTracks;
        if (trackIdSignature(candidateTracks) !== currentSignature) break;
        excludeIds = [...new Set([...excludeIds, ...providerIdsForTracks(candidateTracks)])];
      }

      if (!nextRoamTracks.length) return;
      setRoamTracks(nextRoamTracks);
      setNeteaseTracks((current) => mergeTracks([...current, ...nextRoamTracks]));
      warmNeteaseTrackCache(nextRoamTracks);

      if (activeView === "radar") {
        const queueTracks =
          activeTrack.id !== idleTrack.id && !nextRoamTracks.some((track) => track.id === activeTrack.id)
            ? [activeTrack, ...nextRoamTracks]
            : nextRoamTracks;
        const playableIds = materializeQueueIds(queueTracks, activeTrack.id, shuffleEnabled);
        if (playableIds.length) setPlayQueueIds(playableIds);
      }
    } finally {
      setRoamRefreshing(false);
    }
  }

  function providerIdsForTracks(tracksToRead: Track[]) {
    return tracksToRead
      .map((track) => track.providerId ?? (track.id.startsWith("netease:") ? track.id.slice("netease:".length) : null))
      .filter((id): id is string => Boolean(id));
  }

  function trackIdSignature(tracksToRead: Track[]) {
    return tracksToRead.map((track) => track.id).join("|");
  }

  function warmNeteaseTrackCache(tracksToWarm: Track[]) {
    const warmupLevel = hifiEnabled ? "jymaster" : qualityLevel;
    const warmupItems = tracksToWarm
      .filter((track) => track.source === "netease" && track.providerId)
      .map((track) => ({ id: track.providerId as string, key: `${warmupLevel}:${track.providerId}` }))
      .filter((item) => !neteaseWarmupRef.current.has(item.key))
      .slice(0, warmupBatchLimits.neteaseTracks);
    const ids = warmupItems.map((item) => item.id);
    if (!ids.length) return;
    warmupItems.forEach((item) => neteaseWarmupRef.current.add(item.key));
    trimStringSet(neteaseWarmupRef, memoryLimits.neteaseWarmup);
    api.warmNeteaseCache(ids, warmupLevel).catch(() => {
      warmupItems.forEach((item) => neteaseWarmupRef.current.delete(item.key));
    });

    const metadataItems = warmupItems.slice(
      0,
      playing ? warmupBatchLimits.neteaseMetadataPlaying : warmupBatchLimits.neteaseMetadataIdle,
    );
    void Promise.allSettled(
      metadataItems.map((item) =>
        api
          .getNeteaseStreamMeta(item.id, warmupLevel)
          .then((meta) => applyStreamMetaToTrack(`netease:${item.id}`, meta)),
      ),
    );
  }

  function warmLocalCoverCache(tracksToWarm: Track[]) {
    preloadTrackCovers(tracksToWarm);
    const ids = tracksToWarm
      .filter((track) => track.source === "local" && track.coverUrl && !track.coverUrl.startsWith("data:"))
      .map((track) => track.id)
      .filter((id) => {
        if (localCoverWarmupRef.current.has(id)) return false;
        localCoverWarmupRef.current.add(id);
        return true;
      })
      .slice(0, warmupBatchLimits.localCovers);
    if (!ids.length) return;
    trimStringSet(localCoverWarmupRef, memoryLimits.localCoverWarmup);
    api.warmLocalCovers(ids).catch(() => {
      ids.forEach((id) => localCoverWarmupRef.current.delete(id));
    });
  }

  function preloadTrackCovers(tracksToWarm: Track[], limit = warmupBatchLimits.preloadedImages) {
    tracksToWarm
      .map((track) => track.coverUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, limit)
      .forEach((url) => {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
      });
  }

  useEffect(() => {
    const sourceTracks = playQueueTracks.length ? playQueueTracks : visibleTracks;
    const tracksToWarm = sourceTracks.slice(0, playing ? 12 : 36);
    const timer = window.setTimeout(() => warmNeteaseTrackCache(tracksToWarm), playing ? 1600 : 260);
    return () => window.clearTimeout(timer);
  }, [hifiEnabled, playing, qualityLevel, playQueueTracks, visibleTracks]);

  useEffect(() => {
    trimStringSet(neteaseWarmupRef, memoryLimits.neteaseWarmup);
    trimStringSet(artistRequestRef, memoryLimits.artistRequest);
    trimStringSet(artistAvatarLookupRef, memoryLimits.artistAvatarLookup);
    trimStringSet(localCoverWarmupRef, memoryLimits.localCoverWarmup);
  }, [activeView]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      trimStringSet(neteaseWarmupRef, memoryLimits.neteaseWarmup);
      trimStringSet(artistRequestRef, memoryLimits.artistRequest);
      trimStringSet(artistAvatarLookupRef, memoryLimits.artistAvatarLookup);
      trimStringSet(localCoverWarmupRef, memoryLimits.localCoverWarmup);
      setArtistAvatarCache((current) => trimRecordCache(current, memoryLimits.artistAvatarCache));
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const tracksToWarm = [activeTrack, ...playQueueTracks.slice(0, 12), ...visibleTracks.slice(0, 24)];
    const timer = window.setTimeout(() => warmLocalCoverCache(tracksToWarm), playing ? 700 : 120);
    return () => window.clearTimeout(timer);
  }, [activeTrack, playQueueTracks, playing, visibleTracks]);

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
        const uiTracks = library.tracks.map(localTrackToUiTrack);
        setLocalTracks(uiTracks);
        warmLocalCoverCache(uiTracks);
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
        trimStringSet(artistRequestRef, memoryLimits.artistRequest);
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
        trimStringSet(artistRequestRef, memoryLimits.artistRequest);
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
    trimStringSet(artistAvatarLookupRef, memoryLimits.artistAvatarLookup);
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
        return trimRecordCache(next, memoryLimits.artistAvatarCache);
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
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("aria-play-counts", JSON.stringify(playCounts));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [playCounts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writePlayHistory(playHistory);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [playHistory]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("aria-liked-track-ids", JSON.stringify(likedTrackIds));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [likedTrackIds]);

  useEffect(() => {
    const trimmedCache = trimRecordCache(artistAvatarCache, memoryLimits.artistAvatarCache);
    artistAvatarCacheRef.current = trimmedCache;
    if (trimmedCache !== artistAvatarCache) {
      setArtistAvatarCache(trimmedCache);
    }
  }, [artistAvatarCache]);

  useEffect(() => {
    window.localStorage.setItem("aria-background-enabled", String(backgroundEnabled));
    window.ariaDesktop?.setBackgroundEnabled?.(backgroundEnabled);
  }, [backgroundEnabled]);

  useEffect(() => {
    window.localStorage.setItem("aria-global-arrow-keys", String(globalArrowKeysEnabled));
    window.ariaDesktop?.setGlobalArrowKeys?.(globalArrowKeysEnabled);
  }, [globalArrowKeysEnabled]);

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
      activeTrackSnapshot: createPlayerCacheSnapshot(activeTrack),
      playerSideView,
      playQueueIds,
      volume,
      qualityLevel,
      shuffleEnabled,
      repeatMode,
      playing: false,
      updatedAt: now,
    });
  }, [activeTrack, activeTrack.id, activeTrackId, playQueueIds, playerSideView, qualityLevel, repeatMode, shuffleEnabled, volume]);

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

    nativeAnalyserDelayUntilRef.current = performance.now() + 220;
    const timer = window.setTimeout(() => {
      setNativeAnalyserWakeToken((value) => value + 1);
    }, 260);
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
    audio.preload = nativePlaybackEnabled ? (nativeAnalyserReady ? "auto" : "none") : hifiEnabled ? "auto" : "metadata";

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

    const nextUrl = activeStreamUrl;
    const nextLoadKey = [
      nextUrl,
      activeTrack.nativeDevice ?? "",
      activeTrack.nativeStart ?? "",
      activeTrack.nativeEnd ?? "",
      activeTrack.cdReadQuality ?? "high",
    ].join("\u0000");
    if (nativeLoadedUrlRef.current === nextLoadKey) return;

    let cancelled = false;
    const loadSequence = nativeLoadSequenceRef.current + 1;
    nativeLoadSequenceRef.current = loadSequence;
    nativeLoadedUrlRef.current = nextLoadKey;
    nativeAudio
      .load?.({
        trackId: activeTrack.id,
        url: nextUrl,
        position: pendingSeekRef.current || 0,
        paused: !playing,
        volume: nativePlaybackVolume,
        exclusive: exclusiveMode,
        deviceId: selectedSinkId,
        nativeDevice: activeTrack.nativeDevice ?? null,
        startChapter: activeTrack.nativeStart ?? null,
        endChapter: activeTrack.nativeEnd ?? null,
        cdReadQuality: activeTrack.cdReadQuality ?? "high",
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
    activeTrack.cdReadQuality,
    activeTrack.nativeEnd,
    activeTrack.nativeDevice,
    activeTrack.nativeStart,
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
    if (!playing) return;
    if (activeTrack.id === idleTrack.id) return;
    if (activeTrack.id !== activeTrackId) return;
    if (countedTrackRef.current === activeTrack.id) return;

    countedTrackRef.current = activeTrack.id;
    setPlayCounts((current) => ({
      ...current,
      [activeTrack.id]: (current[activeTrack.id] ?? 0) + 1,
    }));
    setPlayHistory((current) => {
      const existing = current.find((entry) => entry.track.id === activeTrack.id);
      const nextEntry = {
        track: createPlayerCacheSnapshot(activeTrack),
        playedAt: Date.now(),
        count: (existing?.count ?? 0) + 1,
      };
      return [nextEntry, ...current.filter((entry) => entry.track.id !== activeTrack.id)].slice(0, 200);
    });
  }, [activeTrack.id, activeTrackId, playing]);

  useEffect(() => {
    if (!playing || !audioElementStreamUrl || !pageVisible) {
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
      configureSpectrumAnalyser(analyserRef.current);
      audioSourceRef.current.connect(analyserRef.current);
    }

    void context.resume();
    const analyser = analyserRef.current;
    if (!analyser) return;
    configureSpectrumAnalyser(analyser);

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
    warmLocalCoverCache(nextUiTracks);
    setPlayQueueIds(materializeQueueIds(nextUiTracks, nextUiTracks[0]?.id ?? activeTrack.id, shuffleEnabled));
    setLibraryMeta({
      roots: result.library?.roots.length ?? 1,
      updatedAt: result.library?.updatedAt ?? new Date().toISOString(),
    });
    if (nextTracks[0]) setActiveTrackId(nextTracks[0].id);
    setActiveView("local");
  }

  async function scanCdLibrary(qualityMode: "high" | "low") {
    const result = await api.scanCdDrives(true, qualityMode);
    const scannedCdTracks = result.tracks.map(localTrackToUiTrack);
    if (!result.library && !scannedCdTracks.length) {
      setFolderName("未检测到音频光盘");
      setActiveView("local");
      return;
    }
    const nextUiTracks = result.library?.tracks
      ? result.library.tracks.map(localTrackToUiTrack)
      : mergeTracks([...localTracks, ...scannedCdTracks]);
    const queue = scannedCdTracks.length ? scannedCdTracks : nextUiTracks;

    pendingSeekRef.current = 0;
    setLocalTracks(nextUiTracks);
    warmLocalCoverCache(nextUiTracks);
    if (queue.length) {
      setPlayQueueIds(materializeQueueIds(queue, queue[0].id, shuffleEnabled));
    }
    setLibraryMeta({
      roots: result.library?.roots.length ?? result.drives.length,
      updatedAt: result.library?.updatedAt ?? new Date().toISOString(),
    });
    setFolderName(scannedCdTracks.length ? "光盘库" : folderName);
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

  function togglePlayback() {
    if (activeStreamUrl && activeTrack.id !== idleTrack.id) {
      setPlaying((value) => !value);
      return;
    }

    const fallbackTrack = playableTracks(playQueueTracks)[0] ?? playableTracks(contextualQueueTracks)[0] ?? playbackTracks[0];
    if (fallbackTrack) chooseTrack(fallbackTrack.id);
  }

  function resolveQueueForTrack(trackId: string, preferredQueue?: Track[]) {
    const preferredTracks = preferredQueue ? playableTracks(preferredQueue) : [];
    if (preferredTracks.some((track) => track.id === trackId)) return preferredTracks;

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

  function chooseTrack(trackId: string, preferredQueue?: Track[]) {
    const queue = resolveQueueForTrack(trackId, preferredQueue);
    const targetTrack =
      queue.find((track) => track.id === trackId) ??
      allTracks.find((track) => track.id === trackId) ??
      (cachedActiveTrackSnapshot?.id === trackId ? cachedActiveTrackSnapshot : null);
    if (!targetTrack?.streamUrl) return;

    const playableIds = materializeQueueIds(queue.length ? queue : [targetTrack], trackId, shuffleEnabled);
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
    const cachedOverride = readCachedArtworkOverride(trackId);
    if (cachedOverride) return;
    const proxiedCoverUrl = api.getNeteaseCoverUrl(coverUrl);
    const updateTrack = (track: Track) => (track.id === trackId ? { ...track, coverUrl: proxiedCoverUrl } : track);
    setLocalTracks((current) => current.map(updateTrack));
    setNeteaseTracks((current) => current.map(updateTrack));
    setDailyTracks((current) => current.map(updateTrack));
    setRoamTracks((current) => current.map(updateTrack));
    setNeteaseLikedTracks((current) => current.map(updateTrack));
    setPlaylistTracks((current) => current.map(updateTrack));
  }

  async function replaceLocalArtwork(trackId: string, file: File) {
    const dataUrl = await createArtworkOverrideDataUrl(file);
    writeCachedArtworkOverride(trackId, dataUrl);
    const updateTrack = (track: Track) =>
      track.id === trackId && track.source === "local" ? { ...track, coverUrl: dataUrl } : track;
    setLocalTracks((current) => current.map(updateTrack));
    setPlayHistory((current) =>
      current.map((entry) => ({
        ...entry,
        track: updateTrack(entry.track),
      })),
    );
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
          setActiveView("local");
        }}
      />

      <div className="app-shell relative z-10 flex h-full w-full flex-col overflow-hidden bg-white/78">
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
              <img src={ariaIconUrl} alt="" draggable={false} className="size-10 shrink-0 rounded-2xl object-cover" />
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
                    if (item.id === "settings") {
                      setSettingsOpen(true);
                    } else {
                      setActiveView(item.id);
                    }
                  }}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-neutral-950/12 bg-white/82 px-3 py-2.5 shadow-[0_10px_26px_rgba(30,35,45,0.11)] ring-1 ring-white/75 transition focus-within:border-neutral-950/24 focus-within:bg-white focus-within:shadow-[0_14px_34px_rgba(30,35,45,0.15)] sm:max-w-lg"
            style={noDragRegionStyle}
          >
            <Search className="size-4 shrink-0 text-neutral-700" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              placeholder="搜索音乐、歌手、专辑"
              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-500"
            />
          </div>

          <div className="flex items-center gap-2" style={noDragRegionStyle}>
            <div className="relative">
            <Button
              variant="glass"
              size="icon"
              aria-label="网易云账号"
              onClick={() => setAccountOpen((value) => !value)}
            >
              {neteaseAccount?.avatarUrl ? (
                <img
                  src={neteaseAccount.avatarUrl}
                  alt={neteaseAccount.nickname ?? "account"}
                  draggable={false}
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
                  playCounts={playCounts}
                  playHistory={playHistory}
                  playing={playing}
                  localTrackCount={localTracks.length}
                  neteaseLikedCount={neteaseLikedDisplayTracks.length}
                  playlistCount={providerPlaylists.length}
                  onTogglePlay={togglePlayback}
                  onPickTrack={chooseTrack}
                  onOpenPlayer={() => setActiveView("player")}
                />
              )}
              {activeView === "player" && (
                <PlayerSurface
                  activeTrack={activeTrack}
                  palette={activePalette}
                  playing={playing}
                  visualizerPlaying={visualizerPlaying}
                  shuffleEnabled={shuffleEnabled}
                  repeatMode={repeatMode}
                  onTogglePlay={togglePlayback}
                  onToggleShuffle={toggleShuffleQueue}
                  onCycleRepeatMode={() => setRepeatMode((current) => (current === "all" ? "one" : "all"))}
                  onNext={() => pickRelativeTrack(1)}
                  onPrevious={() => pickRelativeTrack(-1)}
                  onOpenImmersive={() => void openImmersiveView()}
                  onReplaceLocalArtwork={replaceLocalArtwork}
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
                  analyserRef={analyserRef}
                  visualizerMode={nativePlaybackEnabled ? audioOutputMode : "system"}
                  visualizerActive={pageVisible && !immersiveOpen}
                  onSeek={seekTo}
                />
              )}
              {activeView === "local" && (
                <LibrarySurfacePanel
                  folderName={folderName}
                  onChooseFolder={() => fileInputRef.current?.click()}
                  tracks={visibleLocalTracks}
                  libraryMeta={libraryMeta}
                  activeTrackId={activeTrackId}
                  onPickTrack={chooseTrack}
                  onScanPath={scanBackendPath}
                  onScanCd={scanCdLibrary}
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
                  refreshing={roamRefreshing}
                  onRefresh={() => void refreshRoamData()}
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
              <Button variant="ghost" size="icon" aria-label="展开队列" onClick={() => setQueueExpanded(true)}>
                <ListMusic />
              </Button>
            </div>

            <QueueList tracks={playQueueTracks.length ? playQueueTracks : visibleTracks} activeTrackId={activeTrackId} onPickTrack={chooseTrack} />
          </aside>
          )}
        </section>

        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              backgroundEnabled={backgroundEnabled}
              onBackgroundEnabledChange={setBackgroundEnabled}
              globalArrowKeysEnabled={globalArrowKeysEnabled}
              onGlobalArrowKeysChange={setGlobalArrowKeysEnabled}
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

        <AnimatePresence>
          {immersiveOpen && (
            <ImmersivePlayerView
              activeTrack={activeTrack}
              palette={activePalette}
              playing={playing}
              visualizerPlaying={visualizerPlaying}
              currentTime={currentTime}
              durationSeconds={durationSeconds}
              analyserRef={analyserRef}
              visualizerMode={nativePlaybackEnabled ? audioOutputMode : "system"}
              volume={volume}
              onClose={() => void closeImmersiveView()}
              onTogglePlay={togglePlayback}
              onNext={() => pickRelativeTrack(1)}
              onPrevious={() => pickRelativeTrack(-1)}
              onSeek={seekTo}
              visualizerActive={pageVisible}
            />
          )}
        </AnimatePresence>

        {queueExpanded && (
          <motion.div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-neutral-950/28 p-6 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16 }}
            onClick={() => setQueueExpanded(false)}
          >
            <motion.div
              className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-[0_28px_90px_rgba(20,24,35,0.3)] backdrop-blur-2xl sm:p-6"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-neutral-950/8 pb-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">Queue</p>
                  <h2 className="mt-1 text-xl font-semibold">播放队列</h2>
                </div>
                <Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setQueueExpanded(false)}>
                  <X />
                </Button>
              </div>
              <QueueList
                tracks={playQueueTracks.length ? playQueueTracks : visibleTracks}
                activeTrackId={activeTrackId}
                tone="card"
                onPickTrack={(id) => {
                  chooseTrack(id);
                  setQueueExpanded(false);
                }}
              />
            </motion.div>
          </motion.div>
        )}

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
            if (id === "settings") {
              setSettingsOpen(true);
            } else {
              setActiveView(id);
            }
            setNavOpen(false);
          }}
        />
      </div>
    </main>
  );
}



