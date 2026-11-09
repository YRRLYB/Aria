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
      providerSource: "netease",
    } satisfies ArtistSummary;

    expect(mergeArtists([local, remote])).toEqual([
      {
        ...local,
        source: "mixed",
        avatarUrl: "cover.jpg",
        trackCount: 8,
        albumCount: 4,
        providerId: "1",
        providerSource: "netease",
      },
    ]);
  });

  it("remembers which provider a merged artist id belongs to", () => {
    const local = {
      id: "artist:aimer",
      name: "Aimer",
      source: "local",
      avatarUrl: null,
      trackCount: 40,
      albumCount: 8,
      providerId: null,
      providerSource: null,
    } satisfies ArtistSummary;
    const qq = {
      id: "qq:0039EKtl4ec7wv",
      name: "Aimer",
      source: "qq",
      avatarUrl: null,
      trackCount: 374,
      albumCount: 82,
      providerId: "0039EKtl4ec7wv",
      providerSource: "qq",
    } satisfies ArtistSummary;
    const netease = {
      id: "netease:16152",
      name: "Aimer",
      source: "netease",
      avatarUrl: null,
      trackCount: 50,
      albumCount: 20,
      providerId: "16152",
      providerSource: "netease",
    } satisfies ArtistSummary;

    const [qqFirst] = mergeArtists([local, qq]);
    expect(qqFirst).toMatchObject({ source: "mixed", providerId: qq.providerId, providerSource: "qq" });
    // A later NetEase result upgrades the provider id so detail requests use
    // the correct catalogue instead of calling NetEase with a QQ id.
    const [upgraded] = mergeArtists([qqFirst, netease]);
    expect(upgraded).toMatchObject({ providerId: netease.providerId, providerSource: "netease" });
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
