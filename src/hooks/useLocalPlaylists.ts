import { useEffect, useMemo, useState } from "react";
import type { Track } from "@/data/music";
import {
  createLocalPlaylist,
  createPlaylistTrackSnapshots,
  mergePlaylistTrackIds,
  mergeReferenceSync,
  readLocalPlaylists,
  resolveLocalPlaylistTracks,
  writeLocalPlaylists,
  type LocalPlaylist,
  type LocalPlaylistRemoteRef,
  type LocalPlaylistSuperMix,
  type PlaylistInsertPosition,
} from "@/lib/localPlaylists";

export function useLocalPlaylists(tracks: Track[]) {
  const [playlists, setPlaylists] = useState<LocalPlaylist[]>(readLocalPlaylists);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setStorageError(!writeLocalPlaylists(playlists));
  }, [playlists]);

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedId) ?? null,
    [playlists, selectedId],
  );
  const selectedTracks = useMemo(
    () => resolveLocalPlaylistTracks(selectedPlaylist, tracks),
    [tracks, selectedPlaylist],
  );

  function create(name: string, initialTracks: Track[] = [], remoteRef?: LocalPlaylistRemoteRef) {
    const playlist = createLocalPlaylist(
      name,
      initialTracks.map((track) => track.id),
      Date.now(),
      createPlaylistTrackSnapshots(initialTracks),
      remoteRef ? { ...remoteRef, syncedAt: Date.now() } : undefined,
    );
    setPlaylists((current) => [playlist, ...current]);
    return playlist;
  }

  function createSuperMix(name: string, tracksToMix: Track[], superMix: LocalPlaylistSuperMix) {
    const now = Date.now();
    const playlist = createLocalPlaylist(
      name,
      tracksToMix.map((track) => track.id),
      now,
      createPlaylistTrackSnapshots(tracksToMix),
      undefined,
      { ...superMix, syncedAt: superMix.syncedAt ?? now },
    );
    setPlaylists((current) => [playlist, ...current]);
    return playlist;
  }

  function updateSuperMix(id: string, tracksToMix: Track[], superMix: LocalPlaylistSuperMix, name?: string) {
    const now = Date.now();
    const snapshots = createPlaylistTrackSnapshots(tracksToMix);
    const trimmedName = name?.trim().slice(0, 80);
    setPlaylists((current) =>
      current.map((playlist) =>
        playlist.id === id
          ? {
              ...playlist,
              kind: "super-mix",
              name: trimmedName || playlist.name,
              trackIds: [...new Set(tracksToMix.map((track) => track.id))],
              trackSnapshots: Object.keys(snapshots).length ? snapshots : undefined,
              superMix: { ...superMix, syncedAt: superMix.syncedAt ?? now },
              updatedAt: now,
            }
          : playlist,
      ),
    );
  }

  function syncReference(id: string, tracksToSync: Track[], title?: string) {
    setPlaylists((current) => current.map((playlist) =>
      playlist.id === id ? mergeReferenceSync(playlist, tracksToSync, title) : playlist,
    ));
  }

  function rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? { ...playlist, name: trimmed.slice(0, 80), updatedAt: Date.now() }
      : playlist));
  }

  function addTracks(id: string, tracksToAdd: Track[], position: PlaylistInsertPosition = "top") {
    if (!tracksToAdd.length) return;
    const addedIds = tracksToAdd.map((track) => track.id);
    const snapshots = createPlaylistTrackSnapshots(tracksToAdd);
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== id) return playlist;
      const nextTrackIds = mergePlaylistTrackIds(playlist.trackIds, addedIds, position);
      const nextManualIds = playlist.superMix
        ? [...new Set([...(playlist.superMix.manualTrackIds ?? []), ...addedIds])].slice(0, 2_000)
        : undefined;
      return {
        ...playlist,
        trackIds: nextTrackIds,
        trackSnapshots: { ...(playlist.trackSnapshots ?? {}), ...snapshots },
        ...(playlist.superMix
          ? {
              superMix: {
                ...playlist.superMix,
                ...(nextManualIds?.length ? { manualTrackIds: nextManualIds } : {}),
              },
            }
          : {}),
        updatedAt: Date.now(),
      };
    }));
  }

  function removeTracks(id: string, tracksToRemove: Track[]) {
    const ids = new Set(tracksToRemove.map((track) => track.id));
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== id) return playlist;
      const trackSnapshots = playlist.trackSnapshots
        ? Object.fromEntries(Object.entries(playlist.trackSnapshots).filter(([trackId]) => !ids.has(trackId)))
        : undefined;
      const nextManualIds = playlist.superMix?.manualTrackIds?.filter((trackId) => !ids.has(trackId));
      return {
        ...playlist,
        trackIds: playlist.trackIds.filter((trackId) => !ids.has(trackId)),
        ...(trackSnapshots && Object.keys(trackSnapshots).length ? { trackSnapshots } : { trackSnapshots: undefined }),
        ...(playlist.superMix
          ? {
              superMix: {
                ...playlist.superMix,
                manualTrackIds: nextManualIds?.length ? nextManualIds : undefined,
              },
            }
          : {}),
        updatedAt: Date.now(),
      };
    }));
  }

  function reorder(id: string, orderedTracks: Track[]) {
    const positions = new Map(orderedTracks.map((track, index) => [track.id, index]));
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? {
          ...playlist,
          trackIds: [...playlist.trackIds].sort((left, right) => (positions.get(left) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right) ?? Number.MAX_SAFE_INTEGER)),
          updatedAt: Date.now(),
        }
      : playlist));
  }

  function remove(id: string) {
    setPlaylists((current) => current.filter((playlist) => playlist.id !== id));
    setSelectedId((current) => current === id ? null : current);
  }

  return {
    playlists,
    selectedId,
    selectedPlaylist,
    selectedTracks,
    storageError,
    setSelectedId,
    create,
    createSuperMix,
    updateSuperMix,
    rename,
    addTracks,
    removeTracks,
    reorder,
    syncReference,
    remove,
  };
}
