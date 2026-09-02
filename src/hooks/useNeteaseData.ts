import { useEffectEvent, useRef, useState } from "react";
import type { Track, ViewId } from "@/data/music";
import type { NeteaseAccountSummary, ProviderPlaylist } from "@/lib/api";
import { api } from "@/lib/api";
import { memoryLimits, trimStringSet, warmupBatchLimits } from "@/lib/memoryCache";
import { mergeTracks, trimTrackCache } from "@/lib/playerPresentation";
import { materializeQueueIds } from "@/lib/playQueue";
import { isLikedPlaylist, providerTrackToUiTrack, idleTrack } from "@/lib/trackMappers";
import type { QualityLevel } from "@/lib/playerPresentation";

// Owns everything NetEase: account, liked/daily/roam/playlist track pools,
// stream-metadata warmup and the like toggle.
export function useNeteaseData(options: {
  applyTrackUpdate: (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void;
  warmupLevel: QualityLevel;
  playing: boolean;
  canAutoSelectFirstTrack: boolean;
  onAutoSelectTrack: (trackId: string) => void;
  activeView: ViewId;
  getActiveTrack: () => Track;
  shuffleEnabled: boolean;
  setPlayQueueIds: (updater: (ids: string[]) => string[]) => void;
}) {
  const { applyTrackUpdate } = options;
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountSummary | null>(null);
  const [neteaseTracks, setNeteaseTracks] = useState<Track[]>([]);
  const [neteaseLikedTracks, setNeteaseLikedTracks] = useState<Track[]>([]);
  const [dailyTracks, setDailyTracks] = useState<Track[]>([]);
  const [roamTracks, setRoamTracks] = useState<Track[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [neteaseLikedIds, setNeteaseLikedIds] = useState<Record<string, true>>({});
  const [selectedPlaylist, setSelectedPlaylist] = useState<ProviderPlaylist | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [roamRefreshing, setRoamRefreshing] = useState(false);
  const [providerPlaylists, setProviderPlaylists] = useState<ProviderPlaylist[]>([]);
  const neteaseWarmupRef = useRef<Set<string>>(new Set());

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
    const warmupLevel = options.warmupLevel;
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
          .getNeteaseStreamMeta(item.id, warmupLevel)
          .then((meta) => applyStreamMetaToTrack(`netease:${item.id}`, meta, { authoritative: authoritativeMetadata })),
      ),
    );
  }

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
    setNeteaseTracks(trimTrackCache(merged));
    setProviderPlaylists(playlists.playlists);
    warmNeteaseTrackCache(merged);
    if (options.canAutoSelectFirstTrack && merged[0]) {
      options.onAutoSelectTrack(merged[0].id);
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
    setSelectedPlaylist(playlist);
    setPlaylistLoading(true);
    try {
      const result = await api.getNeteasePlaylistTracks(playlist.id);
      const uiTracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
      setPlaylistTracks(uiTracks);
      setNeteaseTracks((current) => trimTrackCache([...current, ...uiTracks]));
      warmNeteaseTrackCache(uiTracks);
    } finally {
      setPlaylistLoading(false);
    }
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
    roamRefreshing,
    neteaseLikedIds,
    neteaseWarmupRef,
    applyStreamMetaToTrack,
    warmNeteaseTrackCache,
    refreshNeteaseData,
    refreshRoamData,
    openPlaylist,
    toggleNeteaseLike,
  };
}
