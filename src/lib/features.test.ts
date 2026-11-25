import { describe, expect, it } from "vitest";
import { canPlayTrackVideo, isStandaloneMvSource } from "./features";

describe("video capability feature gates", () => {
  it("allows video mode for bilibili, youtube, netease and qq tracks when videoUrl is present", () => {
    expect(canPlayTrackVideo({ source: "netease", videoUrl: "/api/sources/netease/tracks/1/video" })).toBe(true);
    expect(canPlayTrackVideo({ source: "qq", videoUrl: "/api/sources/qq/tracks/mid1/video" })).toBe(true);
    expect(canPlayTrackVideo({ source: "bilibili", videoUrl: "/api/sources/bilibili/tracks/bv1/video" })).toBe(true);
    expect(canPlayTrackVideo({ source: "youtube", videoUrl: "/api/sources/youtube/tracks/yt1/video" })).toBe(true);
    expect(canPlayTrackVideo({ source: "netease", videoUrl: undefined })).toBe(false);
    expect(canPlayTrackVideo({ source: "local", videoUrl: "/fake" })).toBe(false);
  });

  it("identifies NetEase and QQ as standalone muxed MV sources", () => {
    expect(isStandaloneMvSource("netease")).toBe(true);
    expect(isStandaloneMvSource("qq")).toBe(true);
    expect(isStandaloneMvSource("bilibili")).toBe(false);
    expect(isStandaloneMvSource("youtube")).toBe(false);
    expect(isStandaloneMvSource("local")).toBe(false);
  });
});
