import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { directory } = vi.hoisted(() => ({ directory: `${process.env.TEMP || process.env.TMP || "."}/aria-library-metadata-${Date.now()}-${Math.random().toString(36).slice(2)}` }));
vi.mock("./utils/paths", () => ({ dataDir: directory }));
import { readLibrary, replaceLibraryRoot, writeLibrary } from "./libraryStore";
import { localMetadataStore } from "./localMetadataStore";
import { updateStore } from "./store";
import type { ScannedTrack } from "./types";

const root = path.resolve("test-music-a");
const song: ScannedTrack = { id: "a", path: path.join(root, "original.flac"), libraryRoot: root, title: "Original", artist: "Unknown Artist", album: "Unknown Album", duration: 180, quality: "FLAC", format: "flac", size: 1000 };
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("metadata integration with the scanned library", () => {
  it("returns matched titles for search while keeping the original tags recoverable", async () => {
    await writeLibrary({ tracks: [song], roots: [root], updatedAt: null });
    const undoId = await localMetadataStore.apply({ a: { candidateId: "netease:1", title: "Matched", artist: "Alice", updatedAt: "now" } }, {});
    expect((await readLibrary()).tracks[0].title).toBe("Matched");
    const otherRoot = path.resolve("test-music-b");
    await replaceLibraryRoot(otherRoot, [{ ...song, id: "b", title: "Other", libraryRoot: otherRoot, path: path.join(otherRoot, "other.flac") }]);
    expect((await readLibrary()).tracks.find((track) => track.id === "a")?.artist).toBe("Alice");
    await localMetadataStore.undo(undoId);
    const restored = (await readLibrary()).tracks.find((track) => track.id === "a");
    expect(restored?.title).toBe("Original");
    expect(restored?.artist).toBe("Unknown Artist");
  });
  it("keeps a previous match after re-scanning the same root", async () => {
    await writeLibrary({ tracks: [song], roots: [root], updatedAt: null });
    await localMetadataStore.apply({ a: { candidateId: "netease:1", title: "Matched", updatedAt: "now" } }, {});
    const rescanned = await replaceLibraryRoot(root, [song]);
    expect(rescanned.tracks[0].title).toBe("Matched");
    expect(rescanned.tracks[0].metadata?.candidateId).toBe("netease:1");
  });
  it("lets a subsequent manual lyric binding replace batch lyrics after restart", async () => {
    await writeLibrary({ tracks: [song], roots: [root], updatedAt: null });
    await localMetadataStore.apply({ a: { candidateId: "netease:1", lyricCandidateId: "netease:1", title: "Matched", lyrics: [{ time: "00:01", text: "Old batch words" }], updatedAt: "now" } }, {});
    await updateStore((store) => ({ ...store, lyricBindings: { a: "netease:1" } }));
    expect((await readLibrary()).tracks[0].metadata?.lyrics?.[0].text).toBe("Old batch words");
    await updateStore((store) => ({ ...store, lyricBindings: { a: "netease:manual" } }));
    const refreshed = (await readLibrary()).tracks[0];
    expect(refreshed.metadata?.lyrics).toBeUndefined();
    expect(refreshed.title).toBe("Matched");
    // A later metadata-only match must not change which song owns the lyrics.
    await localMetadataStore.apply({ a: { candidateId: "netease:2", title: "New information", updatedAt: "later" } }, {});
    await updateStore((store) => ({ ...store, lyricBindings: { a: "netease:1" } }));
    expect((await readLibrary()).tracks[0].metadata?.lyrics?.[0].text).toBe("Old batch words");
  });
});
