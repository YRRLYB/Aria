import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Track, ViewId } from "@/data/music";
import type { NeteaseAccountSummary, ProviderPlaylist } from "@/lib/api";
import { api } from "@/lib/api";
import { memoryLimits, trimStringSet, warmupBatchLimits } from "@/lib/memoryCache";
import { clearNeteaseSnapshot, readNeteaseSnapshot, writeNeteaseSnapshot } from "@/lib/neteaseSnapshot";
import { mergeTracks, trimTrackCache } from "@/lib/playerPresentation";
import { materializeQueueIds } from "@/lib/playQueue";
import { isLikedPlaylist, providerTrackToUiTrack, idleTrack } from "@/lib/trackMappers";
import type { QualityLevel } from "@/lib/playerPresentation";

// Owns everything NetEase: account, liked/daily/roam/playlist track pools,
// stream-metadata warmup and the like toggle.
export function useNeteaseData(options: {
  applyTrackUpdate: (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void;
  getWarmupLevel: (track: Track) => QualityLevel;
  playing: boolean;
  canAutoSelectFirstTrack: boolean;
  onAutoSelectTrack: (trackId: string) => void;
  activeView: ViewId;
  getActiveTrack: () => Track;
  shuffleEnabled: boolean;
  setPlayQueueIds: (updater: (ids: string[]) => string[]) => void;
}) {
  const { applyTrackUpdate } = options;
  const initialSnapshot = useRef(readNeteaseSnapshot()).current;
  const snapshotUserIdRef = useRef<string | null>(initialSnapshot?.userId ?? null);
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountSummary | null>(null);
  const [neteaseTracks, setNeteaseTracks] = useState<Track[]>(initialSnapshot?.neteaseTracks ?? []);
  const [neteaseLikedTracks, setNeteaseLikedTracks] = useState<Track[]>(initialSnapshot?.likedTracks ?? []);
  const [dailyTracks, setDailyTracks] = useState<Track[]>(initialSnapshot?.dailyTracks ?? []);
  const [roamTracks, setRoamTracks] = useState<Track[]>(initialSnapshot?.roamTracks ?? []);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [neteaseLikedIds, setNeteaseLikedIds] = useState<Record<string, true>>(
    () => Object.fromEntries((initialSnapshot?.likedTracks ?? []).map((track) => [track.id, true])),
  );
  const [selectedPlaylist, setSelectedPlaylist] = useState<ProviderPlaylist | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [roamRefreshing, setRoamRefreshing] = useState(false);
  const [providerPlaylists, setProviderPlaylists] = useState<ProviderPlaylist[]>(initialSnapshot?.playlists ?? []);
  const neteaseWarmupRef = useRef<Set<string>>(new Set());
  const playlistRequestRef = useRef(0);
  const selectedPlaylistIdRef = useRef<string | null>(null);
  selectedPlaylistIdRef.current = selectedPlaylist?.id ?? null;

  useEffect(() => {
    if (!neteaseAccount) return;
    if (!neteaseAccount.connected) {
      snapshotUserIdRef.current = null;
      setNeteaseTracks([]);
      setNeteaseLikedTracks([]);
      setDailyTracks([]);
      setRoamTracks([]);
      setPlaylistTracks([]);
      setNeteaseLikedIds({});
      setProviderPlaylists([]);
      clearNeteaseSnapshot();
      return;
    }
    const userId = neteaseAccount.userId;
    if (!userId) return;
    if (snapshotUserIdRef.current && snapshotUserIdRef.current !== userId) {
      // A different account must never inherit the previous account's covers,
      // liked songs or playlists while the new data is loading.
      snapshotUserIdRef.current = userId;
      setNeteaseTracks([]);
      setNeteaseLikedTracks([]);
      setDailyTracks([]);
      setRoamTracks([]);
      setPlaylistTracks([]);
      setNeteaseLikedIds({});
      setProviderPlaylists([]);
      clearNeteaseSnapshot();
      return;
    }
    snapshotUserIdRef.current = userId;
  }, [neteaseAccount?.connected, neteaseAccount?.userId]);

  useEffect(() => {
    if (!neteaseTracks.length && !providerPlaylists.length && !neteaseLikedTracks.length && !dailyTracks.length && !roamTracks.length) return;
    const timer = window.setTimeout(() => {
      writeNeteaseSnapshot({
        userId: snapshotUserIdRef.current,
        dailyTracks,
        roamTracks,
        likedTracks: neteaseLikedTracks,
        neteaseTracks,
        playlists: providerPlaylists,
      });
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [dailyTracks, neteaseLikedTracks, neteaseTracks, providerPlaylists, roamTracks]);

  function providerIdsForTracks(tracksToRead: Track[]) {
    return tracksToRead
      .map((track) => track.providerId ?? (track.id.startsWith("netease:") ? track.id.slice("netease:".length) : null))
      .filter((id): id is string => Boolean(id));
  }

  function trackIdSignature(tracksToRead: Track[]) {
    return tracksToRead.map((track) => track.id).join("|");
  }

  // The warmup path prefetches metadata for non-playing quality levels; its
  // results must never overwrite the bitrate the user currently sees.
  function applyStreamMetaToTrack(
    trackId: string,
    meta: {
      quality: Track["quality"];
      bitrate: number | null;
      sampleRate: number | null;
      currentLevel: Track["currentLevel"];
      availableLevels: NonNullable<Track["availableLevels"]>;
    },
    streamMetaOptions: { authoritative?: boolean } = {},
  ) {
    const authoritative = streamMetaOptions.authoritative ?? false;
    const updateTrack = (track: Track) => {
      if (track.id !== trackId) return track;
      if (!authoritative && track.bitrate != null) {
        const nextLevels = meta.availableLevels;
        if (!nextLevels.length || nextLevels.join("|") === (track.availableLevels ?? []).join("|")) {
          return track;
        }
        return { ...track, availableLevels: nextLevels };
      }
      return {
        ...track,
        quality: meta.quality ?? track.quality,
        bitrate: meta.bitrate ?? track.bitrate,
        sampleRate: meta.sampleRate ?? track.sampleRate,
        currentLevel: meta.currentLevel ?? track.currentLevel ?? null,
        availableLevels: meta.availableLevels.length ? meta.availableLevels : track.availableLevels,
      };
    };
    applyTrackUpdate(trackId, updateTrack, { includeHistory: false });
  }

  function warmNeteaseTrackCache(tracksToWarm: Track[]) {
    const warmupItems = tracksToWarm
      .filter((track) => track.source === "netease" && track.providerId)
      .map((track) => {
        const level = options.getWarmupLevel(track);
        return { id: track.providerId as string, level, key: `${level}:${track.providerId}` };
      })
      .filter((item) => !neteaseWarmupRef.current.has(item.key))
      .slice(0, warmupBatchLimits.neteaseTracks);
    const ids = warmupItems.map((item) => item.id);
    if (!ids.length) return;
    warmupItems.forEach((item) => neteaseWarmupRef.current.add(item.key));
    trimStringSet(neteaseWarmupRef, memoryLimits.neteaseWarmup);
    const batches = new Map<QualityLevel, typeof warmupItems>();
    for (const item of warmupItems) {
      const batch = batches.get(item.level) ?? [];
      batch.push(item);
      batches.set(item.level, batch);
    }
    for (const [level, items] of batches) {
      api.warmNeteaseCache(items.map((item) => item.id), level).catch(() => {
        items.forEach((item) => neteaseWarmupRef.current.delete(item.key));
      });
    }

    // Private roaming rows need the stream response's actual bitrate. The
    // song-detail payload commonly carries only a quality bucket (320K), so
    // fetch only rows whose server response still lacks a bitrate. Other
    // surfaces retain the lighter, non-authoritative warmup to avoid changing
    // a user's selected quality in the background.
    const metadataItems =
      options.activeView === "radar"
        ? warmupItems.filter((item) =>
            tracksToWarm.some((track) => track.providerId === item.id && track.bitrate == null),
          )
        : warmupItems.slice(
            0,
            options.playing ? warmupBatchLimits.neteaseMetadataPlaying : warmupBatchLimits.neteaseMetadataIdle,
          );
    const authoritativeMetadata = options.activeView === "radar";
    void Promise.allSettled(
      metadataItems.map((item) =>
        api
          .getNeteaseStreamMeta(item.id, item.level)
          .then((meta) => applyStreamMetaToTrack(`netease:${item.id}`, meta, { authoritative: authoritativeMetadata })),
      ),
    );
  }

  async function refreshNeteaseData() {
    const appendTracks = (tracksToAdd: Track[]) => {
      if (!tracksToAdd.length) return;
      setNeteaseTracks((current) => trimTrackCache([...current, ...tracksToAdd]));
    };

    // Each surface becomes usable as soon as its own request is ready. The old
    // Promise.all meant a slow private-roaming response held back liked songs,
    // daily recommendations, playlists and all of their cover artwork.
    const dailyTask = api.getProviderDaily().then((daily) => {
      const tracks = daily.tracks.map(providerTrackToUiTrack);
      setDailyTracks(tracks);
      appendTracks(tracks);
      warmNeteaseTrackCache(tracks);
      return tracks;
    });
    const roamTask = api.getProviderRoam().then((roam) => {
      const tracks = roam.tracks.map((track, index) => providerTrackToUiTrack(track, index + 1000));
      setRoamTracks(tracks);
      appendTracks(tracks);
      return tracks;
    });
    const likedTask = api.getProviderLiked().then((liked) => {
      const tracks = liked.tracks.map((track, index) => providerTrackToUiTrack(track, index + 2000));
      setNeteaseLikedTracks(tracks);
      setNeteaseLikedIds(Object.fromEntries(tracks.map((track) => [track.id, true])));
      appendTracks(tracks);
      return tracks;
    });
    const playlistsTask = api.getProviderPlaylists().then((playlists) => {
      setProviderPlaylists(playlists.playlists);
      return playlists.playlists;
    });

    const results = await Promise.allSettled([dailyTask, roamTask, likedTask, playlistsTask]);
    const trackResults = results.slice(0, 3);
    const successfulPools = trackResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!successfulPools.length && trackResults.every((result) => result.status === "rejected")) {
      throw trackResults[0]?.reason instanceof Error ? trackResults[0].reason : new Error("网易云数据刷新失败");
    }
    if (options.canAutoSelectFirstTrack) {
      const firstTrack = successfulPools.flat()[0];
      if (firstTrack) options.onAutoSelectTrack(firstTrack.id);
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
      setNeteaseTracks((current) => trimTrackCache([...current, ...nextRoamTracks]));
      warmNeteaseTrackCache(nextRoamTracks);

      if (options.activeView === "radar") {
        const activeTrack = options.getActiveTrack();
        const queueTracks =
          activeTrack.id !== idleTrack.id && !nextRoamTracks.some((track) => track.id === activeTrack.id)
            ? [activeTrack, ...nextRoamTracks]
            : nextRoamTracks;
        const playableIds = materializeQueueIds(queueTracks, activeTrack.id, options.shuffleEnabled);
        if (playableIds.length) options.setPlayQueueIds(() => playableIds);
      }
    } finally {
      setRoamRefreshing(false);
    }
  }

  async function openPlaylist(playlist: ProviderPlaylist) {
    const requestId = ++playlistRequestRef.current;
    setSelectedPlaylist(playlist);
    setPlaylistError(null);
    setPlaylistTracks([]);
    setPlaylistLoading(true);
    try {
      const result = await api.getNeteasePlaylistDetail(playlist.id);
      if (requestId !== playlistRequestRef.current) return;
      setSelectedPlaylist(result.playlist);
      const uiTracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
      setPlaylistTracks(uiTracks);
      setNeteaseTracks((current) => trimTrackCache([...current, ...uiTracks]));
      warmNeteaseTrackCache(uiTracks);
    } catch (error) {
      if (requestId === playlistRequestRef.current) setPlaylistError(error instanceof Error ? error.message : "歌单加载失败，请重试");
    } finally {
      if (requestId === playlistRequestRef.current) setPlaylistLoading(false);
    }
  }

  function closePlaylist() {
    playlistRequestRef.current += 1;
    selectedPlaylistIdRef.current = null;
    setSelectedPlaylist(null);
    setPlaylistLoading(false);
    setPlaylistError(null);
  }

  async function refreshPlaylistList() {
    const result = await api.getProviderPlaylists();
    setProviderPlaylists(result.playlists);
  }

  function applyPlaylistDetails(playlist: ProviderPlaylist) {
    setSelectedPlaylist((current) => current?.id === playlist.id ? playlist : current);
    setProviderPlaylists((current) => current.map((item) => item.id === playlist.id ? playlist : item));
  }

  async function updatePlaylist(id: string, fields: { name?: string; description?: string }) {
    const { playlist } = await api.updateNeteasePlaylist(id, fields);
    applyPlaylistDetails(playlist);
  }

  async function deletePlaylist(id: string) {
    await api.deleteNeteasePlaylist(id);
    const wasOpen = selectedPlaylistIdRef.current === id;
    setProviderPlaylists((current) => current.filter((playlist) => playlist.id !== id));
    if (wasOpen) {
      closePlaylist();
      setPlaylistTracks([]);
    }
    await refreshPlaylistList().catch(() => undefined);
  }

  async function uploadPlaylistCover(id: string, file: File) {
    const { playlist } = await api.uploadNeteasePlaylistCover(id, file);
    applyPlaylistDetails(playlist);
  }

  async function editPlaylistTracks(id: string, tracks: Track[], operation: "add" | "del") {
    const ids = [...new Set(providerIdsForTracks(tracks.filter((track) => track.source === "netease")))];
    if (!ids.length) throw new Error("请选择网易云歌曲");
    await api.editNeteasePlaylistTracks(id, ids, operation);
    // Refresh the current detail without navigating back to a previously opened playlist.
    setNeteaseTracks((current) => trimTrackCache([...current, ...tracks]));
    if (selectedPlaylistIdRef.current === id) {
      try {
        const { playlist, tracks: remoteTracks } = await api.getNeteasePlaylistDetail(id);
        applyPlaylistDetails(playlist);
        setPlaylistTracks((current) => selectedPlaylistIdRef.current === id ? remoteTracks.map(providerTrackToUiTrack) : current);
        setPlaylistError(null);
      } catch {
        if (selectedPlaylistIdRef.current === id) setPlaylistError("歌曲已同步，但重新读取歌单失败，请点击重试刷新。");
      }
    }
    void refreshPlaylistList().catch(() => undefined);
  }

  async function reorderPlaylistTracks(id: string, orderedTracks: Track[]) {
    await api.reorderNeteasePlaylistTracks(id, providerIdsForTracks(orderedTracks));
    setPlaylistTracks((current) => selectedPlaylistIdRef.current === id ? orderedTracks : current);
  }

  async function subscribePlaylist(id: string, subscribed: boolean) {
    await api.subscribeNeteasePlaylist(id, subscribed);
    setSelectedPlaylist((current) => current?.id === id ? { ...current, subscribed } : current);
    void refreshPlaylistList().catch(() => undefined);
  }

  async function createPlaylist(name: string, isPrivate: boolean, open = true) {
    const { playlist } = await api.createNeteasePlaylist(name, isPrivate);
    setProviderPlaylists((current) => [...current.filter((item) => item.id !== playlist.id), playlist]);
    // A newly created playlist is empty; open it immediately. A list refresh
    // failure must not turn a successful remote write into a retry prompt.
    if (open) {
      playlistRequestRef.current += 1;
      setSelectedPlaylist(playlist);
      setPlaylistTracks([]);
      setPlaylistLoading(false);
      setPlaylistError(null);
    }
    void api.getProviderPlaylists().then(({ playlists }) => {
      setProviderPlaylists(playlists.some((item) => item.id === playlist.id) ? playlists : [...playlists, playlist]);
    }).catch(() => {});
    return playlist;
  }

  const toggleNeteaseLike = useEffectEvent((track: Track) => {
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
  });

  return {
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
  };
}
