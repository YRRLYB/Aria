import { describe, expect, it } from "vitest";
import { canPlayTrackVideo, resolveNextVideoMode } from "./features";

describe("Bilibili video mode transitions", () => {
  const biliA = { source: "bilibili" as const, videoUrl: "/api/sources/bilibili/tracks/BV1/video" };
  const biliB = { source: "bilibili" as const, videoUrl: "/api/sources/bilibili/tracks/BV2/video" };
  const neteaseSong = { source: "netease" as const, videoUrl: undefined };
  const localSong = { source: "local" as const, videoUrl: undefined };

  it("maintains video across consecutive Bilibili tracks and closes on other sources", () => {
    expect(canPlayTrackVideo(biliA)).toBe(true);
    expect(canPlayTrackVideo(neteaseSong)).toBe(false);

    // Consecutive Bilibili tracks preserve an active video stage.
    expect(resolveNextVideoMode(true, biliB)).toBe(true);

    // Switching to NetEase or local closes video mode cleanly.
    const afterNetease = resolveNextVideoMode(true, neteaseSong);
    expect(afterNetease).toBe(false);
    expect(resolveNextVideoMode(true, localSong)).toBe(false);

    // Returning to a Bilibili track keeps cover mode until manually opened.
    expect(resolveNextVideoMode(afterNetease, biliA)).toBe(false);
  });
});
