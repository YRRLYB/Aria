import { describe, expect, it } from "vitest";
import { formatFullLyrics, formatSingleLyricLine } from "./lyricCopy";

describe("lyricCopy", () => {
  const sampleLines = [
    { time: "00:12", text: "Night falls softly", translation: "夜幕悄然降临" },
    { time: "00:20", text: "Instrumental", translation: "" },
    { time: "00:28", text: "Stay with the light", translation: "与微光同行" },
  ];

  it("formats a single line with or without translation", () => {
    expect(formatSingleLyricLine(sampleLines[0], false)).toBe("Night falls softly");
    expect(formatSingleLyricLine(sampleLines[0], true)).toBe("Night falls softly\n夜幕悄然降临");
    expect(formatSingleLyricLine(sampleLines[1], true)).toBe("Instrumental");
  });

  it("formats full lyrics cleanly for original and bilingual modes", () => {
    expect(formatFullLyrics(sampleLines, "original")).toBe(
      "Night falls softly\nInstrumental\nStay with the light",
    );
    expect(formatFullLyrics(sampleLines, "bilingual")).toBe(
      "Night falls softly\n夜幕悄然降临\n\nInstrumental\n\nStay with the light\n与微光同行",
    );
  });
});
