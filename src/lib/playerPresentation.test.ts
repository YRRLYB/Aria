import { describe, expect, it } from "vitest";
import {
  formatAudioDetail,
  formatBitrate,
  formatDuration,
  formatSampleRate,
  mergeTracks,
  normalizeQuality,
  parseDuration,
  trimTrackCache,
} from "./playerPresentation";

describe("playerPresentation", () => {
  it("formats and parses durations", () => {
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(0)).toBe("--:--");
    expect(formatDuration(65)).toBe("1:05");
    expect(parseDuration("[01:02.50]")).toBe(62.5);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("bad")).toBe(0);
  });

  it("normalizes quality and audio details", () => {
    expect(normalizeQuality("Hi-Res")).toBe("Hi-Res");
    expect(normalizeQuality("unknown")).toBe("320K");
    expect(formatBitrate(1_411_200)).toBe("1411 kbps");
    expect(formatBitrate(1_411_200, true)).toBe("1411k");
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
    expect(formatSampleRate(96_000, true)).toBe("96kHz");

    const track = {
      quality: "Lossless",
      bitrate: 1_411_200,
      sampleRate: 44_100,
      currentLevel: null,
    } as Parameters<typeof formatAudioDetail>[0];
    const detail = formatAudioDetail(track);
    expect(detail).toContain("Lossless");
    expect(detail).toContain("1411k");
    expect(detail).toContain("44.1kHz");
  });

  it("merges and trims tracks without reordering unique entries", () => {
    const first = { id: "a" } as Parameters<typeof mergeTracks>[0][number];
    const duplicate = { id: "a" } as Parameters<typeof mergeTracks>[0][number];
    const second = { id: "b" } as Parameters<typeof mergeTracks>[0][number];
    const third = { id: "c" } as Parameters<typeof mergeTracks>[0][number];

    expect(mergeTracks([first, duplicate, second]).map((track) => track.id)).toEqual(["a", "b"]);
    expect(trimTrackCache([first, second, third], 2).map((track) => track.id)).toEqual(["b", "c"]);
  });
});
