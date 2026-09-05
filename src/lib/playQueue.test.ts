import { describe, expect, it } from "vitest";
import type { Track } from "@/data/music";
import { mergeQueueTrackSources } from "./playQueue";

function track(id: string, title: string, source: Track["source"] = "netease"): Track {
  return {
    id,
    title,
    artist: "Artist",
    album: "Album",
    duration: "03:00",
    quality: "320K",
    source,
    streamUrl: `/stream/${id}`,
    cover: "#111",
    accent: "#222",
    waveform: [],
    lyrics: [],
    lyricStatus: "missing",
  };
}

describe("playQueue", () => {
  it("prefers live tracks while retaining cached queue entries", () => {
    const cached = track("netease:1", "cached title");
    const live = track("netease:1", "fresh title");
    const onlyCached = track("netease:2", "offline title");

    expect(mergeQueueTrackSources(["netease:1", "netease:2"], [live], [cached, onlyCached])).toEqual([
      live,
      onlyCached,
    ]);
  });

  it("drops duplicate and non-playable queue ids", () => {
    const playable = track("a", "Playable", "local");
    const unavailable = { ...track("b", "Unavailable"), streamUrl: undefined };

    expect(mergeQueueTrackSources(["a", "a", "b"], [playable, unavailable], [])).toEqual([playable]);
  });
});
