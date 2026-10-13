import { describe, expect, it } from "vitest";
import type { Track } from "../data/music";
import { createLocalTrackSearchIndex, searchLocalTrackIndex } from "./localSearch";

describe("local search index", () => {
  const tracks = [
    { id: "a", title: "Moon Halo", artist: "Tetra", album: "夜间", quality: "Hi-Res" },
    { id: "b", title: "Moon", artist: "Other", album: "白天", quality: "320K" },
  ] as Track[];
  const index = createLocalTrackSearchIndex(tracks);
  it("matches title, artist, album and quality without case sensitivity", () => {
    for (const query of [" HALO ", "tetra", "夜间", "HI-RES"]) {
      expect(searchLocalTrackIndex(tracks, index, query).map((track) => track.id)).toEqual(["a"]);
    }
  });
  it("preserves library order, respects limits and returns current track objects", () => {
    const updated = [{ ...tracks[0], coverUrl: "cached-cover" }, tracks[1]];
    expect(searchLocalTrackIndex(updated, index, "moon", 1)).toEqual([updated[0]]);
    expect(searchLocalTrackIndex(tracks, index, "moon", 0)).toEqual([]);
    expect(searchLocalTrackIndex(tracks, index, "   ")).toEqual([]);
  });
});
