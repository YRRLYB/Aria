import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/music";
import {
  LOCAL_PLAYLISTS_STORAGE_KEY,
  createLocalPlaylist,
  readLocalPlaylists,
  resolveLocalPlaylistTracks,
  sanitizeLocalPlaylists,
  writeLocalPlaylists,
} from "./localPlaylists";

describe("local playlists", () => {
  it("creates a named playlist and de-duplicates initial tracks", () => {
    const playlist = createLocalPlaylist("  杰伦与神秘歌曲  ", ["a", "a", "b"], 123);
    expect(playlist).toMatchObject({ name: "杰伦与神秘歌曲", trackIds: ["a", "b"], createdAt: 123, updatedAt: 123 });
    expect(playlist.id).toMatch(/^local-playlist:/);
  });

  it("discards malformed persisted entries and invalid track ids", () => {
    expect(sanitizeLocalPlaylists([
      null,
      { id: "valid", name: "  本地  ", trackIds: ["a", "a", 2, "", "b"], createdAt: 1, updatedAt: 2 },
      { name: "missing id" },
    ])).toEqual([{ id: "valid", name: "本地", trackIds: ["a", "b"], createdAt: 1, updatedAt: 2 }]);
    expect(sanitizeLocalPlaylists({ playlists: [] })).toEqual([]);
  });

  it("reads and writes only playlist metadata, not large track snapshots", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    const playlist = createLocalPlaylist("离线收藏", ["local:a"], 10);
    expect(writeLocalPlaylists([playlist], storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(LOCAL_PLAYLISTS_STORAGE_KEY, expect.any(String));
    expect(values.get(LOCAL_PLAYLISTS_STORAGE_KEY)).not.toContain("streamUrl");
    expect(readLocalPlaylists(storage)).toEqual([playlist]);
  });

  it("recovers from broken JSON and storage write failures", () => {
    expect(readLocalPlaylists({ getItem: () => "{broken", setItem: () => undefined })).toEqual([]);
    expect(writeLocalPlaylists([], { getItem: () => null, setItem: () => { throw new Error("quota"); } })).toBe(false);
  });

  it("resolves tracks in playlist order and skips files missing from the library", () => {
    const tracks = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ] as Track[];
    const playlist = createLocalPlaylist("顺序", ["b", "missing", "a"]);
    expect(resolveLocalPlaylistTracks(playlist, tracks).map((track) => track.id)).toEqual(["b", "a"]);
    expect(resolveLocalPlaylistTracks(null, tracks)).toEqual([]);
  });
});
