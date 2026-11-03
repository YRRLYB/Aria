import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import {
  NETEASE_SNAPSHOT_STORAGE_KEY,
  clearNeteaseSnapshot,
  readNeteaseSnapshot,
  sanitizeNeteaseSnapshot,
  writeNeteaseSnapshot,
} from "./neteaseSnapshot";

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function track(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `歌曲 ${id}`,
    artist: "歌手",
    album: "专辑",
    duration: "03:00",
    quality: "320K",
    source: "netease",
    cover: "linear-gradient(135deg, #e4ddf5 0%, #8680b4 50%, #202036 100%)",
    accent: "#8680b4",
    waveform: Array.from({ length: 48 }, (_, index) => index),
    lyricStatus: "searchable",
    lyrics: [{ time: "00:00", text: "第一句" }],
    ...overrides,
  };
}

function playlist(id: string): ProviderPlaylist {
  return {
    id,
    name: `歌单 ${id}`,
    trackCount: 3,
    subscribed: false,
    ownerId: "7",
    owned: true,
    canEdit: true,
    coverColor: "#8680b4",
    coverUrl: "https://p1.music.126.net/cover.jpg",
    tags: ["流行"],
  };
}

describe("NetEase startup snapshot", () => {
  it("compacts large track fields and restores the first-screen state", () => {
    const storage = createStorage();
    expect(writeNeteaseSnapshot({
      userId: "7",
      dailyTracks: [track("a")],
      roamTracks: [track("b")],
      likedTracks: [track("c")],
      neteaseTracks: [track("d")],
      playlists: [playlist("p1")],
    }, storage)).toBe(true);

    const raw = storage.values.get(NETEASE_SNAPSHOT_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("第一句");
    expect(raw).not.toContain("[0,1,2,3,4,5,6,7,8,9,10,11,12");

    const snapshot = readNeteaseSnapshot(storage);
    expect(snapshot).toMatchObject({ version: 1, userId: "7" });
    expect(snapshot?.dailyTracks[0]).toMatchObject({ id: "a", source: "netease", lyrics: [] });
    expect(snapshot?.dailyTracks[0].waveform).toHaveLength(12);
    expect(snapshot?.playlists).toEqual([playlist("p1")]);
  });

  it("drops malformed entries and snapshots older than two weeks", () => {
    const storage = createStorage();
    const snapshot = {
      version: 1,
      userId: "7",
      savedAt: Date.now() - 15 * 24 * 60 * 60_000,
      dailyTracks: [track("a")],
      roamTracks: [],
      likedTracks: [],
      neteaseTracks: [],
      playlists: [],
    };
    storage.setItem(NETEASE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    expect(readNeteaseSnapshot(storage)).toBeNull();

    snapshot.savedAt = Date.now();
    snapshot.dailyTracks = [null, { id: "ok" }, { title: "missing id" }] as never;
    storage.setItem(NETEASE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    expect(readNeteaseSnapshot(storage)?.dailyTracks).toEqual([]);
    expect(sanitizeNeteaseSnapshot({ version: 2 })).toBeNull();
  });

  it("clears the snapshot on sign-out and tolerates unavailable storage", () => {
    const storage = createStorage();
    writeNeteaseSnapshot({
      userId: null,
      dailyTracks: [track("a")],
      roamTracks: [],
      likedTracks: [],
      neteaseTracks: [],
      playlists: [],
    }, storage);
    clearNeteaseSnapshot(storage);
    expect(readNeteaseSnapshot(storage)).toBeNull();
    expect(readNeteaseSnapshot(null)).toBeNull();
    expect(writeNeteaseSnapshot({
      userId: null,
      dailyTracks: [],
      roamTracks: [],
      likedTracks: [],
      neteaseTracks: [],
      playlists: [],
    }, null)).toBe(false);
  });

  it("does not persist lyrics or oversized playlists", () => {
    const storage = createStorage();
    const setItem = vi.spyOn(storage, "setItem");
    writeNeteaseSnapshot({
      userId: "7",
      dailyTracks: Array.from({ length: 500 }, (_, index) => track(`d${index}`)),
      roamTracks: [],
      likedTracks: [],
      neteaseTracks: [],
      playlists: Array.from({ length: 240 }, (_, index) => playlist(`p${index}`)),
    }, storage);
    const snapshot = readNeteaseSnapshot(storage);
    expect(snapshot?.dailyTracks).toHaveLength(400);
    expect(snapshot?.playlists).toHaveLength(200);
    expect(setItem).toHaveBeenCalledOnce();
  });
});
