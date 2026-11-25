import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Headphones, Maximize2, Minus, Moon, Radio, Search, Settings2, SlidersHorizontal, Sparkles, Sun, UserRound, X } from "lucide-react";
import { AriaIcon } from "@/components/icons/aria";
import { Button } from "@/components/ui/button";
import {
  CollectionSurface,
  LikedSurface,
  PlaylistSurface,
  StatsSurface,
} from "@/components/music/CollectionSurfaces";
import { LibrarySurface as LibrarySurfacePanel } from "@/components/music/LibrarySurface";
import { HistorySurface } from "@/components/music/HomeSurfaces";
import { HomeSurface } from "@/components/music/HomeDashboard";
import { AppNavigation } from "@/components/music/AppNavigation";
import { PlaybackQueue } from "@/components/music/PlaybackQueue";
import { SearchSurface, ArtistsSurface } from "@/components/music/DiscoverySurfaces";
import { AlbumDetailSurface, UserDetailSurface } from "@/components/music/DiscoveryDetails";
import { PlayerSidePanel, QueueList } from "@/components/music/PlayerSidePanels";
import { ImmersivePlayerView, PlayerSurface } from "@/components/music/PlayerViews";
import { FloatingNav } from "@/components/music/FloatingNav";

const EqualizerDialog = lazy(() =>
  import("@/components/music/EqualizerPanel").then((mod) => ({ default: mod.EqualizerDialog })),
);
const CloudSurface = lazy(() =>
  import("@/components/music/CloudSurface").then((mod) => ({ default: mod.CloudSurface })),
);
const ExploreSurface = lazy(() =>
  import("@/components/music/ExploreSurface").then((mod) => ({ default: mod.ExploreSurface })),
);
const AccountPanel = lazy(() =>
  import("@/components/music/SettingsPanels").then((mod) => ({ default: mod.AccountPanel })),
);
const AriaRoomSection = lazy(() =>
  import("@/components/music/AriaRoomSection").then((mod) => ({ default: mod.AriaRoomSection })),
);
const ListenTogetherView = lazy(() =>
  import("@/components/music/ListenTogetherDialog").then((mod) => ({ default: mod.ListenTogetherView })),
);
const ListenTogetherInviteToast = lazy(() =>
  import("@/components/music/ListenTogetherDialog").then((mod) => ({ default: mod.ListenTogetherInviteToast })),
);
const ListenTogetherExitPromptDialog = lazy(() =>
  import("@/components/music/ListenTogetherDialog").then((mod) => ({ default: mod.ListenTogetherExitPromptDialog })),
);
const OnboardingDialog = lazy(() =>
  import("@/components/music/SettingsPanels").then((mod) => ({ default: mod.OnboardingDialog })),
);
const SettingsPanel = lazy(() =>
  import("@/components/music/SettingsPanels").then((mod) => ({ default: mod.SettingsPanel })),
);
import ariaIconUrl from "../build/icon.png";
import { type Track, type ViewId } from "@/data/music";
import { isUsableArtistCoverUrl, type ArtistSummary } from "@/lib/artists";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import type { VideoControl } from "@/hooks/useVideoPlayback";
import { useCloudLibrary } from "@/hooks/useCloudLibrary";
import { useDiscovery } from "@/hooks/useDiscovery";
import { useDiscoveryDetails } from "@/hooks/useDiscoveryDetails";
import { useLocalLibrary } from "@/hooks/useLocalLibrary";
import { useAriaRoom } from "@/hooks/useAriaRoom";
import { useListenTogether } from "@/hooks/useListenTogether";
import { useLocalPlaylists } from "@/hooks/useLocalPlaylists";
import { resolveLocalPlaylistTracks, shouldUseLocalPlaylistDialog } from "@/lib/localPlaylists";
import type { AriaRoomTrackPayload } from "@/lib/api";
import { canonicalTrackId, canonicalizeTrackForLibrary } from "@/lib/ariaRoomSync";
import { useLyricsSync } from "@/hooks/useLyricsSync";
import { useNeteaseData } from "@/hooks/useNeteaseData";
import { useQqData } from "@/hooks/useQqData";
import { saveBilibiliAudioMeta, useBilibiliData } from "@/hooks/useBilibiliData";
import { useYoutubeData } from "@/hooks/useYoutubeData";
import { saveYoutubeAudioMeta } from "@/lib/youtubeAudioMeta";
import {
  createEqualizerCustomPreset,
  defaultEqualizerSettings,
  maxEqualizerCustomPresets,
  readCachedEqualizerPresets,
  readCachedEqualizerSettings,
  writeCachedEqualizerPresets,
  writeCachedEqualizerSettings,
  type EqualizerCustomPreset,
  type EqualizerPresetId,
} from "@/lib/equalizer";
import {
  applyThemeToDocument,
  readCachedTheme,
  resolveTheme,
  systemPrefersDark,
  writeCachedTheme,
  type AriaTheme,
} from "@/lib/theme";
import { memoryLimits, trimStringSet } from "@/lib/memoryCache";
import {
  readDailyActivity,
  recordDailyPlay,
  seedDailyActivityFromHistory,
  writeDailyActivity,
  type DailyActivityLog,
} from "@/lib/dailyActivity";
import {
  createPlayerCacheSnapshot,
  readPlayHistory,
  writePlayHistory,
  type PlayHistoryEntry,
} from "@/lib/playHistory";
import { api, type ApiLibraryWatchState, type ProviderDiscoveryBundle, type ProviderStyle, type ProviderStyleGroup, type ProviderUser, type SourceAccountSummary } from "@/lib/api";
import { ArtworkImage } from "@/components/music/ArtworkImage";
import { AddToPlaylistDialog, PlaylistActionsProvider } from "@/components/music/PlaylistActions";
import { AddToLocalPlaylistDialog } from "@/components/music/LocalPlaylistSurfaces";
import {
  adaptPaletteForTheme,
  extractDominantColors,
  createCachedQueueSnapshots,
  hasSyncedLyrics,
  mergeTrackRecord,
  mergeTracks,
  normalizeQuality,
  parseDuration,
  readCachedAudioSettings,
  readCachedPlayerState,
  migrateBilibiliLyricsCache,
  restoreTrackLyrics,
  selectPlaybackQuality,
  splitArtistNames,
  trimTrackCache,
  writeCachedAudioSettings,
  writeCachedPlayerState,
  type AudioOutputMode,
  type BilibiliDefaultAudioLevel,
  type BilibiliDefaultVideoQn,
  type CoverPalette,
  type PlayerSideView,
  type QualityLevel,
} from "@/lib/playerPresentation";
import { nudgeYoutubeVideoOffset, readYoutubeVideoOffset, saveYoutubeVideoOffset } from "@/lib/youtubeVideoOffset";
import { BILIBILI_LYRICS_ENABLED, BILIBILI_VIDEO_ENABLED, canPlayTrackVideo, isStandaloneMvSource, resolveNextVideoMode } from "@/lib/features";
import {
  createViewHistory,
  pushViewSnapshot,
  stepViewHistory,
  type ViewHistorySnapshot,
} from "@/lib/viewHistory";
import { ArtistNavigationContext } from "@/components/music/shared";
import { commitPlaybackTime, getPlaybackTime, resetPlaybackTime } from "@/lib/playbackClock";
import { materializeQueueIds, mergeQueueTrackSources, orderedQueueIds, playableTracks } from "@/lib/playQueue";
import { matchesShortcut, readKeyboardShortcuts, shortcutDefinitions, writeKeyboardShortcuts, type KeyboardShortcuts, type ShortcutCommand } from "@/lib/keyboardShortcuts";
import { cachedArtworkUrl, directArtworkUrl } from "@/lib/coverUrl";
import { sourceLabel } from "@/lib/trackLabels";
import { updateTracksById } from "@/lib/trackUpdates";
import { createDebouncedTask } from "@/lib/debouncedTask";
import { createLibraryWatchPoller, sameLibraryWatchState } from "@/lib/libraryWatch";
import { getTrackSearchSignature, idleTrack, localTrackToUiTrack, providerTrackToUiTrack } from "@/lib/trackMappers";
import { getBoundedCoverUrl } from "@/components/music/shared";
import { cn } from "@/lib/utils";

const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

const panelVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transitionEnd: { transform: "none" } },
  exit: { opacity: 0, y: -16 },
};

async function loadCoverBitmapWithFallback(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  const candidates = [...new Set([cachedArtworkUrl(url, 320), directArtworkUrl(url, 320), url].filter((u): u is string => Boolean(u)))];
  const tryOnce = async (): Promise<ImageBitmap | null> => {
    for (const candidate of candidates) {
      if (signal.aborted) return null;
      try {
        const resolved = (await getBoundedCoverUrl(candidate, 320)) ?? candidate;
        const response = await fetch(resolved, { mode: "cors", signal });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (signal.aborted) return null;
        return await createImageBitmap(blob);
      } catch {
        // Try the next artwork candidate or direct CDN fallback.
      }
    }
    return null;
  };
  const first = await tryOnce();
  if (first || signal.aborted) return first;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 900);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  if (signal.aborted) return null;
  return await tryOnce();
}

async function createMediaSessionArtwork(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const bitmap = await loadCoverBitmapWithFallback(url, signal);
    if (!bitmap) return null;
    try {
      const side = 256;
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext("2d");
      if (!context) return null;
      const scale = Math.max(side / bitmap.width, side / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height);
      const encoded = await canvas.convertToBlob({ type: "image/png" });
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(encoded);
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export default function App() {
  const [initialPlayerCache] = useState(() => {
    migrateBilibiliLyricsCache();
    return readCachedPlayerState();
  });
  const [cachedActiveTrackSnapshot, setCachedActiveTrackSnapshot] = useState(() => initialPlayerCache.activeTrackSnapshot);
  const [cachedQueueSnapshots, setCachedQueueSnapshots] = useState(() => initialPlayerCache.playQueueSnapshots ?? []);
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [queueOpen, setQueueOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState(
    initialPlayerCache.activeTrackId ?? cachedActiveTrackSnapshot?.id ?? idleTrack.id,
  );
  const [playing, setPlaying] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [videoQn, setVideoQn] = useState<number | null>(null);
  const [videoQualities, setVideoQualities] = useState<Array<{ id: number; label: string }>>([]);
  const [videoAudioQuality, setVideoAudioQuality] = useState<string | null>(null);
  const [videoAudioLevel, setVideoAudioLevel] = useState<string | null>(null);
  const [videoAudioLevels, setVideoAudioLevels] = useState<string[]>([]);
  const videoControlRef = useRef<VideoControl | null>(null);
  const probedMvTrackIdsRef = useRef(new Set<string>());
  const [youtubeWebviewFallbackTrackId, setYoutubeWebviewFallbackTrackId] = useState<string | null>(null);
  const [youtubeOffsetSeconds, setYoutubeOffsetSeconds] = useState(0);
  const [youtubeStageQualities, setYoutubeStageQualities] = useState<Array<{ id: number; label: string }>>([]);
  const [youtubeStageActiveQuality, setYoutubeStageActiveQuality] = useState<string | null>(null);
  const [volume, setVolume] = useState(initialPlayerCache.volume ?? 72);
  const lastNonZeroVolumeRef = useRef(volume > 0 ? volume : 65);
  useEffect(() => {
    if (volume > 0) lastNonZeroVolumeRef.current = volume;
  }, [volume]);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(initialPlayerCache.shuffleEnabled ?? false);
  const [repeatMode, setRepeatMode] = useState<"all" | "one">(initialPlayerCache.repeatMode ?? "all");
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>(readPlayHistory);
  // 年度声迹按天日志：升级首次启动时日志为空，就用旧的「最近播放」历史尽力回填，
  // 保证热力图不会从零开始。
  const [dailyActivity, setDailyActivity] = useState<DailyActivityLog>(() => {
    const existing = readDailyActivity();
    if (Object.keys(existing).length) return existing;
    const seeded = seedDailyActivityFromHistory(readPlayHistory());
    if (Object.keys(seeded).length) writeDailyActivity(seeded);
    return seeded;
  });
  const [likedTrackIds, setLikedTrackIds] = useState<Record<string, true>>({});
  const [activePalette, setActivePalette] = useState<CoverPalette>({ primary: idleTrack.accent, secondary: "#aeb7c6" });
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(
    initialPlayerCache.qualityLevel === "jymaster" ? "hires" : initialPlayerCache.qualityLevel ?? "hires",
  );
  const [playQueueIds, setPlayQueueIds] = useState<string[]>(initialPlayerCache.playQueueIds ?? []);
  const [mediaArtwork, setMediaArtwork] = useState<{ trackId: string; coverUrl: string; data: string | null } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [listenTogetherReturnView, setListenTogetherReturnView] = useState<ViewId>("home");
  const [ariaRoomSubPage, setAriaRoomSubPage] = useState<"main" | "info" | "profile" | "network">("main");
  useEffect(() => {
    if (activeView !== "listenTogether") setAriaRoomSubPage("main");
  }, [activeView]);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  // 从搜索/探索直接打开歌单时，PlaylistSurface 需要知道初始看哪个来源。
  const [playlistSourceIntent, setPlaylistSourceIntent] = useState<"netease" | "local" | "qq" | "bilibili" | "youtube" | null>(null);
  // 歌单页停留期间的即时来源切换请求（B站标签点开镜像后跳回 Aria 歌单详情）。
  const [playlistSourceRequest, setPlaylistSourceRequest] = useState<{ source: "netease" | "local" | "qq" | "bilibili" | "youtube"; nonce: number } | null>(null);
  const requestPlaylistSource = (source: "netease" | "local" | "qq" | "bilibili" | "youtube") => {
    setPlaylistSourceIntent(source);
    setPlaylistSourceRequest({ source, nonce: Date.now() });
  };
  // Non-NetEase sources live behind /api/sources/<id>/account; keep the QQ
  // snapshot in App so the header can show the login state everywhere.
  const [qqAccount, setQqAccount] = useState<SourceAccountSummary | null>(null);
  const [bilibiliAccount, setBilibiliAccount] = useState<SourceAccountSummary | null>(null);
  const [youtubeAccount, setYoutubeAccount] = useState<SourceAccountSummary | null>(null);
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
      return window.localStorage.getItem("aria-lyric-display-mode") === "original" ? "original" : "bilingual";
    } catch {
      return "bilingual";
    }
  });
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(readKeyboardShortcuts);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const searchActive = query.trim().length > 0;
  const restoringHistoryRef = useRef(false);
  const [viewHistory, setViewHistory] = useState(() =>
    createViewHistory({
      view: "home",
      query: "",
      artist: null,
      album: null,
      user: null,
      playlistSource: null,
      neteasePlaylist: null,
      qqPlaylist: null,
      bilibiliPlaylist: null,
      youtubePlaylist: null,
      localPlaylistId: null,
    }),
  );
  const [exploreTab, setExploreTab] = useState<"discover" | "styles">("discover");
  const [exploreStyleGroups, setExploreStyleGroups] = useState<ProviderStyleGroup[]>([]);
  const [exploreStyleId, setExploreStyleId] = useState<string | null>(null);
  const [exploreStyle, setExploreStyle] = useState<ProviderStyle | null>(null);
  const [exploreTracks, setExploreTracks] = useState<Track[]>([]);
  const [ariaRoomGuestTracks, setAriaRoomGuestTracks] = useState<Track[]>([]);
  const [exploreStyleCursor, setExploreStyleCursor] = useState<string | null>(null);
  const [exploreStyleMore, setExploreStyleMore] = useState(false);
  const [exploreStyleSort, setExploreStyleSort] = useState<"hot" | "new">("hot");
  const [exploreStylesLoading, setExploreStylesLoading] = useState(false);
  const [exploreTracksLoading, setExploreTracksLoading] = useState(false);
  const [exploreTracksLoadingMore, setExploreTracksLoadingMore] = useState(false);
  const [exploreStyleError, setExploreStyleError] = useState<string | null>(null);
  const [exploreDiscovery, setExploreDiscovery] = useState<ProviderDiscoveryBundle | null>(null);
  const [exploreDiscoveryLoading, setExploreDiscoveryLoading] = useState(false);
  const [exploreDiscoveryError, setExploreDiscoveryError] = useState<string | null>(null);
  const [addPlaylistRequest, setAddPlaylistRequest] = useState<{ tracks: Track[]; playlistId?: string; existingTrackIds?: string[] } | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const playlistReturnRef = useRef<{ view?: ViewId; query: string; user: ProviderUser | null } | null>(null);
  const [hifiEnabled, setHifiEnabled] = useState(() => readCachedAudioSettings().hifiEnabled ?? true);
  const [masterQualityEnabled, setMasterQualityEnabled] = useState(() => {
    const settings = readCachedAudioSettings();
    return settings.hifiEnabled !== false && (settings.masterQualityEnabled ?? false);
  });
  const [gaplessEnabled, setGaplessEnabled] = useState(() => readCachedAudioSettings().gaplessEnabled ?? false);
  const [normalizationEnabled, setNormalizationEnabled] = useState(() => readCachedAudioSettings().normalizationEnabled ?? false);
  const [audioOutputMode, setAudioOutputMode] = useState<AudioOutputMode>(() => readCachedAudioSettings().outputMode ?? "system");
  const [bilibiliDefaultVideoQn, setBilibiliDefaultVideoQn] = useState<BilibiliDefaultVideoQn>(
    () => readCachedAudioSettings().bilibiliDefaultVideoQn ?? 120,
  );
  const [bilibiliDefaultAudioLevel, setBilibiliDefaultAudioLevel] = useState<BilibiliDefaultAudioLevel>(
    () => readCachedAudioSettings().bilibiliDefaultAudioLevel ?? "hires",
  );
  const [equalizer, setEqualizer] = useState(() => readCachedEqualizerSettings() ?? defaultEqualizerSettings());
  useEffect(() => {
    writeCachedEqualizerSettings(equalizer);
  }, [equalizer]);
  function updateEqualizer(patch: Partial<typeof equalizer>) {
    setEqualizer((current) => ({ ...current, ...patch }));
  }
  function selectEqualizerPreset(preset: EqualizerPresetId) {
    updateEqualizer({ preset });
  }
  const [equalizerOpen, setEqualizerOpen] = useState(false);
  const [customEqualizerPresets, setCustomEqualizerPresets] = useState<EqualizerCustomPreset[]>(() => readCachedEqualizerPresets());
  useEffect(() => {
    writeCachedEqualizerPresets(customEqualizerPresets);
  }, [customEqualizerPresets]);
  useEffect(() => {
    if (activeView !== "player") setEqualizerOpen(false);
  }, [activeView]);

  function saveCustomEqualizerPreset(name: string) {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return false;
    const existing = customEqualizerPresets.find((item) => item.name === trimmed);
    if (!existing && customEqualizerPresets.length >= maxEqualizerCustomPresets) return false;
    const preset = createEqualizerCustomPreset(trimmed, equalizer.bands);
    const next = existing
      ? customEqualizerPresets.map((item) => (item.id === existing.id ? { ...item, bands: preset.bands } : item))
      : [...customEqualizerPresets, preset];
    setCustomEqualizerPresets(next);
    writeCachedEqualizerPresets(next);
    updateEqualizer({ preset: "custom" });
    return true;
  }

  function deleteCustomEqualizerPreset(id: string) {
    const next = customEqualizerPresets.filter((item) => item.id !== id);
    setCustomEqualizerPresets(next);
    writeCachedEqualizerPresets(next);
  }

  function importCustomEqualizerPresets(presets: EqualizerCustomPreset[]) {
    const merged = customEqualizerPresets.slice();
    for (const imported of presets) {
      const index = merged.findIndex((item) => item.name === imported.name);
      if (index >= 0) merged[index] = { ...merged[index], bands: imported.bands };
      else if (merged.length < maxEqualizerCustomPresets) merged.push(imported);
    }
    setCustomEqualizerPresets(merged);
    writeCachedEqualizerPresets(merged);
  }

  function handleHifiEnabledChange(value: boolean) {
    setHifiEnabled(value);
    if (!value) setMasterQualityEnabled(false);
  }

  function handleQualityLevelChange(level: QualityLevel) {
    // Explicit levels are manual choices; 臻品 also enables HiFi so its
    // companion setting remains visible.
    setQualityLevel(level);
    if (level === "jymaster") {
      setHifiEnabled(true);
      setMasterQualityEnabled(true);
    } else {
      setHifiEnabled(false);
      setMasterQualityEnabled(false);
    }
    if (activeTrack.source === "bilibili" || activeTrack.source === "youtube") {
      setVideoAudioLevel(level);
    }
  }

  const [theme, setTheme] = useState<AriaTheme>(() => readCachedTheme());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemDark(query.matches);
    handleChange();
    query.addEventListener?.("change", handleChange);
    return () => query.removeEventListener?.("change", handleChange);
  }, []);
  const resolvedTheme = resolveTheme(theme, systemDark);
  const surfacePalette = useMemo(
    () => adaptPaletteForTheme(activePalette, resolvedTheme === "dark"),
    [activePalette, resolvedTheme],
  );
  const darkSurfacePalette = useMemo(
    () => adaptPaletteForTheme(activePalette, true),
    [activePalette],
  );
  useEffect(() => {
    applyThemeToDocument(theme, systemDark);
    writeCachedTheme(theme);
  }, [theme, systemDark]);

  useEffect(() => {
    if (!playbackNotice) return;
    const timer = window.setTimeout(() => setPlaybackNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [playbackNotice]);
  useEffect(() => {
    setPlaybackNotice(null);
  }, [activeTrackId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const navCloseTimer = useRef<number | null>(null);
  const countedTrackRef = useRef<string | null>(null);
  const pendingSeekRef = useRef(0);
  const pendingSeekTrackIdRef = useRef<string | null>(null);
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

  useEffect(() => () => {
    if (navCloseTimer.current !== null) window.clearTimeout(navCloseTimer.current);
  }, []);

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
    removeLibraryRoot,
    replaceLocalArtwork,
  } = useLocalLibrary({
    applyTrackUpdate,
    activeTrackId,
    shuffleEnabled,
    setPlayQueueIds,
    onLibraryOpened: () => setActiveView("local"),
    onTrackScanned: (trackId) => {
      pendingSeekRef.current = 0;
      pendingSeekTrackIdRef.current = null;
      setActiveTrackId(trackId);
    },
    resetPendingSeek: () => {
      pendingSeekRef.current = 0;
      pendingSeekTrackIdRef.current = null;
    },
    onScanProgress: setLibraryScanProgress,
  });

  // QQ search results live in their own pool: choosing a search row must
  // resolve the qq: id through allTracks/queues like every other source.
  const [qqSearchTracks, setQqSearchTracks] = useState<Track[]>([]);
  const [bilibiliSearchTracks, setBilibiliSearchTracks] = useState<Track[]>([]);
  const [youtubeSearchTracks, setYoutubeSearchTracks] = useState<Track[]>([]);
  const [libraryWatchState, setLibraryWatchState] = useState<ApiLibraryWatchState | null>(null);

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
    playlistError,
    roamRefreshing,
    neteaseLikedIds,
    neteaseWarmupRef,
    applyStreamMetaToTrack,
    warmNeteaseTrackCache,
    refreshNeteaseData,
    refreshRoamData,
    openPlaylist,
    closePlaylist,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    uploadPlaylistCover,
    editPlaylistTracks,
    reorderPlaylistTracks,
    subscribePlaylist,
    refreshPlaylistList,
    toggleNeteaseLike,
  } = useNeteaseData({
    applyTrackUpdate,
    getWarmupLevel: (track) => selectPlaybackQuality(track, { hifiEnabled, masterQualityEnabled, qualityLevel, bilibiliDefaultAudioLevel }),
    playing,
    canAutoSelectFirstTrack: activeTrackId === idleTrack.id && !localTracks.length,
    onAutoSelectTrack: setActiveTrackId,
    activeView,
    getActiveTrack: () => activeTrackRef.current,
    shuffleEnabled,
    setPlayQueueIds,
  });

  const neteaseConnected = Boolean(neteaseAccount?.connected);
  const qqConnected = Boolean(qqAccount?.connected);
  const bilibiliConnected = Boolean(bilibiliAccount?.connected);
  const youtubeConnected = Boolean(youtubeAccount?.connected);
  // The header shows a single account chip; NetEase wins when multiple sources are signed in.
  const primaryAccount = neteaseConnected
    ? neteaseAccount
    : qqConnected
      ? qqAccount
      : bilibiliConnected
        ? bilibiliAccount
        : youtubeConnected
          ? youtubeAccount
          : null;
  const lastAccountRefreshAtRef = useRef(0);
  const refreshQqAccount = useEffectEvent(() => {
    api
      .getSourceAccount("qq")
      .then(({ account }) => setQqAccount(account))
      .catch(() => undefined);
  });
  const refreshBilibiliAccount = useEffectEvent(() => {
    api
      .getSourceAccount("bilibili")
      .then(({ account }) => setBilibiliAccount(account))
      .catch(() => undefined);
  });
  const refreshYoutubeAccount = useEffectEvent(() => {
    api
      .getSourceAccount("youtube")
      .then(({ account }) => setYoutubeAccount(account))
      .catch(() => undefined);
  });

  useEffect(() => {
    const now = Date.now();
    if (now - lastAccountRefreshAtRef.current < 60_000 && activeView !== "settings") return;
    lastAccountRefreshAtRef.current = now;
    refreshQqAccount();
    refreshBilibiliAccount();
    refreshYoutubeAccount();
  }, [activeView]);

  // 源卡片（如 YouTube Cookie 登录/退出）广播 aria-sources-changed 时，
  // 立即刷新各账号态，不等 60 秒节流窗口。
  useEffect(() => {
    const refreshAccounts = () => {
      refreshQqAccount();
      refreshBilibiliAccount();
      refreshYoutubeAccount();
    };
    window.addEventListener("aria-sources-changed", refreshAccounts);
    return () => window.removeEventListener("aria-sources-changed", refreshAccounts);
  }, []);

  const qqData = useQqData({ connected: qqConnected, applyTrackUpdate });
  const bilibiliData = useBilibiliData({ connected: bilibiliConnected, applyTrackUpdate });
  // YouTube 歌单（账号播放列表 + 喜欢的音乐）随登录状态自动同步/清空。
  const youtubeData = useYoutubeData({ connected: youtubeConnected });
  // Reload the QQ liked/playlists whenever the account connects (mount, login,
  // or re-login from settings); disconnect clears inside the hook.
  useEffect(() => {
    if (qqConnected) void qqData.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qqConnected]);
  useEffect(() => {
    if (bilibiliConnected) void bilibiliData.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bilibiliConnected]);
  useEffect(() => {
    const onFocus = () => {
      refreshQqAccount();
      refreshBilibiliAccount();
      refreshYoutubeAccount();
      // 手机端在在线音源里点了红心后，切回 Aria 时顺手刷新一次，
      // 不必等到下一次进入「我喜欢」页面。
      if (qqConnected) void qqData.refresh();
      if (bilibiliConnected) void bilibiliData.refresh();
      if (youtubeConnected) void youtubeData.refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qqConnected, bilibiliConnected, youtubeConnected]);
  // 进入「我喜欢」时重新拉一次在线收藏，手机端刚点过的红心不必重启应用。
  useEffect(() => {
    if (activeView !== "liked") return;
    if (qqConnected) void qqData.refresh();
    if (bilibiliConnected) void bilibiliData.refresh();
    if (youtubeConnected) void youtubeData.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, qqConnected, bilibiliConnected, youtubeConnected]);
  // 推荐视图的来源切换:每日推荐/私人漫游支持网易云、QQ 与 YouTube 三套数据。
  const [recommendSource, setRecommendSource] = useState<"netease" | "qq" | "youtube">("netease");
  const [exploreSource, setExploreSource] = useState<"netease" | "youtube">("netease");
  const recentQqRoamExcludes = () =>
    displayHistory
      .map((entry) => entry.track.id)
      .filter((id) => id.startsWith("qq:"))
      .slice(0, 20);
  const recentYoutubeRoamExcludes = () =>
    displayHistory
      .map((entry) => entry.track.id)
      .filter((id) => id.startsWith("youtube:"))
      .map((id) => id.slice("youtube:".length))
      .slice(0, 20);
  useEffect(() => {
    if (recommendSource === "qq") {
      if (!qqConnected) return;
      if (activeView === "daily") void qqData.loadDaily();
      if (activeView === "radar") void qqData.loadRoam(recentQqRoamExcludes());
      return;
    }
    if (recommendSource === "youtube") {
      if (activeView === "daily") void youtubeData.loadDaily();
      if (activeView === "radar") void youtubeData.loadRoam(recentYoutubeRoamExcludes());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendSource, activeView, qqConnected, youtubeConnected]);
  useEffect(() => {
    if (activeView === "explore" && exploreSource === "youtube") {
      void youtubeData.loadDiscovery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, exploreSource, youtubeConnected]);
  const cloudLibrary = useCloudLibrary({
    enabled: activeView === "cloud",
    connected: neteaseConnected,
    accountId: neteaseAccount?.userId ?? null,
  });
  const { cloudTracks, setCloudTracks } = cloudLibrary;

  useEffect(() => {
    if (activeView !== "explore" || exploreStyleGroups.length) return;
    let cancelled = false;
    setExploreStylesLoading(true);
    setExploreStyleError(null);
    void api.getNeteaseStyles().then((result) => {
      if (cancelled) return;
      const groups = Array.isArray(result.groups) ? result.groups : [];
      setExploreStyleGroups(groups);
      const first = groups.flatMap((group) => group.styles ?? [])[0];
      if (first) setExploreStyleId((current) => current ?? first.id);
    }).catch((error: unknown) => {
      if (!cancelled) setExploreStyleError(error instanceof Error ? error.message : "曲风列表加载失败");
    }).finally(() => {
      if (!cancelled) setExploreStylesLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeView, exploreStyleGroups.length]);

  useEffect(() => {
    if (activeView !== "explore" || !exploreStyleId) return;
    let cancelled = false;
    setExploreTracksLoading(true);
    setExploreStyleError(null);
    setExploreTracks([]);
    setExploreStyleCursor(null);
    setExploreStyleMore(false);
    void api.getNeteaseStyle(exploreStyleId, { sort: exploreStyleSort, limit: 24 }).then((result) => {
      if (cancelled) return;
      setExploreStyle(result.style);
      setExploreTracks((Array.isArray(result.tracks) ? result.tracks : []).map((track, index) => providerTrackToUiTrack(track, index)));
      setExploreStyleCursor(result.cursor ?? null);
      setExploreStyleMore(Boolean(result.more));
    }).catch((error: unknown) => {
      if (!cancelled) setExploreStyleError(error instanceof Error ? error.message : "曲风歌曲加载失败");
    }).finally(() => {
      if (!cancelled) setExploreTracksLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeView, exploreStyleId, exploreStyleSort]);

  async function loadMoreExploreTracks() {
    if (!exploreStyleId || !exploreStyleCursor || !exploreStyleMore || exploreTracksLoadingMore) return;
    setExploreTracksLoadingMore(true);
    setExploreStyleError(null);
    try {
      const result = await api.getNeteaseStyle(exploreStyleId, { sort: exploreStyleSort, cursor: exploreStyleCursor, limit: 24 });
      const offset = exploreTracks.length;
      setExploreTracks((current) => [...current, ...result.tracks.map((track, index) => providerTrackToUiTrack(track, offset + index))]);
      setExploreStyleCursor(result.cursor);
      setExploreStyleMore(result.more);
    } catch (error) {
      setExploreStyleError(error instanceof Error ? error.message : "更多歌曲加载失败");
    } finally {
      setExploreTracksLoadingMore(false);
    }
  }

  async function loadExploreDiscovery(force = false) {
    if (exploreDiscoveryLoading || (exploreDiscovery && !force)) return;
    setExploreDiscoveryLoading(true);
    setExploreDiscoveryError(null);
    try {
      const result = await api.getNeteaseDiscovery(12);
      setExploreDiscovery(result);
    } catch (error) {
      setExploreDiscoveryError(error instanceof Error ? error.message : "发现内容加载失败");
    } finally {
      setExploreDiscoveryLoading(false);
    }
  }

  useEffect(() => {
    if (activeView === "explore" && exploreTab === "discover" && !exploreDiscovery && !exploreDiscoveryLoading) {
      void loadExploreDiscovery();
    }
  }, [activeView, exploreDiscovery, exploreDiscoveryLoading, exploreTab]);

  const qqLibraryTracks = useMemo(
    () => mergeTracks([
      ...qqData.likedTracks,
      ...qqData.playlistTracks,
      ...qqData.dailyTracks,
      ...qqData.roamTracks,
    ]),
    [qqData.likedTracks, qqData.playlistTracks, qqData.dailyTracks, qqData.roamTracks],
  );
  const bilibiliLibraryTracks = bilibiliData.likedTracks;
  const allTracks = useMemo(
    () =>
      mergeTracks([
        ...localTracks,
        ...neteaseTracks,
        ...neteaseLikedTracks,
        ...dailyTracks,
        ...qqSearchTracks,
        ...bilibiliSearchTracks,
        ...youtubeSearchTracks,
        ...qqLibraryTracks,
        ...bilibiliLibraryTracks,
        ...bilibiliData.playlistTracks,
        ...youtubeData.likedTracks,
        ...youtubeData.playlistTracks,
        ...youtubeData.dailyTracks,
        ...youtubeData.roamTracks,
        ...(youtubeData.discovery?.quickPicks ?? []),
        ...(youtubeData.discovery?.trendingTracks ?? []),
        ...roamTracks,
        ...playlistTracks,
        ...cloudTracks,
        ...exploreTracks,
        ...ariaRoomGuestTracks,
      ]),
    [
      localTracks,
      neteaseTracks,
      neteaseLikedTracks,
      dailyTracks,
      qqSearchTracks,
      bilibiliSearchTracks,
      youtubeSearchTracks,
      qqLibraryTracks,
      bilibiliLibraryTracks,
      bilibiliData.playlistTracks,
      youtubeData.likedTracks,
      youtubeData.playlistTracks,
      youtubeData.dailyTracks,
      youtubeData.roamTracks,
      youtubeData.discovery,
      roamTracks,
      playlistTracks,
      cloudTracks,
      exploreTracks,
      ariaRoomGuestTracks,
    ],
  );
  // Mixed playlists resolve live tracks first, then compact remote snapshots.
  const localPlaylists = useLocalPlaylists(allTracks);
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
    if (activeView !== "artists" && !searchActive) return [] as ArtistSummary[];
    const artists = new Map<string, ArtistSummary & { albums: Set<string>; sources: Set<Track["source"]> }>();
    for (const track of allTracks) {
      // Bilibili and YouTube have no shared artist catalogue; keeping their
      // channel names out avoids sending them through NetEase/QQ lookups.
      if (track.source === "bilibili" || track.source === "youtube") continue;
      for (const [artistIndex, artistName] of splitArtistNames(track.artist).entries()) {
        const key = artistName.toLowerCase();
        const current =
          artists.get(key) ??
          ({
            id: `artist:${key}`,
            name: artistName,
            source: track.source === "netease" ? "netease" : track.source === "qq" ? "qq" : "local",
            avatarUrl: null,
            fallbackCoverUrl: null,
            trackCount: 0,
            albumCount: 0,
            providerId: null,
            providerSource: null,
            albums: new Set<string>(),
            sources: new Set<Track["source"]>(),
          } satisfies ArtistSummary & { albums: Set<string>; sources: Set<Track["source"]> });
        current.trackCount += 1;
        current.albums.add(track.album);
        current.sources.add(track.source);
        current.source =
          current.sources.size > 1
            ? "mixed"
            : current.sources.has("netease")
              ? "netease"
              : current.sources.has("qq")
                ? "qq"
                : "local";
        if (!current.fallbackCoverUrl && isUsableArtistCoverUrl(track.coverUrl)) {
          current.fallbackCoverUrl = track.coverUrl;
        }
        if ((track.source === "netease" || track.source === "qq") && track.artistIds?.[artistIndex]) {
          if (!current.providerId || (track.source === "netease" && current.providerSource !== "netease")) {
            current.providerId = track.artistIds[artistIndex];
            current.providerSource = track.source;
          }
        }
        artists.set(key, current);
      }
    }
    return [...artists.values()]
      .map(({ albums, sources, ...artist }) => ({ ...artist, albumCount: albums.size }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
  }, [activeView, allTracks, searchActive]);
  const playQueueTracks = useMemo(() => {
    return mergeQueueTrackSources(playQueueIds, allTracks, cachedQueueSnapshots);
  }, [allTracks, cachedQueueSnapshots, playQueueIds]);
  const requestedActiveTrack = playQueueTracks.find((track) => track.id === activeTrackId) ??
    allTracks.find((track) => track.id === activeTrackId);
  const cachedActiveTrack = cachedActiveTrackSnapshot?.id === activeTrackId ? cachedActiveTrackSnapshot : null;
  const resolvedActiveTrack =
    requestedActiveTrack && cachedActiveTrack
      ? mergeTrackRecord(cachedActiveTrack, requestedActiveTrack)
      : (requestedActiveTrack?.streamUrl ? requestedActiveTrack : null) ??
        (cachedActiveTrack?.streamUrl ? cachedActiveTrack : null) ??
        requestedActiveTrack ??
        cachedActiveTrack ??
        (activeTrackId === idleTrack.id ? allTracks[0] ?? idleTrack : idleTrack);
  // Queue snapshots intentionally omit lyric payloads. When a track is
  // restored after restart, reattach the hydrated active snapshot lyrics so
  // the lyric panel can render immediately and the sync hook can refresh
  // translations when needed.
  const activeTrack = useMemo(
    () => restoreTrackLyrics(
      resolvedActiveTrack,
      cachedActiveTrackSnapshot?.id === activeTrackId && cachedActiveTrackSnapshot.lyricStatus === "linked"
        ? cachedActiveTrackSnapshot.lyrics
        : [],
    ),
    [resolvedActiveTrack, cachedActiveTrackSnapshot, activeTrackId],
  );
  activeTrackRef.current = activeTrack;
  const listenTogetherActiveRef = useRef(false);
  useEffect(() => {
    setVideoMode((current) => resolveNextVideoMode(current, activeTrack));
  }, [activeTrack.id, activeTrack.source, activeTrack.videoUrl]);
  useEffect(() => {
    setVideoQn(activeTrack.source === "bilibili" ? bilibiliDefaultVideoQn : null);
    setVideoQualities([]);
    setVideoAudioQuality(null);
    setVideoAudioLevel(activeTrack.source === "bilibili" ? bilibiliDefaultAudioLevel : null);
    setVideoAudioLevels([]);
    setYoutubeWebviewFallbackTrackId(null);
    setYoutubeStageQualities([]);
    setYoutubeStageActiveQuality(null);
    setYoutubeOffsetSeconds(activeTrack.source === "youtube" ? readYoutubeVideoOffset(activeTrack.providerId) : 0);
  }, [activeTrack.id, activeTrack.source, activeTrack.providerId]);
  useEffect(() => {
    const current = readCachedAudioSettings();
    writeCachedAudioSettings({
      sinkId: current.sinkId ?? "default",
      hifiEnabled,
      masterQualityEnabled,
      gaplessEnabled,
      normalizationEnabled,
      exclusiveMode: audioOutputMode === "exclusive",
      outputMode: audioOutputMode,
      bilibiliDefaultVideoQn,
      bilibiliDefaultAudioLevel,
      youtubeStageMode: "hifi",
      youtubeStageModeV2: "hifi",
    });
  }, [bilibiliDefaultVideoQn, bilibiliDefaultAudioLevel]);
  const youtubeWebviewSupported = Boolean(typeof window !== "undefined" && window.ariaDesktop?.youtubeStage?.supported);
  // Keep the YouTube HD webview mounted while in videoMode for a YouTube track
  // even across view switches so returning to Player resumes immediately without reloading.
  const youtubeWebviewActive = Boolean(
    BILIBILI_VIDEO_ENABLED &&
      videoMode &&
      activeTrack.source === "youtube" &&
      activeTrack.providerId &&
      youtubeWebviewSupported &&
      youtubeWebviewFallbackTrackId !== activeTrack.id,
  );
  const activeVideoUrl = useMemo(() => {
    const isVideoSource =
      activeTrack.source === "bilibili" ||
      activeTrack.source === "youtube" ||
      activeTrack.source === "netease" ||
      activeTrack.source === "qq";
    if (!activeTrack.videoUrl || !isVideoSource || !videoQn) return activeTrack.videoUrl;
    try {
      const url = new URL(api.resolveUrl(activeTrack.videoUrl));
      url.searchParams.set("qn", String(videoQn));
      return url.href;
    } catch {
      return activeTrack.videoUrl;
    }
  }, [activeTrack.videoUrl, activeTrack.source, videoQn]);
  // Bilibili / YouTube DASH video path: the video element plays the video stream
  // and Aria's audio engine keeps ownership of the audio stream.
  const activeVideoAudioUrl = useMemo(() => {
    const isVideoSource = activeTrack.source === "bilibili" || activeTrack.source === "youtube";
    if (!activeTrack.videoUrl || !isVideoSource) return undefined;
    try {
      const url = new URL(api.resolveUrl(activeTrack.videoUrl));
      url.pathname = url.pathname.replace(/\/video$/, "/video-audio");
      if (videoQn) url.searchParams.set("qn", String(videoQn));
      else url.searchParams.delete("qn");
      if (videoAudioLevel) url.searchParams.set("level", videoAudioLevel);
      else url.searchParams.delete("level");
      return url.href;
    } catch {
      return undefined;
    }
  }, [activeTrack.videoUrl, activeTrack.source, videoQn, videoAudioLevel]);
  const mediaSessionArtwork = mediaArtwork?.trackId === activeTrack.id && mediaArtwork.coverUrl === activeTrack.coverUrl
    ? mediaArtwork.data : null;
  const effectiveQualityLevel = useMemo(() => {
    if (
      activeTrack.id.startsWith("aria-room:") &&
      activeTrack.currentLevel &&
      (["standard", "higher", "exhigh", "lossless", "hires", "jymaster"] as const).includes(
        activeTrack.currentLevel as QualityLevel,
      )
    ) {
      return activeTrack.currentLevel as QualityLevel;
    }
    return selectPlaybackQuality(activeTrack, {
      hifiEnabled,
      masterQualityEnabled,
      qualityLevel,
      bilibiliDefaultAudioLevel,
    });
  }, [
    activeTrack.id,
    activeTrack.currentLevel,
    activeTrack.availableLevels,
    activeTrack.source,
    hifiEnabled,
    masterQualityEnabled,
    qualityLevel,
    bilibiliDefaultAudioLevel,
  ]);
  useEffect(() => {
    if ((activeTrack.source !== "bilibili" && activeTrack.source !== "qq" && activeTrack.source !== "youtube") || !activeTrack.providerId) return;
    if (ariaRoom.isGuest && activeTrack.id.startsWith("aria-room:")) return;
    let cancelled = false;
    api
      .getSourceStreamMeta(activeTrack.source, activeTrack.providerId, effectiveQualityLevel)
      .then((meta) => {
        if (cancelled) return;
        if (activeTrack.source === "bilibili" && activeTrack.providerId) {
          saveBilibiliAudioMeta(activeTrack.providerId, {
            bitrate: meta.bitrate ?? null,
            quality: meta.quality ? normalizeQuality(meta.quality) : undefined,
            currentLevel: meta.currentLevel ?? null,
            availableLevels: meta.availableLevels,
          });
        }
        if (activeTrack.source === "youtube" && activeTrack.providerId) {
          saveYoutubeAudioMeta(activeTrack.providerId, {
            bitrate: meta.bitrate ?? null,
            sampleRate: meta.sampleRate ?? null,
            quality: meta.quality ? normalizeQuality(meta.quality) : undefined,
            currentLevel: meta.currentLevel ?? null,
            availableLevels: meta.availableLevels,
          });
        }
        updateTrackRef.current(activeTrack.id, (track) => ({
          ...track,
          bitrate: meta.bitrate ?? track.bitrate,
          sampleRate: meta.sampleRate ?? track.sampleRate,
          currentLevel: meta.currentLevel ?? track.currentLevel,
          availableLevels: meta.availableLevels?.length ? meta.availableLevels : track.availableLevels,
          quality: meta.quality ?? track.quality,
        }), { includeHistory: false });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.providerId, activeTrack.source, effectiveQualityLevel]);
  // Resolve the video quality lazily when video mode opens (for Bilibili, YouTube, NetEase and QQ).
  useEffect(() => {
    const isVideoSource =
      activeTrack.source === "bilibili" ||
      activeTrack.source === "youtube" ||
      activeTrack.source === "netease" ||
      activeTrack.source === "qq";
    if (!BILIBILI_VIDEO_ENABLED || !videoMode || !isVideoSource || !activeTrack.providerId || youtubeWebviewActive) return;
    let cancelled = false;
    api
      .getSourceVideoMeta(activeTrack.source, activeTrack.providerId, videoAudioLevel ?? undefined, videoQn)
      .then((meta) => {
        if (cancelled) return;
        setVideoQualities(meta.availableQualities ?? []);
        setVideoAudioQuality(meta.audioQuality ?? null);
        setVideoAudioLevels(meta.availableAudioLevels ?? []);
        if (!meta.quality) return;
        updateTrackRef.current(activeTrack.id, (track) => ({
          ...track,
          videoQuality: meta.quality ?? track.videoQuality,
          hasVideo: true,
        }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isStandaloneMvSource(activeTrack.source)) {
          setPlaybackError(error instanceof Error ? error.message : "MV 视频加载失败，已切回音频播放。");
          setVideoMode(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.providerId, activeTrack.source, videoMode, videoQn, videoAudioLevel, youtubeWebviewActive]);

  // One-shot MV availability probe for cached/legacy NetEase and QQ tracks
  // whose list row did not yet carry `videoUrl`.
  useEffect(() => {
    if (!BILIBILI_VIDEO_ENABLED) return;
    if (activeTrack.source !== "netease" && activeTrack.source !== "qq") return;
    if (!activeTrack.providerId || activeTrack.videoUrl) return;
    if (probedMvTrackIdsRef.current.has(activeTrack.id)) return;
    probedMvTrackIdsRef.current.add(activeTrack.id);
    const sourceId = activeTrack.source;
    const providerId = activeTrack.providerId;
    const trackId = activeTrack.id;
    let cancelled = false;
    api
      .getSourceVideoMeta(sourceId, providerId)
      .then((meta) => {
        if (cancelled || !meta.url) return;
        updateTrackRef.current(trackId, (track) => ({
          ...track,
          hasVideo: true,
          videoUrl: api.getSourceVideoUrl(sourceId, providerId),
          videoQuality: meta.quality ?? track.videoQuality ?? null,
        }), { includeHistory: false });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.providerId, activeTrack.source, activeTrack.videoUrl]);

  const standaloneMvActive = Boolean(
    BILIBILI_VIDEO_ENABLED &&
      videoMode &&
      isStandaloneMvSource(activeTrack.source) &&
      activeTrack.videoUrl &&
      !listenTogetherActiveRef.current,
  );
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
    () =>
      mergeTracks([
        ...localLikedTracks,
        ...neteaseLikedDisplayTracks,
        ...qqData.likedTracks,
        ...bilibiliData.likedTracks,
        ...youtubeData.likedTracks,
      ]),
    [localLikedTracks, neteaseLikedDisplayTracks, qqData.likedTracks, bilibiliData.likedTracks, youtubeData.likedTracks],
  );
  const linkedLyricCount = useMemo(
    () => allTracks.filter((track) => track.lyricStatus === "linked").length,
    [allTracks],
  );
  const lyricProgress = useMemo(
    () => (allTracks.length ? Math.round((linkedLyricCount / allTracks.length) * 100) : 0),
    [allTracks.length, linkedLyricCount],
  );
  const localSearchSignature = useMemo(() => getTrackSearchSignature(localTracks), [localTracks]);

  const { lyricBindings, setLyricBindings, applyLyricsToTrack, syncLyricsForTrack, lyricSyncingRef } = useLyricsSync({
    applyTrackUpdate,
    activeTrack,
    localTracks,
  });

  // Signing in unlocks Bilibili AI/CC subtitles when Bilibili lyrics are enabled.
  useEffect(() => {
    if (!BILIBILI_LYRICS_ENABLED || !bilibiliConnected || activeTrack.source !== "bilibili") return;
    if (hasSyncedLyrics(activeTrack) || lyricSyncingRef.current.has(activeTrack.id)) return;
    lyricSyncingRef.current.add(activeTrack.id);
    void syncLyricsForTrack(activeTrack)
      .catch(() => undefined)
      .finally(() => lyricSyncingRef.current.delete(activeTrack.id));
    // Regular track changes are already handled by useLyricsSync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bilibiliConnected]);

  const {
    searchBundle,
    searchLoading,
    searchMode,
    setSearchMode,
    searchError,
    searchQqError,
    searchBilibiliError,
    searchYoutubeError,
    searchSuggestions,
    searchTotal,
    searchMore,
    searchQqMore,
    searchBilibiliMore,
    searchYoutubeMore,
    loadMoreSearch,
    retrySearch,
    selectedArtist,
    setSelectedArtist,
    artistTracks,
    artistTracksLoading,
    artistTracksError,
    retryArtistTracks,
    artistAvatarCache,
    artistRequestRef,
    artistAvatarLookupRef,
  } = useDiscovery({
    query,
    suggestionQuery: searchDraft,
    localTracks,
    localSearchSignature,
    allTracks,
    artistSummaries,
    onMergeNeteaseTracks: setNeteaseTracks,
    onMergeQqTracks: setQqSearchTracks,
    onMergeBilibiliTracks: setBilibiliSearchTracks,
    onMergeYoutubeTracks: setYoutubeSearchTracks,
  });

  const {
    selectedUser, setSelectedUser, userDetail, userPlaylists, userLoading, userError,
    userPlaylistsMore, loadMoreUserPlaylists, retryUser,
    selectedAlbum, setSelectedAlbum, albumDetail, albumTracks, albumLoading, albumError, retryAlbum,
    artistDetail, artistAlbums, artistDetailLoading, artistDetailError, artistAlbumsMore,
    loadMoreArtistAlbums, retryArtistDetail,
  } = useDiscoveryDetails({
    selectedArtist,
    onMergeNeteaseTracks: setNeteaseTracks,
    onMergeQqTracks: setQqSearchTracks,
  });

  useEffect(() => {
    if (restoringHistoryRef.current) return;
    setSelectedUser(null);
    setSelectedAlbum(null);
    setSearchFocused(false);
    if (activeView !== "playlists") playlistReturnRef.current = null;
  }, [activeView]);

  useEffect(() => { setSuggestionIndex(-1); }, [searchDraft, searchSuggestions]);

  function clearSearchState() {
    setSearchDraft("");
    setQuery("");
    setSearchFocused(false);
  }

  function submitSearch(rawValue = searchDraft) {
    const trimmed = rawValue.trim();
    setSearchFocused(false);
    if (!trimmed) {
      setQuery("");
      return;
    }
    setSelectedUser(null);
    setSelectedAlbum(null);
    setSearchDraft(trimmed);
    setQuery(trimmed);
  }

  function pickSuggestion(value: string) {
    submitSearch(value);
  }

  const currentViewSnapshot = useMemo<ViewHistorySnapshot>(
    () => ({
      view: activeView,
      query,
      artist: selectedArtist,
      album: selectedAlbum,
      user: selectedUser,
      playlistSource: playlistSourceIntent,
      neteasePlaylist: selectedPlaylist,
      qqPlaylist: qqData.selectedPlaylist,
      bilibiliPlaylist: bilibiliData.selectedPlaylist,
      youtubePlaylist: youtubeData.selectedPlaylist,
      localPlaylistId: localPlaylists.selectedPlaylist?.id ?? null,
    }),
    [
      activeView,
      query,
      selectedArtist,
      selectedAlbum,
      selectedUser,
      playlistSourceIntent,
      selectedPlaylist,
      qqData.selectedPlaylist,
      bilibiliData.selectedPlaylist,
      youtubeData.selectedPlaylist,
      localPlaylists.selectedPlaylist?.id,
    ],
  );

  useEffect(() => {
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      return;
    }
    setViewHistory((current) => pushViewSnapshot(current, currentViewSnapshot));
  }, [currentViewSnapshot]);

  const canGoBack = viewHistory.index > 0;
  const canGoForward = viewHistory.index < viewHistory.entries.length - 1;

  const navigateHistory = useEffectEvent((direction: -1 | 1): boolean => {
    const stepped = stepViewHistory(viewHistory, direction);
    if (!stepped) return false;
    restoringHistoryRef.current = true;
    setViewHistory(stepped.state);
    const target = stepped.target;
    setActiveView(target.view);
    setQuery(target.query);
    setSearchDraft(target.query);
    setSearchFocused(false);
    setSelectedArtist(target.artist);
    setSelectedAlbum(target.album);
    setSelectedUser(target.user);
    setPlaylistSourceIntent(target.playlistSource);
    if (target.neteasePlaylist) {
      if (selectedPlaylist?.id !== target.neteasePlaylist.id) void openPlaylist(target.neteasePlaylist);
    } else if (selectedPlaylist) {
      closePlaylist();
    }
    if (target.qqPlaylist) {
      if (qqData.selectedPlaylist?.id !== target.qqPlaylist.id) void qqData.openPlaylist(target.qqPlaylist);
    } else if (qqData.selectedPlaylist) {
      qqData.closePlaylist();
    }
    if (target.bilibiliPlaylist) {
      if (bilibiliData.selectedPlaylist?.id !== target.bilibiliPlaylist.id) bilibiliData.openPlaylist(target.bilibiliPlaylist);
    } else if (bilibiliData.selectedPlaylist) {
      bilibiliData.closePlaylist();
    }
    if (target.youtubePlaylist) {
      if (youtubeData.selectedPlaylist?.id !== target.youtubePlaylist.id) youtubeData.openPlaylist(target.youtubePlaylist);
    } else if (youtubeData.selectedPlaylist) {
      youtubeData.closePlaylist();
    }
    localPlaylists.setSelectedId(target.localPlaylistId);
    return true;
  });

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        if (navigateHistory(-1)) event.preventDefault();
      } else if (event.button === 4) {
        if (navigateHistory(1)) event.preventDefault();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const contextualQueueTracks = useMemo(() => {
    switch (activeView) {
      case "local":
        return visibleLocalTracks;
      case "liked":
        return likedDisplayTracks;
      case "history":
        return displayHistory.map((entry) => entry.track);
      case "playlists":
        return playlistTracks;
      case "daily":
        return recommendSource === "qq"
          ? qqData.dailyTracks
          : recommendSource === "youtube"
            ? youtubeData.dailyTracks
            : dailyTracks;
      case "radar":
        return recommendSource === "qq"
          ? qqData.roamTracks
          : recommendSource === "youtube"
            ? youtubeData.roamTracks
            : roamTracks;
      case "explore":
        return exploreSource === "youtube"
          ? mergeTracks([
              ...(youtubeData.discovery?.quickPicks ?? []),
              ...(youtubeData.discovery?.trendingTracks ?? []),
            ])
          : exploreTracks;
      case "cloud":
        return cloudLibrary.visibleTracks;
      case "artists":
        return artistTracks;
      case "home":
        return visibleTracks;
      default:
        return [];
    }
  }, [activeView, artistTracks, dailyTracks, displayHistory, exploreSource, exploreTracks, likedDisplayTracks, playlistTracks, qqData.dailyTracks, qqData.roamTracks, youtubeData.dailyTracks, youtubeData.roamTracks, youtubeData.discovery, recommendSource, roamTracks, cloudLibrary.visibleTracks, visibleLocalTracks, visibleTracks]);

  const hasActiveTrack = activeTrack.id !== idleTrack.id;

  // Gapless playback: the engine appends this entry to mpv's playlist while
  // the current track finishes, so the advance happens inside mpv.
  const getNextPreload = useEffectEvent(() => {
    if (ariaRoomRef.current?.isGuest) return null;
    const resolveUrl = (track: Track): string | null => {
      if (!track.streamUrl || track.requiresNativePlayback) return null;
      const resolvedUrl = api.resolveUrl(track.streamUrl);
      if (track.source !== "netease" && track.source !== "qq" && track.source !== "bilibili" && track.source !== "youtube") return resolvedUrl;
      const url = new URL(resolvedUrl, window.location.href);
      url.searchParams.set("level", selectPlaybackQuality(track, { hifiEnabled, masterQualityEnabled, qualityLevel, bilibiliDefaultAudioLevel }));
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
    if (listenTogetherActiveRef.current && next.source !== "netease") return null;
    const url = resolveUrl(next);
    return url ? { trackId: next.id, url } : null;
  });

  const [ariaHostRelayOverride, setAriaHostRelayOverride] = useState<{
    trackId: string;
    streamUrl: string;
  } | null>(null);
  const effectiveAudioTrack = useMemo(
    () =>
      ariaHostRelayOverride && ariaHostRelayOverride.trackId === activeTrack.id
        ? { ...activeTrack, streamUrl: ariaHostRelayOverride.streamUrl }
        : activeTrack,
    [activeTrack, ariaHostRelayOverride],
  );

  const seekNativeTrackRef = useRef<(seconds: number) => Promise<unknown> | void>(() => undefined);
  const {
    audioRef,
    analyserRef,
    audioOutputDevices,
    refreshAudioOutputDevices,
    nativeAudioSupported,
    nativeAudioState,
    selectedSinkId,
    setSelectedSinkId,
    nativePlaybackEnabled,
    activeStreamUrl,
    audioElementStreamUrl,
    playbackError,
    setPlaybackError,
    handleAudioError,
    resetAudioError,
    restartNativeTrack,
    seekNativeTrack,
    setPlaybackSpeed,
    normalizationError,
    equalizerError,
    deviceChangePrompt,
    dismissDeviceChangePrompt,
    recoverAudioOutput,
  } = useAudioEngine({
    activeTrack: effectiveAudioTrack,
    activeTrackId,
    idleTrackId: idleTrack.id,
    effectiveQualityLevel,
    playing,
    volume,
    hifiEnabled,
    masterQualityEnabled,
    gaplessEnabled,
    normalizationEnabled,
    equalizerEnabled: equalizer.enabled,
    equalizerBands: equalizer.bands,
    audioOutputMode,
    pageVisible,
    analyserEnabled:
      pageVisible &&
      !(videoMode && canPlayTrackVideo(activeTrack)) &&
      (activeView === "player" || immersiveOpen),
    videoMode,
    externalAudioActive: standaloneMvActive,
    pendingSeekRef,
    pendingSeekTrackIdRef,
    setPlaying,
    setDurationSeconds,
    exclusiveMode,
    durationSeconds,
    handleTrackEnded,
    handleNativeTrackAdvanced,
    pickRelativeTrack,
    hasMultipleQueueTracks: (playQueueTracks.length || playbackTracks.length) > 1,
    getNextPreload,
    onNativeTrackLoaded: (trackId, durationSec) => {
      const alignSec = ariaRoomRef.current?.consumeGuestInitialAlignSec(trackId, durationSec);
      if (alignSec == null) return;
      const clamped =
        durationSec > 1 ? Math.min(alignSec, Math.max(0, durationSec - 1)) : alignSec;
      const current = getPlaybackTime();
      if (Math.abs(current - clamped) > 0.6) {
        commitPlaybackTime(clamped, true);
        void seekNativeTrackRef.current(clamped);
      }
    },
  });
  seekNativeTrackRef.current = seekNativeTrack;

  useEffect(() => {
    if (!playbackError) return;
    const timer = window.setTimeout(() => setPlaybackError(null), 8000);
    return () => window.clearTimeout(timer);
  }, [playbackError, setPlaybackError]);

  // React playback state is authoritative. mpv can keep an active decoder
  // while restoring a paused session, but that must not animate the spectrum.
  const visualizerPlaying = playing;

  const seekAudioInternal = (nextTime: number, resumePlayback: boolean) => {
    videoControlRef.current?.seek(nextTime);
    if (standaloneMvActive) {
      if (resumePlayback && !playing) setPlaying(true);
      return;
    }
    if (nativePlaybackEnabled) {
      void seekNativeTrack(nextTime);
      if (resumePlayback && !playing) setPlaying(true);
      return;
    }
    if (!audioRef.current) return;
    const audio = audioRef.current;
    if (audio.readyState >= 1) {
      try {
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : nextTime;
        audio.currentTime = Math.min(Math.max(0, nextTime), duration);
      } catch {
        pendingSeekRef.current = nextTime;
        pendingSeekTrackIdRef.current = activeTrack.id;
      }
    } else {
      pendingSeekRef.current = nextTime;
      pendingSeekTrackIdRef.current = activeTrack.id;
    }
    commitPlaybackTime(nextTime, true);
    if (resumePlayback && !playing) setPlaying(true);
  };

  const applyTrackSelection = (targetTrack: Track, queue: Track[]) => {
    if (targetTrack.source === "netease") {
      setNeteaseTracks((current) => trimTrackCache([...current, targetTrack], 360, targetTrack.id));
    } else if (targetTrack.source === "qq") {
      setQqSearchTracks((current) => trimTrackCache([...current, targetTrack], 360, targetTrack.id));
    } else if (targetTrack.source === "bilibili") {
      setBilibiliSearchTracks((current) => trimTrackCache([...current, targetTrack], 360, targetTrack.id));
    } else if (targetTrack.source === "youtube") {
      setYoutubeSearchTracks((current) => trimTrackCache([...current, targetTrack], 360, targetTrack.id));
    }

    const isSameTrack = targetTrack.id === activeTrackRef.current.id;
    const effectiveQueue = queue.length ? queue : [targetTrack];
    setCachedQueueSnapshots(effectiveQueue);
    const playableIds = materializeQueueIds(effectiveQueue, targetTrack.id, shuffleEnabled);
    if (playableIds.length) setPlayQueueIds(playableIds);
    setPlaybackError(null);
    if (isSameTrack) {
      restartActiveTrack();
      return;
    }
    pendingSeekRef.current = 0;
    pendingSeekTrackIdRef.current = null;
    setActiveTrackId(targetTrack.id);
    resetPlaybackTime();
    setDurationSeconds(0);
    setPlaying(true);
  };

  const listenTogether = useListenTogether({
    connected: neteaseConnected,
    activeTrack,
    playing,
    playQueueTracks,
    pageVisible,
    getPlaybackTime,
    onApplyRemoteTrack: (remoteTrack, remoteQueue, progressSeconds, shouldPlay) => {
      const mergedQueue = remoteQueue.length ? remoteQueue : [remoteTrack];
      setNeteaseTracks((current) =>
        trimTrackCache([...current, ...mergedQueue], Math.max(360, mergedQueue.length + 120), remoteTrack.id),
      );
      setCachedQueueSnapshots(mergedQueue);
      const ids = materializeQueueIds(mergedQueue, remoteTrack.id, false);
      if (ids.length) setPlayQueueIds(ids);
      setPlaybackError(null);
      pendingSeekRef.current = progressSeconds;
      pendingSeekTrackIdRef.current = progressSeconds > 0 ? remoteTrack.id : null;
      setActiveTrackId(remoteTrack.id);
      resetPlaybackTime();
      if (progressSeconds > 0.3) commitPlaybackTime(progressSeconds, true);
      setDurationSeconds(0);
      setPlaying(shouldPlay);
    },
    onApplyRemotePlaying: (shouldPlay) => {
      setPlaying(shouldPlay);
    },
    onApplyRemoteSeek: (seconds) => {
      seekAudioInternal(seconds, false);
    },
    onApplyRemoteQueue: (remoteQueue) => {
      if (!remoteQueue.length) return;
      setNeteaseTracks((current) =>
        trimTrackCache([...current, ...remoteQueue], Math.max(360, remoteQueue.length + 120), activeTrack.id),
      );
      setCachedQueueSnapshots(remoteQueue);
      const ids = materializeQueueIds(remoteQueue, activeTrack.id, false);
      if (ids.length) setPlayQueueIds(ids);
    },
    onExecutePendingTrack: (targetTrack, queue) => {
      const resolvedQueue = resolveQueueForTrack(targetTrack.id, queue);
      applyTrackSelection(targetTrack, resolvedQueue);
    },
    onNotice: (message) => {
      setPlaybackNotice(message);
    },
  });
  listenTogetherActiveRef.current = listenTogether.isActive;

  const ariaRoomAccounts = useMemo(
    () => [
      {
        source: "netease" as const,
        connected: Boolean(neteaseAccount?.connected),
        nickname: neteaseAccount?.nickname,
        avatarUrl: neteaseAccount?.avatarUrl,
      },
      {
        source: "qq" as const,
        connected: Boolean(qqAccount?.connected),
        nickname: qqAccount?.nickname,
        avatarUrl: qqAccount?.avatarUrl,
      },
      {
        source: "bilibili" as const,
        connected: Boolean(bilibiliAccount?.connected),
        nickname: bilibiliAccount?.nickname,
        avatarUrl: bilibiliAccount?.avatarUrl,
      },
      {
        source: "youtube" as const,
        connected: Boolean(youtubeAccount?.connected),
        nickname: youtubeAccount?.nickname,
        avatarUrl: youtubeAccount?.avatarUrl,
      },
    ],
    [neteaseAccount, qqAccount, bilibiliAccount, youtubeAccount],
  );
  const hostSourceQueueTracks = useMemo(
    () =>
      playQueueTracks.length
        ? playQueueTracks
        : playbackTracks.length
          ? playbackTracks
          : visibleTracks,
    [playQueueTracks, playbackTracks, visibleTracks],
  );
  const ariaRoomRef = useRef<ReturnType<typeof useAriaRoom> | null>(null);
  const ariaRoom = useAriaRoom({
    activeTrack: activeTrack.id === idleTrack.id ? null : activeTrack,
    playQueueTracks: hostSourceQueueTracks,
    playing,
    durationSeconds,
    getPlaybackTime: () =>
      !nativePlaybackEnabled && audioRef.current && audioRef.current.readyState >= 1
        ? audioRef.current.currentTime || 0
        : getPlaybackTime(),
    accounts: ariaRoomAccounts,
    onBeforeEnterAriaRoom: async () => {
      if (listenTogether.isActive) {
        await listenTogether.leaveRoom();
      }
    },
    onApplyRemoteQueue: (remoteQueue) => {
      setAriaRoomGuestTracks(remoteQueue);
      if (remoteQueue.length) {
        setCachedQueueSnapshots(remoteQueue);
        setPlayQueueIds(remoteQueue.map((item) => item.id));
      }
    },
    onApplyRemoteTrack: (remoteTrack, remoteQueue, shouldPlay, positionSec) => {
      const merged = remoteQueue.length ? remoteQueue : [remoteTrack];
      const wasSameTrack = remoteTrack.id === activeTrackRef.current.id;
      setAriaRoomGuestTracks(merged);
      applyTrackSelection(remoteTrack, merged);
      setPlayQueueIds(merged.map((item) => item.id));
      if (positionSec > 0.2) {
        pendingSeekRef.current = positionSec;
        pendingSeekTrackIdRef.current = remoteTrack.id;
        commitPlaybackTime(positionSec, true);
        if (wasSameTrack) {
          seekAudioInternal(positionSec, shouldPlay);
        }
      }
      setPlaying(shouldPlay);
    },
    onApplyRemotePlaying: (shouldPlay, positionSec) => {
      if (typeof positionSec === "number") {
        const liveTime =
          !nativePlaybackEnabled && audioRef.current && audioRef.current.readyState >= 1
            ? audioRef.current.currentTime || 0
            : getPlaybackTime();
        const needSeek = !shouldPlay
          ? Math.abs(liveTime - positionSec) >= 0.35
          : Math.abs(liveTime - positionSec) >= 1.2 || (!playing && positionSec > 0.5);
        if (needSeek) {
          seekAudioInternal(positionSec, shouldPlay);
        }
      }
      setPlaying(shouldPlay);
    },
    onApplyRemoteSeek: (positionSec) => {
      seekAudioInternal(positionSec, false);
    },
    onApplyPlaybackSpeed: setPlaybackSpeed,
    onAutoAdvanceTrack: () => pickRelativeTrack(1),
    onHostRelayStreamOverride: setAriaHostRelayOverride,
    onHostExecuteCommand: ({ action, payload }) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      if (action === "toggle_play") {
        const nextPlaying = Boolean(p.playing);
        const liveHostPos = getPlaybackTime();
        const pos = liveHostPos > 0.1 || typeof p.positionSec !== "number" ? liveHostPos : p.positionSec;
        setPlaying(nextPlaying);
        ariaRoomRef.current?.reportPlayPause(nextPlaying, pos);
        return;
      }
      if (action === "seek" && typeof p.positionSec === "number") {
        seekAudioInternal(p.positionSec, false);
        ariaRoomRef.current?.reportSeek(p.positionSec);
        return;
      }
      if (action === "pick_nonce" && typeof p.nonce === "string") {
        const currentQueue = ariaRoomRef.current?.snapshot.playback.queue ?? [];
        const target = currentQueue.find((q) => q.nonce === p.nonce);
        if (target) {
          void ariaRoomRef.current?.hostPlayRoomPayload(target, currentQueue);
        }
        return;
      }
      if (action === "pick_track_local" && p.track && Array.isArray(p.queue)) {
        const target = p.track as Track;
        const queue = p.queue as Track[];
        const mergedPool = mergeTracks([target, ...queue]);
        setAriaRoomGuestTracks((prev) => mergeTracks([...mergedPool, ...prev]).slice(0, 300));
        applyTrackSelection(target, queue);
        setPlayQueueIds(queue.map((item) => item.id));
        return;
      }
      if (action === "import_queue" && Array.isArray(p.tracks)) {
        const payloads = p.tracks as AriaRoomTrackPayload[];
        if (payloads.length > 0) {
          void ariaRoomRef.current?.hostImportRoomPayloads(payloads);
        }
        return;
      }
      if (action === "add_and_play" && p.track) {
        const added = p.track as AriaRoomTrackPayload;
        void ariaRoomRef.current?.hostPlayRoomPayload(added);
      }
    },
    onNotice: (message) => setPlaybackNotice(message),
  });
  ariaRoomRef.current = ariaRoom;

  const effectiveQueueTracks = useMemo(
    () =>
      ariaRoom.isGuest && ariaRoomGuestTracks.length > 0
        ? ariaRoomGuestTracks
        : playQueueTracks.length
          ? playQueueTracks
          : visibleTracks,
    [ariaRoom.isGuest, ariaRoomGuestTracks, playQueueTracks, visibleTracks],
  );

  const superMixQuickImportItems = useMemo(
    () =>
      localPlaylists.playlists
        .filter((pl) => pl.kind === "super-mix")
        .map((playlist) => ({
          playlist,
          tracks: resolveLocalPlaylistTracks(playlist, allTracks),
        })),
    [localPlaylists.playlists, allTracks],
  );
  useEffect(() => {
    if (listenTogether.isActive && videoMode && isStandaloneMvSource(activeTrack.source)) {
      setVideoMode(false);
    }
  }, [listenTogether.isActive, videoMode, activeTrack.source]);

  function handleNativeTrackAdvanced(trackId: string) {
    if (!nativePlaybackEnabled || !trackId) return;

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
    if (listenTogether.guardTrackSelection(nextTrack, queue) || ariaRoom.guardTrackSelection(nextTrack)) return;

    const formerNeteaseId = activeTrack.source === "netease" ? activeTrack.providerId ?? null : null;
    pendingSeekRef.current = 0;
    pendingSeekTrackIdRef.current = null;
    resetPlaybackTime();
    setDurationSeconds(0);
    if (nextTrack.id !== activeTrack.id) setActiveTrackId(nextTrack.id);
    setPlaying(true);
    listenTogether.reportTrackChange(nextTrack, formerNeteaseId);
    ariaRoom.reportTrackChange(nextTrack, queue);
  }

  function pickRelativeTrack(direction: 1 | -1) {
    if (ariaRoom.isGuest && ariaRoomGuestTracks.length > 0) {
      const currentIndex = ariaRoomGuestTracks.findIndex((track) => track.id === activeTrack.id);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (safeIndex + direction + ariaRoomGuestTracks.length) % ariaRoomGuestTracks.length;
      const nextTrack = ariaRoomGuestTracks[nextIndex];
      if (nextTrack && ariaRoom.guardTrackSelection(nextTrack)) return;
    }
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
    pendingSeekTrackIdRef.current = null;
    const currentIndex = queue.findIndex((track) => track.id === activeTrack.id);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + queue.length) % queue.length;
    const nextTrack = queue[nextIndex];
    if (listenTogether.guardTrackSelection(nextTrack, queue) || ariaRoom.guardTrackSelection(nextTrack)) return;
    if (nextTrack.id === activeTrack.id) {
      if (nativePlaybackEnabled) {
        void restartNativeTrack().then((restarted) => {
          if (!restarted) setPlaying(() => false);
        });
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setPlaying(false));
      }
    }
    const isSameTrack = nextTrack.id === activeTrack.id;
    const formerNeteaseId = activeTrack.source === "netease" ? activeTrack.providerId ?? null : null;
    setActiveTrackId(nextTrack.id);
    resetPlaybackTime();
    if (!isSameTrack) setDurationSeconds(0);
    setPlaying(true);
    listenTogether.reportTrackChange(nextTrack, formerNeteaseId);
    ariaRoom.reportTrackChange(nextTrack, queue, { restartFromZero: isSameTrack });
  }

  function queueIdsForManagement() {
    const sourceTracks = playQueueTracks.length ? playQueueTracks : visibleTracks;
    const ids = playQueueIds.length ? [...playQueueIds] : orderedQueueIds(sourceTracks);
    if (activeTrack.id !== idleTrack.id && activeTrack.streamUrl && !ids.includes(activeTrack.id)) {
      ids.unshift(activeTrack.id);
    }
    return ids;
  }

  function syncHostQueueIds(ids: string[]) {
    if (!ariaRoom.isHost) return;
    const nextTracks = ids
      .map((id) => allTracksById.get(id))
      .filter((item): item is Track => Boolean(item));
    ariaRoom.reportQueueChange(nextTracks);
  }

  function playNextTrack(trackId: string) {
    if (!trackId || trackId === activeTrack.id) return;
    const ids = queueIdsForManagement().filter((id) => id !== trackId);
    const activeIndex = ids.indexOf(activeTrack.id);
    ids.splice(activeIndex >= 0 ? activeIndex + 1 : 0, 0, trackId);
    setPlayQueueIds(ids);
    syncHostQueueIds(ids);
  }

  function removeFromQueue(trackId: string) {
    if (!trackId || trackId === activeTrack.id) return;
    const ids = queueIdsForManagement().filter((id) => id !== trackId);
    setPlayQueueIds(ids);
    syncHostQueueIds(ids);
  }

  function clearQueue() {
    const ids = activeTrack.id !== idleTrack.id && activeTrack.streamUrl ? [activeTrack.id] : [];
    setPlayQueueIds(ids);
    syncHostQueueIds(ids);
  }

  function moveQueueTrack(trackId: string, direction: "up" | "down") {
    if (!trackId || trackId === activeTrack.id) return;
    const ids = queueIdsForManagement();
    const index = ids.indexOf(trackId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ids.length) return;
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    setPlayQueueIds(ids);
    syncHostQueueIds(ids);
  }

  function restartActiveTrack() {
    pendingSeekRef.current = 0;
    pendingSeekTrackIdRef.current = null;
    resetPlaybackTime();
    setPlaying(true);
    if (standaloneMvActive) {
      videoControlRef.current?.seek(0);
      videoControlRef.current?.element?.play().catch(() => setPlaying(false));
      return;
    }
    if (nativePlaybackEnabled) {
      void restartNativeTrack().then((restarted) => {
        if (!restarted) setPlaying(() => false);
      });
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => setPlaying(false));
  }

  function handleTrackEnded() {
    if (ariaRoom.isGuest) return;
    if (repeatMode === "one") {
      restartActiveTrack();
      if (ariaRoom.isHost) {
        ariaRoom.reportTrackChange(activeTrack, effectiveQueueTracks, { restartFromZero: true });
      }
      return;
    }
    pickRelativeTrack(1);
  }

  function seekTo(nextTime: number) {
    if (ariaRoom.isGuest && ariaRoom.snapshot.controlMode === "host-only") {
      setPlaybackNotice("当前房间仅房主可控制播放进度");
      return;
    }
    if (ariaRoom.isActive) {
      seekAudioInternal(nextTime, false);
      ariaRoom.reportSeek(nextTime);
      return;
    }
    seekAudioInternal(nextTime, true);
    listenTogether.reportSeek(nextTime);
  }

  function toggleVideoMode() {
    if (!canPlayTrackVideo(activeTrack)) return;
    if (!videoMode && isStandaloneMvSource(activeTrack.source) && listenTogether.isActive) {
      setPlaybackNotice("一起听同步房间内暂不支持切换独立音轨 MV，退出房间后可观看官方 MV");
      return;
    }
    setVideoMode((value) => !value);
  }

  function handleYoutubeOffsetChange(deltaOrReset: number | "reset") {
    const next = deltaOrReset === "reset" ? 0 : nudgeYoutubeVideoOffset(youtubeOffsetSeconds, deltaOrReset);
    const saved = activeTrack.providerId ? saveYoutubeVideoOffset(activeTrack.providerId, next) : next;
    setYoutubeOffsetSeconds(saved);
  }

  function togglePlayback() {
    if (ariaRoom.isGuest && ariaRoom.snapshot.controlMode === "host-only") {
      setPlaybackNotice("当前房间仅房主可控制播放与暂停");
      return;
    }
    if (activeStreamUrl && activeTrack.id !== idleTrack.id) {
      const nextPlaying = !playing;
      setPlaying(nextPlaying);
      listenTogether.reportPlayPause(nextPlaying);
      ariaRoom.reportPlayPause(nextPlaying, getPlaybackTime());
      return;
    }

    const fallbackTrack = playableTracks(playQueueTracks)[0] ?? playableTracks(contextualQueueTracks)[0] ?? playbackTracks[0];
    if (fallbackTrack) chooseTrack(fallbackTrack.id);
  }

  function openArtistForTrack(track: Track) {
    if (immersiveOpen) void closeImmersiveView();
    const source = track.source === "qq" ? "qq" : track.source === "netease" ? "netease" : "local";
    const artistId = track.artistIds?.[0];
    const name = splitArtistNames(track.artist)[0] ?? track.artist;
    if ((source === "qq" || source === "netease") && artistId) {
      setSelectedArtist({
        id: `${source}:${artistId}`,
        name,
        source,
        providerId: artistId,
        providerSource: source,
        trackCount: 0,
        avatarUrl: null,
      });
    } else {
      setSelectedArtist({
        id: `artist:${name.toLowerCase()}`,
        name,
        source: "local",
        providerId: null,
        providerSource: null,
        trackCount: 0,
        avatarUrl: null,
      });
    }
    setSelectedUser(null);
    setSelectedAlbum(null);
    clearSearchState();
    setActiveView("artists");
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
      qqData.dailyTracks,
      qqData.roamTracks,
      qqData.playlistTracks,
      qqData.likedTracks,
      bilibiliSearchTracks,
      bilibiliData.likedTracks,
      bilibiliData.playlistTracks,
      youtubeSearchTracks,
      youtubeData.likedTracks,
      youtubeData.playlistTracks,
      youtubeData.dailyTracks,
      youtubeData.roamTracks,
      youtubeData.discovery?.quickPicks ?? [],
      youtubeData.discovery?.trendingTracks ?? [],
      localPlaylists.selectedTracks,
      artistTracks,
      cloudTracks,
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
      playQueueTracks.find((track) => track.id === trackId) ??
      (cachedActiveTrackSnapshot?.id === trackId ? cachedActiveTrackSnapshot : null);
    if (!targetTrack?.streamUrl) {
      setPlaybackNotice("这首歌暂时没有可播放地址，可能受版权、会员或音源限制。");
      return;
    }
    if (listenTogether.guardTrackSelection(targetTrack, preferredQueue) || ariaRoom.guardTrackSelection(targetTrack)) return;
    const isSameTrack = targetTrack.id === activeTrackRef.current.id;
    const formerNeteaseId = activeTrack.source === "netease" ? activeTrack.providerId ?? null : null;
    const effectiveQueue = queue.length ? queue : [targetTrack];
    applyTrackSelection(targetTrack, effectiveQueue);
    listenTogether.reportTrackChange(targetTrack, formerNeteaseId, effectiveQueue);
    ariaRoom.reportTrackChange(targetTrack, effectiveQueue, { restartFromZero: isSameTrack });
  }

  function toggleShuffleQueue() {
    const nextShuffleEnabled = !shuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);
    const queue = resolveQueueForTrack(activeTrack.id);
    const playableIds = materializeQueueIds(queue.length ? queue : playQueueTracks, activeTrack.id, nextShuffleEnabled);
    if (playableIds.length) {
      setPlayQueueIds(playableIds);
      syncHostQueueIds(playableIds);
    }
  }

  function isTrackLiked(track: Track): boolean {
    const canonicalId = canonicalTrackId(track);
    const providerKey =
      track.providerId && track.source !== "local" ? `${track.source}:${track.providerId}` : null;
    if (track.source === "netease") {
      return Boolean(
        neteaseLikedIds[track.id] ||
          neteaseLikedIds[canonicalId] ||
          (providerKey && neteaseLikedIds[providerKey]),
      );
    }
    if (track.source === "qq") {
      return Boolean(
        qqData.likedIds[track.id] ||
          qqData.likedIds[canonicalId] ||
          (providerKey && qqData.likedIds[providerKey]),
      );
    }
    if (track.source === "bilibili") {
      return Boolean(
        bilibiliData.likedIds[track.id] ||
          bilibiliData.likedIds[canonicalId] ||
          (providerKey && bilibiliData.likedIds[providerKey]),
      );
    }
    if (track.source === "youtube") {
      return Boolean(
        youtubeData.likedIds[track.id] ||
          youtubeData.likedIds[canonicalId] ||
          (providerKey && youtubeData.likedIds[providerKey]),
      );
    }
    return Boolean(likedTrackIds[track.id] || likedTrackIds[canonicalId]);
  }

  function toggleLikeTrack(trackId: string) {
    const rawTrack = allTracks.find((item) => item.id === trackId) ??
      (activeTrack.id === trackId ? activeTrack : undefined);
    const track = rawTrack ? canonicalizeTrackForLibrary(rawTrack) : undefined;
    if (track?.source === "netease") {
      toggleNeteaseLike(track);
      return;
    }
    if (track?.source === "qq") {
      void qqData.toggleLike(track).catch((error: unknown) => {
        setPlaybackNotice(error instanceof Error ? error.message : "QQ 音乐红心同步失败，请稍后再试");
      });
      return;
    }
    if (track?.source === "bilibili") {
      void bilibiliData.toggleLike(track).catch((error: unknown) => {
        setPlaybackNotice(error instanceof Error ? error.message : "B站收藏同步失败，请稍后再试");
      });
      return;
    }
    if (track?.source === "youtube") {
      void youtubeData.toggleLike(track).catch((error: unknown) => {
        setPlaybackNotice(error instanceof Error ? error.message : "YouTube 喜欢同步失败，请稍后再试");
      });
      return;
    }
    const likeKey = rawTrack ? canonicalTrackId(rawTrack) : trackId;
    setLikedTrackIds((current) => {
      if (current[likeKey]) {
        const next = { ...current };
        delete next[likeKey];
        return next;
      }
      return { ...current, [likeKey]: true };
    });
  }

  // Every track-list setter exists by now; wire the shared update helper.
  updateTrackRef.current = (trackId, updateTrack, updateOptions) => {
    const includeHistory = updateOptions?.includeHistory ?? true;
    // Metadata warmups touch one track at a time; skip the full array copy
    // (and the re-render it triggers) for lists that do not contain it.
    const applyTo = (tracks: Track[]) => updateTracksById(tracks, trackId, updateTrack);
    setAriaRoomGuestTracks(applyTo);
    setLocalTracks(applyTo);
    setNeteaseTracks(applyTo);
    setQqSearchTracks(applyTo);
    setBilibiliSearchTracks(applyTo);
    setYoutubeSearchTracks(applyTo);
    setDailyTracks(applyTo);
    setRoamTracks(applyTo);
    setNeteaseLikedTracks(applyTo);
    setPlaylistTracks(applyTo);
    qqData.setLikedTracks(applyTo);
    qqData.setPlaylistTracks(applyTo);
    qqData.setDailyTracks(applyTo);
    qqData.setRoamTracks(applyTo);
    bilibiliData.setLikedTracks(applyTo);
    bilibiliData.setPlaylistTracks(applyTo);
    youtubeData.setLikedTracks(applyTo);
    youtubeData.setPlaylistTracks(applyTo);
    youtubeData.setDailyTracks(applyTo);
    youtubeData.setRoamTracks(applyTo);
    youtubeData.setDiscovery((current) =>
      current
        ? {
            ...current,
            quickPicks: applyTo(current.quickPicks),
            trendingTracks: applyTo(current.trendingTracks),
          }
        : current,
    );
    setCloudTracks(applyTo);
    setExploreTracks(applyTo);
    setCachedQueueSnapshots(applyTo);
    setCachedActiveTrackSnapshot((current) => current?.id === trackId ? updateTrack(current) : current);
    if (includeHistory) {
      setPlayHistory((current) =>
        current.some((entry) => entry.track.id === trackId)
          ? current.map((entry) => entry.track.id === trackId ? {
              ...entry,
              track: updateTrack(entry.track),
            } : entry)
          : current,
      );
    }
  };

  const handlePlaybackCommand = useEffectEvent((command: "toggle" | "play" | "pause" | "previous" | "next" | Exclude<ShortcutCommand, "show">) => {
    if (command === "pause") {
      setPlaying(false);
      listenTogether.reportPlayPause(false);
      ariaRoom.reportPlayPause(false, getPlaybackTime());
      return;
    }
    if (command === "play") {
      if (activeStreamUrl && activeTrack.id !== idleTrack.id) {
        setPlaying(true);
        listenTogether.reportPlayPause(true);
        ariaRoom.reportPlayPause(true, getPlaybackTime());
      } else {
        togglePlayback();
      }
      return;
    }
    if (command === "toggle") {
      togglePlayback();
      return;
    }
    if (command === "previous") {
      pickRelativeTrack(-1);
      return;
    }
    if (command === "next") {
      pickRelativeTrack(1);
      return;
    }
    if (command === "volumeUp") {
      setVolume((current) => Math.min(100, Math.round(current + 5)));
      return;
    }
    if (command === "volumeDown") {
      setVolume((current) => Math.max(0, Math.round(current - 5)));
      return;
    }
    if (command === "mute") {
      if (volume > 0) {
        lastNonZeroVolumeRef.current = volume;
        setVolume(0);
      } else {
        setVolume(lastNonZeroVolumeRef.current || 65);
      }
      return;
    }
    if (command === "like") {
      if (hasActiveTrack) toggleLikeTrack(activeTrack.id);
      return;
    }
    if (command === "mode") {
      if (repeatMode === "one") {
        setRepeatMode("all");
        if (shuffleEnabled) toggleShuffleQueue();
      } else if (shuffleEnabled) {
        toggleShuffleQueue();
        setRepeatMode("one");
      } else {
        toggleShuffleQueue();
      }
      return;
    }
    if (command === "equalizer") {
      if (activeView === "player") {
        setEqualizerOpen((open) => !open);
      } else {
        clearSearchState();
        setSelectedUser(null);
        setSelectedAlbum(null);
        setActiveView("player");
        setEqualizerOpen(true);
      }
    }
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

  const handleOpenSettingsFromShell = useEffectEvent(() => {
    setSettingsReturnView(activeView === "settings" ? "home" : activeView);
    clearSearchState();
    setImmersiveOpen(false);
    setActiveView("settings");
  });

  useEffect(() => {
    return window.ariaDesktop?.onOpenSettings?.(handleOpenSettingsFromShell);
  }, [handleOpenSettingsFromShell]);

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

  useEffect(() => {
    const coverUrl = hasActiveTrack ? activeTrack.coverUrl : undefined;
    const controller = new AbortController();
    setMediaArtwork(null);
    if (!coverUrl) return () => controller.abort();

    void createMediaSessionArtwork(coverUrl, controller.signal).then((artwork) => {
      if (!controller.signal.aborted) setMediaArtwork({ trackId: activeTrack.id, coverUrl, data: artwork });
    });
    return () => controller.abort();
  }, [activeTrack.coverUrl, activeTrack.id, hasActiveTrack]);

  const seekToFromMediaKey = useEffectEvent((time: number) => seekTo(time));

  // Publish playback to the OS media overlay / lock screen (Windows SMTC).
  useEffect(() => {
    void window.ariaDesktop?.updateMediaSession?.({
      active: hasActiveTrack,
      title: hasActiveTrack ? activeTrack.title : "",
      artist: hasActiveTrack ? activeTrack.artist : "",
      album: hasActiveTrack ? activeTrack.album : "",
      artwork: mediaSessionArtwork,
      playing,
      canPrevious: hasActiveTrack,
      canNext: hasActiveTrack,
    }).catch(() => undefined);
  }, [activeTrack.album, activeTrack.artist, activeTrack.id, activeTrack.title, hasActiveTrack, mediaSessionArtwork, playing]);

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
      artwork: mediaSessionArtwork
        ? [{ src: mediaSessionArtwork, sizes: "256x256", type: "image/png" }]
        : [],
    });
    mediaSession.playbackState = playing ? "playing" : "paused";
  }, [activeTrack.album, activeTrack.artist, activeTrack.id, activeTrack.title, hasActiveTrack, mediaSessionArtwork, playing]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;

    const handlers: Array<[MediaSessionAction, ((details: MediaSessionActionDetails) => void) | null]> = [
      ["play", () => handlePlaybackCommand("play")],
      ["pause", () => handlePlaybackCommand("pause")],
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
    if (!window.ariaDesktop?.setTaskbarPreviewRect || !pageVisible) return;
    let observer: ResizeObserver | null = null;
    let observedElement: HTMLElement | null = null;
    const update = () => {
      const selectors = immersiveOpen
        ? ['[data-taskbar-anchor="immersive"]']
        : activeView === "player"
          ? ['[data-taskbar-anchor="player-cover"]']
          : activeView === "home"
            ? ['[data-taskbar-anchor="home-cover"]']
            : [];
      let matchedElement: HTMLElement | null = null;
      let rect: DOMRect | null = null;
      for (const selector of selectors) {
        const candidate = document.querySelector<HTMLElement>(selector);
        if (!candidate) continue;
        matchedElement = candidate;
        const nextRect = candidate.getBoundingClientRect();
        if (nextRect.width >= 8 && nextRect.height >= 8 && nextRect.right > 0 && nextRect.bottom > 0) {
          rect = nextRect;
          break;
        }
      }
      if (observer && matchedElement !== observedElement) {
        observer.disconnect();
        observedElement = matchedElement;
        if (matchedElement) observer.observe(matchedElement);
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
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(update);
    }
    update();
    const transitionTimer = window.setTimeout(update, 280);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.clearTimeout(transitionTimer);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [activeView, activeTrack.id, immersiveOpen, pageVisible]);

  const lastTaskbarCoverTrackIdRef = useRef<string | null>(null);

  // Feed a bounded 220x220 cover bitmap to the native DWM taskbar thumbnail.
  useEffect(() => {
    const setThumb = window.ariaDesktop?.setTaskbarIconicThumb;
    const clearThumb = window.ariaDesktop?.clearTaskbarIconicThumb;
    if (!setThumb) return;

    const controller = new AbortController();
    let sending = false;
    let sendQueued = false;
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 220;
    thumbnail.height = 220;
    const thumbnailContext = thumbnail.getContext("2d", { willReadFrequently: true });
    if (!thumbnailContext) return;

    if (!hasActiveTrack) {
      lastTaskbarCoverTrackIdRef.current = null;
      void clearThumb?.().catch(() => undefined);
      return;
    }

    const drawCover = (context: CanvasRenderingContext2D, width: number, height: number, image: CanvasImageSource | null, naturalWidth = 0, naturalHeight = 0) => {
      const fallback = context.createLinearGradient(0, 0, width, height);
      fallback.addColorStop(0, activeTrack.accent || "#343844");
      fallback.addColorStop(1, "#171717");
      context.fillStyle = fallback;
      context.fillRect(0, 0, width, height);
      if (!image || !naturalWidth || !naturalHeight) return;
      const scale = Math.max(width / naturalWidth, height / naturalHeight);
      const drawWidth = naturalWidth * scale;
      const drawHeight = naturalHeight * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };

    const send = () => {
      if (controller.signal.aborted) return;
      if (sending) {
        sendQueued = true;
        return;
      }
      try {
        const thumbnailPixels = thumbnailContext.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
        // The large Aero Peek preview is intentionally left to DWM's live
        // capture of the real Aria window. Sending a second hand-drawn frame
        // here made the preview diverge from the application UI.
        sending = true;
        void setThumb(thumbnailPixels, thumbnail.width, thumbnail.height)
          .catch(() => undefined)
          .finally(() => {
            sending = false;
            if (sendQueued && !controller.signal.aborted) {
              sendQueued = false;
              send();
            }
          });
      } catch {
        // Canvas readback can fail on tainted images; the native preview keeps
        // the last valid frame in that case.
      }
    };

    // Only emit the gradient placeholder on a track change; never clobber an
    // already-painted cover for the current track when accent/metadata updates.
    if (lastTaskbarCoverTrackIdRef.current !== activeTrack.id) {
      drawCover(thumbnailContext, thumbnail.width, thumbnail.height, null);
      send();
    }

    const paintFromBitmap = (bitmap: ImageBitmap | null) => {
      if (!bitmap || controller.signal.aborted) {
        bitmap?.close();
        return false;
      }
      try {
        drawCover(thumbnailContext, thumbnail.width, thumbnail.height, bitmap, bitmap.width, bitmap.height);
        lastTaskbarCoverTrackIdRef.current = activeTrack.id;
        send();
        return true;
      } finally {
        bitmap.close();
      }
    };

    const paintViaImageElement = (src: string) => {
      if (controller.signal.aborted) return;
      const imageElement = new Image();
      imageElement.crossOrigin = "anonymous";
      imageElement.decoding = "async";
      const releaseImage = () => {
        imageElement.onload = null;
        imageElement.onerror = null;
        imageElement.removeAttribute("src");
      };
      controller.signal.addEventListener("abort", releaseImage, { once: true });
      imageElement.onload = () => {
        if (!controller.signal.aborted && imageElement.naturalWidth && imageElement.naturalHeight) {
          drawCover(thumbnailContext, thumbnail.width, thumbnail.height, imageElement, imageElement.naturalWidth, imageElement.naturalHeight);
          lastTaskbarCoverTrackIdRef.current = activeTrack.id;
          send();
        }
        releaseImage();
      };
      imageElement.onerror = releaseImage;
      imageElement.src = src;
    };

    if (mediaSessionArtwork) {
      void fetch(mediaSessionArtwork, { signal: controller.signal })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => (blob && !controller.signal.aborted ? createImageBitmap(blob) : null))
        .then((bitmap) => {
          if (!paintFromBitmap(bitmap) && !controller.signal.aborted && activeTrack.coverUrl) {
            paintViaImageElement(mediaSessionArtwork);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) paintViaImageElement(mediaSessionArtwork);
        });
    } else if (activeTrack.coverUrl) {
      void loadCoverBitmapWithFallback(activeTrack.coverUrl, controller.signal).then((bitmap) => {
        if (!paintFromBitmap(bitmap) && !controller.signal.aborted && activeTrack.coverUrl) {
          const fallbackUrl = cachedArtworkUrl(activeTrack.coverUrl, 320) ?? activeTrack.coverUrl;
          paintViaImageElement(fallbackUrl);
        }
      });
    }

    return () => {
      controller.abort();
    };
  }, [activeTrack.accent, activeTrack.coverUrl, activeTrack.id, hasActiveTrack, mediaSessionArtwork]);

  function commitActiveVideoTime() {
    // Audio engine owns the authoritative clock even while muted video is open.
  }

  async function openImmersiveView() {
    commitActiveVideoTime();
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
    commitActiveVideoTime();
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
      if (event.key === "BrowserBack") {
        if (navigateHistory(-1)) event.preventDefault();
        return;
      }
      if (event.key === "BrowserForward") {
        if (navigateHistory(1)) event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        if (immersiveOpen) {
          event.preventDefault();
          void closeImmersiveView();
        } else if (videoMode) {
          event.preventDefault();
          setVideoMode(false);
        }
        return;
      }
      if (!window.ariaDesktop?.configureGlobalShortcuts) {
        for (const { command } of shortcutDefinitions) {
          if (command === "show") continue;
          if (matchesShortcut(event, keyboardShortcuts[command])) {
            event.preventDefault();
            handlePlaybackCommand(command);
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePlaybackCommand, immersiveOpen, keyboardShortcuts, videoMode]);

  useEffect(() => {
    const sourceTracks = activeView === "radar"
      ? roamTracks
      : activeView === "explore"
        ? exploreTracks
        : playQueueTracks.length ? playQueueTracks : visibleTracks;
    const tracksToWarm = sourceTracks.slice(0, activeView === "radar" || activeView === "explore" ? 72 : playing ? 12 : 36);
    const timer = window.setTimeout(() => warmNeteaseTrackCache(tracksToWarm), playing ? 1600 : 260);
    return () => window.clearTimeout(timer);
    // warmNeteaseTrackCache closes over fresh state on every render, matching
    // the pre-hook behavior; only its inputs belong in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, exploreTracks, hifiEnabled, masterQualityEnabled, playing, playQueueTracks, roamTracks, qualityLevel, visibleTracks]);

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
    const tracksToWarm = [activeTrack, ...playQueueTracks.slice(0, 8), ...visibleTracks.slice(0, 12)];
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
        warmLocalCoverCache(uiTracks.slice(0, 16));
        setLibraryMeta({ roots: library.roots, updatedAt: library.updatedAt });
      })
      .catch(() => {
        setLibraryMeta({ roots: [], updatedAt: null });
      });
  }, []);

  useEffect(() => {
    const poller = createLibraryWatchPoller({
      getState: api.getLibraryWatchState,
      getLibrary: api.getLibrary,
      onState: (state) => setLibraryWatchState((current) => sameLibraryWatchState(current, state) ? current : state),
      onLibrary: (library) => {
        const uiTracks = library.tracks.map(localTrackToUiTrack);
        setLocalTracks(uiTracks);
        warmLocalCoverCache(uiTracks.slice(0, 16));
        setLibraryMeta({ roots: library.roots, updatedAt: library.updatedAt });
      },
    });
    void poller.poll();
    const timer = window.setInterval(() => void poller.poll(), 20_000);
    return () => {
      poller.dispose();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addLibraryFolder() {
    const chooseFolder = window.ariaDesktop?.chooseMusicFolder;
    if (!chooseFolder) return;
    const selectedPath = await chooseFolder();
    if (!selectedPath) return;
    try {
      await scanBackendPath(selectedPath, { openLibrary: false });
      setLibraryWatchState(await api.getLibraryWatchState());
    } catch {
      // The scan job already reports its error through libraryScanProgress.
    }
  }

  async function removeLibraryFolder(root: string) {
    if (!window.confirm(`从曲库中移除“${root}”？音频文件不会被删除。`)) return;
    try {
      await removeLibraryRoot(root);
      setLibraryWatchState(await api.getLibraryWatchState());
    } catch {
      // Keep the current index if the backend rejects the removal.
    }
  }

  async function toggleLibraryAutoScan(enabled: boolean) {
    try {
      setLibraryWatchState(await api.setLibraryAutoScan(enabled));
    } catch {
      // The switch keeps its previous state when the backend is unavailable.
    }
  }

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
      writeDailyActivity(dailyActivity);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [dailyActivity]);

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

  const writeLatestPlayerCacheRef = useRef<() => void>(() => undefined);
  writeLatestPlayerCacheRef.current = () => {
    if (activeTrack.id === idleTrack.id || activeTrack.id !== activeTrackId) return;
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
      updatedAt: Date.now(),
    });
  };
  const playerCacheTaskRef = useRef<ReturnType<typeof createDebouncedTask> | null>(null);
  if (!playerCacheTaskRef.current) {
    playerCacheTaskRef.current = createDebouncedTask(() => writeLatestPlayerCacheRef.current(), 300);
  }

  useEffect(() => {
    if (activeTrack.id === idleTrack.id || activeTrack.id !== activeTrackId) {
      playerCacheTaskRef.current?.cancel();
      return;
    }
    playerCacheTaskRef.current?.schedule();
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
    const flush = () => playerCacheTaskRef.current?.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        setNeteaseAccount((current) => (current?.connected ? current : settings.neteaseAccount));
        setLyricBindings(settings.lyricBindings);
        if (settings.neteaseAccount.connected) {
          // Start the music refresh immediately from the persisted identity.
          // The provider round trip below only replaces the provisional name
          // and avatar once it completes.
          refreshNeteaseData().catch(() => {
            // Keep the startup snapshot on a transient provider failure. Only
            // an explicit sign-out (account.connected === false) clears it.
          });
          if (!settings.neteaseAccount.userId) {
            void api.getNeteaseAccount()
              .then(({ account }) => setNeteaseAccount(account))
              .catch(() => undefined);
          }
        }
      })
      .catch(() => setNeteaseAccount(null));
  }, []);

  useEffect(() => {
    if (activeTrack.source !== "netease" || !activeTrack.providerId) return;
    if (ariaRoom.isGuest && activeTrack.id.startsWith("aria-room:")) return;

    let cancelled = false;
    api
      .getNeteaseStreamMeta(activeTrack.providerId, effectiveQualityLevel)
      .then((meta) => {
        if (cancelled) return;
        applyStreamMetaToTrack(activeTrack.id, meta, { authoritative: true });
        if (!meta.url && playing) {
          setPlaybackError("网易云没有返回可播放地址：可能受会员、版权或当前网络环境限制。");
        }
      })
      .catch((error: unknown) => {
        // 流地址解析失败时把服务端的真实原因（会员限制 / 频控 / 网络风险）
        // 带到播放器，而不是让用户以为点了没反应。
        if (!cancelled && playing) {
          setPlaybackError(error instanceof Error ? error.message : "网易云播放地址解析失败，请稍后重试。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.providerId, activeTrack.source, effectiveQualityLevel, playing, setPlaybackError]);

  useEffect(() => {
    const primaryCover = activeTrack.coverUrl;
    const fallbackCover = activeTrack.coverFallbackUrl;
    if (!primaryCover && !fallbackCover) {
      setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      return;
    }

    let cancelled = false;
    let triedFallback = !primaryCover;
    const image = new Image();
    image.crossOrigin = "anonymous";
    const releaseImage = () => {
      image.onload = null;
      image.onerror = null;
      // The palette is copied into plain strings; keeping the decoded bitmap
      // alive after extraction only grows Chromium's image memory over time.
      image.removeAttribute("src");
    };
    const loadCoverUrl = (targetUrl: string) => {
      void getBoundedCoverUrl(targetUrl).then((src) => {
        if (cancelled) return;
        if (src) image.src = src;
        else if (!triedFallback && fallbackCover) {
          triedFallback = true;
          loadCoverUrl(fallbackCover);
        } else {
          setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
          releaseImage();
        }
      });
    };
    image.onload = () => {
      if (cancelled) {
        releaseImage();
        return;
      }
      try {
        setActivePalette(extractDominantColors(image));
      } catch {
        if (!triedFallback && fallbackCover && fallbackCover !== primaryCover) {
          triedFallback = true;
          loadCoverUrl(fallbackCover);
          return;
        }
        setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      }
      releaseImage();
    };
    image.onerror = () => {
      if (!cancelled && !triedFallback && fallbackCover && fallbackCover !== primaryCover) {
        triedFallback = true;
        loadCoverUrl(fallbackCover);
        return;
      }
      if (!cancelled) setActivePalette({ primary: activeTrack.accent, secondary: activeTrack.accent });
      releaseImage();
    };
    // Palette extraction reads the bounded decode so oversized embedded
    // artwork is sampled at ≤1024px instead of its native resolution.
    loadCoverUrl((primaryCover ?? fallbackCover)!);

    return () => {
      cancelled = true;
      releaseImage();
    };
  }, [activeTrack.id, activeTrack.coverUrl, activeTrack.coverFallbackUrl, activeTrack.accent]);

  useEffect(() => {
    if (!playing) return;
    if (activeTrack.id === idleTrack.id) return;
    if (activeTrack.id !== activeTrackId) return;
    if (countedTrackRef.current === activeTrack.id) return;

    const canonicalActiveId = canonicalTrackId(activeTrack);
    const canonicalSnapshot = createPlayerCacheSnapshot(canonicalizeTrackForLibrary(activeTrack));
    countedTrackRef.current = activeTrack.id;
    setPlayCounts((current) => ({
      ...current,
      [canonicalActiveId]: (current[canonicalActiveId] ?? 0) + 1,
    }));
    setDailyActivity((current) => recordDailyPlay(current, Date.now(), parseDuration(activeTrack.duration)));
    setPlayHistory((current) => {
      const existing = current.find((entry) => entry.track.id === canonicalActiveId);
      const nextEntry = {
        track: canonicalSnapshot,
        playedAt: Date.now(),
        count: (existing?.count ?? 0) + 1,
      };
      return [nextEntry, ...current.filter((entry) => entry.track.id !== canonicalActiveId)].slice(0, 80);
    });
  }, [activeTrack, activeTrack.id, activeTrackId, playing]);

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
    <ArtistNavigationContext.Provider value={openArtistForTrack}>
    <PlaylistActionsProvider openAdd={(tracks, playlistId, existingTrackIds) => {
      const normalizedTracks = tracks.map((track) => canonicalizeTrackForLibrary(track));
      setAddPlaylistRequest({ tracks: normalizedTracks, playlistId, existingTrackIds });
      if (neteaseConnected && normalizedTracks.some((track) => track.source === "netease")) void refreshPlaylistList().catch(() => undefined);
    }}>
    <main
      className="aria-stage relative h-dvh overflow-hidden text-[var(--text-primary)]"
      data-ambient-active={playing && pageVisible ? "true" : "false"}
      style={
        {
          "--aria-accent": surfacePalette.primary,
          "--aria-accent-secondary": surfacePalette.secondary,
        } as CSSProperties
      }
    >
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload="metadata"
        onTimeUpdate={(event) => {
          if (nativePlaybackEnabled || !audioElementStreamUrl) return;
          try {
            const expectedSrc = new URL(audioElementStreamUrl, window.location.href).href;
            if (event.currentTarget.src !== expectedSrc) return;
          } catch {
            return;
          }
          commitPlaybackTime(event.currentTarget.currentTime || 0);
        }}
        onLoadedMetadata={(event) => {
          resetAudioError();
          const duration = event.currentTarget.duration || 0;
          if (!nativePlaybackEnabled) setDurationSeconds(duration);
          if (!nativePlaybackEnabled) {
            const guestAlignSec = ariaRoomRef.current?.consumeGuestInitialAlignSec(
              activeTrack.id,
              duration,
            );
            const rawSeekTarget =
              guestAlignSec != null ? guestAlignSec : pendingSeekRef.current;
            if (rawSeekTarget > 0) {
              const nextTime =
                duration > 1 ? Math.min(rawSeekTarget, Math.max(0, duration - 1)) : rawSeekTarget;
              event.currentTarget.currentTime = nextTime;
              commitPlaybackTime(nextTime, true);
              pendingSeekRef.current = 0;
              pendingSeekTrackIdRef.current = null;
            }
          }
        }}
        onEnded={() => {
          if (nativePlaybackEnabled) return;
          handleTrackEnded();
        }}
        onError={handleAudioError}
      />
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
      <div className={cn("app-shell relative z-10 flex h-full w-full flex-col overflow-hidden", activeView === "home" ? "app-shell-home" : "app-shell-standard")}>
        <header
          className="app-header"
          style={dragRegionStyle}
        >
          <div className="app-brand" style={noDragRegionStyle}>
            <button
              className="flex min-w-0 items-center gap-2.5 rounded-xl text-left"
              aria-label="Aria 主页"
              onClick={() => {
                clearSearchState();
                setSelectedArtist(null);
                setSelectedUser(null);
                setSelectedAlbum(null);
                setActiveView("home");
              }}
            >
              <img src={ariaIconUrl} alt="" draggable={false} className="size-9 shrink-0 rounded-xl object-cover" />
              <p className="app-wordmark">Aria</p>
            </button>
            <div className="app-history-controls" role="group" aria-label="视图历史导航">
              <button
                type="button"
                className="app-history-btn"
                aria-label="后退"
                title="后退（也可使用鼠标后退侧键）"
                disabled={!canGoBack}
                onClick={() => { void navigateHistory(-1); }}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                className="app-history-btn"
                aria-label="前进"
                title="前进（也可使用鼠标前进侧键）"
                disabled={!canGoForward}
                onClick={() => { void navigateHistory(1); }}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          <div className="app-nav-slot">
            <AppNavigation activeView={activeView} onPick={(id) => { clearSearchState(); setSelectedArtist(null); setSelectedUser(null); setSelectedAlbum(null); if (id === "playlists") { closePlaylist(); localPlaylists.setSelectedId(null); playlistReturnRef.current = null; setPlaylistSourceIntent(null); setPlaylistSourceRequest(null); } setActiveView(id); }} />
          </div>

          <div
            className="app-search"
            style={noDragRegionStyle}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchFocused(false); }}
          >
            <button
              type="button"
              className={cn(
                "app-search-trigger flex shrink-0 items-center justify-center",
                (searchFocused || searchDraft.trim().length > 0) && "is-active",
              )}
              aria-label="执行搜索"
              title="开始搜索 (Enter)"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => submitSearch(searchDraft)}
            >
              <Search className="size-3.5" strokeWidth={2.25} />
            </button>
            <input
              value={searchDraft}
              onChange={(event) => { setSearchDraft(event.target.value); setSearchFocused(true); }}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchFocused(false);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (searchFocused && suggestionIndex >= 0 && searchSuggestions[suggestionIndex]) {
                    pickSuggestion(searchSuggestions[suggestionIndex]);
                  } else {
                    submitSearch(searchDraft);
                  }
                  return;
                }
                if (!searchSuggestions.length || !searchFocused) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setSuggestionIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + searchSuggestions.length) % searchSuggestions.length);
                }
              }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              placeholder="搜索歌曲、歌手、专辑、歌单…"
              aria-label="搜索音乐、歌手、专辑、歌单、用户"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchFocused && searchSuggestions.length > 0}
              aria-controls="search-suggestions"
              aria-activedescendant={searchFocused && suggestionIndex >= 0 ? `search-suggestion-${suggestionIndex}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-500"
            />
            {(searchDraft.length > 0 || searchActive) && (
              <button
                type="button"
                className="app-search-clear flex shrink-0 items-center justify-center transition"
                aria-label="清空搜索"
                title="清空搜索"
                onClick={clearSearchState}
              >
                <X className="size-3.5" />
              </button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="设置"
              onClick={() => {
                setSettingsReturnView(activeView === "settings" ? "home" : activeView);
                clearSearchState();
                setActiveView("settings");
              }}
            >
              <Settings2 />
            </Button>
            {searchFocused && searchDraft.trim() && searchSuggestions.length > 0 && <div id="search-suggestions" role="listbox" aria-label="搜索建议" className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-violet-100 bg-white p-2 shadow-xl">
              {searchSuggestions.map((suggestion, index) => <button key={suggestion} id={`search-suggestion-${index}`} type="button" role="option" aria-selected={suggestionIndex === index} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-neutral-600 hover:bg-violet-50", suggestionIndex === index && "bg-violet-50 text-violet-700")} onMouseDown={(event) => event.preventDefault()} onClick={() => pickSuggestion(suggestion)}><Search className="size-3.5 shrink-0" /><span className="truncate">{suggestion}</span></button>)}
            </div>}
          </div>

          <div className="app-header-actions flex items-center gap-2" style={noDragRegionStyle}>
            <div className="relative">
              <Button
                variant="glass"
                size={ariaRoom.isActive || listenTogether.isActive ? "sm" : "icon"}
                aria-label="一起听"
                className={cn(
                  "app-listen-together-btn",
                  (ariaRoom.isActive || listenTogether.isActive) && "is-active",
                  activeView === "listenTogether" && "is-viewing",
                )}
                title={
                  ariaRoom.isActive
                    ? `Aria 官方一起听 (${ariaRoom.snapshot.members.length}/5)`
                    : listenTogether.isActive
                      ? "网易云一起听同步中"
                      : listenTogether.invites.length > 0
                        ? `收到 ${listenTogether.invites.length} 条一起听邀请`
                        : listenTogether.recoverableRoom
                          ? "发现可恢复的一起听房间"
                          : "一起听（Aria 官方 / 网易云）"
                }
                onClick={() => {
                  if (activeView === "listenTogether") {
                    if (!navigateHistory(-1)) setActiveView(listenTogetherReturnView);
                    return;
                  }
                  setListenTogetherReturnView(activeView === "settings" ? "home" : activeView);
                  clearSearchState();
                  setSelectedArtist(null);
                  setSelectedUser(null);
                  setSelectedAlbum(null);
                  ariaRoom.clearError();
                  listenTogether.clearError();
                  setActiveView("listenTogether");
                }}
              >
                {(ariaRoom.isActive || listenTogether.isActive) && <span className="lt-live-dot" aria-hidden="true" />}
                <Headphones className={ariaRoom.isActive || listenTogether.isActive ? "size-3.5 shrink-0" : "size-4"} />
                {ariaRoom.isActive ? (
                  <span className="text-xs font-medium leading-none">
                    Aria 同听 · {ariaRoom.snapshot.members.length}/5
                  </span>
                ) : listenTogether.isActive ? (
                  <span className="text-xs font-medium leading-none">
                    {(listenTogether.room?.roomUsers.length ?? 0) >= 2
                      ? `同听 · ${listenTogether.room?.roomUsers.length}人`
                      : "同听中"}
                  </span>
                ) : null}
              </Button>
              {!ariaRoom.isActive && !listenTogether.isActive && listenTogether.invites.length > 0 ? (
                <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-white">
                  {listenTogether.invites.length}
                </span>
              ) : !ariaRoom.isActive && !listenTogether.isActive && listenTogether.recoverableRoom ? (
                <span className="pointer-events-none absolute right-0 top-0 size-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
              ) : null}
            </div>
            <Button
              variant="glass"
              size="icon"
              aria-label={resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              title={resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            </Button>
            {activeView === "player" && <Button className="xl:hidden" variant="ghost" size="icon" aria-label="打开播放队列" onClick={() => setQueueOpen(true)}><AriaIcon name="queue" className="size-4" /></Button>}
            <div className="relative">
            <Button
              variant="glass"
              size="icon"
              aria-label={primaryAccount ? `账号：${primaryAccount.nickname ?? "已登录"}` : "账号登录"}
              title={
                primaryAccount
                  ? `${primaryAccount.nickname ?? "已登录"}${
                      neteaseConnected
                        ? "（网易云音乐）"
                        : qqConnected
                          ? "（QQ 音乐）"
                          : bilibiliConnected
                            ? "（B站）"
                            : youtubeConnected
                              ? "（YouTube）"
                              : ""
                    }`
                  : "登录播放源账号"
              }
              onClick={() => setAccountOpen((value) => !value)}
            >
              {primaryAccount?.avatarUrl ? (
                <ArtworkImage
                  src={primaryAccount.avatarUrl}
                  cacheSize={128}
                  alt={primaryAccount.nickname ?? "account"}
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
                neteaseConnected || qqConnected || bilibiliConnected || youtubeConnected ? "bg-[#28c840]" : "bg-neutral-300",
              )}
            />
            <AnimatePresence>
              {accountOpen && (
                <Suspense fallback={null}>
                  <AccountPanel
                    sourceAccounts={[
                      {
                        id: "netease",
                        label: "网易云音乐",
                        connected: neteaseConnected,
                        nickname: neteaseAccount?.nickname ?? null,
                        avatarUrl: neteaseAccount?.avatarUrl ?? null,
                      },
                      {
                        id: "qq",
                        label: "QQ 音乐",
                        connected: qqConnected,
                        nickname: qqAccount?.nickname ?? null,
                        avatarUrl: qqAccount?.avatarUrl ?? null,
                      },
                      {
                        id: "bilibili",
                        label: "哔哩哔哩",
                        connected: bilibiliConnected,
                        nickname: bilibiliAccount?.nickname ?? null,
                        avatarUrl: bilibiliAccount?.nickname ? bilibiliAccount.avatarUrl ?? null : bilibiliAccount?.avatarUrl ?? null,
                      },
                      {
                        id: "youtube",
                        label: "YouTube Music",
                        connected: youtubeConnected,
                        nickname: youtubeAccount?.nickname ?? null,
                        avatarUrl: youtubeAccount?.avatarUrl ?? null,
                      },
                    ]}
                    onManageSources={() => {
                      setAccountOpen(false);
                      setSettingsReturnView(activeView === "settings" ? "home" : activeView);
                      setActiveView("settings");
                    }}
                    onClose={() => setAccountOpen(false)}
                  />
                </Suspense>
              )}
            </AnimatePresence>
            </div>

            {window.ariaDesktop && window.ariaDesktop.platform !== "darwin" && <div className="app-window-controls flex items-center">
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
            </div>}
          </div>
        </header>

        <section
          className={cn(
            "app-content relative grid grid-cols-1 min-h-0 flex-1 gap-4 p-4 2xl:gap-5 2xl:p-5",
            activeView === "home" && !searchActive && "app-content-home",
            activeView === "player" && !searchActive && "overflow-hidden",
            searchActive || activeView === "settings" || activeView === "listenTogether" || activeView === "home"
              ? "grid-cols-1"
              : activeView === "player"
                ? "lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_minmax(380px,18vw)]"
                : "xl:grid-cols-[minmax(0,1fr)_minmax(340px,18vw)]",
          )}
        >
          <div
            className={cn(
              "h-full min-h-0 min-w-0 overflow-hidden",
              (activeView !== "player" || searchActive) &&
                (immersiveOpen && BILIBILI_VIDEO_ENABLED && videoMode && Boolean(activeTrack.videoUrl)
                  ? "fixed inset-0 z-[80]"
                  : youtubeWebviewActive
                    ? "pointer-events-none invisible absolute inset-0 -z-10 opacity-0"
                    : "hidden"),
            )}
            aria-hidden={(activeView !== "player" || searchActive) && !(immersiveOpen && BILIBILI_VIDEO_ENABLED && videoMode && Boolean(activeTrack.videoUrl))}
            inert={(activeView !== "player" || searchActive) && !(immersiveOpen && BILIBILI_VIDEO_ENABLED && videoMode && Boolean(activeTrack.videoUrl))}
          >
<PlayerSurface
                  activeTrack={activeTrack}
                  palette={surfacePalette}
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
                  immersive={immersiveOpen}
                  onCloseImmersive={() => void closeImmersiveView()}
                  videoMode={videoMode}
                  onToggleVideoMode={toggleVideoMode}
                  standaloneMvAudio={standaloneMvActive}
                  videoUrlOverride={activeVideoUrl}
                  videoAudioUrlOverride={activeVideoAudioUrl}
                  videoQualities={youtubeWebviewActive ? youtubeStageQualities : videoQualities}
                  videoQualityId={videoQn}
                  videoAudioQuality={videoAudioQuality}
                  videoAudioLevel={videoAudioLevel}
                  videoAudioLevels={videoAudioLevels}
                  onVideoAudioLevelChange={(level) => {
                    commitActiveVideoTime();
                    pendingSeekRef.current = getPlaybackTime();
                    setVideoAudioLevel(level);
                    if (level && level !== effectiveQualityLevel) {
                      handleQualityLevelChange(level as QualityLevel);
                    }
                  }}
                  onVideoQualityChange={(qn) => {
                    commitActiveVideoTime();
                    pendingSeekRef.current = getPlaybackTime();
                    setVideoQn(qn);
                  }}
                  videoActive={
                    videoMode &&
                    (standaloneMvActive || ((activeView === "player" || immersiveOpen) && !searchActive && pageVisible))
                  }
                  videoControlRef={videoControlRef}
                  onVideoDuration={setDurationSeconds}
                  onVideoEnded={handleTrackEnded}
                  onVideoError={(message) => {
                    setPlaybackError(message);
                    setVideoMode(false);
                  }}
                  youtubeWebviewActive={youtubeWebviewActive}
                  youtubeActiveQuality={youtubeStageActiveQuality}
                  youtubeOffsetSeconds={youtubeOffsetSeconds}
                  onYoutubeOffsetChange={handleYoutubeOffsetChange}
                  onYoutubeQualities={(qualities, activeLabel) => {
                    setYoutubeStageQualities(qualities);
                    setYoutubeStageActiveQuality(activeLabel);
                  }}
                  onYoutubeWebviewFallback={(reason) => {
                    setYoutubeWebviewFallbackTrackId(activeTrack.id);
                    setPlaybackNotice(reason);
                  }}
                  onReplaceLocalArtwork={replaceLocalArtwork}
                  liked={isTrackLiked(activeTrack)}
                  onToggleLike={() => toggleLikeTrack(activeTrack.id)}
                  volume={volume}
                  onVolumeChange={setVolume}
                  qualityLevel={effectiveQualityLevel}
                  onQualityLevelChange={handleQualityLevelChange}
                  hifiEnabled={hifiEnabled}
                  masterQualityEnabled={masterQualityEnabled}
                  onMasterQualityEnabledChange={setMasterQualityEnabled}
                  exclusiveMode={exclusiveMode}
                  durationSeconds={durationSeconds}
                  analyserRef={analyserRef}
                  visualizerMode={nativePlaybackEnabled ? audioOutputMode : "system"}
                  visualizerActive={pageVisible && !immersiveOpen && activeView === "player" && !videoMode}
                  lyricDisplayMode={lyricDisplayMode}
                  onLyricDisplayModeChange={setLyricDisplayMode}
                  onSeek={seekTo}
                  equalizerEnabled={equalizer.enabled}
                  onOpenEqualizer={() => setEqualizerOpen(true)}
                />
                {equalizerOpen && (
                  <Suspense fallback={null}>
                    <EqualizerDialog
                      open={equalizerOpen}
                      onClose={() => setEqualizerOpen(false)}
                      enabled={equalizer.enabled}
                      bands={equalizer.bands}
                      preset={equalizer.preset}
                      error={equalizerError}
                      customPresets={customEqualizerPresets}
                      onEnabledChange={(enabled) => updateEqualizer({ enabled })}
                      onBandsChange={(bands) => updateEqualizer({ bands })}
                      onPresetChange={selectEqualizerPreset}
                      onSavePreset={saveCustomEqualizerPreset}
                      onDeletePreset={deleteCustomEqualizerPreset}
                      onImportPresets={importCustomEqualizerPresets}
                    />
                  </Suspense>
                )}
          </div>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={selectedAlbum ? `album:${selectedAlbum.id}` : selectedUser ? `user:${selectedUser.id}` : query.trim() ? "search" : activeView}
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "app-view min-h-0 min-w-0 scrollbar-thin",
                activeView === "home" && !query.trim() && "app-view-home",
                activeView === "player" && !searchActive && "hidden",
              )}
            >
              {selectedAlbum ? (
                <AlbumDetailSurface album={albumDetail ?? selectedAlbum} tracks={albumTracks} loading={albumLoading} error={albumError}
                  onBack={() => { if (!navigateHistory(-1)) setSelectedAlbum(null); }} onRetry={retryAlbum} onPickTrack={chooseTrack}
                  onPickArtist={(id, name) => {
                    const source = (albumDetail ?? selectedAlbum)?.source === "qq" ? "qq" : "netease";
                    setSelectedAlbum(null);
                    setSelectedArtist({ id: `${source}:${id}`, providerId: id, providerSource: source, name, source, trackCount: 0 });
                    clearSearchState();
                    setActiveView("artists");
                  }} />
              ) : selectedUser ? (
                <UserDetailSurface user={userDetail ?? selectedUser} playlists={userPlaylists} loading={userLoading} error={userError} more={userPlaylistsMore}
                  onBack={() => { if (!navigateHistory(-1)) setSelectedUser(null); }} onRetry={retryUser} onLoadMore={() => void loadMoreUserPlaylists()}
                  onPickPlaylist={(playlist) => { playlistReturnRef.current = { view: activeView, query, user: selectedUser }; setPlaylistSourceIntent("netease"); void openPlaylist(playlist); setActiveView("playlists"); clearSearchState(); setSelectedUser(null); }} />
              ) : query.trim() ? (
                <SearchSurface
                  query={query.trim()}
                  loading={searchLoading}
                  localTracks={searchBundle.localTracks}
                  neteaseTracks={searchBundle.neteaseTracks}
                  qqTracks={searchBundle.qqTracks}
                  bilibiliTracks={searchBundle.bilibiliTracks}
                  youtubeTracks={searchBundle.youtubeTracks}
                  qqError={searchQqError}
                  bilibiliError={searchBilibiliError}
                  youtubeError={searchYoutubeError}
                  artists={searchBundle.artists}
                  playlists={searchBundle.playlists}
                  users={searchBundle.users}
                  albums={searchBundle.albums}
                  mode={searchMode}
                  onModeChange={setSearchMode}
                  error={searchError}
                  total={searchTotal}
                  more={searchMore}
                  qqMore={searchQqMore}
                  bilibiliMore={searchBilibiliMore}
                  youtubeMore={searchYoutubeMore}
                  onRetry={retrySearch}
                  onLoadMore={() => void loadMoreSearch()}
                  onPickUser={setSelectedUser}
                  onPickAlbum={setSelectedAlbum}
                  artistAvatarCache={artistAvatarCache}
                  onPickTrack={(id, queue) => {
                    chooseTrack(id, queue);
                  }}
                  onPickArtist={(artist) => {
                    setSelectedArtist(artist);
                    setActiveView("artists");
                    clearSearchState();
                  }}
                  onPickPlaylist={(playlist) => {
                    playlistReturnRef.current = { view: activeView, query, user: null };
                    setPlaylistSourceIntent(playlist.source === "qq" ? "qq" : "netease");
                    if (playlist.source === "qq") {
                      void qqData.openPlaylist(playlist);
                    } else {
                      void openPlaylist(playlist);
                    }
                    setActiveView("playlists");
                    clearSearchState();
                  }}
                />
              ) : (
                <>
              {activeView === "home" && (
                <HomeSurface
                  activeTrack={activeTrack}
                  playHistory={displayHistory}
                  dailyActivity={dailyActivity}
                  playing={playing}
                  onTogglePlay={togglePlayback}
                  onPickTrack={chooseTrack}
                  onOpenPlayer={() => setActiveView("player")}
                  onNavigate={setActiveView}
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
                  onLyricsBound={(trackId, lyrics, candidateId) => applyLyricsToTrack(trackId, lyrics, candidateId)}
                  onArtworkBound={applyArtworkToTrack}
                  onMetadataUpdated={(tracks, bindings) => {
                    setLyricBindings(bindings);
                    for (const [index, track] of tracks.entries()) {
                      const updated = localTrackToUiTrack(track, index);
                      applyTrackUpdate(track.id, (current) => current.id === track.id ? { ...current, ...updated } : current);
                    }
                  }}
                />
              )}
              {activeView === "liked" && (
                <LikedSurface
                  localTracks={localLikedTracks}
                  neteaseTracks={neteaseLikedDisplayTracks}
                  qqTracks={qqData.likedTracks}
                  bilibiliTracks={bilibiliData.likedTracks}
                  youtubeTracks={youtubeData.likedTracks}
                  neteaseConnected={neteaseConnected}
                  qqConnected={qqConnected}
                  bilibiliConnected={bilibiliConnected}
                  youtubeConnected={youtubeConnected}
                  bilibiliError={bilibiliData.listError}
                  youtubeError={youtubeData.listError}
                  refreshing={qqData.listLoading || bilibiliData.listLoading || youtubeData.listLoading}
                  onRefresh={(source) => {
                    if (source === "netease" || source === "all") void refreshNeteaseData();
                    if (source === "qq" || source === "all") void qqData.refresh();
                    if (source === "bilibili" || source === "all") void bilibiliData.refresh();
                    if (source === "youtube" || source === "all") void youtubeData.refresh();
                  }}
                  onVisibleTracksChange={(tracks) => bilibiliData.hydrateTracks(tracks, bilibiliDefaultAudioLevel)}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "history" && (
                <HistorySurface
                  history={displayHistory}
                  activeTrackId={activeTrackId}
                  playing={playing}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "playlists" && (
                <PlaylistSurface
                  playlists={providerPlaylists}
                  superMix={{
                    playlists: localPlaylists.playlists.filter((playlist) => playlist.kind === "super-mix"),
                    localPlaylists: localPlaylists.playlists.filter((playlist) => playlist.kind !== "super-mix"),
                    allTracks,
                    selectedPlaylist:
                      localPlaylists.selectedPlaylist && localPlaylists.selectedPlaylist.kind === "super-mix"
                        ? localPlaylists.selectedPlaylist
                        : null,
                    selectedTracks:
                      localPlaylists.selectedPlaylist && localPlaylists.selectedPlaylist.kind === "super-mix"
                        ? localPlaylists.selectedTracks
                        : [],
                    storageError: localPlaylists.storageError,
                    onOpen: localPlaylists.setSelectedId,
                    onClose: () => localPlaylists.setSelectedId(null),
                    onCreate: localPlaylists.createSuperMix,
                    onUpdateMix: localPlaylists.updateSuperMix,
                    onRename: localPlaylists.rename,
                    onDelete: localPlaylists.remove,
                    onAdd: localPlaylists.addTracks,
                    onRemove: localPlaylists.removeTracks,
                    onReorder: localPlaylists.reorder,
                    onPickTrack: chooseTrack,
                  }}
                  local={{
                    playlists: localPlaylists.playlists.filter((playlist) => !playlist.remoteRef && playlist.kind !== "super-mix"),
                    allTracks,
                    selectedPlaylist:
                      localPlaylists.selectedPlaylist && !localPlaylists.selectedPlaylist.remoteRef && localPlaylists.selectedPlaylist.kind !== "super-mix"
                        ? localPlaylists.selectedPlaylist
                        : null,
                    selectedTracks:
                      localPlaylists.selectedPlaylist && !localPlaylists.selectedPlaylist.remoteRef && localPlaylists.selectedPlaylist.kind !== "super-mix"
                        ? localPlaylists.selectedTracks
                        : [],
                    storageError: localPlaylists.storageError,
                    onOpen: localPlaylists.setSelectedId,
                    onClose: () => localPlaylists.setSelectedId(null),
                    onCreate: localPlaylists.create,
                    onRename: localPlaylists.rename,
                    onDelete: localPlaylists.remove,
                    onAdd: localPlaylists.addTracks,
                    onRemove: localPlaylists.removeTracks,
                    onReorder: localPlaylists.reorder,
                    onSyncReference: localPlaylists.syncReference,
                    onPickTrack: chooseTrack,
                  }}
                  selectedPlaylist={selectedPlaylist}
                  tracks={playlistTracks}
                  playCounts={playCounts}
                  loading={playlistLoading}
                  error={playlistError}
                  onUpdatePlaylist={updatePlaylist}
                  onUploadCover={uploadPlaylistCover}
                  onRemoveTracks={(id, tracks) => editPlaylistTracks(id, tracks, "del")}
                  onReorderTracks={reorderPlaylistTracks}
                  onSubscribe={subscribePlaylist}
                  onDeletePlaylist={deletePlaylist}
                  canCreatePlaylist={neteaseConnected}
                  onCreatePlaylist={createPlaylist}
                  onRequireLogin={() => {
                    setSettingsReturnView("playlists");
                    setActiveView("settings");
                  }}
                  onOpenPlaylist={(playlist) => { if (playlist.id !== selectedPlaylist?.id) playlistReturnRef.current = null; void openPlaylist(playlist); }}
                  onClosePlaylist={() => {
                    closePlaylist();
                    const origin = playlistReturnRef.current;
                    playlistReturnRef.current = null;
                    if (origin) {
                      if (origin.view && origin.view !== "playlists") setActiveView(origin.view);
                      setSearchDraft(origin.query);
                      setQuery(origin.query);
                      setSelectedUser(origin.user);
                    }
                  }}
                  onPickTrack={chooseTrack}
                  qq={{
                    connected: qqConnected,
                    playlists: qqData.playlists,
                    selectedPlaylist: qqData.selectedPlaylist,
                    tracks: qqData.playlistTracks,
                    loading: qqData.playlistLoading,
                    error: qqData.listError ?? qqData.playlistError,
                    onOpen: (playlist) => void qqData.openPlaylist(playlist),
                    onClose: () => {
                      qqData.closePlaylist();
                      const origin = playlistReturnRef.current;
                      playlistReturnRef.current = null;
                      if (origin) {
                        if (origin.view && origin.view !== "playlists") setActiveView(origin.view);
                        setSearchDraft(origin.query);
                        setQuery(origin.query);
                        setSelectedUser(origin.user);
                      }
                    },
                    onPickTrack: chooseTrack,
                  }}
                  bilibili={{
                    connected: bilibiliConnected,
                    playlists: bilibiliData.playlists,
                    loading: bilibiliData.playlistsLoading,
                    error: bilibiliData.playlistsError,
                    selectedPlaylist: bilibiliData.selectedPlaylist,
                    tracks: bilibiliData.playlistTracks,
                    tracksLoading: bilibiliData.playlistLoading,
                    tracksError: bilibiliData.playlistError,
                    playCounts,
                    referencedPlaylists: localPlaylists.playlists.filter((playlist) => playlist.remoteRef),
                    onOpen: (playlist) => void bilibiliData.openPlaylist(playlist),
                    onClose: () => bilibiliData.closePlaylist(),
                    onRefresh: () => void bilibiliData.refreshPlaylists(),
                    onPickTrack: chooseTrack,
                    onRequireLogin: () => {
                      setSettingsReturnView("playlists");
                      setActiveView("settings");
                    },
                    onCreateReference: localPlaylists.create,
                    onSyncReference: localPlaylists.syncReference,
                    onOpenReferenced: (id) => {
                      // 镜像歌单保留在 B站 歌单页内打开详情，避免跳转到「本地」。
                      bilibiliData.closePlaylist();
                      localPlaylists.setSelectedId(id);
                    },
                    onDeleteReferenced: localPlaylists.remove,
                    selectedReferencedPlaylist: localPlaylists.selectedPlaylist?.remoteRef
                      ? localPlaylists.selectedPlaylist
                      : null,
                    selectedReferencedTracks: localPlaylists.selectedPlaylist?.remoteRef
                      ? localPlaylists.selectedTracks
                      : [],
                    allTracks,
                    onCloseReferenced: () => localPlaylists.setSelectedId(null),
                    onRenameReferenced: localPlaylists.rename,
                    onAddReferenced: localPlaylists.addTracks,
                    onRemoveReferenced: localPlaylists.removeTracks,
                    onReorderReferenced: localPlaylists.reorder,
                  }}
                  youtube={{
                    connected: youtubeConnected,
                    playlists: youtubeData.playlists,
                    loading: youtubeData.playlistsLoading,
                    error: youtubeData.playlistsError,
                    selectedPlaylist: youtubeData.selectedPlaylist,
                    tracks: youtubeData.playlistTracks,
                    tracksLoading: youtubeData.playlistLoading,
                    tracksError: youtubeData.playlistError,
                    onOpen: (playlist) => youtubeData.openPlaylist(playlist),
                    onClose: () => {
                      youtubeData.closePlaylist();
                      const origin = playlistReturnRef.current;
                      playlistReturnRef.current = null;
                      if (origin) {
                        if (origin.view && origin.view !== "playlists") setActiveView(origin.view);
                        setSearchDraft(origin.query);
                        setQuery(origin.query);
                        setSelectedUser(origin.user);
                      }
                    },
                    onRefresh: () => void youtubeData.refreshPlaylists(),
                    onPickTrack: chooseTrack,
                    onRequireLogin: () => {
                      setSettingsReturnView("playlists");
                      setActiveView("settings");
                    },
                  }}
                  initialSource={playlistSourceIntent}
                  sourceRequest={playlistSourceRequest}
                />
              )}
              {activeView === "daily" && (
                <CollectionSurface
                  title={
                    recommendSource === "qq"
                      ? "QQ 每日推荐"
                      : recommendSource === "youtube"
                        ? "YouTube 每日推荐"
                        : "每日推荐"
                  }
                  subtitle={
                    recommendSource === "qq"
                      ? "QQ音乐官方榜单聚合，每日更新"
                      : recommendSource === "youtube"
                        ? "YouTube Music 精选动态推荐，可匿名收听"
                        : "30 首"
                  }
                  icon={<Sparkles className="size-5" />}
                  tracks={
                    recommendSource === "qq"
                      ? qqData.dailyTracks
                      : recommendSource === "youtube"
                        ? youtubeData.dailyTracks
                        : dailyTracks
                  }
                  loading={
                    recommendSource === "qq"
                      ? qqData.dailyLoading
                      : recommendSource === "youtube"
                        ? youtubeData.dailyLoading
                        : undefined
                  }
                  refreshing={recommendSource === "youtube" ? youtubeData.dailyLoading : false}
                  onRefresh={
                    recommendSource === "youtube" ? () => void youtubeData.loadDaily(true) : undefined
                  }
                  error={
                    recommendSource === "qq"
                      ? qqData.dailyError
                      : recommendSource === "youtube"
                        ? youtubeData.dailyError
                        : undefined
                  }
                  onPickTrack={chooseTrack}
                  sourceToggle={{ value: recommendSource, onChange: setRecommendSource }}
                  emptyText={
                    recommendSource === "qq"
                      ? "QQ 榜单还没拿到歌曲，点刷新或稍后再试。"
                      : recommendSource === "youtube"
                        ? "暂未拿到 YouTube 推荐曲目，请确认代理运行正常后点刷新。"
                        : undefined
                  }
                />
              )}
              {activeView === "radar" && (
                <CollectionSurface
                  title={
                    recommendSource === "qq"
                      ? "QQ 私人漫游"
                      : recommendSource === "youtube"
                        ? "YouTube 电台漫游"
                        : "私人漫游"
                  }
                  subtitle={
                    recommendSource === "qq"
                      ? "从 QQ 音乐官方榜单里随机发现"
                      : recommendSource === "youtube"
                        ? "基于 YouTube Music 电台连续发现新歌"
                        : "基于最近偏好漫游"
                  }
                  icon={<Radio className="size-5" />}
                  tracks={
                    recommendSource === "qq"
                      ? qqData.roamTracks
                      : recommendSource === "youtube"
                        ? youtubeData.roamTracks
                        : roamTracks
                  }
                  refreshing={
                    recommendSource === "qq"
                      ? qqData.roamLoading
                      : recommendSource === "youtube"
                        ? youtubeData.roamLoading
                        : roamRefreshing
                  }
                  onRefresh={() => {
                    if (recommendSource === "qq") void qqData.loadRoam(recentQqRoamExcludes());
                    else if (recommendSource === "youtube") void youtubeData.loadRoam(recentYoutubeRoamExcludes());
                    else void refreshRoamData();
                  }}
                  onPickTrack={chooseTrack}
                  sourceToggle={{ value: recommendSource, onChange: setRecommendSource }}
                  emptyText={
                    recommendSource === "qq"
                      ? "还没拿到漫游歌曲，点刷新试一次。"
                      : recommendSource === "youtube"
                        ? "还没拿到 YouTube 电台曲目，点右上角刷新试试。"
                        : undefined
                  }
                />
              )}
              {activeView === "explore" && (
                <Suspense fallback={null}>
                  <ExploreSurface
                    styleGroups={exploreStyleGroups}
                    selectedStyle={exploreStyle}
                    tracks={exploreTracks}
                    activeTab={exploreTab}
                    selectedStyleId={exploreStyleId}
                    stylesLoading={exploreStylesLoading}
                    loading={exploreTracksLoading}
                    loadingMore={exploreTracksLoadingMore}
                    styleError={exploreStyleError}
                    discovery={exploreDiscovery}
                    discoveryLoading={exploreDiscoveryLoading}
                    discoveryError={exploreDiscoveryError}
                    sort={exploreStyleSort}
                    onSelectStyle={(id) => {
                      setExploreStyleId(id);
                      setExploreTab("styles");
                    }}
                    onRetryStyles={() => {
                      setExploreStyleGroups([]);
                    }}
                    onSortChange={setExploreStyleSort}
                    onLoadMore={() => void loadMoreExploreTracks()}
                    onLoadDiscovery={() => void loadExploreDiscovery()}
                    onRetryDiscovery={() => void loadExploreDiscovery(true)}
                    onSearchHot={(value) => submitSearch(value)}
                    onOpenPlaylist={(playlist) => { playlistReturnRef.current = { view: "explore", query: "", user: null }; setPlaylistSourceIntent("netease"); void openPlaylist(playlist); setActiveView("playlists"); clearSearchState(); }}
                    onPickTrack={chooseTrack}
                    onTabChange={setExploreTab}
                    exploreSource={exploreSource}
                    onExploreSourceChange={setExploreSource}
                    youtubeDiscovery={youtubeData.discovery}
                    youtubeDiscoveryLoading={youtubeData.discoveryLoading}
                    youtubeDiscoveryError={youtubeData.discoveryError}
                    onRetryYoutubeDiscovery={() => void youtubeData.loadDiscovery(true)}
                    onOpenYoutubePlaylist={(playlist) => {
                      playlistReturnRef.current = { view: "explore", query: "", user: null };
                      requestPlaylistSource("youtube");
                      youtubeData.openPlaylist(playlist);
                      setActiveView("playlists");
                      clearSearchState();
                    }}
                  />
                </Suspense>
              )}
              {activeView === "artists" && (
                <ArtistsSurface
                  artists={artistSummaries}
                  selectedArtist={selectedArtist}
                  tracks={artistTracks}
                  tracksLoading={artistTracksLoading}
                  tracksError={artistTracksError}
                  onRetryTracks={retryArtistTracks}
                  artistDetail={artistDetail}
                  artistAlbums={artistAlbums}
                  detailLoading={artistDetailLoading}
                  detailError={artistDetailError}
                  albumsMore={artistAlbumsMore}
                  onRetryDetail={retryArtistDetail}
                  onLoadMoreAlbums={() => void loadMoreArtistAlbums()}
                  onPickAlbum={setSelectedAlbum}
                  artistAvatarCache={artistAvatarCache}
                  onPickArtist={(artist) => setSelectedArtist(artist)}
                  onBack={() => { if (!navigateHistory(-1)) setSelectedArtist(null); }}
                  onPickTrack={chooseTrack}
                  onPlayNext={playNextTrack}
                />
              )}
              {activeView === "cloud" && (
                <Suspense fallback={null}>
                  <CloudSurface
                    {...cloudLibrary}
                    connected={neteaseConnected}
                    activeTrackId={activeTrackId}
                    onPickTrack={chooseTrack}
                    onRequireLogin={() => {
                      setSettingsReturnView("cloud");
                      setActiveView("settings");
                    }}
                  />
                </Suspense>
              )}
              {activeView === "stats" && (
                <StatsSurface
                  tracks={allTracks}
                  playCounts={playCounts}
                  playHistory={displayHistory}
                  activeTrackId={activeTrackId}
                  playing={playing}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "settings" && (
                <Suspense fallback={null}>
                  <SettingsPanel
                    backgroundEnabled={backgroundEnabled}
                    onBackgroundEnabledChange={setBackgroundEnabled}
                    neteaseAccount={neteaseAccount}
                    libraryMeta={libraryMeta}
                    libraryAutoScanEnabled={libraryWatchState?.enabled ?? true}
                    libraryWatchState={libraryWatchState}
                    onAddLibraryFolder={() => void addLibraryFolder()}
                    onRemoveLibraryRoot={(root) => void removeLibraryFolder(root)}
                    onToggleLibraryAutoScan={(enabled) => void toggleLibraryAutoScan(enabled)}
                    trackCount={allTracks.length}
                    likedCount={localLikedTracks.length + neteaseLikedDisplayTracks.length + qqData.likedTracks.length + bilibiliData.likedTracks.length + youtubeData.likedTracks.length}
                    lyricProgress={lyricProgress}
                    volume={volume}
                    onVolumeChange={setVolume}
                    audioOutputDevices={audioOutputDevices}
                    onRefreshAudioOutputDevices={() => refreshAudioOutputDevices().then(() => undefined)}
                    selectedSinkId={selectedSinkId}
                    onSelectedSinkIdChange={setSelectedSinkId}
                    hifiEnabled={hifiEnabled}
                    onHifiEnabledChange={handleHifiEnabledChange}
                    masterQualityEnabled={masterQualityEnabled}
                    onMasterQualityEnabledChange={setMasterQualityEnabled}
                    gaplessEnabled={gaplessEnabled}
                    onGaplessEnabledChange={setGaplessEnabled}
                    normalizationEnabled={normalizationEnabled}
                    onNormalizationEnabledChange={setNormalizationEnabled}
                    normalizationError={normalizationError}
                    nativeAudioSupported={nativeAudioSupported}
                    nativeAudioState={nativeAudioState}
                    audioOutputMode={audioOutputMode}
                    onAudioOutputModeChange={setAudioOutputMode}
                    exclusiveMode={exclusiveMode}
                    keyboardShortcuts={keyboardShortcuts}
                    onKeyboardShortcutsChange={setKeyboardShortcuts}
                    theme={theme}
                    onThemeChange={setTheme}
                    bilibiliDefaultVideoQn={bilibiliDefaultVideoQn}
                    onBilibiliDefaultVideoQnChange={(qn) => {
                      setBilibiliDefaultVideoQn(qn);
                      if (activeTrack.source === "bilibili") {
                        commitActiveVideoTime();
                        pendingSeekRef.current = getPlaybackTime();
                        setVideoQn(qn);
                      }
                    }}
                    bilibiliDefaultAudioLevel={bilibiliDefaultAudioLevel}
                    onBilibiliDefaultAudioLevelChange={(level) => {
                      setBilibiliDefaultAudioLevel(level);
                      if (activeTrack.source === "bilibili") {
                        commitActiveVideoTime();
                        pendingSeekRef.current = getPlaybackTime();
                        setHifiEnabled(true);
                        setQualityLevel(level);
                        setVideoAudioLevel(level);
                      }
                    }}
                    onSourceAccountChange={() => {
                      refreshQqAccount();
                      refreshBilibiliAccount();
                      refreshYoutubeAccount();
                      void qqData.refresh();
                      void bilibiliData.refresh();
                      void bilibiliData.refreshPlaylists();
                      void youtubeData.refresh();
                      void youtubeData.refreshPlaylists();
                    }}
                    onNeteaseAccountChange={(account) => {
                      setNeteaseAccount(account);
                      if (account.connected) void refreshNeteaseData();
                    }}
                    onClose={() => {
                      if (!navigateHistory(-1)) setActiveView(settingsReturnView);
                    }}
                  />
                </Suspense>
              )}
              {activeView === "listenTogether" && (
                <Suspense fallback={null}>
                  {(() => {
                    const combinedLobbyError =
                      ariaRoom.actionError ||
                      ariaRoom.snapshot.signalingError ||
                      ariaRoom.snapshot.directServer.error ||
                      listenTogether.actionError;

                    const renderAriaRoomSection = (lobbyCardOnly: boolean) => (
                      <AriaRoomSection
                        lobbyCardOnly={lobbyCardOnly}
                        subPage={ariaRoomSubPage}
                        onSubPageChange={setAriaRoomSubPage}
                        snapshot={ariaRoom.snapshot}
                        config={ariaRoom.config}
                        probeResults={ariaRoom.probeResults}
                        profile={ariaRoom.profile}
                        identity={ariaRoom.identity}
                        accounts={ariaRoomAccounts}
                        activeTrack={activeTrack.id === idleTrack.id ? null : activeTrack}
                        loading={ariaRoom.loading}
                        probingIps={ariaRoom.probingIps}
                        actionError={ariaRoom.actionError}
                        rttMs={ariaRoom.rttMs}
                        lastDriftMs={ariaRoom.lastDriftMs}
                        bufferProgress={ariaRoom.bufferProgress}
                        superMixItems={superMixQuickImportItems}
                        onBack={() => {
                          ariaRoom.clearError();
                          listenTogether.clearError();
                          setAriaRoomSubPage("main");
                          if (!navigateHistory(-1)) setActiveView(listenTogetherReturnView);
                        }}
                        onUpdateProfile={ariaRoom.updateProfile}
                        onToggleShareEnabled={ariaRoom.toggleShareEnabled}
                        onUploadAvatar={ariaRoom.uploadCustomAvatar}
                        onCreateRoom={ariaRoom.createRoom}
                        onJoinRoom={ariaRoom.joinRoomByInput}
                        onLeaveRoom={ariaRoom.leaveRoom}
                        onProbeIps={ariaRoom.probePreferredIps}
                        onUpdateNetworkConfig={ariaRoom.updateNetworkConfig}
                        onSetControlMode={ariaRoom.setControlMode}
                        onImportPlaylistTracks={ariaRoom.importPlaylistTracks}
                        onPickRoomTrack={(track) => {
                          if (ariaRoom.isHost) {
                            const entry = ariaRoom.snapshot.playback.queue.find(
                              (q) => `aria-room:${q.nonce}` === track.id,
                            );
                            if (entry) {
                              void ariaRoom.hostPlayRoomPayload(entry, ariaRoom.snapshot.playback.queue);
                              return;
                            }
                            const matchedQueue = playQueueTracks.some((t) => t.id === track.id)
                              ? playQueueTracks
                              : undefined;
                            chooseTrack(track.id, matchedQueue);
                            return;
                          }
                          chooseTrack(track.id, ariaRoomGuestTracks);
                        }}
                        onOpenPlayer={() => setActiveView("player")}
                      />
                    );

                    const renderListenTogetherView = (compactLobbyCard: boolean) => (
                      <ListenTogetherView
                        compactLobbyCard={compactLobbyCard}
                        embedded={false}
                        connected={neteaseConnected}
                        room={listenTogether.room}
                        recoverableRoom={listenTogether.recoverableRoom}
                        activeTrack={activeTrack}
                        playing={playing}
                        invites={listenTogether.invites}
                        contacts={listenTogether.contacts}
                        sharedTracks={listenTogether.sharedTracks}
                        loading={listenTogether.loading}
                        actionError={listenTogether.actionError}
                        lastDriftMs={listenTogether.lastDriftMs}
                        onBack={() => {
                          listenTogether.clearError();
                          setAriaRoomSubPage("main");
                          if (!navigateHistory(-1)) setActiveView(listenTogetherReturnView);
                        }}
                        onRequireLogin={() => {
                          setSettingsReturnView("listenTogether");
                          setActiveView("settings");
                        }}
                        onCreateRoom={async () => {
                          if (ariaRoom.isActive) await ariaRoom.leaveRoom();
                          return listenTogether.createRoom();
                        }}
                        onJoinRoom={async (input) => {
                          if (ariaRoom.isActive) await ariaRoom.leaveRoom();
                          return listenTogether.joinRoom(input);
                        }}
                        onResumeRecoverable={async () => {
                          if (ariaRoom.isActive) await ariaRoom.leaveRoom();
                          return listenTogether.resumeRecoverableRoom();
                        }}
                        onDismissRecoverable={(roomId) => listenTogether.endRoomById(roomId)}
                        onLeaveRoom={() => listenTogether.leaveRoom()}
                        onSyncNow={listenTogether.syncNow}
                        onRefreshInvites={() => listenTogether.refreshInvites(true)}
                        onSendInviteMessage={listenTogether.sendInviteToContact}
                        onPickSharedTrack={(track) => chooseTrack(track.id, listenTogether.sharedTracks)}
                        onOpenPlayer={() => setActiveView("player")}
                      />
                    );

                    if (!ariaRoom.isActive && !listenTogether.isActive && ariaRoomSubPage === "main") {
                      return (
                        <div className="lt-page space-y-4">
                          <header className="flex flex-wrap items-center justify-between gap-3 pb-1 pt-1">
                            <div className="flex items-center gap-3">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="返回上一页"
                                title="返回上一页"
                                onClick={() => {
                                  ariaRoom.clearError();
                                  listenTogether.clearError();
                                  setAriaRoomSubPage("main");
                                  if (!navigateHistory(-1)) setActiveView(listenTogetherReturnView);
                                }}
                              >
                                <ArrowLeft className="size-4" />
                              </Button>
                              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                                一起听
                              </h1>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setAriaRoomSubPage("profile")}
                                title="查看头像与昵称"
                                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pl-1 pr-2.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-muted)]"
                              >
                                <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface)] text-[11px] font-semibold">
                                  {ariaRoom.identity.avatarUrl ? (
                                    ariaRoom.identity.avatarUrl.startsWith("data:") ? (
                                      <img
                                        src={ariaRoom.identity.avatarUrl}
                                        alt={ariaRoom.identity.nickname}
                                        referrerPolicy="no-referrer"
                                        className="size-full object-cover"
                                      />
                                    ) : (
                                      <ArtworkImage
                                        src={ariaRoom.identity.avatarUrl}
                                        cacheSize={64}
                                        alt={ariaRoom.identity.nickname}
                                        referrerPolicy="no-referrer"
                                        className="size-full object-cover"
                                      />
                                    )
                                  ) : (
                                    <span>{ariaRoom.identity.nickname.slice(0, 1).toUpperCase()}</span>
                                  )}
                                </span>
                                <span className="max-w-[96px] truncate">{ariaRoom.identity.nickname}</span>
                                <ChevronDown className="size-3.5 text-[var(--text-secondary)]" />
                              </button>

                              <Button
                                variant="glass"
                                size="sm"
                                onClick={() => setAriaRoomSubPage("network")}
                              >
                                <SlidersHorizontal className="size-3.5" />
                                网络设置
                              </Button>
                            </div>
                          </header>

                          {combinedLobbyError && (
                            <div
                              role="alert"
                              className="flex items-center gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-xs text-rose-600 dark:text-rose-300"
                            >
                              <AlertTriangle className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1">{combinedLobbyError}</span>
                            </div>
                          )}

                          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
                            {renderAriaRoomSection(true)}
                            {renderListenTogetherView(true)}
                          </div>
                        </div>
                      );
                    }

                    if (!listenTogether.isActive) {
                      return <div className="lt-page">{renderAriaRoomSection(false)}</div>;
                    }

                    return renderListenTogetherView(false);
                  })()}
                </Suspense>
              )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {searchActive || activeView === "settings" || activeView === "listenTogether" || activeView === "home" ? null : activeView === "player" ? (
            <PlayerSidePanel
              playing={playing}
              mode={playerSideView}
              onModeChange={setPlayerSideView}
              track={activeTrack}
              palette={surfacePalette}
              lyricDisplayMode={lyricDisplayMode}
              mvLyricsUnavailable={standaloneMvActive}
              tracks={effectiveQueueTracks}
              activeTrackId={activeTrackId}
              onPickTrack={chooseTrack}
              onSeek={seekTo}
              onBindLyrics={(trackId, lyrics, candidateId) => applyLyricsToTrack(trackId, lyrics, candidateId)}
              onPlayNext={playNextTrack}
              onRemove={removeFromQueue}
              onMove={moveQueueTrack}
            />
          ) : (
          <aside className="glass hidden min-h-0 flex-col rounded-[1.5rem] p-4 xl:flex">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-950/6 pb-3">
              <h2 className="text-base font-semibold tracking-tight">下一首</h2>
              <Button variant="ghost" size="icon" aria-label="展开队列" onClick={() => setQueueOpen(true)}>
                <AriaIcon name="queue" className="size-4" />
              </Button>
            </div>

            <QueueList
              tracks={effectiveQueueTracks}
              activeTrackId={activeTrackId}
              playing={playing}
              onPickTrack={chooseTrack}
              onPlayNext={playNextTrack}
              onRemove={removeFromQueue}
              onMove={moveQueueTrack}
            />
          </aside>
          )}
        </section>

        {queueOpen && <PlaybackQueue
          tracks={effectiveQueueTracks}
          activeTrackId={activeTrackId}
          onPickTrack={chooseTrack}
          onClose={() => setQueueOpen(false)}
          onPlayNext={playNextTrack}
          onRemove={removeFromQueue}
          onMove={moveQueueTrack}
          onClear={clearQueue}
        />}

        <AnimatePresence>
          {immersiveOpen && !(BILIBILI_VIDEO_ENABLED && videoMode && Boolean(activeTrack.videoUrl)) && (
            <ImmersivePlayerView
              activeTrack={activeTrack}
              palette={darkSurfacePalette}
              playing={playing}
              visualizerPlaying={visualizerPlaying}
              durationSeconds={durationSeconds}
              analyserRef={analyserRef}
              visualizerMode={nativePlaybackEnabled ? audioOutputMode : "system"}
              volume={volume}
              onVolumeChange={setVolume}
              shuffleEnabled={shuffleEnabled}
              repeatMode={repeatMode}
              liked={isTrackLiked(activeTrack)}
              onToggleShuffle={toggleShuffleQueue}
              onCycleRepeatMode={() => setRepeatMode((current) => (current === "all" ? "one" : "all"))}
              onToggleLike={() => toggleLikeTrack(activeTrack.id)}
              qualityLevel={effectiveQualityLevel}
              onQualityLevelChange={handleQualityLevelChange}
              onClose={() => void closeImmersiveView()}
              onTogglePlay={togglePlayback}
              onNext={() => pickRelativeTrack(1)}
              onPrevious={() => pickRelativeTrack(-1)}
              onSeek={seekTo}
              visualizerActive={pageVisible}
              lyricDisplayMode={lyricDisplayMode}
              videoMode={videoMode}
              onToggleVideoMode={toggleVideoMode}
              standaloneMvAudio={standaloneMvActive}
              videoControlRef={videoControlRef}
              videoUrlOverride={activeVideoUrl}
              videoAudioUrlOverride={activeVideoAudioUrl}
              videoQualities={videoQualities}
              videoQualityId={videoQn}
              videoAudioQuality={videoAudioQuality}
              videoAudioLevel={videoAudioLevel}
              videoAudioLevels={videoAudioLevels}
              onVideoAudioLevelChange={(level) => {
                commitActiveVideoTime();
                pendingSeekRef.current = getPlaybackTime();
                setVideoAudioLevel(level);
                if (level && level !== effectiveQualityLevel) {
                  handleQualityLevelChange(level as QualityLevel);
                }
              }}
              onVideoQualityChange={(qn) => {
                commitActiveVideoTime();
                pendingSeekRef.current = getPlaybackTime();
                setVideoQn(qn);
              }}
              onVideoDuration={setDurationSeconds}
              onVideoEnded={handleTrackEnded}
              onVideoError={(message) => {
                setPlaybackError(message);
                setVideoMode(false);
              }}
              videoActive={immersiveOpen}
            />
          )}
        </AnimatePresence>

        {onboardingOpen && (
          <Suspense fallback={null}>
            <OnboardingDialog
              neteaseAccount={neteaseAccount}
              hifiEnabled={hifiEnabled}
              onHifiEnabledChange={handleHifiEnabledChange}
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
              onSourceAccountChange={() => { refreshQqAccount(); refreshBilibiliAccount(); refreshYoutubeAccount(); void qqData.refresh(); void youtubeData.refresh(); void youtubeData.refreshPlaylists(); }}
              qqAccount={qqAccount}
              bilibiliAccount={bilibiliAccount}
              onComplete={() => setOnboardingOpen(false)}
            />
          </Suspense>
        )}

        {navOpen && !immersiveOpen && (
          <button
            type="button"
            aria-label="关闭副导航"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            onClick={() => setNavOpen(false)}
          />
        )}

        {!immersiveOpen && !onboardingOpen && <FloatingNav
          activeView={activeView}
          open={navOpen}
          raised={activeView === "player" && videoMode}
          onOpenChange={(nextOpen) => {
            if (navCloseTimer.current !== null) {
              window.clearTimeout(navCloseTimer.current);
              navCloseTimer.current = null;
            }
            setNavOpen(nextOpen);
          }}
          onRequestClose={() => {
            if (navCloseTimer.current !== null) window.clearTimeout(navCloseTimer.current);
            navCloseTimer.current = window.setTimeout(() => {
              setNavOpen(false);
              navCloseTimer.current = null;
            }, 300);
          }}
          onPick={(id) => {
            if (navCloseTimer.current !== null) {
              window.clearTimeout(navCloseTimer.current);
              navCloseTimer.current = null;
            }
            clearSearchState();
            setSelectedArtist(null);
            setSelectedUser(null);
            setSelectedAlbum(null);
            setQueueOpen(false);
            if (id === "playlists") { closePlaylist(); localPlaylists.setSelectedId(null); playlistReturnRef.current = null; setPlaylistSourceIntent(null); setPlaylistSourceRequest(null); }
            if (id === "settings" && activeView !== "settings") setSettingsReturnView(activeView);
            setActiveView(id);
            setNavOpen(false);
          }}
        />}

      </div>
      {(playbackNotice || playbackError || deviceChangePrompt) && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-[90] flex max-w-[min(92vw,34rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-neutral-950/92 px-4 py-3 text-sm text-white shadow-[0_18px_50px_rgba(20,24,35,0.35)] backdrop-blur"
        >
          <span className="min-w-0 flex-1 leading-6">{playbackNotice ?? playbackError ?? deviceChangePrompt}</span>
          {!playbackNotice && !playbackError && deviceChangePrompt && (
            <button
              type="button"
              className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/25"
              onClick={() => void recoverAudioOutput()}
            >
              恢复输出
            </button>
          )}
          <button
            type="button"
            className="shrink-0 rounded-full px-1 text-white/60 hover:text-white"
            aria-label="关闭提示"
            onClick={() => {
              setPlaybackNotice(null);
              setPlaybackError(null);
              dismissDeviceChangePrompt();
            }}
          >
            ×
          </button>
        </div>
      )}
      {addPlaylistRequest && (shouldUseLocalPlaylistDialog(addPlaylistRequest.tracks) ? (
        <AddToLocalPlaylistDialog
          tracks={addPlaylistRequest.tracks}
          playlists={localPlaylists.playlists}
          onClose={() => setAddPlaylistRequest(null)}
          onCreate={localPlaylists.create}
          onAdd={(id, tracks) => {
            localPlaylists.addTracks(id, tracks);
            if (addPlaylistRequest.playlistId === id) localPlaylists.setSelectedId(id);
          }}
        />
      ) : (
        <AddToPlaylistDialog
          initialTracks={addPlaylistRequest.tracks}
          initialPlaylistId={addPlaylistRequest.playlistId}
          existingTrackIds={addPlaylistRequest.existingTrackIds}
          playlists={providerPlaylists}
          localPlaylists={localPlaylists.playlists}
          allTracks={allTracks}
          connected={neteaseConnected}
          onClose={() => setAddPlaylistRequest(null)}
          onRequireLogin={() => { setAddPlaylistRequest(null); setAccountOpen(true); }}
          onAdd={(id, tracks) => editPlaylistTracks(id, tracks, "add")}
          onCreate={(name, isPrivate) => createPlaylist(name, isPrivate, false)}
          onAddLocal={(id, tracks) => {
            localPlaylists.addTracks(id, tracks);
            if (addPlaylistRequest.playlistId === id) localPlaylists.setSelectedId(id);
          }}
          onCreateLocal={(name, tracks) => localPlaylists.create(name, tracks)}
        />
      ))}
      <Suspense fallback={null}>
        {listenTogether.incomingInvite && !listenTogether.isActive && (
          <ListenTogetherInviteToast
            invite={listenTogether.incomingInvite}
            loading={listenTogether.loading}
            onAccept={async (invite) => {
              if (ariaRoom.isActive) await ariaRoom.leaveRoom();
              return listenTogether.acceptIncomingInvite(invite);
            }}
            onDismiss={listenTogether.dismissIncomingInvite}
          />
        )}
        {listenTogether.pendingSourceExit && (
          <ListenTogetherExitPromptDialog
            pendingTrack={listenTogether.pendingSourceExit.track}
            onContinueTogether={listenTogether.cancelSourceExit}
            onConfirmExitAndPlay={listenTogether.confirmExitAndPlay}
          />
        )}
      </Suspense>
    </main>
    </PlaylistActionsProvider>
    </ArtistNavigationContext.Provider>
  );
}
