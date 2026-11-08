import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api, type ProviderPlaylist } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { mergeTracks } from "@/lib/playerPresentation";

/**
 * QQ 音乐账号数据（只读）：我喜欢、歌单列表与歌单详情。
 * 与 useNeteaseData 平行——网易云的写入/每日/漫游等能力不适用于 QQ。
 */
export function useQqData({ connected, applyTrackUpdate }: {
  connected: boolean;
  applyTrackUpdate: (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void;
}) {
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<ProviderPlaylist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [dailyTracks, setDailyTracks] = useState<Track[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [roamTracks, setRoamTracks] = useState<Track[]>([]);
  const [roamLoading, setRoamLoading] = useState(false);
  const [roamError, setRoamError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const dailyLoadedRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const sessionTokenRef = useRef(0);

  const refresh = useCallback(() => {
    // Coalesce simultaneous requests from the connection effect, the liked-view
    // effect and the manual sync button; otherwise entry into 我喜欢 could
    // fire two full profile/playlist round trips.
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    // No `connected` guard here: login callbacks fire before the account state
    // re-renders, and the server answers AUTH_REQUIRED when actually signed out.
    const sessionToken = ++sessionTokenRef.current;
    setListLoading(true);
    setListError(null);
    const task = (async () => {
      try {
        const [likedResult, playlistsResult] = await Promise.allSettled([
          api.getProviderLiked("qq"),
          api.getProviderPlaylists("qq"),
        ]);
        // A sign-out or account switch while this request was in flight must
        // not repopulate the previous account's liked list.
        if (sessionToken !== sessionTokenRef.current) return;
        if (likedResult.status === "fulfilled") {
          const tracks = likedResult.value.tracks.map((track, index) => providerTrackToUiTrack(track, index));
          // Replace instead of merge: a song removed in QQ Music must disappear
          // here too, and a re-sync must not accumulate duplicate rows.
          setLikedTracks(tracks);
        }
        if (playlistsResult.status === "fulfilled") {
          setPlaylists(playlistsResult.value.playlists);
        }
        if (likedResult.status === "rejected" && playlistsResult.status === "rejected") {
          const reason = likedResult.reason;
          setListError(reason instanceof Error ? reason.message : "QQ 音乐歌单读取失败");
        } else if (likedResult.status === "fulfilled") {
          setListError(null);
        }
      } finally {
        if (sessionToken === sessionTokenRef.current) setListLoading(false);
      }
    })();
    refreshPromiseRef.current = task.finally(() => {
      if (sessionToken === sessionTokenRef.current) refreshPromiseRef.current = null;
    });
    return refreshPromiseRef.current;
  }, []);

  // Signed out → drop everything; the lists reload lazily via refresh().
  useEffect(() => {
    if (connected) return;
    sessionTokenRef.current += 1;
    refreshPromiseRef.current = null;
    setListLoading(false);
    setLikedTracks([]);
    setPlaylists([]);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setPlaylistError(null);
    setListError(null);
  }, [connected]);

  const openPlaylist = useCallback(async (playlist: ProviderPlaylist) => {
    const requestId = ++requestRef.current;
    setSelectedPlaylist(playlist);
    setPlaylistError(null);
    setPlaylistTracks([]);
    setPlaylistLoading(true);
    try {
      const result = await api.getProviderPlaylistTracks("qq", playlist.id);
      if (requestId !== requestRef.current) return;
      const uiTracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
      setPlaylistTracks(uiTracks);
    } catch (error) {
      if (requestId === requestRef.current) setPlaylistError(error instanceof Error ? error.message : "歌单加载失败，请重试");
    } finally {
      if (requestId === requestRef.current) setPlaylistLoading(false);
    }
  }, []);

  function closePlaylist() {
    requestRef.current += 1;
    setSelectedPlaylist(null);
    setPlaylistLoading(false);
    setPlaylistError(null);
  }

  const likedIds = useMemo(
    () => likedTracks.reduce<Record<string, true>>((result, track) => {
      result[track.id] = true;
      return result;
    }, {}),
    [likedTracks],
  );

  /**
   * QQ 红心写入 + 乐观更新。失败时回滚并把错误抛给调用方，由界面提示
   * “登录过期 / 操作频繁 / 需要会员”等原因，而不是假装点成功。
   */
  const toggleLike = useCallback(async (track: Track) => {
    const providerId = track.providerId ?? track.id.replace(/^qq:/, "");
    if (!providerId) throw new Error("缺少 QQ 音乐歌曲 ID");
    const wasLiked = likedTracks.some((item) => item.id === track.id);
    const nextLiked = !wasLiked;
    const optimistic = { ...track, likedAt: nextLiked ? Date.now() : track.likedAt };
    setLikedTracks((current) => (
      nextLiked
        ? [optimistic, ...current.filter((item) => item.id !== track.id)]
        : current.filter((item) => item.id !== track.id)
    ));
    try {
      await api.setQqLike(providerId, nextLiked);
    } catch (error) {
      setLikedTracks((current) => (
        wasLiked
          ? [track, ...current.filter((item) => item.id !== track.id)]
          : current.filter((item) => item.id !== track.id)
      ));
      throw error;
    }
  }, [likedTracks]);

  // —— QQ 推荐流(官方榜单聚合) ——

  const loadDaily = useCallback(async () => {
    if (dailyLoadedRef.current || dailyLoading) return;
    setDailyLoading(true);
    setDailyError(null);
    try {
      const result = await api.getSourceDailyTracks("qq");
      const tracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
      dailyLoadedRef.current = true;
      setDailyTracks((current) => mergeTracks([...current, ...tracks]));
    } catch (error) {
      setDailyError(error instanceof Error ? error.message : "QQ 每日推荐加载失败");
    } finally {
      setDailyLoading(false);
    }
  }, [dailyLoading]);

  const loadRoam = useCallback(async (excludeIds: string[] = []) => {
    if (roamLoading) return;
    setRoamLoading(true);
    setRoamError(null);
    try {
      const result = await api.getSourceRoamTracks("qq", 30, excludeIds);
      const tracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index + 600));
      setRoamTracks(tracks);
    } catch (error) {
      setRoamError(error instanceof Error ? error.message : "QQ 私人漫游加载失败");
    } finally {
      setRoamLoading(false);
    }
  }, [roamLoading]);

  return {
    likedTracks,
    likedIds,
    setLikedTracks,
    toggleLike,
    playlists,
    selectedPlaylist,
    setSelectedPlaylist,
    playlistTracks,
    playlistLoading,
    playlistError,
    listLoading,
    listError,
    refresh,
    openPlaylist,
    closePlaylist,
    dailyTracks,
    dailyLoading,
    dailyError,
    loadDaily,
    roamTracks,
    roamLoading,
    roamError,
    loadRoam,
  };
}

export type QqDataState = ReturnType<typeof useQqData>;
