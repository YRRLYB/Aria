import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
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
      quality: detectQuality(filePath, format.bitsPerSample),
      format: format.container || path.extname(filePath).slice(1).toUpperCase(),
      size: fileStat.size,
    };
  } catch {
    return null;
  }
}

function detectQuality(filePath: string, bitsPerSample?: number) {
  const extension = path.extname(filePath).toLowerCase();
  if (bitsPerSample && bitsPerSample >= 24) return "Hi-Res";
  if (extension === ".flac" || extension === ".wav" || extension === ".ape") return "Lossless";
  return "320K";
}
