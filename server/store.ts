import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppStore } from "./types";
import { dataDir } from "./utils/paths";

const storePath = path.join(dataDir, "store.json");

const defaultStore: AppStore = {
  neteaseCookie: null,
  neteaseAccount: null,
  qqCookie: null,
  neteaseRealIp: null,
  sources: {},
  lyricBindings: {},
  libraryAutoScanEnabled: true,
};

let storeCache: { mtimeMs: number; size: number; value: AppStore } | null = null;

export async function readStore(): Promise<AppStore> {
  try {
    const fileStat = await stat(storePath);
    if (
      storeCache &&
      storeCache.size === fileStat.size &&
      Math.abs(storeCache.mtimeMs - fileStat.mtimeMs) < 1
    ) {
      return storeCache.value;
    }
    const raw = await readFile(storePath, "utf8");
    const parsed: AppStore = { ...defaultStore, ...JSON.parse(raw) };
    storeCache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: parsed };
    return parsed;
  } catch {
    storeCache = null;
    return defaultStore;
  }
}

export async function writeStore(nextStore: AppStore) {
  await mkdir(dataDir, { recursive: true });
  const serialized = JSON.stringify(nextStore, null, 2);
  const temporary = `${storePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, storePath);
  try {
    const fileStat = await stat(storePath);
    storeCache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: { ...defaultStore, ...nextStore } };
  } catch {
    storeCache = null;
  }
}

let pendingUpdate: Promise<unknown> = Promise.resolve();

export function updateStore(updater: (store: AppStore) => AppStore | Promise<AppStore>) {
  const operation = pendingUpdate.catch(() => undefined).then(async () => {
    const current = await readStore();
    const next = await updater(current);
    await writeStore(next);
    return next;
  });
  pendingUpdate = operation;
  return operation;
}
