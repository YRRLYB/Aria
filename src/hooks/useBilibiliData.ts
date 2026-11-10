import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";

/**
 * Bilibili account favourites (its default favourite folder). This is read
 * lazily when the user opens 我喜欢 or signs in, not at app start.
 */
export function useBilibiliData(options: { connected: boolean }) {
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const sessionTokenRef = useRef(0);

  const refresh = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const sessionToken = ++sessionTokenRef.current;
    setListLoading(true);
    const task = api
      .getSourceLikedTracks("bilibili")
      .then(({ tracks }) => {
        if (sessionToken !== sessionTokenRef.current) return;
        setLikedTracks(tracks.map((track, index) => providerTrackToUiTrack(track, index)));
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
    sessionTokenRef.current += 1;
    refreshPromiseRef.current = null;
    setLikedTracks([]);
    setListLoading(false);
    setListError(null);
  }, [options.connected]);

  const likedIds = useMemo(
    () => likedTracks.reduce<Record<string, true>>((result, track) => {
      result[track.id] = true;
      return result;
    }, {}),
    [likedTracks],
  );

  const toggleLike = useCallback(async (track: Track) => {
    const providerId = track.providerId ?? (track.id.startsWith("bilibili:") ? track.id.slice("bilibili:".length) : track.id);
    const wasLiked = likedTracks.some((item) => item.id === track.id);
    const nextLiked = !wasLiked;
    const optimistic = { ...track, likedAt: nextLiked ? Date.now() : track.likedAt };
    setLikedTracks((current) => (
      nextLiked
        ? [optimistic, ...current.filter((item) => item.id !== track.id)]
        : current.filter((item) => item.id !== track.id)
    ));
    try {
      await api.setSourceLike("bilibili", providerId, nextLiked);
    } catch (error) {
      setLikedTracks((current) => (
        wasLiked
          ? [track, ...current.filter((item) => item.id !== track.id)]
          : current.filter((item) => item.id !== track.id)
      ));
      throw error;
    }
  }, [likedTracks]);

  return {
    likedTracks,
    likedIds,
    listLoading,
    listError,
    refresh,
    toggleLike,
    setLikedTracks,
  };
}
