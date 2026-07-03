import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppStore } from "./types";

const dataDir = path.resolve(process.cwd(), ".musicbox");
const storePath = path.join(dataDir, "store.json");

const defaultStore: AppStore = {
  neteaseCookie: null,
  lyricBindings: {},
};

export async function readStore(): Promise<AppStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    return { ...defaultStore, ...JSON.parse(raw) };
  } catch {
    return defaultStore;
  }
}

export async function writeStore(nextStore: AppStore) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(nextStore, null, 2), "utf8");
}

export async function updateStore(updater: (store: AppStore) => AppStore | Promise<AppStore>) {
  const current = await readStore();
  const next = await updater(current);
  await writeStore(next);
  return next;
}
