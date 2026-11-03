import { useEffect, useMemo, useState } from "react";
import type { Track } from "@/data/music";
import {
  createLocalPlaylist,
  readLocalPlaylists,
  resolveLocalPlaylistTracks,
  writeLocalPlaylists,
  type LocalPlaylist,
} from "@/lib/localPlaylists";

export function useLocalPlaylists(localTracks: Track[]) {
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
    () => resolveLocalPlaylistTracks(selectedPlaylist, localTracks),
    [localTracks, selectedPlaylist],
  );

  function create(name: string, tracks: Track[] = []) {
    const playlist = createLocalPlaylist(name, tracks.map((track) => track.id));
    setPlaylists((current) => [playlist, ...current]);
    return playlist;
  }

  function rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? { ...playlist, name: trimmed.slice(0, 80), updatedAt: Date.now() }
      : playlist));
  }

  function addTracks(id: string, tracks: Track[]) {
    const ids = tracks.filter((track) => track.source === "local").map((track) => track.id);
    if (!ids.length) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? { ...playlist, trackIds: [...new Set([...playlist.trackIds, ...ids])], updatedAt: Date.now() }
      : playlist));
  }

  function removeTracks(id: string, tracks: Track[]) {
    const ids = new Set(tracks.map((track) => track.id));
    setPlaylists((current) => current.map((playlist) => playlist.id === id
      ? { ...playlist, trackIds: playlist.trackIds.filter((trackId) => !ids.has(trackId)), updatedAt: Date.now() }
      : playlist));
  }

  function reorder(id: string, tracks: Track[]) {
    const positions = new Map(tracks.map((track, index) => [track.id, index]));
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
    remove,
  };
}
