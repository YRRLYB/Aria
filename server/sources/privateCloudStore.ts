import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../utils/paths";
import { decryptSecret, encryptSecret } from "../utils/secretBox";

export type PrivateCloudInstanceKind = "subsonic" | "webdav";

export type StoredPrivateCloudInstance = {
  id: string;
  kind: PrivateCloudInstanceKind;
  name: string;
  baseUrl: string;
  username: string;
  encryptedPassword: string;
  rootPath?: string;
  enabled: boolean;
  mobileTranscodeBitrate?: number;
  createdAt: number;
  updatedAt: number;
  lastSyncAt?: number | null;
  trackCount?: number;
};

export type PublicPrivateCloudInstance = Omit<StoredPrivateCloudInstance, "encryptedPassword"> & {
  hasPassword: boolean;
};

export type UpsertPrivateCloudInput = {
  id?: string;
  kind: PrivateCloudInstanceKind;
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  rootPath?: string;
  enabled?: boolean;
  mobileTranscodeBitrate?: number;
};

type StoreFileShape = {
  version: 1;
  instances: StoredPrivateCloudInstance[];
};

const storePath = path.join(dataDir, "private-cloud.json");

let fileCache: { mtimeMs: number; size: number; value: StoreFileShape } | null = null;
let pendingWrite: Promise<unknown> = Promise.resolve();

export function normalizeBaseUrl(raw: string, kind?: PrivateCloudInstanceKind): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("服务器地址不能为空");
  const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 http:// 或 https:// 服务器地址");
  }
  // Beginners often copy browser address bar URLs with `#/album` or `/app` suffixes.
  parsed.hash = "";
  parsed.search = "";
  if (kind === "subsonic") {
    parsed.pathname = parsed.pathname.replace(/\/+(?:app|rest|login)(?:\/.*)?$/i, "") || "/";
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeRootPath(raw: string | undefined): string {
  const cleaned = (raw ?? "/").trim().replace(/\\/g, "/");
  if (!cleaned || cleaned === "/") return "/";
  const withLead = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return withLead.replace(/\/+$/, "") || "/";
}

async function readStoreFile(): Promise<StoreFileShape> {
  await pendingWrite.catch(() => undefined);
  try {
    const fileStat = await stat(storePath);
    if (fileCache && fileCache.size === fileStat.size && Math.abs(fileCache.mtimeMs - fileStat.mtimeMs) < 1) {
      return fileCache.value;
    }
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFileShape>;
    const normalized: StoreFileShape = {
      version: 1,
      instances: Array.isArray(parsed.instances) ? parsed.instances : [],
    };
    fileCache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: normalized };
    return normalized;
  } catch {
    fileCache = null;
    return { version: 1, instances: [] };
  }
}

function writeStoreFile(next: StoreFileShape): Promise<void> {
  const operation = pendingWrite.catch(() => undefined).then(async () => {
    await mkdir(dataDir, { recursive: true });
    const temp = `${storePath}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, storePath);
    try {
      const fileStat = await stat(storePath);
      fileCache = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value: next };
    } catch {
      fileCache = null;
    }
  });
  pendingWrite = operation;
  return operation;
}

export function toPublicInstance(instance: StoredPrivateCloudInstance): PublicPrivateCloudInstance {
  const { encryptedPassword, ...rest } = instance;
  return {
    ...rest,
    hasPassword: Boolean(encryptedPassword),
  };
}

export function getPrivateCloudPassword(instance: StoredPrivateCloudInstance): string {
  if (!instance.encryptedPassword) return "";
  try {
    return decryptSecret(instance.encryptedPassword);
  } catch {
    return "";
  }
}

export async function listPrivateCloudInstances(kind?: PrivateCloudInstanceKind): Promise<StoredPrivateCloudInstance[]> {
  const file = await readStoreFile();
  return kind ? file.instances.filter((item) => item.kind === kind) : file.instances;
}

export async function listEnabledPrivateCloudInstances(kind?: PrivateCloudInstanceKind): Promise<StoredPrivateCloudInstance[]> {
  const list = await listPrivateCloudInstances(kind);
  return list.filter((item) => item.enabled !== false);
}

export async function getPrivateCloudInstance(id: string): Promise<StoredPrivateCloudInstance | null> {
  const file = await readStoreFile();
  return file.instances.find((item) => item.id === id) ?? null;
}

export async function upsertPrivateCloudInstance(input: UpsertPrivateCloudInput): Promise<StoredPrivateCloudInstance> {
  const file = await readStoreFile();
  const now = Date.now();
  const existing = input.id ? file.instances.find((item) => item.id === input.id) : undefined;
  const id = existing?.id ?? `${input.kind}-${randomUUID().slice(0, 8)}`;
  const nextPassword =
    typeof input.password === "string" && input.password.length > 0
      ? encryptSecret(input.password)
      : existing?.encryptedPassword ?? "";
  const bitrate =
    typeof input.mobileTranscodeBitrate === "number" && Number.isFinite(input.mobileTranscodeBitrate)
      ? Math.max(64, Math.min(320, Math.round(input.mobileTranscodeBitrate)))
      : existing?.mobileTranscodeBitrate ?? 192;

  const record: StoredPrivateCloudInstance = {
    id,
    kind: input.kind,
    name: input.name.trim().slice(0, 64) || (input.kind === "subsonic" ? "OpenSubsonic 服务器" : "WebDAV 网盘"),
    baseUrl: normalizeBaseUrl(input.baseUrl, input.kind),
    username: (input.username ?? existing?.username ?? "").trim(),
    encryptedPassword: nextPassword,
    rootPath: input.kind === "webdav" ? normalizeRootPath(input.rootPath ?? existing?.rootPath) : undefined,
    enabled: input.enabled ?? existing?.enabled ?? true,
    mobileTranscodeBitrate: input.kind === "subsonic" ? bitrate : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSyncAt: existing?.lastSyncAt ?? null,
    trackCount: existing?.trackCount ?? 0,
  };

  const instances = existing
    ? file.instances.map((item) => (item.id === id ? record : item))
    : [...file.instances, record];
  await writeStoreFile({ version: 1, instances });
  return record;
}

export async function updatePrivateCloudSyncMeta(
  id: string,
  meta: { lastSyncAt?: number | null; trackCount?: number },
): Promise<void> {
  const file = await readStoreFile();
  if (!file.instances.some((item) => item.id === id)) return;
  const instances = file.instances.map((item) =>
    item.id === id
      ? {
          ...item,
          ...(meta.lastSyncAt !== undefined ? { lastSyncAt: meta.lastSyncAt } : {}),
          ...(meta.trackCount !== undefined ? { trackCount: meta.trackCount } : {}),
          updatedAt: Date.now(),
        }
      : item,
  );
  await writeStoreFile({ version: 1, instances });
}

export async function deletePrivateCloudInstance(id: string): Promise<boolean> {
  const file = await readStoreFile();
  const next = file.instances.filter((item) => item.id !== id);
  if (next.length === file.instances.length) return false;
  await writeStoreFile({ version: 1, instances: next });
  return true;
}
