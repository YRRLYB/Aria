import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  readStore: vi.fn(),
  readLibrary: vi.fn(),
  replaceLibraryRoot: vi.fn(),
  scanMusicFolder: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: mocks.watch };
});
vi.mock("../store", () => ({ readStore: mocks.readStore, updateStore: vi.fn() }));
vi.mock("../libraryStore", () => ({
  readLibrary: mocks.readLibrary,
  replaceLibraryRoot: mocks.replaceLibraryRoot,
  normalizeLibraryRoot: (root: string) => root,
}));
vi.mock("../musicScanner", () => ({ scanMusicFolder: mocks.scanMusicFolder }));

import { getLibraryWatchState, refreshLibraryWatchers } from "./libraryWatcher";

const failingRoot = String.raw`\\NAS\music-lossless`;
const healthyRoot = String.raw`D:\Music`;

function watcherStub() {
  return { on: vi.fn(), close: vi.fn() };
}

function setLibraryRoots(roots: string[]) {
  mocks.readLibrary.mockResolvedValue({ tracks: [], roots, updatedAt: null });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.readStore.mockResolvedValue({ libraryAutoScanEnabled: true });
  mocks.watch.mockImplementation(() => watcherStub());
  setLibraryRoots([]);
  await refreshLibraryWatchers();
});

afterEach(async () => {
  setLibraryRoots([]);
  await refreshLibraryWatchers();
});

describe("library watcher errors", () => {
  it("forgets the scan error of a folder that was removed", async () => {
    mocks.watch.mockImplementation(() => {
      throw new Error("UNKNOWN: unknown error, watch '\\\\NAS\\music-lossless'");
    });
    setLibraryRoots([failingRoot]);
    await refreshLibraryWatchers();

    const failed = await getLibraryWatchState();
    expect(failed.lastError).toContain(failingRoot);
    expect(failed.lastError).toContain("UNKNOWN: unknown error");

    setLibraryRoots([]);
    await refreshLibraryWatchers();
    expect((await getLibraryWatchState()).lastError).toBeNull();
  });

  it("keeps healthy roots silent and clears an error once its watcher reconnects", async () => {
    let failing = true;
    mocks.watch.mockImplementation((root: string) => {
      if (failing && root === failingRoot) throw new Error("EPERM: operation not permitted");
      return watcherStub();
    });
    setLibraryRoots([failingRoot, healthyRoot]);
    await refreshLibraryWatchers();
    const failed = await getLibraryWatchState();
    expect(failed.lastError).toContain("EPERM");

    failing = false;
    await refreshLibraryWatchers();
    const recovered = await getLibraryWatchState();
    expect(recovered.lastError).toBeNull();
    expect(recovered.scanningRoots).toEqual([]);
  });

  it("clears every error when automatic scanning is disabled", async () => {
    mocks.watch.mockImplementation(() => {
      throw new Error("EPERM: operation not permitted");
    });
    setLibraryRoots([failingRoot]);
    await refreshLibraryWatchers();
    expect((await getLibraryWatchState()).lastError).toBeTruthy();

    mocks.readStore.mockResolvedValue({ libraryAutoScanEnabled: false });
    await refreshLibraryWatchers();
    const state = await getLibraryWatchState();
    expect(state.enabled).toBe(false);
    expect(state.lastError).toBeNull();
  });
});
