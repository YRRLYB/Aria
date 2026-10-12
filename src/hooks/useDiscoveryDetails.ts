import { useEffect, useRef, useState } from "react";
import type { Track } from "@/data/music";
import type { ArtistSummary } from "@/lib/artists";
import { api, type ProviderAlbum, type ProviderUser } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { trimTrackCache } from "@/lib/playerPresentation";

type ArtistDetail = Awaited<ReturnType<typeof api.getNeteaseArtistDetail>>;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "暂时无法加载，请重试。";
const uniqueById = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

export function useDiscoveryDetails(options: {
  selectedArtist: ArtistSummary | null;
  onMergeNeteaseTracks: (updater: (current: Track[]) => Track[]) => void;
}) {
  const [selectedUser, setSelectedUser] = useState<ProviderUser | null>(null);
  const [userDetail, setUserDetail] = useState<ProviderUser | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<
    Awaited<ReturnType<typeof api.getNeteaseUserPlaylists>>["playlists"]
  >([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userPlaylistsMore, setUserPlaylistsMore] = useState(false);
  const [userRevision, setUserRevision] = useState(0);
  const userRequestRef = useRef(0);
  const userOffsetRef = useRef(0);
  const userLoadingRef = useRef(false);
  const [userStateId, setUserStateId] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<ProviderAlbum | null>(
    null,
  );
  const [albumDetail, setAlbumDetail] = useState<ProviderAlbum | null>(null);
  const [albumTracks, setAlbumTracks] = useState<Track[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumError, setAlbumError] = useState<string | null>(null);
  const [albumRevision, setAlbumRevision] = useState(0);
  const [albumStateId, setAlbumStateId] = useState<string | null>(null);
  const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);
  const [artistAlbums, setArtistAlbums] = useState<ProviderAlbum[]>([]);
  const [artistDetailLoading, setArtistDetailLoading] = useState(false);
  const [artistDetailError, setArtistDetailError] = useState<string | null>(
    null,
  );
  const [artistAlbumsMore, setArtistAlbumsMore] = useState(false);
  const [artistRevision, setArtistRevision] = useState(0);
  const artistRequestRef = useRef(0);
  const artistOffsetRef = useRef(0);
  const artistLoadingRef = useRef(false);
  const [artistStateId, setArtistStateId] = useState<string | null>(null);

  useEffect(() => {
    const requestId = ++userRequestRef.current;
    setUserStateId(selectedUser?.id ?? null);
    setUserDetail(selectedUser);
    setUserPlaylists([]);
    setUserError(null);
    setUserPlaylistsMore(false);
    userOffsetRef.current = 0;
    userLoadingRef.current = Boolean(selectedUser);
    setUserLoading(Boolean(selectedUser));
    if (!selectedUser) return;
    Promise.allSettled([
      api.getNeteaseUserDetail(selectedUser.id),
      api.getNeteaseUserPlaylists(selectedUser.id, 60),
    ]).then(([profile, playlists]) => {
      if (requestId !== userRequestRef.current) return;
      if (profile.status === "fulfilled") setUserDetail(profile.value.user);
      if (playlists.status === "fulfilled") {
        setUserPlaylists(playlists.value.playlists);
        setUserPlaylistsMore(playlists.value.more);
        userOffsetRef.current = 60;
      }
      const failure =
        profile.status === "rejected"
          ? profile.reason
          : playlists.status === "rejected"
            ? playlists.reason
            : null;
      if (failure) setUserError(errorText(failure));
      userLoadingRef.current = false;
      setUserLoading(false);
    });
    return () => {
      userRequestRef.current += 1;
    };
  }, [selectedUser?.id, userRevision]);

  async function loadMoreUserPlaylists() {
    if (!selectedUser || !userPlaylistsMore || userLoadingRef.current) return;
    const requestId = userRequestRef.current;
    userLoadingRef.current = true;
    setUserLoading(true);
    setUserError(null);
    try {
      const result = await api.getNeteaseUserPlaylists(
        selectedUser.id,
        60,
        userOffsetRef.current,
      );
      if (requestId !== userRequestRef.current) return;
      setUserPlaylists((current) =>
        uniqueById([...current, ...result.playlists]),
      );
      // Advance by the upstream page size: private playlists can be filtered
      // out by the server, leaving fewer visible rows than were consumed.
      userOffsetRef.current += 60;
      setUserPlaylistsMore(result.more);
    } catch (error) {
      if (requestId === userRequestRef.current) setUserError(errorText(error));
    } finally {
      if (requestId === userRequestRef.current) {
        userLoadingRef.current = false;
        setUserLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setAlbumStateId(selectedAlbum?.id ?? null);
    setAlbumDetail(selectedAlbum);
    setAlbumTracks([]);
    setAlbumError(null);
    setAlbumLoading(Boolean(selectedAlbum));
    if (!selectedAlbum) return;
    api
      .getNeteaseAlbum(selectedAlbum.id)
      .then((result) => {
        if (cancelled) return;
        const tracks = result.tracks.map((track, index) =>
          providerTrackToUiTrack(track, index),
        );
        setAlbumDetail(result.album);
        setAlbumTracks(tracks);
        options.onMergeNeteaseTracks((current) =>
          trimTrackCache([...current, ...tracks]),
        );
      })
      .catch((error) => {
        if (!cancelled) setAlbumError(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setAlbumLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAlbum?.id, albumRevision]);

  useEffect(() => {
    const providerId = options.selectedArtist?.providerId;
    const requestId = ++artistRequestRef.current;
    setArtistStateId(providerId ?? null);
    setArtistDetail(null);
    setArtistAlbums([]);
    setArtistDetailError(null);
    setArtistAlbumsMore(false);
    artistOffsetRef.current = 0;
    artistLoadingRef.current = Boolean(providerId);
    setArtistDetailLoading(Boolean(providerId));
    if (!providerId) return;
    Promise.allSettled([
      api.getNeteaseArtistDetail(providerId),
      api.getNeteaseArtistAlbums(providerId, 30),
    ]).then(([detail, albums]) => {
      if (requestId !== artistRequestRef.current) return;
      if (detail.status === "fulfilled") setArtistDetail(detail.value);
      if (albums.status === "fulfilled") {
        setArtistAlbums(albums.value.albums);
        setArtistAlbumsMore(albums.value.more);
        artistOffsetRef.current = 30;
      }
      const failure =
        detail.status === "rejected"
          ? detail.reason
          : albums.status === "rejected"
            ? albums.reason
            : null;
      if (failure) setArtistDetailError(errorText(failure));
      artistLoadingRef.current = false;
      setArtistDetailLoading(false);
    });
    return () => {
      artistRequestRef.current += 1;
    };
  }, [options.selectedArtist?.providerId, artistRevision]);

  async function loadMoreArtistAlbums() {
    const providerId = options.selectedArtist?.providerId;
    if (!providerId || !artistAlbumsMore || artistLoadingRef.current) return;
    const requestId = artistRequestRef.current;
    artistLoadingRef.current = true;
    setArtistDetailLoading(true);
    setArtistDetailError(null);
    try {
      const result = await api.getNeteaseArtistAlbums(
        providerId,
        30,
        artistOffsetRef.current,
      );
      if (requestId !== artistRequestRef.current) return;
      setArtistAlbums((current) => uniqueById([...current, ...result.albums]));
      artistOffsetRef.current += 30;
      setArtistAlbumsMore(result.more && result.albums.length > 0);
    } catch (error) {
      if (requestId === artistRequestRef.current)
        setArtistDetailError(errorText(error));
    } finally {
      if (requestId === artistRequestRef.current) {
        artistLoadingRef.current = false;
        setArtistDetailLoading(false);
      }
    }
  }

  const userMatches = Boolean(selectedUser && userStateId === selectedUser.id);
  const albumMatches = Boolean(
    selectedAlbum && albumStateId === selectedAlbum.id,
  );
  const artistMatches = Boolean(
    options.selectedArtist?.providerId &&
    artistStateId === options.selectedArtist.providerId,
  );

  return {
    selectedUser,
    setSelectedUser,
    userDetail: userMatches ? userDetail : selectedUser,
    userPlaylists: userMatches ? userPlaylists : [],
    userLoading: Boolean(selectedUser) && (!userMatches || userLoading),
    userError: userMatches ? userError : null,
    userPlaylistsMore: userMatches && userPlaylistsMore,
    loadMoreUserPlaylists,
    retryUser: () => setUserRevision((current) => current + 1),
    selectedAlbum,
    setSelectedAlbum,
    albumDetail: albumMatches ? albumDetail : selectedAlbum,
    albumTracks: albumMatches ? albumTracks : [],
    albumLoading: Boolean(selectedAlbum) && (!albumMatches || albumLoading),
    albumError: albumMatches ? albumError : null,
    retryAlbum: () => setAlbumRevision((current) => current + 1),
    artistDetail: artistMatches ? artistDetail : null,
    artistAlbums: artistMatches ? artistAlbums : [],
    artistDetailLoading:
      Boolean(options.selectedArtist?.providerId) &&
      (!artistMatches || artistDetailLoading),
    artistDetailError: artistMatches ? artistDetailError : null,
    artistAlbumsMore: artistMatches && artistAlbumsMore,
    loadMoreArtistAlbums,
    retryArtistDetail: () => setArtistRevision((current) => current + 1),
  };
}
