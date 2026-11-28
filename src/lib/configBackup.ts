export type BackupModuleKey = "eqPresets" | "playlists" | "preferences" | "desktopLyrics";

export type BackupMergeStrategy = "merge" | "overwrite";

export type AriaBackupSnapshot = {
  version: 1;
  exportedAt: string;
  appVersion: string;
  modules: {
    eqPresets?: unknown[];
    playlists?: unknown[];
    preferences?: Record<string, unknown>;
    desktopLyrics?: Record<string, unknown>;
  };
};

// Strictly forbids sensitive credentials (cookies, tokens, private cloud passwords, TURN secrets).
const FORBIDDEN_BACKUP_KEYS = new Set([
  "cookie",
  "cookies",
  "neteaseCookie",
  "qqCookie",
  "bilibiliCookie",
  "youtubeCookie",
  "youtubeOauth",
  "password",
  "encryptedPassword",
  "token",
  "accessToken",
  "refreshToken",
  "turnCredential",
]);

function scrubForbiddenKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubForbiddenKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_BACKUP_KEYS.has(k) || /cookie|password|secret|credential/i.test(k)) continue;
      out[k] = scrubForbiddenKeys(v);
    }
    return out;
  }
  return value;
}

export type BackupSourceData = {
  appVersion: string;
  eqPresets?: unknown[];
  playlists?: unknown[];
  preferences?: Record<string, unknown>;
  desktopLyrics?: Record<string, unknown>;
};

export function buildBackupSnapshot(
  input: BackupSourceData,
  selectedModules: BackupModuleKey[] = ["eqPresets", "playlists", "preferences", "desktopLyrics"],
): AriaBackupSnapshot {
  const allow = new Set(selectedModules);
  const modules: AriaBackupSnapshot["modules"] = {};
  if (allow.has("eqPresets") && Array.isArray(input.eqPresets)) {
    modules.eqPresets = scrubForbiddenKeys(input.eqPresets) as unknown[];
  }
  if (allow.has("playlists") && Array.isArray(input.playlists)) {
    modules.playlists = scrubForbiddenKeys(input.playlists) as unknown[];
  }
  if (allow.has("preferences") && input.preferences) {
    modules.preferences = scrubForbiddenKeys(input.preferences) as Record<string, unknown>;
  }
  if (allow.has("desktopLyrics") && input.desktopLyrics) {
    modules.desktopLyrics = scrubForbiddenKeys(input.desktopLyrics) as Record<string, unknown>;
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: input.appVersion || "0.9.0",
    modules,
  };
}

export function parseAndValidateBackup(raw: unknown): AriaBackupSnapshot {
  const obj = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!obj || typeof obj !== "object") {
    throw new Error("备份文件格式无效");
  }
  const record = obj as Partial<AriaBackupSnapshot>;
  if (record.version !== 1 || !record.modules || typeof record.modules !== "object") {
    throw new Error("不支持的 Aria 备份版本或结构缺失");
  }
  return {
    version: 1,
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : new Date().toISOString(),
    appVersion: typeof record.appVersion === "string" ? record.appVersion : "0.9.0",
    modules: {
      ...(Array.isArray(record.modules.eqPresets)
        ? { eqPresets: scrubForbiddenKeys(record.modules.eqPresets) as unknown[] }
        : {}),
      ...(Array.isArray(record.modules.playlists)
        ? { playlists: scrubForbiddenKeys(record.modules.playlists) as unknown[] }
        : {}),
      ...(record.modules.preferences && typeof record.modules.preferences === "object"
        ? { preferences: scrubForbiddenKeys(record.modules.preferences) as Record<string, unknown> }
        : {}),
      ...(record.modules.desktopLyrics && typeof record.modules.desktopLyrics === "object"
        ? { desktopLyrics: scrubForbiddenKeys(record.modules.desktopLyrics) as Record<string, unknown> }
        : {}),
    },
  };
}

function mergeByIdOrName(current: unknown[], incoming: unknown[], strategy: BackupMergeStrategy): unknown[] {
  if (strategy === "overwrite") return [...incoming];
  const merged = [...current];
  const seen = new Set(
    current.map((item) => {
      if (!item || typeof item !== "object") return JSON.stringify(item);
      const rec = item as { id?: unknown; name?: unknown };
      return String(rec.id ?? rec.name ?? JSON.stringify(item));
    }),
  );
  for (const item of incoming) {
    const key =
      item && typeof item === "object"
        ? String((item as { id?: unknown; name?: unknown }).id ?? (item as { name?: unknown }).name ?? JSON.stringify(item))
        : JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

export function mergeBackupSnapshot(
  current: BackupSourceData,
  incoming: AriaBackupSnapshot,
  strategy: BackupMergeStrategy,
  selectedModules: BackupModuleKey[] = ["eqPresets", "playlists", "preferences", "desktopLyrics"],
): BackupSourceData {
  const allow = new Set(selectedModules);
  const nextEq =
    allow.has("eqPresets") && Array.isArray(incoming.modules.eqPresets)
      ? mergeByIdOrName(current.eqPresets ?? [], incoming.modules.eqPresets, strategy)
      : current.eqPresets;
  const nextPlaylists =
    allow.has("playlists") && Array.isArray(incoming.modules.playlists)
      ? mergeByIdOrName(current.playlists ?? [], incoming.modules.playlists, strategy)
      : current.playlists;
  const nextPreferences =
    allow.has("preferences") && incoming.modules.preferences
      ? strategy === "overwrite"
        ? { ...incoming.modules.preferences }
        : { ...(current.preferences ?? {}), ...incoming.modules.preferences }
      : current.preferences;
  const nextDesktopLyrics =
    allow.has("desktopLyrics") && incoming.modules.desktopLyrics
      ? strategy === "overwrite"
        ? { ...incoming.modules.desktopLyrics }
        : { ...(current.desktopLyrics ?? {}), ...incoming.modules.desktopLyrics }
      : current.desktopLyrics;

  return {
    appVersion: current.appVersion,
    eqPresets: nextEq,
    playlists: nextPlaylists,
    preferences: nextPreferences,
    desktopLyrics: nextDesktopLyrics,
  };
}
