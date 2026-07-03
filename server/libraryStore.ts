import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScannedTrack } from "./types";

const dataDir = path.resolve(process.cwd(), ".musicbox");
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

export async function readLibrary(): Promise<LibraryIndex> {
  try {
    const raw = await readFile(libraryPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LibraryIndex>;
    return {
      updatedAt: parsed.updatedAt ?? null,
      roots: parsed.roots ?? [],
      tracks: parsed.tracks ?? [],
    };
  } catch {
    return defaultLibrary;
  }
}

export async function writeLibrary(library: LibraryIndex) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(libraryPath, JSON.stringify(library, null, 2), "utf8");
}

export async function replaceLibraryRoot(root: string, tracks: ScannedTrack[]) {
  const current = await readLibrary();
  const normalizedRoot = path.resolve(root);
  const nextTracks = [
    ...current.tracks.filter((track) => !path.resolve(track.path).startsWith(normalizedRoot)),
    ...tracks,
  ];
  const roots = Array.from(new Set([...current.roots.filter((item) => item !== normalizedRoot), normalizedRoot]));
  const next: LibraryIndex = {
    updatedAt: new Date().toISOString(),
    roots,
    tracks: nextTracks,
  };
  await writeLibrary(next);
  return next;
}

export async function clearLibrary() {
  await writeLibrary(defaultLibrary);
  return defaultLibrary;
}

export async function findTrack(trackId: string) {
  const library = await readLibrary();
  return library.tracks.find((track) => track.id === trackId) ?? null;
}
