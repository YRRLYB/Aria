import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api, type ProviderPlaylist } from "@/lib/api";
import { normalizeQuality, type QualityLevel } from "@/lib/playerPresentation";
import { providerTrackToUiTrack } from "@/lib/trackMappers";

export type BilibiliAudioMetaEntry = {
  bitrate?: number | null;
  quality?: Track["quality"];
  currentLevel?: Track["currentLevel"];
  availableLevels?: Track["availableLevels"];
};

const AUDIO_META_STORAGE_KEY = "aria-bilibili-audio-meta-v1";
const MAX_CACHED_AUDIO_META = 500;
const HYDRATE_CONCURRENCY = 2;
const HYDRATE_PACE_MS = 150;

function readAudioMetaStore(): Record<string, BilibiliAudioMetaEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AUDIO_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BilibiliAudioMetaEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAudioMetaStore(entries: Record<string, BilibiliAudioMetaEntry>) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(entries);
    if (keys.length > MAX_CACHED_AUDIO_META) {
      const trimmed: Record<string, BilibiliAudioMetaEntry> = {};
      for (const key of keys.slice(keys.length - MAX_CACHED_AUDIO_META)) {
        trimmed[key] = entries[key];
      }
      window.localStorage.setItem(AUDIO_META_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(AUDIO_META_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Cache writes are best-effort.
  }
}

export function saveBilibiliAudioMeta(providerId: string, meta: BilibiliAudioMetaEntry) {
  if (!providerId) return;
  const entries = readAudioMetaStore();
  const previous = entries[providerId];
  entries[providerId] = {
    bitrate: meta.bitrate ?? previous?.bitrate ?? null,
    quality: meta.quality ? normalizeQuality(meta.quality) : previous?.quality,
    currentLevel: meta.currentLevel ?? previous?.currentLevel ?? null,
    availableLevels: meta.availableLevels?.length ? meta.availableLevels : previous?.availableLevels,
  };
  writeAudioMetaStore(entries);
}

function mergeCachedAudioMeta(track: Track, store: Record<string, BilibiliAudioMetaEntry>): Track {
  const key = track.providerId ?? (track.id.startsWith("bilibili:") ? track.id.slice("bilibili:".length) : "");
  const cached = key ? store[key] : undefined;
  if (!cached) return track;
  return {
    ...track,
    bitrate: track.bitrate ?? cached.bitrate ?? null,
    quality: cached.quality ?? track.quality,
    currentLevel: track.currentLevel ?? cached.currentLevel ?? null,
    availableLevels: cached.availableLevels?.length ? cached.availableLevels : track.availableLevels,
  };
}

/**
 * Bilibili account favourites (the Aria favourite folder). Reads lazily when
 * the user opens 我喜欢 or signs in, and progressively hydrates bitrates for
 * visible tracks while preserving cached values across refreshes.
 */
export function useBilibiliData(options: {
  connected: boolean;
  applyTrackUpdate?: (
    trackId: string,
    updateTrack: (track: Track) => Track,
    updateOptions?: { includeHistory?: boolean },
  ) => void;
}) {
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // 账号自己的收藏夹歌单（B站歌单页的「我的收藏夹」，登录后自动同步）。
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<ProviderPlaylist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const playlistsRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const playlistsTokenRef = useRef(0);
  const playlistDetailTokenRef = useRef(0);
  const sessionTokenRef = useRef(0);
  const accountEpochRef = useRef(0);
  const likedTracksRef = useRef<Track[]>(likedTracks);
  likedTracksRef.current = likedTracks;
  const probedKeysRef = useRef(new Set<string>());
  const inFlightKeysRef = useRef(new Set<string>());
  const pendingQueueRef = useRef<Array<{ trackId: string; providerId: string; level: QualityLevel }>>([]);
  const activeWorkersRef = useRef(0);
  const applyTrackUpdateRef = useRef(options.applyTrackUpdate);
  applyTrackUpdateRef.current = options.applyTrackUpdate;

  const refresh = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const sessionToken = ++sessionTokenRef.current;
    setListLoading(true);
    const task = api
      .getSourceLikedTracks("bilibili")
      .then(({ tracks }) => {
        if (sessionToken !== sessionTokenRef.current) return;
        const cacheStore = readAudioMetaStore();
        const existingById = new Map(likedTracksRef.current.map((item) => [item.id, item]));
        setLikedTracks(
          tracks.map((rawTrack, index) => {
            const uiTrack = providerTrackToUiTrack(rawTrack, index);
            const existing = existingById.get(uiTrack.id);
            const withExisting: Track = existing
              ? {
                  ...uiTrack,
                  bitrate: uiTrack.bitrate ?? existing.bitrate ?? null,
                  quality: uiTrack.bitrate ? uiTrack.quality : existing.quality,
                  currentLevel: uiTrack.currentLevel ?? existing.currentLevel ?? null,
                  availableLevels: existing.availableLevels?.length ? existing.availableLevels : uiTrack.availableLevels,
                }
              : uiTrack;
            return mergeCachedAudioMeta(withExisting, cacheStore);
          }),
        );
        setListError(null);
      })
      .catch((error: unknown) => {
        if (sessionToken !== sessionTokenRef.current) return;
        setListError(error instanceof Error ? error.message : "B站收藏读取失败，请稍后重试");
      })
      .finally(() => {
        if (sessionToken === sessionTokenRef.current) setListLoading(false);
      });
    refreshPromiseRef.current = task.finally(() => {
      if (sessionToken === sessionTokenRef.current) refreshPromiseRef.current = null;
    });
    return refreshPromiseRef.current;
  }, []);

  useEffect(() => {
    if (options.connected) return;
    accountEpochRef.current += 1;
    sessionTokenRef.current += 1;
    refreshPromiseRef.current = null;
    playlistsRefreshPromiseRef.current = null;
    playlistsTokenRef.current += 1;
    playlistDetailTokenRef.current += 1;
    probedKeysRef.current.clear();
    inFlightKeysRef.current.clear();
    pendingQueueRef.current = [];
    setLikedTracks([]);
    setListLoading(false);
    setListError(null);
    setPlaylists([]);
    setPlaylistsLoading(false);
    setPlaylistsError(null);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setPlaylistLoading(false);
    setPlaylistError(null);
  }, [options.connected]);

  /** 拉取账号自己的收藏夹歌单列表（并发合并，切账号自动作废）。 */
  const refreshPlaylists = useCallback(() => {
    if (playlistsRefreshPromiseRef.current) return playlistsRefreshPromiseRef.current;
    const sessionToken = ++playlistsTokenRef.current;
    setPlaylistsLoading(true);
    const task = api
      .getSourcePlaylists("bilibili")
      .then(({ playlists: nextPlaylists }) => {
        if (sessionToken !== playlistsTokenRef.current) return;
        setPlaylists(nextPlaylists);
        setPlaylistsError(null);
      })
      .catch((error: unknown) => {
        if (sessionToken !== playlistsTokenRef.current) return;
        setPlaylistsError(error instanceof Error ? error.message : "B站收藏夹读取失败，请稍后重试");
      })
      .finally(() => {
        if (sessionToken === playlistsTokenRef.current) setPlaylistsLoading(false);
      });
    playlistsRefreshPromiseRef.current = task.finally(() => {
      if (sessionToken === playlistsTokenRef.current) playlistsRefreshPromiseRef.current = null;
    });
    return playlistsRefreshPromiseRef.current;
  }, []);

  // 登录后自动同步一次收藏夹歌单；未登录时保持空列表。
  useEffect(() => {
    if (!options.connected) return;
    void refreshPlaylists();
  }, [options.connected, refreshPlaylists]);

  const openPlaylist = useCallback((playlist: ProviderPlaylist) => {
    const sessionToken = ++playlistDetailTokenRef.current;
    setSelectedPlaylist(playlist);
    setPlaylistTracks([]);
    setPlaylistError(null);
    setPlaylistLoading(true);
    api
      .getSourcePlaylistTracks("bilibili", playlist.id)
      .then(({ tracks }) => {
        if (sessionToken !== playlistDetailTokenRef.current) return;
        const cacheStore = readAudioMetaStore();
        setPlaylistTracks(tracks.map((rawTrack, index) => mergeCachedAudioMeta(providerTrackToUiTrack(rawTrack, index), cacheStore)));
        setPlaylistError(null);
      })
      .catch((error: unknown) => {
        if (sessionToken !== playlistDetailTokenRef.current) return;
        setPlaylistError(error instanceof Error ? error.message : "读取B站歌单曲目失败，请稍后重试");
      })
      .finally(() => {
        if (sessionToken === playlistDetailTokenRef.current) setPlaylistLoading(false);
      });
  }, []);

  const closePlaylist = useCallback(() => {
    playlistDetailTokenRef.current += 1;
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setPlaylistLoading(false);
    setPlaylistError(null);
  }, []);

  const drainHydrationQueue = useCallback(() => {
    const pump = async () => {
      while (pendingQueueRef.current.length > 0) {
        const next = pendingQueueRef.current.shift();
        if (!next) break;
        const probeKey = `${next.providerId}:${next.level}`;
        if (probedKeysRef.current.has(probeKey) || inFlightKeysRef.current.has(probeKey)) continue;
        inFlightKeysRef.current.add(probeKey);
        const epoch = accountEpochRef.current;
        try {
          const meta = await api.getSourceStreamMeta("bilibili", next.providerId, next.level);
          if (epoch !== accountEpochRef.current) return;
          probedKeysRef.current.add(probeKey);
          const resolvedQuality = meta.quality ? normalizeQuality(meta.quality) : undefined;
          saveBilibiliAudioMeta(next.providerId, {
            bitrate: meta.bitrate ?? null,
            quality: resolvedQuality,
            currentLevel: meta.currentLevel ?? null,
            availableLevels: meta.availableLevels,
          });
          applyTrackUpdateRef.current?.(
            next.trackId,
            (track) => ({
              ...track,
              bitrate: meta.bitrate ?? track.bitrate,
              sampleRate: meta.sampleRate ?? track.sampleRate,
              currentLevel: meta.currentLevel ?? track.currentLevel,
              availableLevels: meta.availableLevels?.length ? meta.availableLevels : track.availableLevels,
              quality: resolvedQuality ?? track.quality,
            }),
            { includeHistory: false },
          );
        } catch {
          probedKeysRef.current.add(probeKey);
        } finally {
          inFlightKeysRef.current.delete(probeKey);
        }
        await new Promise((resolve) => window.setTimeout(resolve, HYDRATE_PACE_MS));
      }
    };

    while (activeWorkersRef.current < HYDRATE_CONCURRENCY && pendingQueueRef.current.length > 0) {
      activeWorkersRef.current += 1;
      void pump().finally(() => {
        activeWorkersRef.current = Math.max(0, activeWorkersRef.current - 1);
      });
    }
  }, []);

  const hydrateTracks = useCallback(
    (tracks: Track[], preferredLevel: QualityLevel) => {
      if (!options.connected || !tracks.length) return;
      const cacheStore = readAudioMetaStore();
      for (const track of tracks) {
        if (track.source !== "bilibili" || track.bitrate) continue;
        const providerId = track.providerId ?? (track.id.startsWith("bilibili:") ? track.id.slice("bilibili:".length) : "");
        if (!providerId) continue;
        const cached = cacheStore[providerId];
        if (cached?.bitrate) {
          applyTrackUpdateRef.current?.(
            track.id,
            (current) => ({
              ...current,
              bitrate: current.bitrate ?? cached.bitrate ?? null,
              quality: cached.quality ?? current.quality,
              currentLevel: current.currentLevel ?? cached.currentLevel ?? null,
              availableLevels: cached.availableLevels?.length ? cached.availableLevels : current.availableLevels,
            }),
            { includeHistory: false },
          );
          continue;
        }
        const probeKey = `${providerId}:${preferredLevel}`;
        if (
          probedKeysRef.current.has(probeKey) ||
          inFlightKeysRef.current.has(probeKey) ||
          pendingQueueRef.current.some((item) => item.providerId === providerId && item.level === preferredLevel)
        ) {
          continue;
        }
        pendingQueueRef.current.push({ trackId: track.id, providerId, level: preferredLevel });
      }
      drainHydrationQueue();
    },
    [drainHydrationQueue, options.connected],
  );

  const likedIds = useMemo(
    () =>
      likedTracks.reduce<Record<string, true>>((result, track) => {
        result[track.id] = true;
        return result;
      }, {}),
    [likedTracks],
  );

  const toggleLike = useCallback(
    async (track: Track) => {
      const providerId =
        track.providerId ?? (track.id.startsWith("bilibili:") ? track.id.slice("bilibili:".length) : track.id);
      const wasLiked = likedTracks.some((item) => item.id === track.id);
      const accountEpoch = accountEpochRef.current;
      const nextLiked = !wasLiked;
      const optimistic = { ...track, likedAt: nextLiked ? Date.now() : track.likedAt };
      setLikedTracks((current) =>
        nextLiked
          ? [optimistic, ...current.filter((item) => item.id !== track.id)]
          : current.filter((item) => item.id !== track.id),
      );
      try {
        await api.setSourceLike("bilibili", providerId, nextLiked);
      } catch (error) {
        if (accountEpoch === accountEpochRef.current) {
          setLikedTracks((current) =>
            wasLiked
              ? [track, ...current.filter((item) => item.id !== track.id)]
              : current.filter((item) => item.id !== track.id),
          );
        }
        throw error;
      }
    },
    [likedTracks],
  );

  return {
    likedTracks,
    likedIds,
    listLoading,
    listError,
    refresh,
    hydrateTracks,
    toggleLike,
    setLikedTracks,
    playlists,
    playlistsLoading,
    playlistsError,
    refreshPlaylists,
    selectedPlaylist,
    playlistTracks,
    setPlaylistTracks,
    playlistLoading,
    playlistError,
    openPlaylist,
    closePlaylist,
  };
}
