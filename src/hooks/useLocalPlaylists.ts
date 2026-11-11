import { useEffect, useMemo, useState } from "react";
import type { Track } from "@/data/music";
import {
  createLocalPlaylist,
  createPlaylistTrackSnapshots,
  readLocalPlaylists,
  resolveLocalPlaylistTracks,
  writeLocalPlaylists,
  type LocalPlaylist,
  type LocalPlaylistRemoteRef,
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

  function syncReference(id: string, tracksToSync: Track[], title?: string) {
    const snapshots = createPlaylistTrackSnapshots(tracksToSync);
    const trimmedTitle = title?.trim().slice(0, 120);
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== id) return playlist;
      return {
        ...playlist,
        name: trimmedTitle || playlist.name,
        trackIds: [...new Set(tracksToSync.map((track) => track.id))],
        trackSnapshots: snapshots,
        remoteRef: playlist.remoteRef
          ? {
              ...playlist.remoteRef,
              ...(trimmedTitle ? { title: trimmedTitle } : {}),
              syncedAt: Date.now(),
            }
          : undefined,
        updatedAt: Date.now(),
      };
    }));
  }

  function rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? { ...playlist, name: trimmed.slice(0, 80), updatedAt: Date.now() }
      : playlist));
  }

  function addTracks(id: string, tracksToAdd: Track[]) {
    if (!tracksToAdd.length) return;
    const snapshots = createPlaylistTrackSnapshots(tracksToAdd);
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? {
          ...playlist,
          trackIds: [...new Set([...playlist.trackIds, ...tracksToAdd.map((track) => track.id)])],
          trackSnapshots: { ...(playlist.trackSnapshots ?? {}), ...snapshots },
          updatedAt: Date.now(),
        }
      : playlist));
  }

  function removeTracks(id: string, tracksToRemove: Track[]) {
    const ids = new Set(tracksToRemove.map((track) => track.id));
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== id) return playlist;
      const trackSnapshots = playlist.trackSnapshots
        ? Object.fromEntries(Object.entries(playlist.trackSnapshots).filter(([trackId]) => !ids.has(trackId)))
        : undefined;
      return {
        ...playlist,
        trackIds: playlist.trackIds.filter((trackId) => !ids.has(trackId)),
        ...(trackSnapshots && Object.keys(trackSnapshots).length ? { trackSnapshots } : { trackSnapshots: undefined }),
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
    rename,
    addTracks,
    removeTracks,
    reorder,
    syncReference,
    remove,
  };
}
