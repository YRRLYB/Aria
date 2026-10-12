import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCachedQueueSnapshots,
  formatAudioDetail,
  formatBitrate,
  formatDuration,
  formatSampleRate,
  hasSyncedLyrics,
  mergeTracks,
  normalizeQuality,
  parseDuration,
  readCachedAudioSettings,
  readCachedPlayerState,
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
  });

  it("persists master quality independently and defaults legacy audio settings to disabled", () => {
    const storage = mockLocalStorage();
    storage.setItem("aria-audio-settings", JSON.stringify({ hifiEnabled: true }));
    expect(readCachedAudioSettings().masterQualityEnabled).toBe(false);
    writeCachedAudioSettings({ sinkId: "default", hifiEnabled: true, masterQualityEnabled: true, gaplessEnabled: false, exclusiveMode: false, outputMode: "system" });
    expect(readCachedAudioSettings()).toMatchObject({ hifiEnabled: true, masterQualityEnabled: true });
    writeCachedAudioSettings({ sinkId: "default", hifiEnabled: true, masterQualityEnabled: false, gaplessEnabled: false, exclusiveMode: false, outputMode: "system" });
    expect(readCachedAudioSettings()).toMatchObject({ hifiEnabled: true, masterQualityEnabled: false });
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
});
