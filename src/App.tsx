import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListMusic, Maximize2, Minus, Radio, Search, Settings2, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CloudSurface,
  CollectionSurface,
  LikedSurface,
  PlaylistSurface,
  StatsSurface,
} from "@/components/music/CollectionSurfaces";
import { LibrarySurface as LibrarySurfacePanel } from "@/components/music/LibrarySurface";
import { HomeSidePanel, HomeSurface, HistorySurface } from "@/components/music/HomeSurfaces";
import { SearchSurface, ArtistsSurface } from "@/components/music/DiscoverySurfaces";
import { PlayerSidePanel, QueueList } from "@/components/music/PlayerSidePanels";
import { ImmersivePlayerView, PlayerSurface } from "@/components/music/PlayerViews";
import { FloatingNav } from "@/components/music/FloatingNav";
import { AccountPanel, OnboardingDialog, SettingsPanel } from "@/components/music/SettingsPanels";
import ariaIconUrl from "../build/icon.png";
import { navItems, type Track, type ViewId } from "@/data/music";
import type { ArtistSummary } from "@/lib/artists";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useDiscovery } from "@/hooks/useDiscovery";
import { useLocalLibrary } from "@/hooks/useLocalLibrary";
import { useLyricsSync } from "@/hooks/useLyricsSync";
import { useNeteaseData } from "@/hooks/useNeteaseData";
import { memoryLimits, trimStringSet } from "@/lib/memoryCache";
import {
  createPlayerCacheSnapshot,
  readPlayHistory,
  writePlayHistory,
  type PlayHistoryEntry,
} from "@/lib/playHistory";
import { api } from "@/lib/api";
import {
  extractDominantColors,
  createCachedQueueSnapshots,
  mergeTracks,
  readCachedAudioSettings,
  readCachedPlayerState,
  splitArtistNames,
  writeCachedPlayerState,
  type AudioOutputMode,
  type CoverPalette,
  type PlayerSideView,
  type QualityLevel,
} from "@/lib/playerPresentation";
import { commitPlaybackTime, resetPlaybackTime } from "@/lib/playbackClock";
import { materializeQueueIds, mergeQueueTrackSources, orderedQueueIds, playableTracks } from "@/lib/playQueue";
import { matchesShortcut, readKeyboardShortcuts, writeKeyboardShortcuts, type KeyboardShortcuts } from "@/lib/keyboardShortcuts";
import { sourceLabel } from "@/lib/trackLabels";
import { getTrackSearchSignature, idleTrack, localTrackToUiTrack } from "@/lib/trackMappers";
import { getBoundedCoverUrl } from "@/components/music/shared";
import { cn } from "@/lib/utils";

const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

const panelVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
};

export default function App() {
  const [initialPlayerCache] = useState(readCachedPlayerState);
  const [cachedActiveTrackSnapshot] = useState(() => initialPlayerCache.activeTrackSnapshot);
  const [cachedQueueSnapshots] = useState(() => initialPlayerCache.playQueueSnapshots ?? []);
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [activeTrackId, setActiveTrackId] = useState(
    initialPlayerCache.activeTrackId ?? cachedActiveTrackSnapshot?.id ?? idleTrack.id,
  );
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(initialPlayerCache.volume ?? 72);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(initialPlayerCache.shuffleEnabled ?? false);
  const [repeatMode, setRepeatMode] = useState<"all" | "one">(initialPlayerCache.repeatMode ?? "all");
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>(readPlayHistory);
  const [likedTrackIds, setLikedTrackIds] = useState<Record<string, true>>({});
  const [activePalette, setActivePalette] = useState<CoverPalette>({ primary: idleTrack.accent, secondary: "#aeb7c6" });
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(initialPlayerCache.qualityLevel ?? "lossless");
  const [playQueueIds, setPlayQueueIds] = useState<string[]>(initialPlayerCache.playQueueIds ?? []);
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      const completed = window.localStorage.getItem("aria-onboarding-complete") === "1";
      const returningUser = Boolean(window.localStorage.getItem("aria-player-state"));
      return !completed && !returningUser;
    } catch {
      return true;
    }
  });
  const [onboardingLocalInfo, setOnboardingLocalInfo] = useState<{ path: string; count: number } | null>(null);
  const [libraryScanProgress, setLibraryScanProgress] = useState<{
    phase: string;
    processed: number;
    total: number;
    status: string;
    error?: string | null;
  } | null>(null);
  const [settingsReturnView, setSettingsReturnView] = useState<ViewId>("home");
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === "visible");
  const [backgroundEnabled, setBackgroundEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("aria-background-enabled") === "true";
    } catch {
      return false;
    }
  });
  const [playerSideView, setPlayerSideView] = useState<PlayerSideView>(initialPlayerCache.playerSideView ?? "lyrics");
  const [lyricDisplayMode, setLyricDisplayMode] = useState<"original" | "bilingual">(() => {
    try {
      return window.localStorage.getItem("aria-lyric-display-mode") === "bilingual" ? "bilingual" : "original";
    } catch {
      return "original";
    }
  });
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(readKeyboardShortcuts);
  const [query, setQuery] = useState("");
  const [hifiEnabled, setHifiEnabled] = useState(() => readCachedAudioSettings().hifiEnabled ?? true);
  const [gaplessEnabled, setGaplessEnabled] = useState(() => readCachedAudioSettings().gaplessEnabled ?? false);
  const [audioOutputMode, setAudioOutputMode] = useState<AudioOutputMode>(() => readCachedAudioSettings().outputMode ?? "system");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const navCloseTimer = useRef<number | null>(null);
  const countedTrackRef = useRef<string | null>(null);
  const pendingSeekRef = useRef(0);
  const lastPlayerCacheWriteRef = useRef(0);
  const rendererDiagnosticRef = useRef<Record<string, unknown>>({});
  const immersiveFullscreenRef = useRef(false);
  const taskbarClipKeyRef = useRef<string>("");
  // Track-list states live in this component, but the domain hooks update them
  // through this indirection because the setters only exist after those hooks.
  const updateTrackRef = useRef<
    (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void
  >(() => undefined);
  const applyTrackUpdate = useEffectEvent(
    (
      trackId: string,
      updateTrack: (track: Track) => Track,
      updateOptions?: { includeHistory?: boolean },
    ) => updateTrackRef.current(trackId, updateTrack, updateOptions),
  );
  const activeTrackRef = useRef<Track>(idleTrack);

  const exclusiveMode = audioOutputMode === "exclusive";

  const chooseLocalFolder = useEffectEvent(async () => {
    const chooseFolder = window.ariaDesktop?.chooseMusicFolder;
    if (!chooseFolder) {
      fileInputRef.current?.click();
      return;
    }
    const selectedPath = await chooseFolder();
    if (!selectedPath) return;
    try {
      const result = await scanBackendPath(selectedPath);
      const summary = result as { folderPath?: string; trackCount?: number } | undefined;
      setOnboardingLocalInfo({
        path: summary?.folderPath ?? selectedPath,
        count: summary?.trackCount ?? 0,
      });
    } catch {
      setOnboardingLocalInfo({ path: selectedPath, count: 0 });
    }
  });

  const {
    localTracks,
    setLocalTracks,
    libraryMeta,
    setLibraryMeta,
    folderName,
    setFolderName,
    artworkSyncingRef,
    localCoverWarmupRef,
    warmLocalCoverCache,
    applyArtworkToTrack,
    scanBackendPath,
    scanCdLibrary,
    replaceLocalArtwork,
  } = useLocalLibrary({
    applyTrackUpdate,
    activeTrackId,
    shuffleEnabled,
    setPlayQueueIds,
    onLibraryOpened: () => setActiveView("local"),
    onTrackScanned: (trackId) => {
      pendingSeekRef.current = 0;
      setActiveTrackId(trackId);
    },
    resetPendingSeek: () => {
      pendingSeekRef.current = 0;
    },
    onScanProgress: setLibraryScanProgress,
  });

  const {
    neteaseAccount,
    setNeteaseAccount,
    neteaseTracks,
    setNeteaseTracks,
    neteaseLikedTracks,
    setNeteaseLikedTracks,
    dailyTracks,
    setDailyTracks,
    roamTracks,
    setRoamTracks,
    playlistTracks,
    setPlaylistTracks,
    providerPlaylists,
    setProviderPlaylists,
    selectedPlaylist,
    setSelectedPlaylist,
    playlistLoading,
    roamRefreshing,
    neteaseLikedIds,
    neteaseWarmupRef,
    applyStreamMetaToTrack,
    warmNeteaseTrackCache,
    refreshNeteaseData,
    refreshRoamData,
    openPlaylist,
    toggleNeteaseLike,
  } = useNeteaseData({
    applyTrackUpdate,
    warmupLevel: hifiEnabled ? "jymaster" : qualityLevel,
    playing,
    canAutoSelectFirstTrack: activeTrackId === idleTrack.id && !localTracks.length,
    onAutoSelectTrack: setActiveTrackId,
    activeView,
    getActiveTrack: () => activeTrackRef.current,
    shuffleEnabled,
    setPlayQueueIds,
  });

  const neteaseConnected = Boolean(neteaseAccount?.connected);

  const allTracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...roamTracks, ...playlistTracks]),
    [localTracks, neteaseTracks, roamTracks, playlistTracks],
  );
  const allTracksById = useMemo(() => {
    const map = new Map<string, Track>();
    for (const track of allTracks) map.set(track.id, track);
    return map;
  }, [allTracks]);
  // History snapshots go stale when stream metadata refreshes; render history
  // rows from the live library so one song shows one bitrate everywhere.
  const displayHistory = useMemo(
    () =>
      playHistory.map((entry) => {
        const live = allTracksById.get(entry.track.id);
        return live ? { ...entry, track: live } : entry;
      }),
    [playHistory, allTracksById],
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
        if (track.source === "netease" && track.providerId) {
          current.providerId = current.providerId ?? track.providerId;
        }
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
  activeTrackRef.current = activeTrack;
  const effectiveQualityLevel = useMemo(() => {
    if (!hifiEnabled || activeTrack.source !== "netease") return qualityLevel;
    const levels = activeTrack.availableLevels ?? [];
    return levels.at(-1) ?? qualityLevel;
  }, [activeTrack.availableLevels, activeTrack.source, hifiEnabled, qualityLevel]);
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
  const playQueueTracks = useMemo(() => {
    return mergeQueueTrackSources(playQueueIds, allTracks, cachedQueueSnapshots);
  }, [allTracks, cachedQueueSnapshots, playQueueIds]);
  const linkedLyricCount = useMemo(
    () => allTracks.filter((track) => track.lyricStatus === "linked").length,
    [allTracks],
  );
  const lyricProgress = useMemo(
    () => (allTracks.length ? Math.round((linkedLyricCount / allTracks.length) * 100) : 0),
    [allTracks.length, linkedLyricCount],
  );
  const localSearchSignature = useMemo(() => getTrackSearchSignature(localTracks), [localTracks]);

  const { lyricBindings, setLyricBindings, applyLyricsToTrack } = useLyricsSync({
    applyTrackUpdate,
    activeTrack,
    localTracks,
  });

  const {
    searchBundle,
    searchLoading,
    selectedArtist,
    setSelectedArtist,
    artistTracks,
    artistAvatarCache,
    artistRequestRef,
    artistAvatarLookupRef,
  } = useDiscovery({
    query,
    localTracks,
    localSearchSignature,
    allTracks,
    artistSummaries,
    onMergeNeteaseTracks: setNeteaseTracks,
  });

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

  const hasActiveTrack = activeTrack.id !== idleTrack.id;

  // Gapless playback: the engine appends this entry to mpv's playlist while
  // the current track finishes, so the advance happens inside mpv.
  const getNextPreload = useEffectEvent(() => {
    const resolveUrl = (track: Track): string | null => {
      if (!track.streamUrl || track.requiresNativePlayback) return null;
      const resolvedUrl = api.resolveUrl(track.streamUrl);
      if (track.source !== "netease") return resolvedUrl;
      const url = new URL(resolvedUrl, window.location.href);
      const levels = track.availableLevels ?? [];
      url.searchParams.set("level", hifiEnabled ? (levels.at(-1) ?? qualityLevel) : qualityLevel);
      return url.href;
    };

    if (repeatMode === "one") {
      const current = activeTrackRef.current;
      const url = hasActiveTrack ? resolveUrl(current) : null;
      return current.id !== idleTrack.id && url ? { trackId: current.id, url } : null;
    }

    // Mirror pickRelativeTrack's fallback chain so hero-toggle playback
    // (which never materializes the queue) still preloads correctly.
    const queue = playQueueTracks.length ? playQueueTracks : playbackTracks.length ? playbackTracks : visibleTracks;
    if (!queue.length) return null;
    const currentIndex = queue.findIndex((track) => track.id === activeTrackId);
    const next = queue[(currentIndex + 1) % queue.length];
    if (!next || next.id === activeTrackId) return null;
    const url = resolveUrl(next);
    return url ? { trackId: next.id, url } : null;
  });

  const {
    audioRef,
    analyserRef,
    audioOutputDevices,
    nativeAudioSupported,
    nativeAudioState,
    selectedSinkId,
    setSelectedSinkId,
    nativePlaybackEnabled,
    activeStreamUrl,
    handleAudioError,
    resetAudioError,
  } = useAudioEngine({
    activeTrack,
    activeTrackId,
    idleTrackId: idleTrack.id,
    effectiveQualityLevel,
    playing,
    volume,
    hifiEnabled,
    gaplessEnabled,
    audioOutputMode,
    pageVisible,
    analyserEnabled: pageVisible && (activeView === "player" || immersiveOpen),
    pendingSeekRef,
    setPlaying,
    setDurationSeconds,
    exclusiveMode,
    durationSeconds,
    handleTrackEnded,
    handleNativeTrackAdvanced,
    pickRelativeTrack,
    hasMultipleQueueTracks: (playQueueTracks.length || playbackTracks.length) > 1,
    getNextPreload,
  });

  const visualizerPlaying = nativePlaybackEnabled
    ? Boolean(playing || (nativeAudioState?.active && !nativeAudioState.paused))
    : playing;

  function handleNativeTrackAdvanced(trackId: string) {
    if (!nativePlaybackEnabled || !trackId || trackId === activeTrack.id) return;

    // The next entry was selected by the native gapless playlist. Resolve it
    // from the same queue used by preloading so a stale/local track with a
    // matching title cannot hijack the transition.
    const queue = playQueueTracks.length ? playQueueTracks : playbackTracks.length ? playbackTracks : visibleTracks;
    const nextTrack = queue.find((track) => track.id === trackId);
    if (!nextTrack?.streamUrl) {
      // A preload can race a queue refresh. Let the normal relative picker
      // recover from the current queue instead of leaving mpv and React out
      // of sync indefinitely.
      handleTrackEnded();
      return;
    }

    pendingSeekRef.current = 0;
    resetPlaybackTime();
    setDurationSeconds(0);
    setActiveTrackId(nextTrack.id);
    setPlaying(true);
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
    resetPlaybackTime();
    setDurationSeconds(0);
    setPlaying(true);
  }

  function restartActiveTrack() {
    pendingSeekRef.current = 0;
    resetPlaybackTime();
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

  function seekTo(nextTime: number) {
    if (nativePlaybackEnabled) {
      pendingSeekRef.current = nextTime;
      commitPlaybackTime(nextTime, true);
      window.ariaDesktop?.nativeAudio?.seek?.(nextTime).catch(() => undefined);
      if (!playing) setPlaying(true);
      return;
    }

    if (!audioRef.current) return;
    audioRef.current.currentTime = nextTime;
    commitPlaybackTime(nextTime, true);
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
    const preferredTarget = preferredQueue?.find((track) => track.id === trackId && track.streamUrl);
    // A caller that supplies a source-specific queue must never silently fall
    // back to a same-named local track if that queue has gone stale.
    if (preferredQueue && !preferredTarget) return;
    const targetTrack =
      preferredTarget ??
      queue.find((track) => track.id === trackId) ??
      allTracks.find((track) => track.id === trackId) ??
      (cachedActiveTrackSnapshot?.id === trackId ? cachedActiveTrackSnapshot : null);
    if (!targetTrack?.streamUrl) return;

    const playableIds = materializeQueueIds(queue.length ? queue : [targetTrack], trackId, shuffleEnabled);
    if (playableIds.length) setPlayQueueIds(playableIds);
    pendingSeekRef.current = 0;
    setActiveTrackId(trackId);
    resetPlaybackTime();
    setDurationSeconds(0);
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

  // Every track-list setter exists by now; wire the shared update helper.
  updateTrackRef.current = (trackId, updateTrack, updateOptions) => {
    const includeHistory = updateOptions?.includeHistory ?? true;
    // Metadata warmups touch one track at a time; skip the full array copy
    // (and the re-render it triggers) for lists that do not contain it.
    const applyTo = (tracks: Track[]) =>
      tracks.some((track) => track.id === trackId) ? tracks.map(updateTrack) : tracks;
    setLocalTracks(applyTo);
    setNeteaseTracks(applyTo);
    setDailyTracks(applyTo);
    setRoamTracks(applyTo);
    setNeteaseLikedTracks(applyTo);
    setPlaylistTracks(applyTo);
    if (includeHistory) {
      setPlayHistory((current) =>
        current.some((entry) => entry.track.id === trackId)
          ? current.map((entry) => ({
              ...entry,
              track: updateTrack(entry.track),
            }))
          : current,
      );
    }
  };

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

  useEffect(() => {
    return window.ariaDesktop?.onPlaybackCommand?.(handlePlaybackCommand);
  }, [handlePlaybackCommand]);

  useEffect(() => {
    writeKeyboardShortcuts(keyboardShortcuts);
    window.ariaDesktop?.configureGlobalShortcuts?.(keyboardShortcuts).catch(() => undefined);
  }, [keyboardShortcuts]);

  useEffect(() => {
    try {
      window.localStorage.setItem("aria-lyric-display-mode", lyricDisplayMode);
    } catch {
      // Lyric presentation settings are best-effort.
    }
  }, [lyricDisplayMode]);

  useEffect(() => {
    const updateTaskbarPlayback = window.ariaDesktop?.updateTaskbarPlayback;
    if (!updateTaskbarPlayback) return;

    const hasTrack = activeTrack.id !== idleTrack.id;
    // Keep the native window/application identity stable for OOPZ and other
    // application-loopback tools. Song metadata is published separately.
    document.title = "Aria";
    updateTaskbarPlayback({
      title: hasTrack ? activeTrack.title : "",
      artist: hasTrack ? activeTrack.artist : "",
      playing,
    }).catch(() => undefined);
  }, [activeTrack.artist, activeTrack.id, activeTrack.title, playing]);

  const seekToFromMediaKey = useEffectEvent((time: number) => seekTo(time));

  // Publish playback to the OS media overlay / lock screen (Windows SMTC).
  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;

    if (!hasActiveTrack) {
      mediaSession.metadata = null;
      mediaSession.playbackState = "none";
      return;
    }
    mediaSession.metadata = new MediaMetadata({
      title: activeTrack.title,
      artist: activeTrack.artist,
      album: activeTrack.album,
      artwork: activeTrack.coverUrl ? [{ src: activeTrack.coverUrl, sizes: "512x512" }] : [],
    });
    mediaSession.playbackState = playing ? "playing" : "paused";
  }, [activeTrack.album, activeTrack.artist, activeTrack.coverUrl, activeTrack.id, activeTrack.title, hasActiveTrack, playing]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;

    const handlers: Array<[MediaSessionAction, ((details: MediaSessionActionDetails) => void) | null]> = [
      ["play", () => handlePlaybackCommand("toggle")],
      ["pause", () => handlePlaybackCommand("toggle")],
      ["previoustrack", () => handlePlaybackCommand("previous")],
      ["nexttrack", () => handlePlaybackCommand("next")],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") seekToFromMediaKey(details.seekTime);
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Individual session actions are optional per platform.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Optional per platform.
        }
      }
    };
  }, [handlePlaybackCommand, seekToFromMediaKey]);

  // The non-native fallback thumbnail clips to the visible artwork. Prefer
  // the exact current view so an exiting animation cannot leave a stale clip
  // from the previous page.
  useEffect(() => {
    const update = () => {
      const selectors = immersiveOpen
        ? ['[data-taskbar-anchor="immersive"]']
        : activeView === "player"
          ? ['[data-taskbar-anchor="player-cover"]']
          : activeView === "home"
            ? ['[data-taskbar-anchor="home-cover"]']
            : [];
      let rect: DOMRect | null = null;
      for (const selector of selectors) {
        const candidate = document.querySelector<HTMLElement>(selector);
        if (!candidate) continue;
        const nextRect = candidate.getBoundingClientRect();
        if (nextRect.width >= 8 && nextRect.height >= 8 && nextRect.right > 0 && nextRect.bottom > 0) {
          rect = nextRect;
          break;
        }
      }
      if (!rect) {
        if (taskbarClipKeyRef.current !== "none") {
          taskbarClipKeyRef.current = "none";
          void window.ariaDesktop?.setTaskbarPreviewRect?.(null);
        }
        return;
      }
      const key = `${window.devicePixelRatio}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}|${Math.round(rect.height)}`;
      if (taskbarClipKeyRef.current === key) return;
      taskbarClipKeyRef.current = key;
      void window.ariaDesktop?.setTaskbarPreviewRect?.({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    update();
    const interval = window.setInterval(update, 500);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [activeView, activeTrack.id, immersiveOpen]);

  // Feed two bounded bitmaps to the native DWM bridge. Windows asks for a
  // square-ish thumbnail and a separate live preview; sharing one stretched
  // source is what made the old implementation look unlike NetEase Cloud.
  useEffect(() => {
    const setThumb = window.ariaDesktop?.setTaskbarIconicThumb;
    const clearThumb = window.ariaDesktop?.clearTaskbarIconicThumb;
    if (!setThumb) return;
    const taskbarProgressRatio = playing ? 0.42 : 0.18;

    let cancelled = false;
    let sending = false;
    let sendQueued = false;
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 220;
    thumbnail.height = 220;
    const thumbnailContext = thumbnail.getContext("2d", { willReadFrequently: true });
    if (!thumbnailContext) return;
    // Retain names used by the legacy dead branch below without allocating a
    // second canvas; the current build sends only the compact cover bitmap.
    const livePreview = { width: 1, height: 1 };
    const liveContext: any = null;

    if (!hasActiveTrack) {
      void clearThumb?.().catch(() => undefined);
      return;
    }

    const drawCover = (context: CanvasRenderingContext2D, width: number, height: number, image: HTMLImageElement | null) => {
      const fallback = context.createLinearGradient(0, 0, width, height);
      fallback.addColorStop(0, activeTrack.accent || "#343844");
      fallback.addColorStop(1, "#171717");
      context.fillStyle = fallback;
      context.fillRect(0, 0, width, height);
      if (!image || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };

    let image: any = null;
    const drawFrame = () => {
      drawCover(thumbnailContext, thumbnail.width, thumbnail.height, image);
      return;
      const width = livePreview.width;
      const height = livePreview.height;
      const background = liveContext.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#f5f6f8");
      background.addColorStop(1, activeTrack.accent || "#dfe4ec");
      liveContext.fillStyle = background;
      liveContext.fillRect(0, 0, width, height);
      liveContext.fillStyle = "rgba(255,255,255,0.78)";
      liveContext.fillRect(36, 32, width - 72, height - 64);
      liveContext.fillStyle = "#17191e";
      liveContext.font = "600 34px Segoe UI, sans-serif";
      liveContext.fillText("Aria", 74, 92);
      liveContext.fillStyle = "#3e4653";
      liveContext.font = "600 30px Segoe UI, sans-serif";
      const title = activeTrack.title.length > 24 ? `${activeTrack.title.slice(0, 23)}...` : activeTrack.title;
      liveContext.fillText(title, 74, 176);
      liveContext.fillStyle = "#727b89";
      liveContext.font = "24px Segoe UI, sans-serif";
      const artist = activeTrack.artist.length > 30 ? `${activeTrack.artist.slice(0, 29)}...` : activeTrack.artist;
      liveContext.fillText(artist, 74, 216);
      liveContext.fillStyle = "#c5ccd5";
      liveContext.fillRect(74, 458, 520, 8);
      liveContext.fillStyle = "#8fa7ff";
      liveContext.fillRect(74, 458, taskbarProgressRatio * 520, 8);
      liveContext.fillStyle = "#6d7684";
      liveContext.font = "18px Segoe UI, sans-serif";
      liveContext.fillText("NOW PLAYING", 74, 412);
      liveContext.fillStyle = "#17191e";
      liveContext.beginPath();
      liveContext.arc(190, 518, 24, 0, Math.PI * 2);
      liveContext.arc(270, 518, 30, 0, Math.PI * 2);
      liveContext.arc(350, 518, 24, 0, Math.PI * 2);
      liveContext.fill();
      liveContext.fillStyle = "#ffffff";
      liveContext.font = "28px Segoe UI Symbol, sans-serif";
      liveContext.fillText("‹", 181, 527);
      liveContext.fillText(playing ? "Ⅱ" : "▶", 259, 528);
      liveContext.fillText("›", 341, 527);
      if (image && image.naturalWidth && image.naturalHeight) {
        const coverSize = 390;
        const scale = Math.max(coverSize / image.naturalWidth, coverSize / image.naturalHeight);
        const drawWidth = image.naturalWidth * scale;
        const drawHeight = image.naturalHeight * scale;
        liveContext.save();
        liveContext.beginPath();
        liveContext.roundRect(520, 92, coverSize, coverSize, 24);
        liveContext.clip();
        liveContext.drawImage(image, 520 + (coverSize - drawWidth) / 2, 92 + (coverSize - drawHeight) / 2, drawWidth, drawHeight);
        liveContext.restore();
      }
    };

    const send = () => {
      if (cancelled) return;
      if (sending) {
        sendQueued = true;
        return;
      }
      try {
        const thumbnailPixels = thumbnailContext.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
        const requests = [setThumb(thumbnailPixels, thumbnail.width, thumbnail.height)];
        // The large Aero Peek preview is intentionally left to DWM's live
        // capture of the real Aria window. Sending a second hand-drawn frame
        // here made the preview diverge from the application UI.
        sending = true;
        void Promise.all(requests)
          .catch(() => undefined)
          .finally(() => {
            sending = false;
            if (sendQueued) {
              sendQueued = false;
              send();
            }
          });
      } catch {
        // Canvas readback can fail on tainted images; the native preview keeps
        // the last valid frame in that case.
      }
    };

    drawFrame();
    send();

    const imageElement = new Image();
    imageElement.crossOrigin = "anonymous";
    imageElement.decoding = "async";
    imageElement.onload = () => {
      if (cancelled) return;
      image = imageElement;
      drawFrame();
      send();
    };
    imageElement.onerror = () => undefined;
    if (activeTrack.coverUrl) {
      const previewCoverUrl = activeTrack.coverUrl.includes("/api/providers/netease/cover")
        ? `${activeTrack.coverUrl}${activeTrack.coverUrl.includes("?") ? "&" : "?"}size=320y320`
        : activeTrack.coverUrl;
      void getBoundedCoverUrl(previewCoverUrl).then((resolvedUrl) => {
        if (!cancelled && resolvedUrl) imageElement.src = resolvedUrl;
      });
    }

    return () => {
      cancelled = true;
      imageElement.onload = null;
      imageElement.onerror = null;
      imageElement.removeAttribute("src");
    };
  }, [activeTrack.accent, activeTrack.artist, activeTrack.coverUrl, activeTrack.id, activeTrack.title, hasActiveTrack, playing]);

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
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && (event.key === " " || event.code === "Space" || event.key === "MediaPlayPause")) {
        event.preventDefault();
        handlePlaybackCommand("toggle");
        return;
      }
      if (event.key === "MediaTrackNext" || (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "ArrowRight")) {
        event.preventDefault();
        handlePlaybackCommand("next");
        return;
      }
      if (event.key === "MediaTrackPrevious" || (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "ArrowLeft")) {
        event.preventDefault();
        handlePlaybackCommand("previous");
        return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "i") {
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
        return;
      }
      if (!window.ariaDesktop?.configureGlobalShortcuts) {
        if (matchesShortcut(event, keyboardShortcuts.toggle)) {
          event.preventDefault();
          handlePlaybackCommand("toggle");
          return;
        }
        if (matchesShortcut(event, keyboardShortcuts.previous)) {
          event.preventDefault();
          handlePlaybackCommand("previous");
          return;
        }
        if (matchesShortcut(event, keyboardShortcuts.next)) {
          event.preventDefault();
          handlePlaybackCommand("next");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePlaybackCommand, immersiveOpen, keyboardShortcuts]);

  useEffect(() => {
    const sourceTracks = activeView === "radar" ? roamTracks : playQueueTracks.length ? playQueueTracks : visibleTracks;
    const tracksToWarm = sourceTracks.slice(0, activeView === "radar" ? 72 : playing ? 12 : 36);
    const timer = window.setTimeout(() => warmNeteaseTrackCache(tracksToWarm), playing ? 1600 : 260);
    return () => window.clearTimeout(timer);
    // warmNeteaseTrackCache closes over fresh state on every render, matching
    // the pre-hook behavior; only its inputs belong in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, hifiEnabled, playing, playQueueTracks, roamTracks, qualityLevel, visibleTracks]);

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
      trimStringSet(artworkSyncingRef, memoryLimits.artworkSyncing);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const tracksToWarm = [activeTrack, ...playQueueTracks.slice(0, 12), ...visibleTracks.slice(0, 24)];
    const timer = window.setTimeout(() => warmLocalCoverCache(tracksToWarm), playing ? 700 : 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, playQueueTracks, playing, visibleTracks]);

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
    const timer = window.setInterval(() => {
      const collect = (window as Window & { gc?: () => void }).gc;
      if (collect && (!playing || document.hidden)) collect();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [playing]);

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
      playQueueSnapshots: createCachedQueueSnapshots(playQueueTracks),
      volume,
      qualityLevel,
      shuffleEnabled,
      repeatMode,
      playing: false,
      updatedAt: now,
    });
  }, [
    activeTrack,
    activeTrack.id,
    activeTrackId,
    playQueueIds,
    playQueueTracks,
    playerSideView,
    qualityLevel,
    repeatMode,
    shuffleEnabled,
    volume,
  ]);

  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        setNeteaseAccount((current) => (current?.connected ? current : settings.neteaseAccount));
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
    if (activeTrack.source !== "netease" || !activeTrack.providerId) return;

    let cancelled = false;
    api
      .getNeteaseStreamMeta(activeTrack.providerId, effectiveQualityLevel)
      .then((meta) => {
        if (cancelled) return;
        applyStreamMetaToTrack(activeTrack.id, meta, { authoritative: true });
      })
      .catch(() => {
        // Keep the previous metadata when the provider temporarily rejects the request.
      });

    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.providerId, activeTrack.source, effectiveQualityLevel]);

  useEffect(() => {
    if (!activeTrack.coverUrl) {
      setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    const releaseImage = () => {
      image.onload = null;
      image.onerror = null;
      // The palette is copied into plain strings; keeping the decoded bitmap
      // alive after extraction only grows Chromium's image memory over time.
      image.removeAttribute("src");
    };
    image.onload = () => {
      if (cancelled) {
        releaseImage();
        return;
      }
      try {
        setActivePalette(extractDominantColors(image));
      } catch {
        setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      } finally {
        releaseImage();
      }
    };
    image.onerror = () => {
      if (!cancelled) setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      releaseImage();
    };
    // Palette extraction reads the bounded decode so oversized embedded
    // artwork is sampled at ≤1024px instead of its native resolution.
    void getBoundedCoverUrl(activeTrack.coverUrl).then((src) => {
      if (cancelled) return;
      if (src) image.src = src;
      else releaseImage();
    });

    return () => {
      cancelled = true;
      releaseImage();
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
      return [nextEntry, ...current.filter((entry) => entry.track.id !== activeTrack.id)].slice(0, 80);
    });
  }, [activeTrack.id, activeTrackId, playing]);

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

  return (
    <main className="relative h-screen overflow-hidden bg-[#f5f6f8] text-neutral-950">
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload="metadata"
        onTimeUpdate={(event) => {
          if (nativePlaybackEnabled) return;
          commitPlaybackTime(event.currentTarget.currentTime || 0);
        }}
        onLoadedMetadata={(event) => {
          resetAudioError();
          const duration = event.currentTarget.duration || 0;
          if (!nativePlaybackEnabled) setDurationSeconds(duration);
          if (pendingSeekRef.current > 0) {
            const nextTime = Math.min(pendingSeekRef.current, Math.max(0, duration - 1));
            event.currentTarget.currentTime = nextTime;
            if (!nativePlaybackEnabled) commitPlaybackTime(nextTime, true);
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
          const files = Array.from(event.target.files ?? []);
          const file = files[0];
          const path = file?.webkitRelativePath || file?.name || "";
          const absolutePath = (file as (File & { path?: string }) | undefined)?.path;
          const audioFiles = files.filter((item) => /\.(flac|alac|wav|ape|m4a|aac|mp3|ogg|opus|wma|aiff?)$/i.test(item.name));
          setOnboardingLocalInfo({
            path: absolutePath || (path ? path.split(/[\\/]/)[0] : "已选择本地音乐"),
            count: audioFiles.length || files.length,
          });
          setFolderName(path.split("/")[0] || "已选择");
          setActiveView("local");
          event.currentTarget.value = "";
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="设置"
              onClick={() => {
                setSettingsReturnView(activeView === "settings" ? "home" : activeView);
                setQuery("");
                setActiveView("settings");
              }}
            >
              <Settings2 />
            </Button>
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
                  initialAccount={neteaseAccount}
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
            activeView === "settings"
              ? "grid-cols-1"
              : activeView === "player"
                ? "xl:grid-cols-[minmax(0,1fr)_minmax(380px,18vw)]"
                : "xl:grid-cols-[minmax(0,1fr)_minmax(340px,18vw)]",
          )}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={query.trim() ? "search" : activeView}
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-0 min-w-0"
              style={{ willChange: "transform, opacity" }}
            >
              {query.trim() ? (
                <SearchSurface
                  query={query.trim()}
                  loading={searchLoading}
                  localTracks={searchBundle.localTracks}
                  neteaseTracks={searchBundle.neteaseTracks}
                  artists={searchBundle.artists}
                  artistAvatarCache={artistAvatarCache}
                  onPickTrack={(id, queue) => {
                    chooseTrack(id, queue);
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
                  playHistory={displayHistory}
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
                  durationSeconds={durationSeconds}
                  analyserRef={analyserRef}
                  visualizerMode={nativePlaybackEnabled ? audioOutputMode : "system"}
                  visualizerActive={pageVisible && !immersiveOpen}
                  lyricDisplayMode={lyricDisplayMode}
                  onLyricDisplayModeChange={setLyricDisplayMode}
                  onSeek={seekTo}
                />
              )}
              {activeView === "local" && (
                <LibrarySurfacePanel
                  folderName={folderName}
                  onChooseFolder={() => void chooseLocalFolder()}
                  scanProgress={libraryScanProgress}
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
              {activeView === "history" && (
                <HistorySurface
                  history={displayHistory}
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
              {activeView === "settings" && (
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
                  gaplessEnabled={gaplessEnabled}
                  onGaplessEnabledChange={setGaplessEnabled}
                  nativeAudioSupported={nativeAudioSupported}
                  nativeAudioState={nativeAudioState}
                  audioOutputMode={audioOutputMode}
                  onAudioOutputModeChange={setAudioOutputMode}
                  exclusiveMode={exclusiveMode}
                  keyboardShortcuts={keyboardShortcuts}
                  onKeyboardShortcutsChange={setKeyboardShortcuts}
                  onClose={() => setActiveView(settingsReturnView)}
                />
              )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {activeView === "settings" ? null : activeView === "player" ? (
            <PlayerSidePanel
              mode={playerSideView}
              onModeChange={setPlayerSideView}
              track={activeTrack}
              palette={activePalette}
              lyricDisplayMode={lyricDisplayMode}
              tracks={playQueueTracks.length ? playQueueTracks : visibleTracks}
              activeTrackId={activeTrackId}
              onPickTrack={chooseTrack}
              onSeek={seekTo}
            />
          ) : activeView === "home" ? (
            <HomeSidePanel
              tracks={visibleTracks}
              playCounts={playCounts}
              playHistory={displayHistory}
              onOpenHistory={() => setActiveView("history")}
              onOpenStats={() => setActiveView("stats")}
              onPickTrack={chooseTrack}
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
          </aside>
          )}
        </section>

        <AnimatePresence>
          {immersiveOpen && (
            <ImmersivePlayerView
              activeTrack={activeTrack}
              palette={activePalette}
              playing={playing}
              visualizerPlaying={visualizerPlaying}
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

        <AnimatePresence>
          {onboardingOpen && (
            <OnboardingDialog
              neteaseAccount={neteaseAccount}
              hifiEnabled={hifiEnabled}
              onHifiEnabledChange={setHifiEnabled}
              backgroundEnabled={backgroundEnabled}
              onBackgroundEnabledChange={setBackgroundEnabled}
              gaplessEnabled={gaplessEnabled}
              onGaplessEnabledChange={setGaplessEnabled}
              onAddLocalMusic={() => void chooseLocalFolder()}
              localMusicInfo={onboardingLocalInfo ?? (localTracks.length ? { path: folderName, count: localTracks.length } : null)}
              scanProgress={libraryScanProgress}
              onAccountChange={(account) => {
                setNeteaseAccount(account);
                if (account.connected) void refreshNeteaseData();
              }}
              onComplete={() => setOnboardingOpen(false)}
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
