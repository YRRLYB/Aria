import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api, type ProviderPlaylist, type SourceAccountSummary, type SourceDiscoveryMood } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";

export type YoutubeDiscoveryUiBundle = {
  quickPicks: Track[];
  trendingTracks: Track[];
  charts: ProviderPlaylist[];
  playlists: ProviderPlaylist[];
  moods: SourceDiscoveryMood[];
};

const LIKE_RECONCILE_TTL_MS = 20_000;

/**
 * YouTube Music 账号、我喜欢、歌单与精选推荐：
 * - 登录（窗口 / Cookie）后同步账号「喜欢的音乐」与播放列表；
 * - 每日推荐 / 私人漫游 / 探索发现同时支持已登录（个性化）与匿名模式。
 */
export function useYoutubeData(options: { connected: boolean }) {
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<ProviderPlaylist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const [dailyTracks, setDailyTracks] = useState<Track[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [roamTracks, setRoamTracks] = useState<Track[]>([]);
  const [roamLoading, setRoamLoading] = useState(false);
  const [roamError, setRoamError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<YoutubeDiscoveryUiBundle | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const playlistsRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const likedSessionTokenRef = useRef(0);
  const playlistsTokenRef = useRef(0);
  const playlistDetailTokenRef = useRef(0);
  const accountEpochRef = useRef(0);
  const dailyLoadedRef = useRef(false);
  const discoveryLoadedRef = useRef(false);
  const recentLikeMutationsRef = useRef(new Map<string, { liked: boolean; track: Track; at: number }>());

  const reconcileLikedWithRecentMutations = useCallback((fetched: Track[]): Track[] => {
    const now = Date.now();
    const mutations = recentLikeMutationsRef.current;
    for (const [id, entry] of mutations.entries()) {
      if (now - entry.at > LIKE_RECONCILE_TTL_MS) {
        mutations.delete(id);
      }
    }
    if (!mutations.size) return fetched;
    const filtered = fetched.filter((track) => mutations.get(track.id)?.liked !== false);
    const seen = new Set(filtered.map((track) => track.id));
    const added: Track[] = [];
    for (const entry of mutations.values()) {
      if (entry.liked && !seen.has(entry.track.id)) {
        seen.add(entry.track.id);
        added.push(entry.track);
      }
    }
    return added.length ? [...added, ...filtered] : filtered;
  }, []);

  const refreshLiked = useCallback(() => {
    if (!options.connected) return Promise.resolve();
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const sessionToken = ++likedSessionTokenRef.current;
    setListLoading(true);
    const task = api
      .getSourceLikedTracks("youtube")
      .then(({ tracks }) => {
        if (sessionToken !== likedSessionTokenRef.current) return;
        const uiTracks = tracks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index));
        setLikedTracks(reconcileLikedWithRecentMutations(uiTracks));
        setListError(null);
      })
      .catch((error: unknown) => {
        if (sessionToken !== likedSessionTokenRef.current) return;
        setListError(error instanceof Error ? error.message : "YouTube 喜欢的音乐读取失败，请稍后重试");
      })
      .finally(() => {
        if (sessionToken === likedSessionTokenRef.current) setListLoading(false);
      });
    refreshPromiseRef.current = task.finally(() => {
      if (sessionToken === likedSessionTokenRef.current) refreshPromiseRef.current = null;
    });
    return refreshPromiseRef.current;
  }, [options.connected, reconcileLikedWithRecentMutations]);

  const refreshPlaylists = useCallback(() => {
    if (!options.connected) return Promise.resolve();
    if (playlistsRefreshPromiseRef.current) return playlistsRefreshPromiseRef.current;
    const sessionToken = ++playlistsTokenRef.current;
    setPlaylistsLoading(true);
    const task = api
      .getSourcePlaylists("youtube")
      .then(({ playlists: nextPlaylists }) => {
        if (sessionToken !== playlistsTokenRef.current) return;
        setPlaylists(nextPlaylists);
        setPlaylistsError(null);
      })
      .catch((error: unknown) => {
        if (sessionToken !== playlistsTokenRef.current) return;
        setPlaylistsError(error instanceof Error ? error.message : "YouTube 歌单读取失败，请稍后重试");
      })
      .finally(() => {
        if (sessionToken === playlistsTokenRef.current) setPlaylistsLoading(false);
      });
    playlistsRefreshPromiseRef.current = task.finally(() => {
      if (sessionToken === playlistsTokenRef.current) playlistsRefreshPromiseRef.current = null;
    });
    return playlistsRefreshPromiseRef.current;
  }, [options.connected]);

  const refresh = useCallback(() => {
    return Promise.all([refreshLiked(), refreshPlaylists()]).then(() => undefined);
  }, [refreshLiked, refreshPlaylists]);

  // 登录后自动同步一次；退出时丢弃账号私人数据，并允许重新拉取个性化推荐。
  useEffect(() => {
    accountEpochRef.current += 1;
    dailyLoadedRef.current = false;
    discoveryLoadedRef.current = false;
    if (options.connected) {
      void refresh();
      return;
    }
    likedSessionTokenRef.current += 1;
    playlistsTokenRef.current += 1;
    playlistDetailTokenRef.current += 1;
    refreshPromiseRef.current = null;
    playlistsRefreshPromiseRef.current = null;
    recentLikeMutationsRef.current.clear();
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
  }, [options.connected, refresh]);

  const openPlaylist = useCallback((playlist: ProviderPlaylist) => {
    const sessionToken = ++playlistDetailTokenRef.current;
    setSelectedPlaylist(playlist);
    setPlaylistTracks([]);
    setPlaylistError(null);
    setPlaylistLoading(true);
    api
      .getSourcePlaylistTracks("youtube", playlist.id)
      .then(({ tracks }) => {
        if (sessionToken !== playlistDetailTokenRef.current) return;
        setPlaylistTracks(tracks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index)));
        setPlaylistError(null);
      })
      .catch((error: unknown) => {
        if (sessionToken !== playlistDetailTokenRef.current) return;
        setPlaylistError(error instanceof Error ? error.message : "读取 YouTube 歌单曲目失败，请稍后重试");
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

  const likedIds = useMemo(() => {
    const map: Record<string, true> = {};
    for (const track of likedTracks) map[track.id] = true;
    return map;
  }, [likedTracks]);

  const toggleLike = useCallback(async (track: Track) => {
    const providerId = track.providerId ?? (track.id.startsWith("youtube:") ? track.id.slice("youtube:".length) : "");
    if (!providerId) return;
    const epoch = accountEpochRef.current;
    const currentlyLiked = Boolean(likedIds[track.id]);
    const nextLiked = !currentlyLiked;
    const optimisticTrack: Track = nextLiked ? { ...track, likedAt: Date.now() } : track;

    recentLikeMutationsRef.current.set(track.id, { liked: nextLiked, track: optimisticTrack, at: Date.now() });
    setLikedTracks((current) =>
      nextLiked
        ? [optimisticTrack, ...current.filter((item) => item.id !== track.id)]
        : current.filter((item) => item.id !== track.id),
    );
    setPlaylists((current) =>
      current.map((playlist) =>
        playlist.id === "FEmusic_liked_songs"
          ? { ...playlist, trackCount: Math.max(0, playlist.trackCount + (nextLiked ? 1 : -1)) }
          : playlist,
      ),
    );
    try {
      await api.setSourceLike("youtube", providerId, nextLiked);
    } catch (error) {
      recentLikeMutationsRef.current.delete(track.id);
      if (epoch === accountEpochRef.current) {
        setLikedTracks((current) =>
          currentlyLiked
            ? [track, ...current.filter((item) => item.id !== track.id)]
            : current.filter((item) => item.id !== track.id),
        );
        setPlaylists((current) =>
          current.map((playlist) =>
            playlist.id === "FEmusic_liked_songs"
              ? { ...playlist, trackCount: Math.max(0, playlist.trackCount + (currentlyLiked ? 1 : -1)) }
              : playlist,
          ),
        );
      }
      throw error;
    }
  }, [likedIds]);

  const loadDaily = useCallback(async (force = false) => {
    if ((dailyLoadedRef.current && !force) || dailyLoading) return;
    setDailyLoading(true);
    setDailyError(null);
    try {
      const result = await api.getSourceDailyTracks("youtube");
      dailyLoadedRef.current = true;
      setDailyTracks(result.tracks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index + 200)));
    } catch (error) {
      setDailyError(error instanceof Error ? error.message : "YouTube 每日推荐加载失败，请确认代理运行正常后重试");
    } finally {
      setDailyLoading(false);
    }
  }, [dailyLoading]);

  const loadRoam = useCallback(async (excludeIds: string[] = []) => {
    if (roamLoading) return;
    setRoamLoading(true);
    setRoamError(null);
    try {
      const result = await api.getSourceRoamTracks("youtube", 30, excludeIds);
      setRoamTracks(result.tracks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index + 400)));
    } catch (error) {
      setRoamError(error instanceof Error ? error.message : "YouTube 私人漫游加载失败，请稍后重试");
    } finally {
      setRoamLoading(false);
    }
  }, [roamLoading]);

  const loadDiscovery = useCallback(async (force = false) => {
    if ((discoveryLoadedRef.current && !force) || discoveryLoading) return;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    try {
      const result = await api.getSourceDiscovery("youtube");
      discoveryLoadedRef.current = true;
      setDiscovery({
        quickPicks: result.quickPicks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index + 600)),
        trendingTracks: result.trendingTracks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index + 800)),
        charts: result.charts,
        playlists: result.playlists,
        moods: result.moods,
      });
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : "YouTube 探索推荐加载失败，请确认代理运行正常后重试");
    } finally {
      setDiscoveryLoading(false);
    }
  }, [discoveryLoading]);

  return {
    likedTracks,
    likedIds,
    listLoading,
    listError,
    refresh,
    refreshLiked,
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
    dailyTracks,
    setDailyTracks,
    dailyLoading,
    dailyError,
    loadDaily,
    roamTracks,
    setRoamTracks,
    roamLoading,
    roamError,
    loadRoam,
    discovery,
    setDiscovery,
    discoveryLoading,
    discoveryError,
    loadDiscovery,
  };
}

/** 读取一次 YouTube 账号摘要（登录态探测由服务端完成）。 */
export async function fetchYoutubeAccountSummary(): Promise<SourceAccountSummary | null> {
  try {
    const result = await api.getSourceAccount("youtube");
    return result.account;
  } catch {
    return null;
  }
}
