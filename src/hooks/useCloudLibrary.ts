import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api, ApiError, type ProviderCloudTrack } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { mergeTracks } from "@/lib/playerPresentation";

const pageSize = 100;

/** Loads only the viewed account's cloud library; searching scans its pages. */
export function useCloudLibrary({ enabled, connected, accountId }: {
  enabled: boolean;
  connected: boolean;
  accountId: string | null;
}) {
  const [items, setItems] = useState<ProviderCloudTrack[]>([]);
  const [cloudTracks, setCloudTracks] = useState<Track[]>([]);
  const [count, setCount] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [maxSize, setMaxSize] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessExpired, setAccessExpired] = useState(false);
  const [query, setQuery] = useState("");
  const nextOffsetRef = useRef(0);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const lastPageRefreshRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    pendingRef.current = false;
    nextOffsetRef.current = 0;
    setItems([]);
    setCloudTracks([]);
    setCount(0);
    setSize(null);
    setMaxSize(null);
    setMore(false);
    setLoaded(false);
    setLoading(false);
    setError(null);
    setAccessExpired(false);
    setQuery("");
  }, [accountId, connected]);

  const loadPage = useCallback(async (refresh = false) => {
    if (!connected || !accountId || pendingRef.current) return;
    const generation = generationRef.current;
    const offset = refresh ? 0 : nextOffsetRef.current;
    pendingRef.current = true;
    lastPageRefreshRef.current = refresh;
    setLoading(true);
    setError(null);
    setAccessExpired(false);
    try {
      const page = await api.getNeteaseCloud(pageSize, offset, refresh);
      if (generation !== generationRef.current) return;
      const mapped = page.items.map((item, index) => providerTrackToUiTrack(item.track, offset + index));
      setItems((current) => {
        const combined = refresh ? page.items : [...current, ...page.items];
        return [...new Map(combined.map((item) => [item.track.id, item])).values()];
      });
      setCloudTracks((current) => refresh ? mapped : mergeTracks([...current, ...mapped]));
      setCount(page.count);
      setSize(page.size);
      setMaxSize(page.maxSize);
      // Guard a malformed provider page from restarting the same request forever.
      setMore(page.more && page.nextOffset > offset);
      nextOffsetRef.current = page.nextOffset;
      setLoaded(true);
    } catch (cause) {
      if (generation !== generationRef.current) return;
      const expired = cause instanceof ApiError && cause.status === 401;
      setAccessExpired(expired);
      setError(expired ? "网易云登录已失效，请重新登录后读取云盘。" : cause instanceof Error ? cause.message : "云盘加载失败，请重试");
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
        setLoading(false);
      }
    }
  }, [connected, accountId]);

  useEffect(() => {
    if (enabled && connected && !loaded && !loading && !error) void loadPage();
  }, [enabled, connected, loaded, loading, error, loadPage]);

  // The API has no cloud keyword endpoint. Load remaining pages while a cloud
  // query is active, so filtering eventually covers the entire library.
  useEffect(() => {
    if (!enabled || !query.trim() || !more || loading || error) return;
    const timer = window.setTimeout(() => void loadPage(), 180);
    return () => window.clearTimeout(timer);
  }, [enabled, query, more, loading, error, loadPage]);

  const resolveCloudTrack = useCallback(async (trackId: string) => {
    const generation = generationRef.current;
    const providerId = trackId.replace(/^netease:/, "");
    const { item } = await api.getNeteaseCloudTrack(providerId);
    if (generation !== generationRef.current) throw new Error("账号已切换，请重新打开云盘");
    const track = providerTrackToUiTrack(item.track, 0);
    setItems((current) => current.map((existing) => existing.track.id === providerId ? item : existing));
    setCloudTracks((current) => current.map((existing) => existing.id === trackId ? { ...existing, ...track } : existing));
    return track;
  }, []);

  const visibleTracks = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return cloudTracks;
    const fileNames = new Map(items.map((item) => [`netease:${item.track.id}`, item.fileName]));
    return cloudTracks.filter((track) => `${track.title}\n${track.artist}\n${track.album}\n${fileNames.get(track.id) ?? ""}`.toLocaleLowerCase().includes(keyword));
  }, [cloudTracks, items, query]);

  return {
    items, cloudTracks, setCloudTracks, visibleTracks,
    count, size, maxSize, more, loaded, loading, error, accessExpired,
    query, setQuery,
    refreshCloud: () => loadPage(true),
    loadMoreCloud: () => loadPage(),
    retryCloud: () => loadPage(lastPageRefreshRef.current),
    resolveCloudTrack,
  };
}

export type CloudLibraryState = ReturnType<typeof useCloudLibrary>;
