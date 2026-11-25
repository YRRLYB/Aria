import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptPaletteForTheme,
  contrastRatio,
  createCachedQueueSnapshots,
  formatAudioDetail,
  formatBitrate,
  formatDuration,
  formatSampleRate,
  hasSyncedLyrics,
  mergeTrackRecord,
  mergeTracks,
  normalizeQuality,
  parseDuration,
  readCachedAudioSettings,
  readCachedPlayerState,
  readableForegroundForAccent,
  restoreTrackLyrics,
  selectPlaybackQuality,
  trimTrackCache,
  writeCachedAudioSettings,
  writeCachedLyrics,
} from "./playerPresentation";
import { mergeQueueTrackSources } from "./playQueue";

function mockLocalStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  vi.stubGlobal("window", { localStorage });
  return localStorage;
}

afterEach(() => vi.unstubAllGlobals());

describe("playerPresentation", () => {
  it("formats and parses durations", () => {
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(0)).toBe("--:--");
    expect(formatDuration(65)).toBe("1:05");
    expect(parseDuration("[01:02.50]")).toBe(62.5);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("bad")).toBe(0);
  });

  it("normalizes quality and audio details", () => {
    expect(normalizeQuality("Hi-Res")).toBe("Hi-Res");
    expect(normalizeQuality("unknown")).toBe("320K");
    expect(formatBitrate(1_411_200)).toBe("1411 kbps");
    expect(formatBitrate(1_411_200, true)).toBe("1411k");
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
    expect(formatSampleRate(96_000, true)).toBe("96kHz");

    const track = {
      quality: "Lossless",
      bitrate: 1_411_200,
      sampleRate: 44_100,
      currentLevel: null,
    } as Parameters<typeof formatAudioDetail>[0];
    const detail = formatAudioDetail(track);
    expect(detail).toContain("Lossless");
    expect(detail).toContain("1411k");
    expect(detail).toContain("44.1kHz");

    expect(normalizeQuality("臻品")).toBe("臻品");
    expect(formatAudioDetail({ ...track, currentLevel: "jymaster" })).toContain("臻品");
    expect(formatAudioDetail({ ...track, currentLevel: "hires" }, "jymaster")).toContain("Hi-Res");
    expect(formatAudioDetail({ ...track, currentLevel: "hires" }, "jymaster")).not.toContain("臻品");
  });

  it("merges and trims tracks without reordering unique entries", () => {
    const first = { id: "a" } as Parameters<typeof mergeTracks>[0][number];
    const duplicate = { id: "a" } as Parameters<typeof mergeTracks>[0][number];
    const second = { id: "b" } as Parameters<typeof mergeTracks>[0][number];
    const third = { id: "c" } as Parameters<typeof mergeTracks>[0][number];

    expect(mergeTracks([first, duplicate, second]).map((track) => track.id)).toEqual(["a", "b"]);
    expect(trimTrackCache([first, second, third], 2).map((track) => track.id)).toEqual(["b", "c"]);
  });

  it("refreshes a cached track when a playable copy arrives later", () => {
    const stale = {
      id: "netease:42",
      title: "Song",
      artist: "Artist",
      album: "Album",
      duration: "03:00",
      quality: "Lossless",
      source: "netease",
      cover: "#111",
      accent: "#111",
      waveform: [],
      lyricStatus: "searchable",
      lyrics: [],
    } as Parameters<typeof trimTrackCache>[0][number];
    const fresh = { ...stale, streamUrl: "/api/providers/netease/tracks/42/stream" };

    expect(trimTrackCache([stale, fresh])[0].streamUrl).toBe(fresh.streamUrl);
    // Never trade a playable cached copy for a metadata-only refresh.
    expect(trimTrackCache([fresh, stale])[0].streamUrl).toBe(fresh.streamUrl);
  });

  it("creates compact queue snapshots without losing playback metadata", () => {
    const track = {
      id: "netease:42",
      providerId: "42",
      title: "Remote song",
      artist: "Artist",
      album: "Album",
      duration: "03:20",
      quality: "Lossless",
      source: "netease",
      streamUrl: "/api/providers/netease/stream/42",
      coverUrl: "data:image/jpeg;base64,large",
      cover: "linear-gradient(#fff,#000)",
      accent: "#222",
      waveform: [1, 2, 3],
      lyrics: [{ time: "00:01", text: "long lyric" }],
      lyricStatus: "linked",
    } as Parameters<typeof createCachedQueueSnapshots>[0][number];

    const [snapshot] = createCachedQueueSnapshots([track]);
    expect(snapshot).toMatchObject({ id: track.id, streamUrl: track.streamUrl, source: "netease" });
    expect(snapshot.coverUrl).toBeUndefined();
    expect(snapshot.waveform).toEqual([]);
    expect(snapshot.lyrics).toEqual([]);
    expect(snapshot.lyricStatus).toBe("searchable");
  });

  it("deduplicates large queue snapshots in insertion order", () => {
    const first = { id: "a", title: "first" } as Parameters<typeof createCachedQueueSnapshots>[0][number];
    const replacement = { id: "a", title: "replacement" } as Parameters<typeof createCachedQueueSnapshots>[0][number];
    const second = { id: "b", title: "second" } as Parameters<typeof createCachedQueueSnapshots>[0][number];

    expect(createCachedQueueSnapshots([first, replacement, second], 2).map((track) => track.id)).toEqual(["a", "b"]);
    expect(createCachedQueueSnapshots([first, replacement, second], 2)[0].title).toBe("first");
    expect(createCachedQueueSnapshots([first], 0)).toEqual([]);
  });

  it("chooses highest original quality and treats master quality as a separate opt-in", () => {
    const full = { source: "netease" as const, availableLevels: ["standard", "lossless", "hires", "jymaster"] as const };
    const track = { ...full, availableLevels: [...full.availableLevels] };
    const settings = { qualityLevel: "hires" as const, hifiEnabled: true, masterQualityEnabled: false };
    expect(selectPlaybackQuality(track, settings)).toBe("hires");
    expect(selectPlaybackQuality(track, { ...settings, masterQualityEnabled: true })).toBe("jymaster");
    expect(selectPlaybackQuality(track, settings)).toBe("hires");
    expect(selectPlaybackQuality({ source: "netease", availableLevels: ["lossless", "exhigh"] }, settings)).toBe("lossless");
    expect(selectPlaybackQuality({ source: "netease", availableLevels: ["exhigh"] }, { ...settings, masterQualityEnabled: true })).toBe("exhigh");
    expect(selectPlaybackQuality(undefined, settings)).toBe("hires");
    expect(selectPlaybackQuality(track, { ...settings, hifiEnabled: false, qualityLevel: "exhigh" })).toBe("exhigh");
    expect(selectPlaybackQuality(track, { ...settings, hifiEnabled: false, qualityLevel: "jymaster" })).toBe("hires");
    expect(selectPlaybackQuality({ source: "local", availableLevels: ["jymaster"] }, { ...settings, masterQualityEnabled: true })).toBe("hires");
    // QQ has no 臻品母带 tier: HiFi picks the highest original level, and a
    // master-quality preference degrades to Hi-Res instead of jymaster.
    expect(selectPlaybackQuality({ source: "qq", availableLevels: ["standard", "exhigh", "lossless", "hires"] }, settings)).toBe("hires");
    expect(selectPlaybackQuality({ source: "qq", availableLevels: ["standard", "exhigh", "lossless"] }, settings)).toBe("lossless");
    expect(selectPlaybackQuality({ source: "qq", availableLevels: ["standard", "exhigh"] }, settings)).toBe("hires");
    expect(selectPlaybackQuality({ source: "qq", availableLevels: ["standard"] }, { ...settings, hifiEnabled: false, qualityLevel: "exhigh" })).toBe("exhigh");
    expect(selectPlaybackQuality({ source: "bilibili", availableLevels: ["standard", "exhigh", "hires"] }, { ...settings, bilibiliDefaultAudioLevel: "hires" })).toBe("hires");
    expect(selectPlaybackQuality({ source: "bilibili", availableLevels: ["standard", "exhigh", "hires"] }, { ...settings, bilibiliDefaultAudioLevel: "exhigh" })).toBe("exhigh");
  });

  it("persists master quality independently and defaults legacy audio settings to disabled", () => {
    const storage = mockLocalStorage();
    storage.setItem("aria-audio-settings", JSON.stringify({ hifiEnabled: true }));
    expect(readCachedAudioSettings()).toMatchObject({
      masterQualityEnabled: false,
      bilibiliDefaultVideoQn: 120,
      bilibiliDefaultAudioLevel: "hires",
    });
    writeCachedAudioSettings({ sinkId: "default", hifiEnabled: true, masterQualityEnabled: true, gaplessEnabled: false, exclusiveMode: false, outputMode: "system", bilibiliDefaultVideoQn: 116, bilibiliDefaultAudioLevel: "exhigh" });
    expect(readCachedAudioSettings()).toMatchObject({ hifiEnabled: true, masterQualityEnabled: true, bilibiliDefaultVideoQn: 116, bilibiliDefaultAudioLevel: "exhigh" });
    writeCachedAudioSettings({ sinkId: "default", hifiEnabled: true, masterQualityEnabled: false, gaplessEnabled: false, exclusiveMode: false, outputMode: "system" });
    expect(readCachedAudioSettings()).toMatchObject({ hifiEnabled: true, masterQualityEnabled: false, bilibiliDefaultVideoQn: 116, bilibiliDefaultAudioLevel: "exhigh" });
  });

  it("hydrates compact queue lyrics and keeps an empty legacy linked snapshot eligible for sync", () => {
    const storage = mockLocalStorage();
    const track = {
      id: "netease:lyric-restore",
      title: "Restored song",
      artist: "Artist",
      album: "Album",
      duration: "03:00",
      quality: "Hi-Res",
      source: "netease",
      providerId: "lyric-restore",
      streamUrl: "/stream/lyric-restore",
      cover: "#111",
      accent: "#222",
      waveform: [],
      lyrics: [{ time: "00:01", text: "Lyrics survive restart" }],
      lyricStatus: "linked",
    } as Parameters<typeof createCachedQueueSnapshots>[0][number];
    writeCachedLyrics(track.id, track.lyrics);
    storage.setItem("aria-player-state", JSON.stringify({ activeTrackId: track.id, activeTrackSnapshot: track, playQueueIds: [track.id], playQueueSnapshots: createCachedQueueSnapshots([track]) }));
    const cached = readCachedPlayerState();
    const [rendered] = mergeQueueTrackSources(cached.playQueueIds ?? [], [], cached.playQueueSnapshots ?? []);
    expect(rendered.lyrics).toEqual(track.lyrics);
    expect(hasSyncedLyrics(rendered)).toBe(true);

    const legacy = { ...track, id: "netease:legacy-without-lyrics", lyrics: [] };
    storage.setItem("aria-player-state", JSON.stringify({ activeTrackId: legacy.id, activeTrackSnapshot: legacy, playQueueSnapshots: [legacy] }));
    const withoutLyrics = readCachedPlayerState();
    expect(withoutLyrics.activeTrackSnapshot?.lyricStatus).toBe("searchable");
    expect(withoutLyrics.playQueueSnapshots?.[0].lyricStatus).toBe("searchable");
    expect(hasSyncedLyrics(withoutLyrics.playQueueSnapshots![0])).toBe(false);
    const updatedQueue = withoutLyrics.playQueueSnapshots!.map((item) => ({ ...item, lyrics: track.lyrics, lyricStatus: "linked" as const }));
    expect(mergeQueueTrackSources([legacy.id], [], updatedQueue)[0].lyrics).toEqual(track.lyrics);
  });

  it("restores real lyrics over placeholders while preserving fresh synchronized lyrics", () => {
    const cachedLyrics = [{ time: "00:01", text: "Saved lyric" }];
    const placeholder = { lyrics: [{ time: "00:00", text: "歌词等待同步" }], lyricStatus: "searchable" } as Parameters<typeof restoreTrackLyrics>[0];
    expect(restoreTrackLyrics(placeholder, cachedLyrics)).toMatchObject({ lyrics: cachedLyrics, lyricStatus: "linked" });
    const synced = { ...placeholder, lyrics: [{ time: "00:01", text: "Fresh lyric" }], lyricStatus: "linked" as const };
    expect(restoreTrackLyrics(synced, cachedLyrics)).toBe(synced);
  });

  it("allows manual Bilibili quality switching and formats accurate Bilibili tier labels", () => {
    const biliTrack = {
      source: "bilibili" as const,
      quality: "320K" as const,
      currentLevel: "exhigh" as const,
      availableLevels: ["standard", "higher", "exhigh", "hires"] as const,
      bitrate: 192_000,
      sampleRate: 48_000,
    };
    expect(
      selectPlaybackQuality(
        { source: "bilibili", availableLevels: [...biliTrack.availableLevels] },
        { qualityLevel: "standard", hifiEnabled: false, masterQualityEnabled: false, bilibiliDefaultAudioLevel: "hires" },
      ),
    ).toBe("standard");
    expect(
      selectPlaybackQuality(
        { source: "bilibili", availableLevels: ["standard", "exhigh", "hires"] },
        { qualityLevel: "lossless", hifiEnabled: false, masterQualityEnabled: false, bilibiliDefaultAudioLevel: "hires" },
      ),
    ).toBe("exhigh");
    const formatted = formatAudioDetail({ ...biliTrack, availableLevels: [...biliTrack.availableLevels] } as Parameters<typeof formatAudioDetail>[0]);
    expect(formatted).toContain("192K");
    expect(formatted).not.toContain("320K");
  });

  it("lifts very dark album cover accents in dark mode for crisp control contrast", () => {
    const pitchBlack = adaptPaletteForTheme({ primary: "#141418", secondary: "#0e1116" }, true);
    expect(contrastRatio(pitchBlack.primary, "#14141d")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pitchBlack.secondary, "#14141d")).toBeGreaterThanOrEqual(4.5);
    const fg = readableForegroundForAccent(pitchBlack.primary);
    expect(contrastRatio(pitchBlack.primary, fg)).toBeGreaterThanOrEqual(4.5);
  });

  it("preserves runtime stream metadata and pins the active track across cache merges", () => {
    const richTrack = {
      id: "netease:active-1",
      title: "Active",
      artist: "Artist",
      album: "Album",
      duration: "03:45",
      quality: "Hi-Res" as const,
      source: "netease" as const,
      streamUrl: "/stream/active",
      cover: "#111",
      accent: "#7c5ce6",
      waveform: [],
      availableLevels: ["standard", "exhigh", "lossless", "hires"] as const,
      currentLevel: "hires" as const,
      bitrate: 1_900_000,
      lyrics: [{ time: "00:01", text: "Hello" }],
      lyricStatus: "linked" as const,
    };
    const shallowIncoming = {
      ...richTrack,
      availableLevels: [],
      currentLevel: null,
      bitrate: null,
      lyrics: [],
      lyricStatus: "searchable" as const,
    };
    const merged = mergeTrackRecord(
      richTrack as unknown as Parameters<typeof mergeTrackRecord>[0],
      shallowIncoming as unknown as Parameters<typeof mergeTrackRecord>[1],
    );
    expect(merged.availableLevels).toEqual(["standard", "exhigh", "lossless", "hires"]);
    expect(merged.bitrate).toBe(1_900_000);
    expect(merged.lyricStatus).toBe("linked");

    const filler = Array.from({ length: 10 }, (_, idx) => ({ ...shallowIncoming, id: `netease:f-${idx}` }));
    const trimmed = trimTrackCache(
      [richTrack, ...filler] as unknown as Parameters<typeof trimTrackCache>[0],
      4,
      richTrack.id,
    );
    expect(trimmed.some((item) => item.id === richTrack.id)).toBe(true);
  });

  it("scrubs legacy NetEase placeholder lyrics from persisted snapshots and preserves missing status across merges", () => {
    const storage = mockLocalStorage();
    const stalePlaceholderTrack = {
      id: "netease:1844160090",
      providerId: "1844160090",
      title: "Crystal Gravity",
      artist: "Tanchiky / siromaru",
      album: "Crystal Gravity",
      duration: "02:04",
      quality: "320K",
      source: "netease",
      streamUrl: "/stream/1844160090",
      cover: "#111",
      accent: "#7c5ce6",
      waveform: [],
      lyrics: [
        { time: "00:00", text: "歌词等待同步" },
        { time: "00:15", text: "网易云歌曲已接入真实账号数据" },
        { time: "00:30", text: "后续会按歌曲 ID 同步滚动歌词" },
      ],
      lyricStatus: "linked",
    };
    storage.setItem(
      "aria-player-state",
      JSON.stringify({
        activeTrackId: stalePlaceholderTrack.id,
        activeTrackSnapshot: stalePlaceholderTrack,
        playQueueIds: [stalePlaceholderTrack.id],
        playQueueSnapshots: [stalePlaceholderTrack],
      }),
    );

    const restored = readCachedPlayerState();
    expect(restored.activeTrackSnapshot?.lyrics).toEqual([]);
    expect(restored.activeTrackSnapshot?.lyricStatus).toBe("searchable");
    expect(hasSyncedLyrics(restored.activeTrackSnapshot!)).toBe(false);
    expect(restored.playQueueSnapshots?.[0].lyrics).toEqual([]);
    expect(restored.playQueueSnapshots?.[0].lyricStatus).toBe("searchable");

    const resolvedInstrumental = {
      ...restored.activeTrackSnapshot!,
      lyrics: [],
      lyricStatus: "missing" as const,
    };
    const incomingSearchable = {
      ...restored.activeTrackSnapshot!,
      lyrics: [],
      lyricStatus: "searchable" as const,
    };
    const merged = mergeTrackRecord(resolvedInstrumental, incomingSearchable);
    expect(merged.lyricStatus).toBe("missing");
    expect(merged.lyrics).toEqual([]);
  });
});
