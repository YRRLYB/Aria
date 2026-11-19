import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const parseFileMock = vi.hoisted(() => vi.fn());
vi.mock("music-metadata", () => ({
  parseFile: parseFileMock,
}));

import { recoverJapaneseAlbumName, scanMusicFolder } from "./musicScanner";
import type { ScannedTrack } from "./types";

let tempRoot: string | null = null;

afterEach(async () => {
  parseFileMock.mockReset();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("incremental music scanner", () => {
  it("reuses cached metadata when file size and mtimeMs have not changed", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "aria-scan-"));
    const unchangedPath = path.join(tempRoot, "01-unchanged.flac");
    const addedPath = path.join(tempRoot, "02-added.flac");
    await writeFile(unchangedPath, "fake-flac-bytes-1");
    await writeFile(addedPath, "fake-flac-bytes-22");
    const unchangedStat = await stat(unchangedPath);

    parseFileMock.mockResolvedValue({
      common: { title: "Newly Parsed", artist: "Aimer", album: "Daydream", track: { no: 2 } },
      format: { duration: 245, container: "FLAC", lossless: true, sampleRate: 48_000, bitsPerSample: 24 },
    });

    const cachedTrack: ScannedTrack = {
      id: "cached-id",
      path: unchangedPath,
      title: "Cached Song",
      artist: "Aimer",
      album: "Daydream",
      duration: 210,
      quality: "Hi-Res",
      format: "FLAC",
      size: unchangedStat.size,
      mtimeMs: unchangedStat.mtimeMs,
      trackNumber: 1,
      libraryRoot: tempRoot,
    };

    const result = await scanMusicFolder(tempRoot, undefined, [cachedTrack]);
    expect(parseFileMock).toHaveBeenCalledTimes(1);
    expect(parseFileMock).toHaveBeenCalledWith(addedPath);
    expect(result.map((track) => track.title)).toEqual(["Cached Song", "Newly Parsed"]);

    // Touching the file mtime invalidates the cache and triggers re-parsing.
    const nextTime = new Date(unchangedStat.mtimeMs + 5_000);
    await utimes(unchangedPath, nextTime, nextTime);
    await scanMusicFolder(tempRoot, undefined, result);
    expect(parseFileMock).toHaveBeenCalledTimes(2);
  });

  it("recovers Japanese album names from ISO-2022-JP tags and updates filename-derived titles", async () => {
    expect(recoverJapaneseAlbumName("disc1 pianoIzQ]W`", "disc1 piano生演奏")).toBe("disc1 piano生演奏");
    expect(recoverJapaneseAlbumName("\x1b$B$R$i$,$J\x1b(B", "other")).toBe("ひらがな");
    expect(recoverJapaneseAlbumName("album $R$i$,$J", "album ひらがな")).toBe("album ひらがな");
    expect(recoverJapaneseAlbumName("Normal Album", "other")).toBe("Normal Album");

    tempRoot = await mkdtemp(path.join(os.tmpdir(), "aria-jp-scan-"));
    const albumDir = path.join(tempRoot, "disc1 piano生演奏");
    await mkdir(albumDir, { recursive: true });
    const trackPath = path.join(albumDir, "03 - 夜のピアノ.flac");
    await writeFile(trackPath, "fake-jp-flac");
    const fileStat = await stat(trackPath);

    parseFileMock.mockResolvedValue({
      common: { title: "Garbled", artist: "Artist", album: "disc1 pianoIzQ]W`", track: { no: 3 } },
      format: { duration: 190, container: "FLAC", lossless: true, sampleRate: 44_100, bitsPerSample: 16 },
    });

    const fresh = await scanMusicFolder(tempRoot);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].album).toBe("disc1 piano生演奏");
    expect(fresh[0].title).toBe("夜のピアノ");

    // Verify incremental cache hits also recover previously scanned garbled albums.
    const staleCached: ScannedTrack = {
      ...fresh[0],
      album: "disc1 pianoIzQ]W`",
      title: "Garbled",
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    };
    const recoveredFromCache = await scanMusicFolder(tempRoot, undefined, [staleCached]);
    expect(parseFileMock).toHaveBeenCalledTimes(1);
    expect(recoveredFromCache[0].album).toBe("disc1 piano生演奏");
    expect(recoveredFromCache[0].title).toBe("夜のピアノ");
  });
});
