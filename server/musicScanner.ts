import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseFile, type IAudioMetadata } from "music-metadata";
import type { ScannedTrack } from "./types";

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

export async function scanMusicFolder(root: string): Promise<ScannedTrack[]> {
  const resolvedRoot = path.resolve(root);
  const files = await collectAudioFiles(resolvedRoot);
  const tracks = await Promise.all(files.map(readTrackMetadata));

  return tracks
    .filter((track): track is ScannedTrack => Boolean(track))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

async function collectAudioFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
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

async function readTrackMetadata(filePath: string): Promise<ScannedTrack | null> {
  try {
    const [metadata, fileStat] = await Promise.all([parseFile(filePath), stat(filePath)]);
    const common = metadata.common;
    const format = metadata.format;
    const filename = path.basename(filePath, path.extname(filePath));

    return {
      id: createHash("sha1").update(filePath).digest("hex"),
      path: filePath,
      title: common.title || filename,
      artist: common.artist || "未知艺人",
      album: common.album || "未知专辑",
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
      bpm: extractBpm(metadata),
      hasCover: Boolean(common.picture?.length),
    };
  } catch {
    return null;
  }
}

function extractBpm(metadata: IAudioMetadata) {
  const candidates: unknown[] = [metadata.common.bpm];
  const bpmTagIds = new Set(["bpm", "tbpm", "tbp", "tmpo", "wm/beatsperminute", "beatsperminute"]);

  for (const tags of Object.values(metadata.native)) {
    for (const tag of tags) {
      if (bpmTagIds.has(String(tag.id).toLowerCase())) {
        candidates.push(tag.value);
      }
    }
  }

  for (const candidate of candidates) {
    const bpm = parseBpmValue(candidate);
    if (bpm) return bpm;
  }

  return null;
}

function parseBpmValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeBpm(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const bpm = parseBpmValue(item);
      if (bpm) return bpm;
    }
    return null;
  }

  if (typeof value === "object" && value !== null) {
    for (const key of ["text", "value", "description"]) {
      const bpm = parseBpmValue((value as Record<string, unknown>)[key]);
      if (bpm) return bpm;
    }
    return null;
  }

  if (typeof value !== "string") return null;
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  return normalizeBpm(Number.parseFloat(match[0]));
}

function normalizeBpm(value: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 40 && rounded <= 260 ? rounded : null;
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
