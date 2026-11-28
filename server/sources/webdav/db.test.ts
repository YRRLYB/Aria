import { describe, expect, it } from "vitest";
import { WebdavIndexDb } from "./db";

describe("WebdavIndexDb", () => {
  it("upserts, deduplicates incrementally, searches, and prunes removed paths", () => {
    const db = new WebdavIndexDb(":memory:");
    db.upsertTracks([
      {
        id: "t1",
        instanceId: "dav-1",
        remotePath: "/HiRes/TrackOne.flac",
        etag: "etag-1",
        fileSize: 32_000_000,
        title: "Track One",
        artist: "Artist A",
        album: "Album Alpha",
        durationMs: 245_000,
        sampleRate: 96_000,
        bitDepth: 24,
        bitrateKbps: 2800,
        format: "flac",
        lyricPath: "/HiRes/TrackOne.lrc",
        coverPath: "/HiRes/cover.jpg",
        updatedAt: 1000,
      },
      {
        id: "t2",
        instanceId: "dav-1",
        remotePath: "/Pop/SongTwo.mp3",
        etag: "etag-2",
        fileSize: 8_000_000,
        title: "Song Two",
        artist: "Artist B",
        album: "Album Beta",
        durationMs: 180_000,
        sampleRate: 44_100,
        bitDepth: 16,
        bitrateKbps: 320,
        format: "mp3",
        lyricPath: null,
        coverPath: null,
        updatedAt: 2000,
      },
    ]);

    expect(db.countByInstance("dav-1")).toBe(2);
    expect(db.getTrackById("t1")?.title).toBe("Track One");
    expect(db.getExistingEtags("dav-1").get("/HiRes/TrackOne.flac")?.etag).toBe("etag-1");

    const found = db.searchTracks("Track One", 10, 0, ["dav-1"]);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("t1");

    const pruned = db.pruneMissingPaths("dav-1", new Set(["/HiRes/TrackOne.flac"]));
    expect(pruned).toBe(1);
    expect(db.countByInstance("dav-1")).toBe(1);
    expect(db.getTrackById("t2")).toBeNull();
    db.close();
  });
});
