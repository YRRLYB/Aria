import { describe, expect, it } from "vitest";
import { getLyricStartTime, getLyricWordProgress } from "./lyricTiming";
import { getActiveLyricIndex } from "./playerPresentation";

describe("lyric playback timing", () => {
  it("selects fractional line timing precisely and supports seeking back", () => {
    const lyrics = [{ time: "00:01", startTime: 1.25, text: "One" }, { time: "00:02", startTime: 2.75, text: "Two" }];
    expect(getActiveLyricIndex(lyrics, 2.65)).toBe(0);
    expect(getActiveLyricIndex(lyrics, 2.75)).toBe(1);
    expect(getActiveLyricIndex(lyrics, 1.8)).toBe(0);
    expect(getLyricStartTime({ time: "01:12", text: "Old cache" })).toBe(72);
  });

  it("clamps word progress and derives it from current time after backwards seeking", () => {
    const word = { text: "歌", startTime: 10, duration: 2 };
    expect(getLyricWordProgress(word, 9)).toBe(0);
    expect(getLyricWordProgress(word, 11)).toBe(0.5);
    expect(getLyricWordProgress(word, 20)).toBe(1);
    expect(getLyricWordProgress(word, 10.2)).toBeCloseTo(0.1);
    expect(getLyricWordProgress({ ...word, duration: 0 }, 10)).toBe(1);
  });
});
