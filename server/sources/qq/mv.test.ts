import { describe, expect, it } from "vitest";
import { normalizeLegacyQqSong, normalizeQqSong } from "./client";
import { matchMvCandidate, normalizeSong } from "../../clients/neteaseClient";

describe("NetEase & QQ MV metadata extraction", () => {
  it("extracts MV videoUrl when QQ search or legacy playlist row carries mv.vid", () => {
    const searchTrack = normalizeQqSong({
      mid: "003OUlho2HcRHC",
      name: "告白气球",
      interval: 215,
      singer: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }],
      album: { mid: "003RMaRI1iFoYd", name: "周杰伦的床边故事" },
      mv: { id: 1053277, vid: "u00222le4ox" },
    });
    expect(searchTrack.hasVideo).toBe(true);
    expect(searchTrack.videoUrl).toBe("/api/sources/qq/tracks/003OUlho2HcRHC/video");

    const noMvTrack = normalizeQqSong({
      mid: "0037GMG74LpROP",
      name: "告白气球",
      mv: { id: 0, vid: "" },
    });
    expect(noMvTrack.hasVideo).toBeUndefined();
    expect(noMvTrack.videoUrl).toBeUndefined();

    const legacyConverted = normalizeLegacyQqSong({
      songmid: "0027oMO61wWi55",
      songname: "发如雪",
      vid: "p0011tzl846",
    });
    expect(normalizeQqSong(legacyConverted).videoUrl).toBe("/api/sources/qq/tracks/0027oMO61wWi55/video");
  });

  it("extracts NetEase mv/mvid and filters fallback MV search candidates strictly", () => {
    const track = normalizeSong({
      id: 1901371647,
      name: "孤勇者",
      mv: 14686114,
      ar: [{ id: 2116, name: "陈奕迅" }],
      al: { id: 137142551, name: "孤勇者" },
      dt: 256000,
    });
    expect(track.hasVideo).toBe(true);
    expect(track.videoUrl).toBe("/api/sources/netease/tracks/1901371647/video");

    const noMv = normalizeSong({ id: 186016, name: "晴天", mv: 0 });
    expect(noMv.hasVideo).toBeUndefined();
    expect(noMv.videoUrl).toBeUndefined();

    expect(matchMvCandidate("晴天", ["周杰伦"], "晴天", "周杰伦")).toBe(true);
    expect(matchMvCandidate("晴天", ["周杰伦"], "晴天", "高伟")).toBe(false);
    expect(matchMvCandidate("Crystal Gravity", ["Tanchiky"], "Crystal Gravity (Extended)", "Tanchiky")).toBe(true);
  });
});
