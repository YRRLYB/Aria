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
  ".cda",
]);

type ParsedMetadata = Awaited<ReturnType<typeof parseFile>>;

export type ScanMusicOptions = {
  libraryRoot?: string;
  cdDeviceId?: string | null;
  albumFallback?: string | null;
};

export type CdDriveInfo = {
  deviceId: string;
  volumeName: string | null;
  rootPath: string;
};

export async function scanMusicFolder(root: string, options: ScanMusicOptions = {}): Promise<ScannedTrack[]> {
  const resolvedRoot = path.resolve(root);
  const libraryRoot = options.libraryRoot ?? resolvedRoot;
  const files = await collectAudioFiles(resolvedRoot);
  const tracks = await Promise.all(
    files.map((filePath) =>
      readTrackMetadata(filePath, {
        ...options,
        libraryRoot,
      }),
    ),
  );

  return sortScannedTracks(tracks.filter((track): track is ScannedTrack => Boolean(track)));
}

export async function scanCdDrives(): Promise<Array<{ drive: CdDriveInfo; tracks: ScannedTrack[] }>> {
  const drives = await listCdDrives();
  return Promise.all(
    drives.map(async (drive) => ({
      drive,
      tracks: await scanMusicFolder(drive.rootPath, {
        libraryRoot: `cd:${drive.deviceId}`,
        cdDeviceId: drive.deviceId,
        albumFallback: drive.volumeName || `光盘 ${drive.deviceId}`,
      }),
    })),
  );
}

export async function listCdDrives(): Promise<CdDriveInfo[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=5\" | Select-Object DeviceID,VolumeName | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(String(stdout || "null")) as
      | { DeviceID?: string; VolumeName?: string | null }
      | Array<{ DeviceID?: string; VolumeName?: string | null }>
      | null;
    const entries = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return entries
      .map((entry) => {
        const deviceId = normalizeDriveId(entry.DeviceID);
        if (!deviceId) return null;
        return {
          deviceId,
          volumeName: normalizeText(entry.VolumeName),
          rootPath: `${deviceId}\\`,
        } satisfies CdDriveInfo;
      })
      .filter((entry): entry is CdDriveInfo => Boolean(entry));
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
      if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) return [absolute];
      return [];
    }),
  );

  return nested.flat();
}

async function readTrackMetadata(filePath: string, options: ScanMusicOptions): Promise<ScannedTrack | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".cda" && options.cdDeviceId) {
    return buildCdTrack(filePath, options);
  }

  try {
    const [metadata, fileStat] = await Promise.all([parseFile(filePath), stat(filePath)]);
    return buildFileTrack(filePath, fileStat.size, metadata.common, metadata.format, options);
  } catch {
    return null;
  }
}

function buildFileTrack(
  filePath: string,
  size: number,
  common: ParsedMetadata["common"],
  format: ParsedMetadata["format"],
  options: ScanMusicOptions,
): ScannedTrack {
  const filename = path.basename(filePath, path.extname(filePath));
  const title = normalizeText(common.title) ?? normalizeFilenameTitle(filename) ?? filename;
  const artist =
    normalizeText(common.artist) ??
    normalizeText(common.artists) ??
    normalizeFilenameArtist(filename) ??
    "未知艺术家";
  const album = normalizeText(common.album) ?? options.albumFallback ?? inferAlbumFromPath(filePath) ?? "未知专辑";
  const albumArtist = normalizeText(common.albumartist) ?? normalizeText(common.artist) ?? normalizeText(common.artists);
  const trackNumber = normalizeNumeric(common.track?.no) ?? inferTrackNumber(filename);
  const discNumber = normalizeNumeric(common.disk?.no) ?? inferDiscNumber(filePath);
  const fileExtension = path.extname(filePath).slice(1).toUpperCase();

  return {
    id: createHash("sha1").update(filePath).digest("hex"),
    path: filePath,
    libraryRoot: options.libraryRoot ?? path.resolve(path.dirname(filePath)),
    title,
    artist,
    album,
    albumArtist,
    duration: typeof format.duration === "number" ? format.duration : null,
    quality: detectQuality(filePath, {
      bitsPerSample: format.bitsPerSample,
      bitrate: format.bitrate,
      lossless: format.lossless,
      sampleRate: format.sampleRate,
    }),
    format: format.container || fileExtension,
    size,
    trackNumber,
    discNumber,
    bitrate: typeof format.bitrate === "number" ? Math.round(format.bitrate) : null,
    sampleRate: typeof format.sampleRate === "number" ? format.sampleRate : null,
    bpm: null,
    hasCover: Boolean(common.picture?.length),
    streamUrl: null,
    mediaKind: "file",
    nativeStart: null,
    nativeEnd: null,
    requiresNativePlayback: false,
  };
}

function buildCdTrack(filePath: string, options: ScanMusicOptions): ScannedTrack | null {
  const filename = path.basename(filePath, path.extname(filePath));
  const trackNumber = inferTrackNumber(filename);
  const deviceId = normalizeDriveId(options.cdDeviceId || path.parse(filePath).root);
  if (!deviceId) return null;

  const albumName = options.albumFallback || `光盘 ${deviceId}`;

  return {
    id: createHash("sha1").update(`cdda:${deviceId}:${filePath}`).digest("hex"),
    path: filePath,
    libraryRoot: options.libraryRoot ?? `cd:${deviceId}`,
    title: normalizeFilenameTitle(filename) || `Track ${String(trackNumber ?? 0).padStart(2, "0")}`,
    artist: "音频光盘",
    album: albumName,
    albumArtist: albumName,
    duration: null,
    quality: "Lossless",
    format: "CDA",
    size: 0,
    trackNumber,
    discNumber: 1,
    bitrate: 1411000,
    sampleRate: 44100,
    bpm: null,
    hasCover: false,
    streamUrl: `cdda://${deviceId}`,
    mediaKind: "audio-cd",
    nativeStart: trackNumber ? `#${trackNumber}` : null,
    nativeEnd: trackNumber ? `#${trackNumber + 1}` : null,
    requiresNativePlayback: true,
  };
}

function sortScannedTracks(tracks: ScannedTrack[]) {
  return [...tracks].sort((left, right) => {
    const artistCompare = (left.albumArtist ?? left.artist).localeCompare(right.albumArtist ?? right.artist, "zh-CN", {
      numeric: true,
    });
    if (artistCompare !== 0) return artistCompare;
    const albumCompare = left.album.localeCompare(right.album, "zh-CN", { numeric: true });
    if (albumCompare !== 0) return albumCompare;
    const discCompare = (left.discNumber ?? 0) - (right.discNumber ?? 0);
    if (discCompare !== 0) return discCompare;
    const trackCompare = (left.trackNumber ?? Number.MAX_SAFE_INTEGER) - (right.trackNumber ?? Number.MAX_SAFE_INTEGER);
    if (trackCompare !== 0) return trackCompare;
    return left.title.localeCompare(right.title, "zh-CN", { numeric: true });
  });
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

function inferAlbumFromPath(filePath: string) {
  const parent = path.basename(path.dirname(filePath));
  if (!parent) return null;
  if (/^(cd|disc|disk)\s*[0-9一二三四五六七八九十]+$/i.test(parent)) {
    const grandParent = path.basename(path.dirname(path.dirname(filePath)));
    return grandParent || parent;
  }
  return parent;
}

function inferTrackNumber(value: string) {
  const match = value.match(/(?:^|[^\d])(\d{1,3})(?:[\s._-]+|$)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function inferDiscNumber(filePath: string) {
  const segments = path.dirname(filePath).split(path.sep).reverse();
  for (const segment of segments) {
    const match = segment.match(/^(?:cd|disc|disk)[\s._-]*([0-9一二三四五六七八九十]+)/i);
    if (!match) continue;
    const number = parseDiscToken(match[1]);
    if (number) return number;
  }
  return null;
}

function parseDiscToken(value: string) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const numerals: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (numerals[value]) return numerals[value];
  if (value.includes("十")) {
    const [tensText, onesText] = value.split("十");
    const tens = tensText ? numerals[tensText] ?? 0 : 1;
    const ones = onesText ? numerals[onesText] ?? 0 : 0;
    const number = tens * 10 + ones;
    return number > 0 ? number : null;
  }
  return null;
}

function normalizeNumeric(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function normalizeText(value?: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).find((item): item is string => Boolean(item)) ?? null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeFilenameTitle(value: string) {
  return (
    value
      .replace(/^[\s._-]*/, "")
      .replace(/^\d{1,3}[\s._-]*/, "")
      .trim() || null
  );
}

function normalizeFilenameArtist(value: string) {
  const match = value.match(/^(.*?)\s*[-–—]\s*.+$/u);
  if (!match) return null;
  const artist = match[1]?.trim();
  return artist || null;
}

function normalizeDriveId(value?: string | null) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[\\/]+$/g, "");
  if (!trimmed) return null;
  if (/^[a-z]:$/i.test(trimmed)) return `${trimmed[0].toUpperCase()}:`;
  const driveMatch = trimmed.match(/^([a-z]):/i);
  if (driveMatch) return `${driveMatch[1].toUpperCase()}:`;
  return trimmed;
}
