import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScannedTrack } from "./types";
import { dataDir } from "./utils/paths";
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

export async function readLibrary(): Promise<LibraryIndex> {
  try {
    const raw = await readFile(libraryPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LibraryIndex>;
    const metadata = await localMetadataStore.read();
    const store = await readStore();
    return {
      updatedAt: parsed.updatedAt ?? null,
      roots: parsed.roots ?? [],
      tracks: (parsed.tracks ?? []).map((track) => {
        let override = metadata.overrides[track.id];
        if (override?.lyrics?.length && store.lyricBindings[track.id] !== (override.lyricCandidateId ?? override.candidateId)) {
          override = { ...override, lyrics: undefined };
        }
        return { ...track, title: override?.title ?? track.title, artist: override?.artist ?? track.artist, album: override?.album ?? track.album, metadata: override };
      }),
    };
  } catch {
    return defaultLibrary;
  }
}

export async function writeLibrary(library: LibraryIndex) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(libraryPath, JSON.stringify(library, null, 2), "utf8");
}

async function readOriginalTracks() {
  try { return (JSON.parse(await readFile(libraryPath, "utf8")) as LibraryIndex).tracks ?? []; }
  catch { return []; }
}

export async function replaceLibraryRoot(root: string, tracks: ScannedTrack[]) {
  const current = await readLibrary();
  const normalizedRoot = normalizeLibraryRoot(root);
  const normalizedTracks = tracks.map((track) => ({
    ...track,
    libraryRoot: track.libraryRoot ?? normalizedRoot,
  }));
  const nextTracks = [
    ...(await readOriginalTracks()).filter((track) => !trackMatchesRoot(track, normalizedRoot)),
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

export function normalizeLibraryRoot(root: string) {
  return root.startsWith("cd:") ? root : path.resolve(root);
}

function trackMatchesRoot(track: ScannedTrack, root: string) {
  if (track.libraryRoot) return normalizeLibraryRoot(track.libraryRoot) === root;
  if (root.startsWith("cd:")) return track.path.startsWith(`${root}:`) || track.path.startsWith(root);
  return path.resolve(track.path).startsWith(root);
}

export async function clearLibrary() {
  await writeLibrary(defaultLibrary);
  return defaultLibrary;
}

export async function findTrack(trackId: string) {
  const library = await readLibrary();
  return library.tracks.find((track) => track.id === trackId) ?? null;
}
