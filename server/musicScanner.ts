import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseFile } from "music-metadata";
import type { ScannedTrack } from "./types";

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

export async function scanMusicFolder(root: string): Promise<ScannedTrack[]> {
  const resolvedRoot = path.resolve(root);
  const files = await collectAudioFiles(resolvedRoot);
  const tracks = await mapWithConcurrency(files, 6, (file) => readTrackMetadata(file, resolvedRoot));

  return tracks.filter((track): track is ScannedTrack => Boolean(track)).sort(compareTracksForAlbum);
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

export async function scanCdDrives(): Promise<{ drives: CdDrive[]; tracks: ScannedTrack[] }> {
  const drives = await listCdDrives();
  const nested = await Promise.all(drives.map((drive) => scanCdDrive(drive)));
  const tracks = nested.flat().sort(compareTracksForAlbum);
  return { drives, tracks };
}

async function scanCdDrive(drive: CdDrive): Promise<ScannedTrack[]> {
  try {
    const entries = await readdir(drive.drive, { withFileTypes: true });
    const cdaFiles = entries
      .filter((entry) => entry.isFile() && cdExtensions.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    return cdaFiles.map((entry, index) => {
      const absolute = path.join(drive.drive, entry.name);
      const trackNumber = parseTrackNumber(entry.name) ?? index + 1;
      return {
        id: createHash("sha1").update(`cd:${drive.drive}:${entry.name}`).digest("hex"),
        path: absolute,
        title: `Track ${String(trackNumber).padStart(2, "0")}`,
        artist: "Audio CD",
        album: drive.label || "Audio CD",
        albumArtist: "Audio CD",
        duration: null,
        quality: "Lossless",
        format: "CDDA",
        size: 0,
        bitrate: 1_411_200,
        sampleRate: 44_100,
        bpm: null,
        hasCover: false,
        trackNumber,
        discNumber: 1,
        libraryRoot: `cd:${drive.drive}`,
        mediaKind: "audio-cd",
        streamUrl: "cdda://",
        nativeDevice: drive.drive,
        nativeStart: `#${trackNumber}`,
        nativeEnd: trackNumber < cdaFiles.length ? `#${trackNumber + 1}` : null,
        requiresNativePlayback: true,
      };
    });
  } catch {
    return [];
  }
}

async function collectAudioFiles(dir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
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

async function readTrackMetadata(filePath: string, libraryRoot: string): Promise<ScannedTrack | null> {
  try {
    const [metadata, fileStat] = await Promise.all([parseFile(filePath), stat(filePath)]);
    const common = metadata.common;
    const format = metadata.format;
    const filename = path.basename(filePath, path.extname(filePath));

    return {
      id: createHash("sha1").update(filePath).digest("hex"),
      path: filePath,
      title: common.title || filename,
      artist: common.artist || common.albumartist || "Unknown Artist",
      album: common.album || "Unknown Album",
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
      bitrate: typeof format.bitrate === "number" ? Math.round(format.bitrate) : null,
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
