import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parseFile } from "music-metadata";
import { readOriginalTracksForRoot } from "./libraryStore";
import { quantizeBitrate } from "./utils/bitrate";
import { recoverJapaneseAlbumName, stripTrackPrefix } from "./utils/japaneseTags";
import type { ScannedTrack } from "./types";

export { recoverJapaneseAlbumName };

const execFileAsync = promisify(execFile);

const audioExtensions = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".ape",
]);

const cdExtensions = new Set([".cda"]);

export type CdDrive = {
  drive: string;
  label: string;
};

export type CdReadQuality = "high" | "low";

export type ScanProgress = {
  phase: "discovering" | "metadata" | "complete";
  processed: number;
  total: number;
};

export async function scanMusicFolder(
  root: string,
  onProgress?: (progress: ScanProgress) => void,
  existingTracks?: ScannedTrack[],
): Promise<ScannedTrack[]> {
  const resolvedRoot = path.resolve(root);
  onProgress?.({ phase: "discovering", processed: 0, total: 0 });
  const [files, cachedTracks] = await Promise.all([
    collectAudioFiles(resolvedRoot),
    existingTracks ? Promise.resolve(existingTracks) : readOriginalTracksForRoot(resolvedRoot).catch(() => []),
  ]);
  const existingByPath = new Map<string, ScannedTrack>();
  for (const track of cachedTracks) {
    if (track.path) existingByPath.set(path.resolve(track.path), track);
  }
  onProgress?.({ phase: "metadata", processed: 0, total: files.length });
  let processed = 0;
  const tracks = await mapWithConcurrency(files, 6, async (file) => {
    const track = await readTrackMetadata(file, resolvedRoot, existingByPath);
    processed += 1;
    onProgress?.({ phase: "metadata", processed, total: files.length });
    return track;
  });

  const result = tracks.filter((track): track is ScannedTrack => Boolean(track)).sort(compareTracksForAlbum);
  onProgress?.({ phase: "complete", processed: files.length, total: files.length });
  return result;
}

export async function listCdDrives(): Promise<CdDrive[]> {
  if (process.platform !== "win32") return [];

  try {
    const command =
      "Get-CimInstance Win32_CDROMDrive | Select-Object Drive,Name,MediaLoaded | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
      timeout: 5000,
    });
    const parsed = JSON.parse(stdout.trim() || "[]") as
      | Array<{ Drive?: string; Name?: string; MediaLoaded?: boolean }>
      | { Drive?: string; Name?: string; MediaLoaded?: boolean };
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .filter((item) => typeof item.Drive === "string" && item.Drive)
      .map((item) => ({
        drive: `${String(item.Drive).replace(/\\$/, "")}\\`,
        label: String(item.Name || item.Drive || "Audio CD"),
      }));
  } catch {
    return [];
  }
}

export async function scanCdDrives(qualityMode: CdReadQuality = "high"): Promise<{ drives: CdDrive[]; tracks: ScannedTrack[] }> {
  const drives = await listCdDrives();
  const nested = await Promise.all(drives.map((drive) => scanCdDrive(drive, qualityMode)));
  const tracks = nested.flat().sort(compareTracksForAlbum);
  return { drives, tracks };
}

async function scanCdDrive(drive: CdDrive, qualityMode: CdReadQuality): Promise<ScannedTrack[]> {
  try {
    const entries = await readdir(drive.drive, { withFileTypes: true });
    const cdaFiles = entries
      .filter((entry) => entry.isFile() && cdExtensions.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    return cdaFiles.map((entry, index) => {
      const absolute = path.join(drive.drive, entry.name);
      const trackNumber = parseTrackNumber(entry.name) ?? index + 1;
      const highQuality = qualityMode === "high";
      return {
        id: createHash("sha1").update(`cd:${drive.drive}:${entry.name}`).digest("hex"),
        path: absolute,
        title: `Track ${String(trackNumber).padStart(2, "0")}`,
        artist: "Audio CD",
        album: drive.label || "Audio CD",
        albumArtist: "Audio CD",
        duration: null,
        quality: highQuality ? "Lossless" : "320K",
        format: highQuality ? "CDDA" : "CDDA Low",
        size: 0,
        bitrate: highQuality ? 1_411_200 : 705_600,
        sampleRate: highQuality ? 44_100 : 22_050,
        bpm: null,
        hasCover: false,
        trackNumber,
        discNumber: 1,
        libraryRoot: `cd:${drive.drive}`,
        mediaKind: "audio-cd",
        streamUrl: absolute,
        nativeDevice: drive.drive,
        nativeStart: `#${trackNumber}`,
        nativeEnd: trackNumber < cdaFiles.length ? `#${trackNumber + 1}` : null,
        cdReadQuality: qualityMode,
        requiresNativePlayback: true,
      };
    });
  } catch {
    return [];
  }
}

async function collectAudioFiles(dir: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectAudioFiles(absolute);
      if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
        return [absolute];
      }
      return [];
    }),
  );

  return nested.flat();
}

async function readTrackMetadata(
  filePath: string,
  libraryRoot: string,
  existingByPath?: Map<string, ScannedTrack>,
): Promise<ScannedTrack | null> {
  try {
    const resolvedFilePath = path.resolve(filePath);
    const fileStat = await stat(filePath);
    const folder = path.basename(path.dirname(resolvedFilePath));
    const filename = path.basename(filePath, path.extname(filePath));
    const cached = existingByPath?.get(resolvedFilePath);
    if (
      cached &&
      cached.size === fileStat.size &&
      typeof cached.mtimeMs === "number" &&
      Math.abs(cached.mtimeMs - fileStat.mtimeMs) < 1
    ) {
      const recoveredAlbum = recoverJapaneseAlbumName(cached.album, folder);
      const nextTitle = recoveredAlbum !== cached.album ? stripTrackPrefix(filename) : cached.title;
      return {
        ...cached,
        album: recoveredAlbum,
        title: nextTitle,
        libraryRoot,
        mtimeMs: fileStat.mtimeMs,
      };
    }

    const metadata = await parseFile(filePath);
    const common = metadata.common;
    const format = metadata.format;
    const rawAlbum = common.album || "Unknown Album";
    const album = recoverJapaneseAlbumName(rawAlbum, folder);
    const title = album !== rawAlbum ? stripTrackPrefix(filename) : common.title || filename;

    return {
      id: createHash("sha1").update(filePath).digest("hex"),
      path: filePath,
      title,
      artist: common.artist || common.albumartist || "Unknown Artist",
      album,
      albumArtist: common.albumartist || common.artist || null,
      duration: typeof format.duration === "number" ? format.duration : null,
      quality: detectQuality(filePath, {
        bitsPerSample: format.bitsPerSample,
        bitrate: format.bitrate,
        lossless: format.lossless,
        sampleRate: format.sampleRate,
      }),
      format: format.container || path.extname(filePath).slice(1).toUpperCase(),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      bitrate: typeof format.bitrate === "number" ? quantizeBitrate(format.bitrate) : null,
      sampleRate: typeof format.sampleRate === "number" ? format.sampleRate : null,
      bpm: null,
      hasCover: Boolean(common.picture?.length),
      trackNumber: typeof common.track?.no === "number" ? common.track.no : null,
      discNumber: typeof common.disk?.no === "number" ? common.disk.no : null,
      libraryRoot,
      mediaKind: "file",
      streamUrl: null,
      nativeDevice: null,
      nativeStart: null,
      nativeEnd: null,
      requiresNativePlayback: false,
    };
  } catch {
    return null;
  }
}

function parseTrackNumber(name: string) {
  const match = name.match(/(\d+)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function compareTracksForAlbum(a: ScannedTrack, b: ScannedTrack) {
  const albumCompare = `${a.albumArtist || a.artist} ${a.album}`.localeCompare(
    `${b.albumArtist || b.artist} ${b.album}`,
    "zh-CN",
  );
  if (albumCompare !== 0) return albumCompare;
  const discCompare = (a.discNumber ?? 0) - (b.discNumber ?? 0);
  if (discCompare !== 0) return discCompare;
  const trackCompare = (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999);
  if (trackCompare !== 0) return trackCompare;
  return a.title.localeCompare(b.title, "zh-CN");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function detectQuality(
  filePath: string,
  format: { bitsPerSample?: number; bitrate?: number; lossless?: boolean; sampleRate?: number },
) {
  const extension = path.extname(filePath).toLowerCase();
  if ((format.bitsPerSample && format.bitsPerSample >= 24) || (format.sampleRate && format.sampleRate >= 88_200)) {
    return "Hi-Res";
  }
  if (format.lossless || extension === ".flac" || extension === ".wav" || extension === ".ape") return "Lossless";
  if (format.bitrate && format.bitrate >= 900_000) return "Lossless";
  if (format.bitrate && format.bitrate >= 256_000) return "320K";
  return "320K";
}
