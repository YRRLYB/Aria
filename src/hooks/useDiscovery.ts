import { useEffect, useRef, useState } from "react";
import type { Track } from "@/data/music";
import type { ArtistSummary } from "@/lib/artists";
import { createLocalArtistSummaries, mergeArtists, providerArtistToUiArtist } from "@/lib/artists";
import { api } from "@/lib/api";
import { memoryLimits, trimRecordCache, trimStringSet } from "@/lib/memoryCache";
import { mergeTracks, splitArtistNames, trimTrackCache } from "@/lib/playerPresentation";
import { providerTrackToUiTrack, localTrackToUiTrack } from "@/lib/trackMappers";

export type SearchBundle = {
  localTracks: Track[];
  neteaseTracks: Track[];
  artists: ArtistSummary[];
};

const emptySearchBundle: SearchBundle = { localTracks: [], neteaseTracks: [], artists: [] };

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
  const [searchBundle, setSearchBundle] = useState<SearchBundle>(emptySearchBundle);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<ArtistSummary | null>(null);
  const [artistTracks, setArtistTracks] = useState<Track[]>([]);
  const [artistAvatarCache, setArtistAvatarCache] = useState<Record<string, string | null>>({});
  const artistRequestRef = useRef<Set<string>>(new Set());
  const artistAvatarLookupRef = useRef<Set<string>>(new Set());
  const artistAvatarCacheRef = useRef<Record<string, string | null>>({});
  const localTracksRef = useRef<Track[]>([]);
  const artistRemoteTracksCacheRef = useRef<Map<string, Track[]>>(new Map());
  const selectedArtistIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedArtistIdRef.current = selectedArtist?.id ?? null;
  }, [selectedArtist]);

  useEffect(() => {
    localTracksRef.current = options.localTracks;
  }, [options.localTracks]);

  useEffect(() => {
    const text = options.query.trim();
    if (!text) {
      setSearchBundle(emptySearchBundle);
      setSearchLoading(false);
      return;
    }

    const currentLocalTracks = localTracksRef.current;
    const localMatches = currentLocalTracks.filter((track) =>
      [track.title, track.artist, track.album, track.quality].join(" ").toLowerCase().includes(text.toLowerCase()),
    );
    const localArtists = createLocalArtistSummaries(currentLocalTracks)
      .filter((artist) => artist.name.toLowerCase().includes(text.toLowerCase()))
      .slice(0, 10);
    setSearchBundle((current) => ({
      localTracks: localMatches.slice(0, 24),
      neteaseTracks: current.neteaseTracks.filter((track) =>
        [track.title, track.artist, track.album].join(" ").toLowerCase().includes(text.toLowerCase()),
      ),
      artists: mergeArtists([
        ...localArtists,
        ...current.artists.filter(
          (artist) => artist.source !== "local" && artist.name.toLowerCase().includes(text.toLowerCase()),
        ),
      ]).slice(0, 18),
    }));
    setSearchLoading(true);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchLibraryAndStream(text, 24)
        .then((result) => {
          if (cancelled) return;
          const neteaseUiTracks = result.neteaseTracks.map((track, index) => providerTrackToUiTrack(track, index));
          const localUiTracks = result.localTracks.map(localTrackToUiTrack);
          const remoteArtists = result.artists.map(providerArtistToUiArtist);
          options.onMergeNeteaseTracks((current) => trimTrackCache([...current, ...neteaseUiTracks]));
          setSearchBundle({
            localTracks: mergeTracks([...localMatches, ...localUiTracks]).slice(0, 28),
            neteaseTracks: neteaseUiTracks,
            artists: mergeArtists([...localArtists, ...remoteArtists]).slice(0, 18),
          });
        })
        .catch(() => {
          if (!cancelled) {
            setSearchBundle({
              localTracks: localMatches.slice(0, 28),
              neteaseTracks: [],
              artists: localArtists,
            });
          }
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 360);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [options.localSearchSignature, options.query]);

  useEffect(() => {
    if (!selectedArtist) {
      setArtistTracks([]);
      return;
    }

    const artistId = selectedArtist.id;
    const artistName = selectedArtist.name;
    // Keep local files separate from provider streams while the remote artist
    // request is loading; `allTracks` contains every source.
    const localArtistTracks = options.allTracks.filter(
      (track) =>
        track.source === "local" &&
        splitArtistNames(track.artist).some((name) => name.toLowerCase() === artistName.toLowerCase()),
    );
    const cachedRemoteTracks = artistRemoteTracksCacheRef.current.get(artistId) ?? [];
    setArtistTracks(mergeTracks([...cachedRemoteTracks, ...localArtistTracks]));

    const providerId = selectedArtist.providerId;
    if (providerId) {
      const requestKey = `tracks:${providerId}`;
      if (!artistRequestRef.current.has(requestKey)) {
        artistRequestRef.current.add(requestKey);
        trimStringSet(artistRequestRef, memoryLimits.artistRequest);
        api
          .getNeteaseArtistTracks(providerId)
          .then((result) => {
            // Cache and library merge run even when this effect run was
            // cleaned up: `allTracks` churns while the request is in flight,
            // and discarding a resolved response left the request key in
            // place so the artist page never received its streaming tracks.
            const remoteTracks = result.tracks.map((track, index) => providerTrackToUiTrack(track, index));
            artistRemoteTracksCacheRef.current.delete(artistId);
            artistRemoteTracksCacheRef.current.set(artistId, remoteTracks);
            while (artistRemoteTracksCacheRef.current.size > 8) {
              const oldest = artistRemoteTracksCacheRef.current.keys().next().value;
              if (oldest === undefined) break;
              artistRemoteTracksCacheRef.current.delete(oldest);
            }
            options.onMergeNeteaseTracks((current) => trimTrackCache([...current, ...remoteTracks]));
            if (selectedArtistIdRef.current === artistId) {
              setArtistTracks(mergeTracks([...remoteTracks, ...localArtistTracks]));
            }
          })
          .catch(() => {
            artistRequestRef.current.delete(requestKey);
          });
      }
    } else {
      // Resolve the streaming provider id for local-only artist cards; this
      // used to be gated on a missing avatar, so a cached avatar (or a null
      // lookup) permanently blocked the artist's streaming track list.
      const requestKey = `lookup:${artistName.toLowerCase()}`;
      if (!artistRequestRef.current.has(requestKey)) {
        artistRequestRef.current.add(requestKey);
        trimStringSet(artistRequestRef, memoryLimits.artistRequest);
        api
          .lookupArtist(artistName)
          .then((result) => {
            if (!result.artist) return;
            const remoteArtist = providerArtistToUiArtist(result.artist);
            setArtistAvatarCache((current) => ({
              ...current,
              [artistName.toLowerCase()]: remoteArtist.avatarUrl ?? null,
            }));
            setSelectedArtist((current) =>
              current?.name === artistName
                ? {
                    ...current,
                    avatarUrl: current.avatarUrl ?? remoteArtist.avatarUrl,
                    providerId: current.providerId ?? remoteArtist.providerId,
                    source: current.source === "local" && remoteArtist.providerId ? "mixed" : current.source,
                  }
                : current,
            );
          })
          .catch(() => {
            artistRequestRef.current.delete(requestKey);
          });
      }
    }
  }, [options.allTracks, selectedArtist]);

  useEffect(() => {
    const candidates = options.artistSummaries
      .filter((artist) => {
        const key = artist.name.toLowerCase();
        return !artist.avatarUrl && !(key in artistAvatarCacheRef.current) && !artistAvatarLookupRef.current.has(key);
      })
      .slice(0, 6);
    if (!candidates.length) return;

    let cancelled = false;
    candidates.forEach((artist) => artistAvatarLookupRef.current.add(artist.name.toLowerCase()));
    trimStringSet(artistAvatarLookupRef, memoryLimits.artistAvatarLookup);
    Promise.allSettled(
      candidates.map(async (artist) => {
        const result = await api.lookupArtist(artist.name);
        const remoteArtist = result.artist ? providerArtistToUiArtist(result.artist) : null;
        return [artist.name.toLowerCase(), remoteArtist?.avatarUrl ?? null] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const entries = results.map((result, index) =>
        result.status === "fulfilled" ? result.value : ([candidates[index].name.toLowerCase(), null] as const),
      );
      setArtistAvatarCache((current) => {
        const next = { ...current };
        for (const [key, avatarUrl] of entries) {
          next[key] = avatarUrl;
        }
        return trimRecordCache(next, memoryLimits.artistAvatarCache);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [options.artistSummaries]);

  useEffect(() => {
    const trimmedCache = trimRecordCache(artistAvatarCache, memoryLimits.artistAvatarCache);
    artistAvatarCacheRef.current = trimmedCache;
    if (trimmedCache !== artistAvatarCache) {
      setArtistAvatarCache(trimmedCache);
    }
  }, [artistAvatarCache]);

  return {
    searchBundle,
    searchLoading,
    selectedArtist,
    setSelectedArtist,
    artistTracks,
    artistAvatarCache,
    artistRequestRef,
    artistAvatarLookupRef,
  };
}
