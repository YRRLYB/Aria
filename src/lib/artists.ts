import type { Track } from "@/data/music";
import { api, type ProviderArtist } from "@/lib/api";
import { splitArtistNames } from "@/lib/playerPresentation";

export type ArtistSummary = {
  id: string;
  name: string;
  source: "local" | "netease" | "qq" | "mixed";
  avatarUrl?: string | null;
  trackCount: number;
  albumCount?: number | null;
  providerId?: string | null;
  // Which provider `providerId` belongs to. A merged/mixed artist keeps the id
  // from one provider, so the display source alone cannot route API requests.
  providerSource?: "netease" | "qq" | null;
};

export function artistProviderSource(artist: Pick<ArtistSummary, "source" | "providerSource">): "netease" | "qq" {
  if (artist.providerSource === "qq") return "qq";
  if (!artist.providerSource && artist.source === "qq") return "qq";
  return "netease";
}

export function providerArtistToUiArtist(artist: ProviderArtist): ArtistSummary {
  const source = artist.source === "qq" ? "qq" : artist.source === "netease" ? "netease" : "mixed";
  return {
    id: `${artist.source}:${artist.id}`,
    name: artist.name,
    source,
    avatarUrl: artist.avatarUrl
      ? source === "qq"
        ? api.getSourceCoverUrl("qq", artist.avatarUrl)
        : api.getNeteaseCoverUrl(artist.avatarUrl)
      : null,
    trackCount: artist.trackCount ?? 0,
    albumCount: artist.albumCount ?? null,
    providerId: artist.id,
    providerSource: source === "qq" ? "qq" : "netease",
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
    // Prefer NetEase when both providers have the same artist; its detail and
    // track endpoints are the richer fallback and match the old behaviour.
    const replaceProvider =
      !current.providerId ||
      (artist.providerSource === "netease" && current.providerSource !== "netease");
    byName.set(key, {
      ...current,
      source: current.source === artist.source ? current.source : "mixed",
      avatarUrl: current.avatarUrl ?? artist.avatarUrl,
      trackCount: Math.max(current.trackCount, artist.trackCount),
      albumCount: Math.max(current.albumCount ?? 0, artist.albumCount ?? 0),
      providerId: replaceProvider ? artist.providerId : current.providerId,
      providerSource: replaceProvider ? artist.providerSource : current.providerSource,
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
          providerSource: null,
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
  if (source === "qq") return "QQ 音乐";
  return "混合";
}
