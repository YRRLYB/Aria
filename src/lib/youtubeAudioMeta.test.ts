import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/music";
import { applyYoutubeCachedAudioMeta, saveYoutubeAudioMeta } from "./youtubeAudioMeta";

function makeYoutubeTrack(id: string): Track {
  return {
    id: `youtube:${id}`,
    providerId: id,
    title: "Track",
    artist: "Artist",
    album: "YouTube Music",
    duration: "03:30",
    quality: "AAC",
    source: "youtube",
    cover: "#222",
    accent: "#7c5ce6",
    waveform: [],
    bitrate: 128_000,
    sampleRate: 44_100,
    currentLevel: null,
    availableLevels: ["standard", "higher", "exhigh"],
    lyricStatus: "searchable",
    lyrics: [],
  };
}

describe("youtubeAudioMeta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists resolved real bitrate, sampleRate, currentLevel and narrowed availableLevels", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    saveYoutubeAudioMeta("dQw4w9WgXcQ", {
      bitrate: 160_000,
      sampleRate: 48_000,
      quality: "320K",
      currentLevel: "exhigh",
      availableLevels: ["standard", "higher", "exhigh"],
    });

    const hydrated = applyYoutubeCachedAudioMeta(makeYoutubeTrack("dQw4w9WgXcQ"));
    expect(hydrated.bitrate).toBe(160_000);
    expect(hydrated.sampleRate).toBe(48_000);
    expect(hydrated.quality).toBe("320K");
    expect(hydrated.currentLevel).toBe("exhigh");

    saveYoutubeAudioMeta("fallbackId", {
      bitrate: 128_000,
      sampleRate: 44_100,
      quality: "AAC",
      currentLevel: "standard",
      availableLevels: ["standard"],
    });
    const fallback = applyYoutubeCachedAudioMeta(makeYoutubeTrack("fallbackId"));
    expect(fallback.availableLevels).toEqual(["standard"]);
    expect(fallback.currentLevel).toBe("standard");
  });
});
