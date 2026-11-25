import { describe, expect, it } from "vitest";
import type { Track } from "@/data/music";
import {
  countTrackSources,
  mixSuperMixTracks,
  normalizeTrackFingerprint,
  trackQualityScore,
} from "./superMix";

function makeTrack(
  id: string,
  source: Track["source"],
  title: string,
  artist: string,
  extra: Partial<Track> = {},
): Track {
  return {
    id,
    title,
    artist,
    album: "Test Album",
    duration: "03:30",
    quality: "320K",
    source,
    cover: "#111",
    accent: "#222",
    waveform: [],
    lyrics: [],
    lyricStatus: "searchable",
    ...extra,
  };
}

describe("Super混合 mixer", () => {
  it("interleaves tracks evenly across multiple source playlists", () => {
    const ne1 = makeTrack("netease:1", "netease", "Song A", "Artist 1");
    const ne2 = makeTrack("netease:2", "netease", "Song B", "Artist 2");
    const qq1 = makeTrack("qq:1", "qq", "Song C", "Artist 3");
    const bili1 = makeTrack("bilibili:1", "bilibili", "Song D", "Artist 4");

    const result = mixSuperMixTracks(
      [
        { ref: { key: "netease:1", source: "netease", playlistId: "1", name: "NE" }, tracks: [ne1, ne2] },
        { ref: { key: "qq:1", source: "qq", playlistId: "1", name: "QQ" }, tracks: [qq1] },
        { ref: { key: "bilibili:1", source: "bilibili", playlistId: "1", name: "BL" }, tracks: [bili1] },
      ],
      { strategy: "interleave", dedupe: true },
    );

    expect(result.tracks.map((t) => t.id)).toEqual(["netease:1", "qq:1", "bilibili:1", "netease:2"]);
    expect(result.sourceCounts).toEqual({ netease: 2, qq: 1, bilibili: 1 });
    expect(result.dedupedCount).toBe(0);
  });

  it("deduplicates matching tracks across sources while upgrading to higher fidelity or non-VIP copies", () => {
    const neVipLow = makeTrack("netease:100", "netease", "晴天", "周杰伦", {
      quality: "128K",
      vip: true,
    });
    const qqLossless = makeTrack("qq:0039", "qq", "晴天", "周杰伦", {
      quality: "Hi-Res",
      bitrate: 1_900_000,
      vip: false,
    });
    const localFlac = makeTrack("local:1", "local", "孤勇者", "陈奕迅", {
      quality: "FLAC",
      bitrate: 960_000,
    });
    const ne320 = makeTrack("netease:200", "netease", "孤勇者", "陈奕迅", {
      quality: "320K",
    });

    expect(normalizeTrackFingerprint(neVipLow)).toBe(normalizeTrackFingerprint(qqLossless));
    expect(trackQualityScore(qqLossless)).toBeGreaterThan(trackQualityScore(neVipLow));
    expect(trackQualityScore(localFlac)).toBeGreaterThan(trackQualityScore(ne320));

    const result = mixSuperMixTracks(
      [
        { ref: { key: "netease:p1", source: "netease", playlistId: "p1", name: "NE" }, tracks: [neVipLow, ne320] },
        { ref: { key: "qq:p2", source: "qq", playlistId: "p2", name: "QQ" }, tracks: [qqLossless] },
        { ref: { key: "local:__all__", source: "local", playlistId: "__all__", name: "Local" }, tracks: [localFlac] },
      ],
      { strategy: "sequential", dedupe: true },
    );

    expect(result.tracks.map((t) => t.id)).toEqual(["qq:0039", "local:1"]);
    expect(result.dedupedCount).toBe(2);
    expect(countTrackSources(result.tracks)).toEqual({ qq: 1, local: 1 });
  });

  it("supports shuffle and preserves manually pinned tracks after deduplication", () => {
    const t1 = makeTrack("netease:1", "netease", "One", "A");
    const t2 = makeTrack("qq:2", "qq", "Two", "B");
    const manualUnique = makeTrack("youtube:yt1", "youtube", "Three", "C");
    const manualDup = makeTrack("qq:dup", "qq", "One", "A", { quality: "128K" });

    const result = mixSuperMixTracks(
      [
        { ref: { key: "netease:1", source: "netease", playlistId: "1", name: "NE" }, tracks: [t1] },
        { ref: { key: "qq:2", source: "qq", playlistId: "2", name: "QQ" }, tracks: [t2] },
      ],
      {
        strategy: "shuffle",
        dedupe: true,
        manualTracks: [manualUnique, manualDup],
        rng: () => 0.1,
      },
    );

    expect(result.tracks.map((t) => t.id)).toContain("youtube:yt1");
    expect(result.tracks.map((t) => t.id)).not.toContain("qq:dup");
    expect(result.tracks).toHaveLength(3);
  });
});
