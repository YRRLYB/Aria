import { describe, expect, it } from "vitest";
import { parseLrcEntries, parseNeteaseLyrics, parseYrcEntries } from "./lyricParser";

describe("word-level lyric parsing", () => {
  it("preserves absolute word timing, spaces and line timing while excluding metadata", () => {
    const lines = parseYrcEntries('{"t":0,"c":[{"tx":"作词"}]}\n[12345,1200](12345,300,0)Hello (12645,600,0)世界(13245,300,0)!');
    expect(lines).toEqual([{
      time: "00:12", startTime: 12.345, duration: 1.2, text: "Hello 世界!", timingVersion: 1,
      words: [
        { startTime: 12.345, duration: 0.3, text: "Hello " },
        { startTime: 12.645, duration: 0.6, text: "世界" },
        { startTime: 13.245, duration: 0.3, text: "!" },
      ],
    }]);
  });

  it("uses the translation aligned to word-level timing and falls back to ordinary translation", () => {
    expect(parseNeteaseLyrics({
      yrc: { lyric: "[10000,1000](10000,1000,0)Hello" },
      lrc: { lyric: "[00:09.00]Hello" },
      ytlrc: { lyric: "[00:10.00]你好" },
      tlyric: { lyric: "[00:09.00]普通翻译" },
    })[0]).toMatchObject({ text: "Hello", startTime: 10, translation: "你好", words: [{ text: "Hello" }] });
    expect(parseNeteaseLyrics({
      yrc: { lyric: "[10000,1000](10000,1000,0)Hello" },
      tlyric: { lyric: "[00:10.05]你好" },
    })[0].translation).toBe("你好");
  });

  it("falls back to synchronized lines when the word-level payload is missing or malformed", () => {
    const lines = parseNeteaseLyrics({
      yrc: { lyric: "[1234,100]broken timing without words" },
      lrc: { lyric: "[00:02.350]Two\n[00:01.12]One" },
      tlyric: { lyric: "[00:01.12]一" },
    });
    expect(lines).toEqual([
      { time: "00:01", startTime: 1.12, text: "One", translation: "一", timingVersion: 1 },
      { time: "00:02", startTime: 2.35, text: "Two", timingVersion: 1 },
    ]);
    expect(lines.every((line) => !line.words)).toBe(true);
  });

  it("handles repeated LRC timestamps, milliseconds and global offsets", () => {
    expect(parseLrcEntries("[offset:-250]\n[00:01.5][01:02.050]Repeat\n[ar:Artist]\n[00:00.100]Start"))
      .toEqual([
        { time: "00:00", startTime: 0, text: "Start", timingVersion: 1 },
        { time: "00:01", startTime: 1.25, text: "Repeat", timingVersion: 1 },
        { time: "01:01", startTime: 61.8, text: "Repeat", timingVersion: 1 },
      ]);
  });
});
