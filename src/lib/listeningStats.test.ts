import { describe, expect, it } from "vitest";
import type { Track } from "@/data/music";
import { computeListeningInsights, formatListeningDuration } from "./listeningStats";

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: "local:1",
    title: "Song",
    artist: "Artist",
    album: "Album",
    duration: "03:30",
    quality: "FLAC",
    source: "local",
    cover: "#222",
    accent: "#7c5ce6",
    waveform: [],
    lyricStatus: "missing",
    lyrics: [],
    ...overrides,
  };
}

describe("listeningStats", () => {
  it("formats durations cleanly across seconds, minutes, and hours", () => {
    expect(formatListeningDuration(0)).toBe("0 分钟");
    expect(formatListeningDuration(45)).toBe("45 秒");
    expect(formatListeningDuration(600)).toBe("10 分钟");
    expect(formatListeningDuration(4500)).toBe("1 小时 15 分钟");
  });

  it("computes multi-source breakdown, top artists, top tracks, and peak listening window", () => {
    const t1 = makeTrack({ id: "netease:1", source: "netease", title: "Midnight", artist: "YOASOBI", duration: "04:00" });
    const t2 = makeTrack({ id: "qq:2", source: "qq", title: "Sunshine", artist: "YOASOBI / Aimer", duration: "03:00" });
    const t3 = makeTrack({ id: "bilibili:3", source: "bilibili", title: "Live", artist: "BiliUP", duration: "02:00", quality: "320K", currentLevel: "exhigh" });

    const lateNight = new Date(2026, 10, 18, 23, 15, 0).getTime();
    const afternoon = new Date(2026, 10, 17, 14, 10, 0).getTime();

    const insights = computeListeningInsights(
      [t1, t2, t3],
      { "netease:1": 5, "qq:2": 2 },
      [
        { track: t1, playedAt: lateNight, count: 5 },
        { track: t3, playedAt: afternoon, count: 1 },
      ],
    );

    expect(insights.totalPlays).toBe(8);
    expect(insights.uniquePlayedTracks).toBe(3);
    expect(insights.estimatedSeconds).toBe(5 * 240 + 2 * 180 + 1 * 120);
    expect(insights.activeDays).toBe(2);
    expect(insights.peakHour).toBe(23);
    expect(insights.personaLabel).toBe("深夜漫游派");
    expect(insights.topArtists[0]).toMatchObject({ name: "YOASOBI", playCount: 7, trackCount: 2 });
    expect(insights.topTracks[0].track.id).toBe("netease:1");
    expect(insights.sources.find((s) => s.source === "bilibili")?.playCount).toBe(1);
    expect(insights.sources.find((s) => s.source === "netease")?.playCount).toBe(5);
    expect(insights.topTracks[2].audioDetail).toContain("192K");
  });
});
