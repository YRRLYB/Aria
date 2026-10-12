import { useEffect, useRef, useState } from "react";
import type { Track } from "@/data/music";
import type { ArtistSummary } from "@/lib/artists";
import type { ProviderAlbum, ProviderPlaylist, ProviderUser } from "@/lib/api";
import {
  createLocalArtistSummaries,
  mergeArtists,
  providerArtistToUiArtist,
} from "@/lib/artists";
import { api } from "@/lib/api";
import {
  memoryLimits,
  trimRecordCache,
  trimStringSet,
} from "@/lib/memoryCache";
import {
  mergeTracks,
  splitArtistNames,
  trimTrackCache,
} from "@/lib/playerPresentation";
import { providerTrackToUiTrack } from "@/lib/trackMappers";

export type SearchBundle = {
  localTracks: Track[];
  neteaseTracks: Track[];
  artists: ArtistSummary[];
  playlists: ProviderPlaylist[];
  users: ProviderUser[];
  albums: ProviderAlbum[];
};

export type DiscoverySearchMode =
  "tracks" | "artists" | "playlists" | "users" | "albums" | "lyrics";
const emptySearchBundle: SearchBundle = {
  localTracks: [],
  neteaseTracks: [],
  artists: [],
  playlists: [],
  users: [],
  albums: [],
};
const searchPageSize = 24;

// Owns search + artist discovery: debounced library/stream search, artist
// drill-down with remote track merging, and artist avatar lookups.
export function useDiscovery(options: {
  query: string;
  localTracks: Track[];
  localSearchSignature: string;
  allTracks: Track[];
  artistSummaries: ArtistSummary[];
  onMergeNeteaseTracks: (updater: (current: Track[]) => Track[]) => void;
}) {
  const [searchBundle, setSearchBundle] =
    useState<SearchBundle>(emptySearchBundle);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMode, setSearchMode] = useState<DiscoverySearchMode>("tracks");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchMore, setSearchMore] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const searchRequestRef = useRef(0);
  const searchOffsetRef = useRef(0);
  const searchLoadingRef = useRef(false);
  const [selectedArtist, setSelectedArtist] = useState<ArtistSummary | null>(
    null,
  );
  const [artistTracks, setArtistTracks] = useState<Track[]>([]);
  const [artistTracksLoading, setArtistTracksLoading] = useState(false);
  const [artistTracksError, setArtistTracksError] = useState<string | null>(
    null,
  );
  const [artistTracksRevision, setArtistTracksRevision] = useState(0);
  const [artistAvatarCache, setArtistAvatarCache] = useState<
    Record<string, string | null>
  >({});
  const artistRequestRef = useRef<Set<string>>(new Set());
  const artistAvatarLookupRef = useRef<Set<string>>(new Set());
  const artistAvatarCacheRef = useRef<Record<string, string | null>>({});
  const localTracksRef = useRef<Track[]>([]);
  const artistRemoteTracksCacheRef = useRef<Map<string, Track[]>>(new Map());
  const artistLookupCacheRef = useRef<Map<string, ArtistSummary | null>>(
    new Map(),
  );
  const selectedArtistIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedArtistIdRef.current = selectedArtist?.id ?? null;
  }, [selectedArtist]);

  useEffect(() => {
    localTracksRef.current = options.localTracks;
  }, [options.localTracks]);

  useEffect(() => {
    const text = options.query.trim();
    const requestId = ++searchRequestRef.current;
    searchOffsetRef.current = 0;
    setSearchError(null);
    setSearchTotal(0);
    setSearchMore(false);
    const localMatches =
      searchMode === "tracks" && text
        ? localTracksRef.current
            .filter((track) =>
              [track.title, track.artist, track.album, track.quality]
                .join(" ")
                .toLowerCase()
                .includes(text.toLowerCase()),
            )
            .slice(0, 60)
        : [];
    const localArtists =
      searchMode === "artists" && text
        ? createLocalArtistSummaries(localTracksRef.current)
            .filter((artist) =>
              artist.name.toLowerCase().includes(text.toLowerCase()),
            )
            .slice(0, 24)
        : [];
    setSearchBundle({
      ...emptySearchBundle,
      localTracks: localMatches,
      artists: localArtists,
    });
    setSearchLoading(Boolean(text));
    searchLoadingRef.current = Boolean(text);
    if (!text) return;

    const timer = window.setTimeout(() => {
      api
        .searchNetease(text, searchMode, searchPageSize)
        .then((result) => {
          if (requestId !== searchRequestRef.current) return;
          const remoteTracks = result.tracks.map((track, index) =>
            providerTrackToUiTrack(track, index),
          );
          options.onMergeNeteaseTracks((current) =>
            trimTrackCache([...current, ...remoteTracks]),
          );
          setSearchBundle({
            localTracks: localMatches,
            neteaseTracks: remoteTracks,
            artists: mergeArtists([
              ...localArtists,
              ...result.artists.map(providerArtistToUiArtist),
            ]),
            playlists: result.playlists,
            users: result.users,
            albums: result.albums,
          });
          const count =
            result.tracks.length +
            result.artists.length +
            result.playlists.length +
            result.users.length +
            result.albums.length;
          searchOffsetRef.current = searchPageSize;
          setSearchTotal(result.total);
          setSearchMore(count > 0 && searchPageSize < result.total);
        })
        .catch((error) => {
          if (requestId === searchRequestRef.current)
            setSearchError(
              error instanceof Error
                ? error.message
                : "搜索暂时不可用，请重试。",
            );
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) {
            setSearchLoading(false);
            searchLoadingRef.current = false;
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      searchRequestRef.current += 1;
    };
  }, [options.localSearchSignature, options.query, searchMode, searchRevision]);

  useEffect(() => {
    const text = options.query.trim();
    setSearchSuggestions([]);
    if (!text) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .getNeteaseSearchSuggestions(text)
        .then((result) => {
          if (!cancelled) setSearchSuggestions(result.suggestions.slice(0, 8));
        })
        .catch(() => {
          /* Suggestions never block the actual search. */
        });
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [options.query]);

  async function loadMoreSearch() {
    if (!searchMore || searchLoadingRef.current) return;
    const requestId = searchRequestRef.current;
    const offset = searchOffsetRef.current;
    searchLoadingRef.current = true;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const result = await api.searchNetease(
        options.query.trim(),
        searchMode,
        searchPageSize,
        offset,
      );
      if (requestId !== searchRequestRef.current) return;
      const remoteTracks = result.tracks.map((track, index) =>
        providerTrackToUiTrack(track, index),
      );
      options.onMergeNeteaseTracks((current) =>
        trimTrackCache([...current, ...remoteTracks]),
      );
      const unique = <T extends { id: string }>(items: T[]) => [
        ...new Map(items.map((item) => [item.id, item])).values(),
      ];
      setSearchBundle((current) => ({
        localTracks: current.localTracks,
        neteaseTracks: mergeTracks([...current.neteaseTracks, ...remoteTracks]),
        artists: mergeArtists([
          ...current.artists,
          ...result.artists.map(providerArtistToUiArtist),
        ]),
        playlists: unique([...current.playlists, ...result.playlists]),
        users: unique([...current.users, ...result.users]),
        albums: unique([...current.albums, ...result.albums]),
      }));
      const next = offset + searchPageSize;
      const count =
        result.tracks.length +
        result.artists.length +
        result.playlists.length +
        result.users.length +
        result.albums.length;
      searchOffsetRef.current = next;
      setSearchTotal(result.total);
      setSearchMore(count > 0 && next < result.total);
    } catch (error) {
      if (requestId === searchRequestRef.current)
        setSearchError(
          error instanceof Error ? error.message : "加载更多失败，请重试。",
        );
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearchLoading(false);
        searchLoadingRef.current = false;
      }
    }
  }

  useEffect(() => {
    if (!selectedArtist) {
      setArtistTracks([]);
      setArtistTracksLoading(false);
      setArtistTracksError(null);
      return;
    }

    const artistId = selectedArtist.id;
    const artistName = selectedArtist.name;
    // Keep local files separate from provider streams while the remote artist
    // request is loading; `allTracks` contains every source.
    const localArtistTracks = options.allTracks.filter(
      (track) =>
        track.source === "local" &&
        splitArtistNames(track.artist).some(
          (name) => name.toLowerCase() === artistName.toLowerCase(),
        ),
    );
    const cachedRemoteTracks =
      artistRemoteTracksCacheRef.current.get(artistId) ?? [];
    setArtistTracks(mergeTracks([...cachedRemoteTracks, ...localArtistTracks]));

    const providerId = selectedArtist.providerId;
    if (providerId) {
      const requestKey = `tracks:${providerId}`;
      if (
        !artistRemoteTracksCacheRef.current.has(artistId) &&
        !artistRequestRef.current.has(requestKey)
      ) {
        setArtistTracksLoading(true);
        setArtistTracksError(null);
        artistRequestRef.current.add(requestKey);
        trimStringSet(artistRequestRef, memoryLimits.artistRequest);
        api
          .getNeteaseArtistTracks(providerId)
          .then((result) => {
            // Cache and library merge run even when this effect run was
            // cleaned up: `allTracks` churns while the request is in flight,
            // and discarding a resolved response left the request key in
            // place so the artist page never received its streaming tracks.
            const remoteTracks = result.tracks.map((track, index) =>
              providerTrackToUiTrack(track, index),
            );
            artistRemoteTracksCacheRef.current.delete(artistId);
            artistRemoteTracksCacheRef.current.set(artistId, remoteTracks);
            artistRequestRef.current.delete(requestKey);
            while (artistRemoteTracksCacheRef.current.size > 8) {
              const oldest = artistRemoteTracksCacheRef.current
                .keys()
                .next().value;
              if (oldest === undefined) break;
              artistRemoteTracksCacheRef.current.delete(oldest);
            }
            options.onMergeNeteaseTracks((current) =>
              trimTrackCache([...current, ...remoteTracks]),
            );
            if (selectedArtistIdRef.current === artistId) {
              setArtistTracks(
                mergeTracks([...remoteTracks, ...localArtistTracks]),
              );
              setArtistTracksLoading(false);
            }
          })
          .catch((error) => {
            artistRequestRef.current.delete(requestKey);
            if (selectedArtistIdRef.current === artistId) {
              setArtistTracksLoading(false);
              setArtistTracksError(
                error instanceof Error
                  ? error.message
                  : "歌曲加载失败，请重试。",
              );
            }
          });
      } else if (artistRemoteTracksCacheRef.current.has(artistId)) {
        setArtistTracksLoading(false);
        setArtistTracksError(null);
      } else {
        setArtistTracksLoading(true);
      }
    } else {
      // Resolve the streaming provider id for local-only artist cards; this
      // used to be gated on a missing avatar, so a cached avatar (or a null
      // lookup) permanently blocked the artist's streaming track list.
      const nameKey = artistName.toLowerCase();
      const requestKey = `lookup:${nameKey}`;
      const applyArtist = (remoteArtist: ArtistSummary | null) => {
        if (!remoteArtist) {
          if (selectedArtistIdRef.current === artistId)
            setArtistTracksLoading(false);
          return;
        }
        setArtistAvatarCache((current) => ({
          ...current,
          [nameKey]: remoteArtist.avatarUrl ?? null,
        }));
        setSelectedArtist((current) =>
          current?.id === artistId
            ? {
                ...current,
                avatarUrl: current.avatarUrl ?? remoteArtist.avatarUrl,
                providerId: current.providerId ?? remoteArtist.providerId,
                source:
                  current.source === "local" && remoteArtist.providerId
                    ? "mixed"
                    : current.source,
              }
            : current,
        );
      };
      if (artistLookupCacheRef.current.has(nameKey)) {
        applyArtist(artistLookupCacheRef.current.get(nameKey) ?? null);
      } else if (!artistRequestRef.current.has(requestKey)) {
        setArtistTracksLoading(true);
        setArtistTracksError(null);
        artistRequestRef.current.add(requestKey);
        trimStringSet(artistRequestRef, memoryLimits.artistRequest);
        api
          .lookupArtist(artistName)
          .then((result) => {
            artistRequestRef.current.delete(requestKey);
            const remoteArtist = result.artist
              ? providerArtistToUiArtist(result.artist)
              : null;
            artistLookupCacheRef.current.set(nameKey, remoteArtist);
            while (artistLookupCacheRef.current.size > 32) {
              const oldest = artistLookupCacheRef.current.keys().next().value;
              if (oldest === undefined) break;
              artistLookupCacheRef.current.delete(oldest);
            }
            applyArtist(remoteArtist);
          })
          .catch((error) => {
            artistRequestRef.current.delete(requestKey);
            if (selectedArtistIdRef.current === artistId) {
              setArtistTracksLoading(false);
              setArtistTracksError(
                error instanceof Error
                  ? error.message
                  : "歌手匹配失败，请重试。",
              );
            }
          });
      } else {
        setArtistTracksLoading(true);
      }
    }
  }, [options.allTracks, selectedArtist, artistTracksRevision]);

  useEffect(() => {
    const candidates = options.artistSummaries
      .filter((artist) => {
        const key = artist.name.toLowerCase();
        return (
          !artist.avatarUrl &&
          !(key in artistAvatarCacheRef.current) &&
          !artistAvatarLookupRef.current.has(key)
        );
      })
      .slice(0, 6);
    if (!candidates.length) return;

    candidates.forEach((artist) =>
      artistAvatarLookupRef.current.add(artist.name.toLowerCase()),
    );
    trimStringSet(artistAvatarLookupRef, memoryLimits.artistAvatarLookup);
    Promise.allSettled(
      candidates.map(async (artist) => {
        const result = await api.lookupArtist(artist.name);
        const remoteArtist = result.artist
          ? providerArtistToUiArtist(result.artist)
          : null;
        return [
          artist.name.toLowerCase(),
          remoteArtist?.avatarUrl ?? null,
        ] as const;
      }),
    ).then((results) => {
      // Results remain useful when the library changes during lookup.
      // Failed requests may retry later; a confirmed missing artist is cached.
      results.forEach((_, index) =>
        artistAvatarLookupRef.current.delete(
          candidates[index].name.toLowerCase(),
        ),
      );
      const entries = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (!entries.length) return;
      setArtistAvatarCache((current) => {
        const next = { ...current };
        for (const [key, avatarUrl] of entries) {
          next[key] = avatarUrl;
        }
        return trimRecordCache(next, memoryLimits.artistAvatarCache);
      });
    });
  }, [options.artistSummaries]);

  useEffect(() => {
    const trimmedCache = trimRecordCache(
      artistAvatarCache,
      memoryLimits.artistAvatarCache,
    );
    artistAvatarCacheRef.current = trimmedCache;
    if (trimmedCache !== artistAvatarCache) {
      setArtistAvatarCache(trimmedCache);
    }
  }, [artistAvatarCache]);

  return {
    searchBundle,
    searchLoading,
    searchMode,
    setSearchMode,
    searchError,
    searchSuggestions,
    searchTotal,
    searchMore,
    loadMoreSearch,
    retrySearch: () => setSearchRevision((current) => current + 1),
    selectedArtist,
    setSelectedArtist,
    artistTracks,
    artistTracksLoading,
    artistTracksError,
    retryArtistTracks: () => {
      if (!selectedArtist) return;
      artistRequestRef.current.delete(
        selectedArtist.providerId
          ? `tracks:${selectedArtist.providerId}`
          : `lookup:${selectedArtist.name.toLowerCase()}`,
      );
      artistRemoteTracksCacheRef.current.delete(selectedArtist.id);
      artistLookupCacheRef.current.delete(selectedArtist.name.toLowerCase());
      setArtistTracksRevision((current) => current + 1);
    },
    artistAvatarCache,
    artistRequestRef,
    artistAvatarLookupRef,
  };
}
