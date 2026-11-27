import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalMetadataOverride } from "../src/lib/localMetadata";
import type { ScannedTrack } from "./types";
import { dataDir } from "./utils/paths";
import { recoverJapaneseAlbumName, stripTrackPrefix } from "./utils/japaneseTags";
import { localMetadataStore } from "./localMetadataStore";
import { readStore } from "./store";

const libraryPath = path.join(dataDir, "library.json");

export type LibraryIndex = {
  updatedAt: string | null;
  roots: string[];
  tracks: ScannedTrack[];
};

const defaultLibrary: LibraryIndex = {
  updatedAt: null,
  roots: [],
  tracks: [],
};

let rawLibraryCache: { mtimeMs: number; size: number; parsed: LibraryIndex } | null = null;
let mergedLibraryCache: {
  raw: LibraryIndex;
  overrides: Record<string, LocalMetadataOverride>;
  lyricBindings: Record<string, string>;
  library: LibraryIndex;
  byId: Map<string, ScannedTrack>;
} | null = null;
let pendingWrite: Promise<unknown> = Promise.resolve();

async function readRawLibrary(): Promise<LibraryIndex> {
  await pendingWrite.catch(() => undefined);
  try {
    const fileStat = await stat(libraryPath);
    if (
      rawLibraryCache &&
      rawLibraryCache.size === fileStat.size &&
      Math.abs(rawLibraryCache.mtimeMs - fileStat.mtimeMs) < 1
    ) {
      return rawLibraryCache.parsed;
    }
    const raw = await readFile(libraryPath, "utf8");
    const parsedJson = JSON.parse(raw) as Partial<LibraryIndex>;
    const parsed: LibraryIndex = {
      updatedAt: parsedJson.updatedAt ?? null,
      roots: parsedJson.roots ?? [],
      tracks: parsedJson.tracks ?? [],
    };
    rawLibraryCache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, parsed };
    return parsed;
  } catch {
    rawLibraryCache = null;
    return defaultLibrary;
  }
}

async function resolveLibraryWithIndex(): Promise<{ library: LibraryIndex; byId: Map<string, ScannedTrack> }> {
  const [raw, metadata, store] = await Promise.all([
    readRawLibrary(),
    localMetadataStore.read(),
    readStore(),
  ]);
  if (raw === defaultLibrary) {
    mergedLibraryCache = null;
    return { library: defaultLibrary, byId: new Map() };
  }
  if (
    mergedLibraryCache &&
    mergedLibraryCache.raw === raw &&
    mergedLibraryCache.overrides === metadata.overrides &&
    mergedLibraryCache.lyricBindings === store.lyricBindings
  ) {
    return { library: mergedLibraryCache.library, byId: mergedLibraryCache.byId };
  }

  const byId = new Map<string, ScannedTrack>();
  const tracks = raw.tracks.map((track) => {
    let override = metadata.overrides[track.id];
    if (override?.lyrics?.length && store.lyricBindings[track.id] !== (override.lyricCandidateId ?? override.candidateId)) {
      override = { ...override, lyrics: undefined };
    }
    const folder = track.path && track.mediaKind !== "audio-cd" ? path.basename(path.dirname(track.path)) : "";
    const recoveredAlbum = folder ? recoverJapaneseAlbumName(track.album, folder) : track.album;
    const recoveredTitle =
      recoveredAlbum !== track.album && track.path
        ? stripTrackPrefix(path.basename(track.path, path.extname(track.path)))
        : track.title;
    const merged: ScannedTrack = {
      ...track,
      title: override?.title ?? recoveredTitle,
      artist: override?.artist ?? track.artist,
      album: override?.album ?? recoveredAlbum,
      metadata: override,
    };
    byId.set(merged.id, merged);
    return merged;
  });
  const library: LibraryIndex = {
    updatedAt: raw.updatedAt,
    roots: raw.roots,
    tracks,
  };
  mergedLibraryCache = {
    raw,
    overrides: metadata.overrides,
    lyricBindings: store.lyricBindings,
    library,
    byId,
  };
  return { library, byId };
}

export async function readLibrary(): Promise<LibraryIndex> {
  return (await resolveLibraryWithIndex()).library;
}

export function writeLibrary(library: LibraryIndex): Promise<void> {
  const operation = pendingWrite.catch(() => undefined).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const temporary = `${libraryPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(library, null, 2), "utf8");
    await rename(temporary, libraryPath);
    try {
      const fileStat = await stat(libraryPath);
      const normalized: LibraryIndex = {
        updatedAt: library.updatedAt ?? null,
        roots: library.roots ?? [],
        tracks: library.tracks ?? [],
      };
      rawLibraryCache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, parsed: normalized };
    } catch {
      rawLibraryCache = null;
    }
    mergedLibraryCache = null;
  });
  pendingWrite = operation;
  return operation;
}

async function readOriginalTracks() {
  return (await readRawLibrary()).tracks;
}

export async function readOriginalTracksForRoot(root: string): Promise<ScannedTrack[]> {
  const normalizedRoot = normalizeLibraryRoot(root);
  const tracks = await readOriginalTracks();
  return tracks.filter((track) => trackMatchesRoot(track, normalizedRoot));
}

export async function replaceLibraryRoot(root: string, tracks: ScannedTrack[]) {
  const current = await readRawLibrary();
  const normalizedRoot = normalizeLibraryRoot(root);
  const normalizedTracks = tracks.map((track) => ({
    ...track,
    libraryRoot: track.libraryRoot ?? normalizedRoot,
  }));
  const nextTracks = [
    ...current.tracks.filter((track) => !trackMatchesRoot(track, normalizedRoot)),
    ...normalizedTracks,
  ];
  const roots = Array.from(
    new Set([...current.roots.filter((item) => normalizeLibraryRoot(item) !== normalizedRoot), normalizedRoot]),
  );
  const next: LibraryIndex = {
    updatedAt: new Date().toISOString(),
    roots,
    tracks: nextTracks,
  };
  await writeLibrary(next);
  return readLibrary();
}

export async function removeLibraryRoot(root: string) {
  const normalizedRoot = normalizeLibraryRoot(root);
  const current = await readRawLibrary();
  const next: LibraryIndex = {
    updatedAt: new Date().toISOString(),
    roots: current.roots.filter((item) => normalizeLibraryRoot(item) !== normalizedRoot),
    tracks: current.tracks.filter((track) => !trackMatchesRoot(track, normalizedRoot)),
  };
  await writeLibrary(next);
  return readLibrary();
}

export function normalizeLibraryRoot(root: string) {
  return root.startsWith("cd:") ? root : path.resolve(root);
}

function trackMatchesRoot(track: ScannedTrack, root: string) {
  if (track.libraryRoot) return normalizeLibraryRoot(track.libraryRoot) === root;
  if (root.startsWith("cd:")) return track.path.startsWith(`${root}:`) || track.path.startsWith(root);
  const relative = path.relative(root, path.resolve(track.path));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function clearLibrary() {
  await writeLibrary(defaultLibrary);
  return defaultLibrary;
}

export async function findTrack(trackId: string) {
  const { byId } = await resolveLibraryWithIndex();
  return byId.get(trackId) ?? null;
}

export async function upsertLibraryTracks(tracks: ScannedTrack[]): Promise<LibraryIndex> {
  if (!tracks.length) return readLibrary();
  const current = await readRawLibrary();
  const byId = new Map(current.tracks.map((track) => [track.id, track]));
  for (const track of tracks) {
    byId.set(track.id, track);
  }
  const next: LibraryIndex = {
    updatedAt: new Date().toISOString(),
    roots: current.roots,
    tracks: [...byId.values()],
  };
  await writeLibrary(next);
  return readLibrary();
}
