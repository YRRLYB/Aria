import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api, type ProviderPlaylist, type SourceAccountSummary } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";

/**
 * YouTube Music 账号、我喜欢与歌单数据：登录（窗口 / 设备码 / Cookie 绑定）后
 * 同步账号「喜欢的音乐」与音乐播放列表；未登录时保持空态。
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
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const playlistsRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const likedSessionTokenRef = useRef(0);
  const playlistsTokenRef = useRef(0);
  const playlistDetailTokenRef = useRef(0);
  const accountEpochRef = useRef(0);

  const refreshLiked = useCallback(() => {
    if (!options.connected) return Promise.resolve();
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const sessionToken = ++likedSessionTokenRef.current;
    setListLoading(true);
    const task = api
      .getSourceLikedTracks("youtube")
      .then(({ tracks }) => {
        if (sessionToken !== likedSessionTokenRef.current) return;
        setLikedTracks(tracks.map((rawTrack, index) => providerTrackToUiTrack(rawTrack, index)));
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
  }, [options.connected]);

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

  // 登录后自动同步一次；退出时丢弃全部状态。
  useEffect(() => {
    accountEpochRef.current += 1;
    if (options.connected) {
      void refresh();
      return;
    }
    likedSessionTokenRef.current += 1;
    playlistsTokenRef.current += 1;
    playlistDetailTokenRef.current += 1;
    refreshPromiseRef.current = null;
    playlistsRefreshPromiseRef.current = null;
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
    if (!options.connected) {
      throw new Error("请先在「设置 → 播放源 → YouTube」登录后再收藏");
    }
    const epoch = accountEpochRef.current;
    const currentlyLiked = Boolean(likedIds[track.id]);
    const nextLiked = !currentlyLiked;
    setLikedTracks((current) =>
      nextLiked
        ? [{ ...track, likedAt: Date.now() }, ...current.filter((item) => item.id !== track.id)]
        : current.filter((item) => item.id !== track.id),
    );
    try {
      await api.setSourceLike("youtube", providerId, nextLiked);
      if (epoch !== accountEpochRef.current) return;
      void refresh();
    } catch (error) {
      if (epoch === accountEpochRef.current) {
        setLikedTracks((current) =>
          currentlyLiked
            ? [track, ...current.filter((item) => item.id !== track.id)]
            : current.filter((item) => item.id !== track.id),
        );
      }
      throw error;
    }
  }, [likedIds, options.connected, refresh]);

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
