import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ words: vi.fn(), lines: vi.fn() }));
vi.mock("NeteaseCloudMusicApi", () => ({ default: { lyric_new: mocks.words, lyric: mocks.lines } }));
import { fetchNeteaseLyrics } from "./lyricService";

beforeEach(() => vi.resetAllMocks());

describe("lyric acquisition", () => {
  it("loads word timing without an additional ordinary lyric request", async () => {
    mocks.words.mockResolvedValue({ body: { code: 200, yrc: { lyric: "[1000,500](1000,500,0)歌" } } });
    expect(await fetchNeteaseLyrics("42")).toMatchObject([{ startTime: 1, words: [{ text: "歌", duration: 0.5 }] }]);
    expect(mocks.words).toHaveBeenCalledExactlyOnceWith({ id: "42" });
    expect(mocks.lines).not.toHaveBeenCalled();
  });

  it.each(["reject", "missing", "error"])("keeps ordinary lyrics when word lyrics %s", async (mode) => {
    if (mode === "reject") mocks.words.mockRejectedValue(new Error("Unavailable"));
    else mocks.words.mockResolvedValue({ body: mode === "error" ? { code: 403 } : { code: 200 } });
    mocks.lines.mockResolvedValue({ body: { lrc: { lyric: "[00:01.250]歌" }, tlyric: { lyric: "[00:01.250]Song" } } });
    expect(await fetchNeteaseLyrics(42)).toEqual([{ time: "00:01", startTime: 1.25, text: "歌", translation: "Song", timingVersion: 1 }]);
    expect(mocks.lines).toHaveBeenCalledExactlyOnceWith({ id: 42 });
  });

  it("accepts line-only data from the new endpoint without repeatedly trying other APIs", async () => {
    mocks.words.mockResolvedValue({ body: { code: 200, lrc: { lyric: "[00:01]歌" } } });
    expect(await fetchNeteaseLyrics(42)).toMatchObject([{ timingVersion: 1, text: "歌" }]);
    expect(mocks.lines).not.toHaveBeenCalled();
  });
});
