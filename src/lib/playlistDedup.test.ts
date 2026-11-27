import { describe, expect, it } from "vitest";
import { findPlaylistDuplicates, normalizeTrackDedupKey, scoreTrackQuality } from "./playlistDedup";
import type { Track } from "@/data/music";

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: overrides.id ?? "track-1",
    title: overrides.title ?? "Sample",
    artist: overrides.artist ?? "Artist",
    album: overrides.album ?? "Album",
    duration: "03:45",
    quality: overrides.quality ?? "320K",
    source: overrides.source ?? "local",
    streamUrl: overrides.streamUrl ?? "https://example.com/audio.mp3",
    cover: "",
    accent: "#5976b4",
    waveform: [],
    lyrics: [],
    lyricStatus: "missing",
    sampleRate: overrides.sampleRate ?? null,
    bitrate: overrides.bitrate ?? null,
  };
}

describe("playlistDedup", () => {
  it("normalizes title and primary artist consistently", () => {
    expect(normalizeTrackDedupKey({ title: "  Midnight   City ", artist: "M83 / Guest" })).toBe(
      "midnight city::m83",
    );
    expect(normalizeTrackDedupKey({ title: "", artist: "M83" })).toBe("");
  });

  it("keeps the highest quality copy and marks duplicates as removable", () => {
    const low = makeTrack({ id: "t-low", title: "Gravity", artist: "John Mayer", quality: "128K", bitrate: 128 });
    const hires = makeTrack({ id: "t-hi", title: "gravity ", artist: "John Mayer", quality: "Hi-Res", sampleRate: 96000 });
    const flac = makeTrack({ id: "t-flac", title: "Gravity", artist: "John Mayer", quality: "FLAC", sampleRate: 44100 });
    const unique = makeTrack({ id: "t-other", title: "Slow Dancing", artist: "John Mayer", quality: "FLAC" });

    expect(scoreTrackQuality(hires)).toBeGreaterThan(scoreTrackQuality(flac));
    expect(scoreTrackQuality(flac)).toBeGreaterThan(scoreTrackQuality(low));

    const result = findPlaylistDuplicates([low, hires, flac, unique]);
    expect(result.duplicateCount).toBe(2);
    expect(result.keptTracks.map((t) => t.id)).toEqual(["t-hi", "t-other"]);
    expect(result.removableTracks.map((t) => t.id)).toEqual(["t-low", "t-flac"]);
  });
});
