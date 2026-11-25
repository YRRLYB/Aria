import { beforeEach, describe, expect, it } from "vitest";
import {
  computeYoutubeSyncDecision,
  formatYoutubeVideoOffset,
  mapYoutubeQualityOptions,
  nudgeYoutubeVideoOffset,
  readYoutubeVideoOffset,
  saveYoutubeVideoOffset,
  youtubeCodeForQualityId,
} from "./youtubeVideoOffset";

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
  };
}

describe("youtubeVideoOffset", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: createMemoryStorage() },
      configurable: true,
    });
  });

  it("persists, clamps, formats, and evicts per-track offsets cleanly", () => {
    expect(readYoutubeVideoOffset("dQw4w9WgXcQ")).toBe(0);

    expect(saveYoutubeVideoOffset("dQw4w9WgXcQ", 0.34)).toBe(0.35);
    expect(readYoutubeVideoOffset("dQw4w9WgXcQ")).toBe(0.35);
    expect(formatYoutubeVideoOffset(0.35)).toBe("+0.3s");
    expect(formatYoutubeVideoOffset(-0.2)).toBe("-0.2s");
    expect(formatYoutubeVideoOffset(0)).toBe("0.0s");

    expect(saveYoutubeVideoOffset("v2", 99)).toBe(15);
    expect(saveYoutubeVideoOffset("v3", -99)).toBe(-15);
    expect(nudgeYoutubeVideoOffset(0.1, 0.1)).toBe(0.2);
    expect(saveYoutubeVideoOffset("dQw4w9WgXcQ", 0)).toBe(0);
    expect(readYoutubeVideoOffset("dQw4w9WgXcQ")).toBe(0);

    for (let i = 0; i < 520; i += 1) {
      saveYoutubeVideoOffset(`vid-${i}`, 0.5);
    }
    expect(readYoutubeVideoOffset("vid-0")).toBe(0);
    expect(readYoutubeVideoOffset("vid-519")).toBe(0.5);
  });

  it("maps YouTube player quality codes and computes drift decisions", () => {
    const mapped = mapYoutubeQualityOptions(["small", "hd720", "hd2160", "hd1080", "hd1080"]);
    expect(mapped).toEqual([
      { id: 2160, label: "4K 2160P", ytCode: "hd2160" },
      { id: 1080, label: "1080P 全高清", ytCode: "hd1080" },
      { id: 720, label: "720P 高清", ytCode: "hd720" },
    ]);
    expect(youtubeCodeForQualityId(2160)).toBe("hd2160");
    expect(youtubeCodeForQualityId(null)).toBeNull();

    expect(computeYoutubeSyncDecision(10.0, 10.8, true)).toEqual({
      action: "seek",
      target: 10.8,
      playbackRate: 1,
    });
    expect(computeYoutubeSyncDecision(10.2, 10.0, true)).toEqual({
      action: "rate",
      playbackRate: 0.96,
    });
    expect(computeYoutubeSyncDecision(9.8, 10.0, true)).toEqual({
      action: "rate",
      playbackRate: 1.04,
    });
    expect(computeYoutubeSyncDecision(9.95, 10.0, true)).toEqual({
      action: "none",
      playbackRate: 1,
    });
    expect(computeYoutubeSyncDecision(9.8, 10.0, false)).toEqual({
      action: "none",
      playbackRate: 1,
    });
    expect(computeYoutubeSyncDecision(10.0, 12.5, false)).toEqual({
      action: "none",
      playbackRate: 1,
    });
    expect(computeYoutubeSyncDecision(10.6, 10.0, false)).toEqual({
      action: "none",
      playbackRate: 1,
    });
  });
});
