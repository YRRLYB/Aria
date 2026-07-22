import { describe, expect, it, vi } from "vitest";
import { artistSourceLabel, createLocalArtistSummaries, mergeArtists, type ArtistSummary } from "./artists";
import type { Track } from "@/data/music";

vi.mock("@/lib/api", () => ({
  api: {
    getNeteaseCoverUrl: (url: string) => `cover:${url}`,
  },
}));

describe("artists", () => {
  it("merges artists by name and keeps the richest metadata", () => {
    const local = {
      id: "artist:a",
      name: "Alice",
      source: "local",
      avatarUrl: null,
      trackCount: 2,
      albumCount: 1,
      providerId: null,
    } satisfies ArtistSummary;
    const remote = {
      id: "netease:1",
      name: "alice",
      source: "netease",
      avatarUrl: "cover.jpg",
      trackCount: 8,
      albumCount: 4,
      providerId: "1",
    } satisfies ArtistSummary;

    expect(mergeArtists([local, remote])).toEqual([
      {
        ...local,
        source: "mixed",
        avatarUrl: "cover.jpg",
        trackCount: 8,
        albumCount: 4,
        providerId: "1",
      },
    ]);
  });

  it("creates local artist summaries from split artist names", () => {
    const tracks = [
      { id: "1", title: "A", artist: "Alice / Bob", album: "One" },
      { id: "2", title: "B", artist: "Alice", album: "Two" },
    ] as Track[];

    const summaries = createLocalArtistSummaries(tracks).sort((left, right) => left.name.localeCompare(right.name));

    expect(summaries.map((artist) => [artist.name, artist.trackCount, artist.albumCount])).toEqual([
      ["Alice", 2, 2],
      ["Bob", 1, 1],
    ]);
  });

  it("formats artist source labels", () => {
    expect(artistSourceLabel("local")).toBe("本地");
    expect(artistSourceLabel("netease")).toBe("网易云");
    expect(artistSourceLabel("mixed")).toBe("混合");
  });
});
