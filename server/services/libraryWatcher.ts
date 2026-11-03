import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { readLibrary, replaceLibraryRoot, normalizeLibraryRoot } from "../libraryStore";
import { scanMusicFolder } from "../musicScanner";
import { readStore, updateStore } from "../store";

const audioExtensions = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".ape"]);
const watchers = new Map<string, FSWatcher>();
const scanTimers = new Map<string, NodeJS.Timeout>();
const scanningRoots = new Set<string>();
const queuedRoots = new Set<string>();
// Watcher/scan failures are tracked per root so removing a folder cannot leave
// a stale "自动扫描" error in the settings panel.
const rootErrors = new Map<string, string>();
let lastScanAt: number | null = null;
let refreshPromise: Promise<void> | null = null;
let catchupTimer: NodeJS.Timeout | null = null;

export function startLibraryWatchers() {
  void refreshLibraryWatchers();
  // Catch files added while Aria was closed without putting a full metadata
  // scan in the window-startup path. Runtime changes are handled by fs.watch.
  catchupTimer ??= setTimeout(() => {
    for (const root of watchers.keys()) scheduleRootScan(root, 1_000);
  }, 45_000);
  catchupTimer.unref?.();
}

export function refreshLibraryWatchers() {
  refreshPromise ??= reconcileWatchers().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function reconcileWatchers() {
  const [store, library] = await Promise.all([readStore(), readLibrary()]);
  const enabled = store.libraryAutoScanEnabled !== false;
  const roots = new Set(
    enabled
      ? library.roots.filter((root) => !root.startsWith("cd:")).map(normalizeLibraryRoot)
      : [],
  );

  for (const [root, watcher] of watchers) {
    if (roots.has(root)) continue;
    watcher.close();
    watchers.delete(root);
    rootErrors.delete(root);
    const timer = scanTimers.get(root);
    if (timer) clearTimeout(timer);
    scanTimers.delete(root);
    queuedRoots.delete(root);
  }

  for (const root of rootErrors.keys()) {
    if (!roots.has(root)) rootErrors.delete(root);
  }

  if (!enabled) {
    rootErrors.clear();
    return;
  }
  for (const root of roots) {
    if (watchers.has(root)) continue;
    try {
      const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
        if (filename && !audioExtensions.has(path.extname(filename.toString()).toLowerCase())) return;
        scheduleRootScan(root);
      });
      watcher.on("error", (error) => {
        if (watchers.get(root) !== watcher) return;
        recordRootError(root, error.message);
        watchers.delete(root);
        watcher.close();
      });
      watchers.set(root, watcher);
      rootErrors.delete(root);
    } catch (error) {
      recordRootError(root, error instanceof Error ? error.message : String(error));
    }
  }
}

function recordRootError(root: string, message: string) {
  rootErrors.set(root, message.includes(root) ? message : `${root}：${message}`);
}

function scheduleRootScan(root: string, delay = 4_000) {
  if (!watchers.has(root)) return;
  if (scanningRoots.has(root)) {
    queuedRoots.add(root);
    return;
  }
  const previous = scanTimers.get(root);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    scanTimers.delete(root);
    void scanRoot(root);
  }, delay);
  timer.unref?.();
  scanTimers.set(root, timer);
}

async function scanRoot(root: string) {
  if (scanningRoots.has(root) || !watchers.has(root)) {
    queuedRoots.add(root);
    return;
  }
  scanningRoots.add(root);
  try {
    const tracks = await scanMusicFolder(root);
    // A path removed or disabled during a long scan must not be reinserted.
    if (!watchers.has(root)) return;
    await replaceLibraryRoot(root, tracks);
    lastScanAt = Date.now();
    rootErrors.delete(root);
  } catch (error) {
    if (watchers.has(root)) recordRootError(root, error instanceof Error ? error.message : String(error));
  } finally {
    scanningRoots.delete(root);
    if (queuedRoots.delete(root)) scheduleRootScan(root, 1_500);
  }
}

export async function getLibraryWatchState() {
  const store = await readStore();
  return {
    enabled: store.libraryAutoScanEnabled !== false,
    scanningRoots: [...scanningRoots],
    lastScanAt,
    lastError: rootErrors.values().next().value ?? null,
  };
}

export async function setLibraryAutoScanEnabled(enabled: boolean) {
  await updateStore((store) => ({ ...store, libraryAutoScanEnabled: enabled }));
  await refreshLibraryWatchers();
  return getLibraryWatchState();
}
