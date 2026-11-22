import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanYoutubeTrackQuery } from "../src/lib/localMetadata";

const mocks = vi.hoisted(() => ({
  cloudsearch: vi.fn(),
  lyric: vi.fn(),
  qqSearch: vi.fn(),
  qqLyrics: vi.fn(),
}));

vi.mock("NeteaseCloudMusicApi", () => ({
  default: {
    cloudsearch: mocks.cloudsearch,
    lyric: mocks.lyric,
  },
}));

vi.mock("./sources/qq/client", () => ({
  searchQqTracks: mocks.qqSearch,
  getQqLyrics: mocks.qqLyrics,
}));

import { resolveLyricLines, searchLyricCandidates } from "./lyrics";

describe("cross-source lyrics search and resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips YouTube video noise tags and - Topic channel suffixes before searching", () => {
    expect(
      cleanYoutubeTrackQuery({
        title: "アイドル (Official Music Video) [HD]",
        artist: "YOASOBI - Topic",
        album: "YouTube Music",
      }),
    ).toEqual({
      title: "アイドル",
      artist: "YOASOBI",
      album: "",
    });
  });

  it("merges NetEase and QQ candidates and keeps results when one source fails", async () => {
    mocks.cloudsearch.mockResolvedValue({
      body: {
        result: {
          songs: [{ id: 101, name: "夜に駆ける", ar: [{ name: "YOASOBI" }], al: { name: "THE BOOK" } }],
        },
      },
    });
    mocks.lyric.mockResolvedValue({ body: { lrc: { lyric: "[00:01.00]沈むように" } } });
    mocks.qqSearch.mockResolvedValue([
      { id: "001qq", title: "夜に駆ける", artist: "YOASOBI", album: "THE BOOK", coverUrl: "https://y.gtimg.cn/c.jpg" },
    ]);
    mocks.qqLyrics.mockResolvedValue([{ time: "00:01", text: "溶けてゆくように" }]);

    const combined = await searchLyricCandidates({
      title: "夜に駆ける (Official Audio)",
      artist: "YOASOBI - Topic",
    });
    expect(combined.map((item) => item.id)).toEqual(["netease:101", "qq:001qq"]);
    expect(combined[0].preview).toEqual(["沈むように"]);
    expect(combined[1].preview).toEqual(["溶けてゆくように"]);

    // One upstream failure must not suppress the other provider's candidates.
    mocks.cloudsearch.mockRejectedValueOnce(new Error("timeout"));
    const qqOnly = await searchLyricCandidates({ title: "夜に駆ける", artist: "YOASOBI" });
    expect(qqOnly.map((item) => item.id)).toEqual(["qq:001qq"]);
  });

  it("resolves QQ lyric candidate ids via getQqLyrics", async () => {
    mocks.qqLyrics.mockResolvedValue([{ time: "00:05", startTime: 5, text: "Test line", translation: "测试行" }]);
    const lines = await resolveLyricLines("qq:002mid");
    expect(mocks.qqLyrics).toHaveBeenCalledWith("002mid");
    expect(lines).toEqual([{ time: "00:05", startTime: 5, text: "Test line", translation: "测试行" }]);
  });
});
