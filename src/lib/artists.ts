import type { Track } from "@/data/music";
import { api, type ProviderArtist } from "@/lib/api";
import { splitArtistNames } from "@/lib/playerPresentation";

export type ArtistSummary = {
  id: string;
  name: string;
  source: "local" | "netease" | "mixed";
  avatarUrl?: string | null;
  trackCount: number;
  albumCount?: number | null;
  providerId?: string | null;
};

export function providerArtistToUiArtist(artist: ProviderArtist): ArtistSummary {
  return {
    id: `${artist.source}:${artist.id}`,
    name: artist.name,
    source: artist.source === "netease" ? "netease" : "mixed",
    avatarUrl: artist.avatarUrl ? api.getNeteaseCoverUrl(artist.avatarUrl) : null,
    trackCount: artist.trackCount ?? 0,
    albumCount: artist.albumCount ?? null,
    providerId: artist.id,
  };
}

export function mergeArtists(artistsToMerge: ArtistSummary[]) {
  const byName = new Map<string, ArtistSummary>();
  for (const artist of artistsToMerge) {
    const key = artist.name.toLowerCase();
    const current = byName.get(key);
    if (!current) {
      byName.set(key, artist);
      continue;
    }
    byName.set(key, {
      ...current,
      source: current.source === artist.source ? current.source : "mixed",
      avatarUrl: current.avatarUrl ?? artist.avatarUrl,
      trackCount: Math.max(current.trackCount, artist.trackCount),
      albumCount: Math.max(current.albumCount ?? 0, artist.albumCount ?? 0),
      providerId: current.providerId ?? artist.providerId,
    });
  }
  return [...byName.values()];
}

export function createLocalArtistSummaries(tracks: Track[]) {
  const artists = new Map<string, ArtistSummary & { albums: Set<string> }>();
  for (const track of tracks) {
    for (const artistName of splitArtistNames(track.artist)) {
      const key = artistName.toLowerCase();
      const current =
        artists.get(key) ??
        ({
          id: `artist:${key}`,
          name: artistName,
          source: "local" as const,
          avatarUrl: null,
          trackCount: 0,
          albumCount: 0,
          providerId: null,
          albums: new Set<string>(),
        } satisfies ArtistSummary & { albums: Set<string> });
      current.trackCount += 1;
      current.albums.add(track.album);
      artists.set(key, current);
    }
  }
  return [...artists.values()].map(({ albums, ...artist }) => ({ ...artist, albumCount: albums.size }));
}

export function artistSourceLabel(source: ArtistSummary["source"]) {
  if (source === "local") return "本地";
  if (source === "netease") return "网易云";
  return "混合";
}
