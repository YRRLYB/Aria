export type AriaProfileSourceOption = "auto" | "netease" | "qq" | "bilibili" | "youtube";

export type AriaRoomProfile = {
  peerId: string;
  mode: "inherit" | "custom";
  preferredSource: AriaProfileSourceOption;
  customNickname: string;
  customAvatarDataUrl: string | null;
  selectedAvatarUrl?: string | null;
  avatarHistory?: string[];
  shareEnabled: boolean;
};

export type AriaSourceAccountSummary = {
  source: "netease" | "qq" | "bilibili" | "youtube";
  connected: boolean;
  nickname?: string | null;
  avatarUrl?: string | null;
};

export type ResolvedAriaRoomIdentity = {
  peerId: string;
  nickname: string;
  avatarUrl: string | null;
  isInherited: boolean;
  inheritedFromSource: AriaSourceAccountSummary["source"] | null;
};

const PROFILE_STORAGE_KEY = "aria-room-profile-v1";
const SOURCE_PRIORITY: ReadonlyArray<AriaSourceAccountSummary["source"]> = [
  "netease",
  "qq",
  "bilibili",
  "youtube",
];

function createPeerId(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 14)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `aria-${rand}`;
}

const MAX_AVATAR_HISTORY = 16;

function isValidHttpAvatarUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/.+/.test(value);
}

function isValidAvatarSelection(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("data:image/") || isValidHttpAvatarUrl(value));
}

export function appendAvatarHistory(
  history: string[] | undefined,
  dataUrl: string,
  maxItems = MAX_AVATAR_HISTORY,
): string[] {
  if (!dataUrl.startsWith("data:image/")) return Array.isArray(history) ? history.slice(0, maxItems) : [];
  const next = [dataUrl, ...(Array.isArray(history) ? history : []).filter((item) => item && item !== dataUrl)];
  return next.slice(0, Math.max(1, maxItems));
}

export function readAriaRoomProfile(): AriaRoomProfile {
  const fallback: AriaRoomProfile = {
    peerId: createPeerId(),
    mode: "inherit",
    preferredSource: "auto",
    customNickname: "",
    customAvatarDataUrl: null,
    selectedAvatarUrl: null,
    avatarHistory: [],
    shareEnabled: true,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<AriaRoomProfile>;
    const customAvatarDataUrl =
      typeof parsed.customAvatarDataUrl === "string" && parsed.customAvatarDataUrl.startsWith("data:image/")
        ? parsed.customAvatarDataUrl
        : null;
    const rawHistory = Array.isArray(parsed.avatarHistory)
      ? parsed.avatarHistory.filter((item): item is string => typeof item === "string" && item.startsWith("data:image/"))
      : [];
    const dedupedHistory: string[] = [];
    for (const item of rawHistory) {
      if (!dedupedHistory.includes(item)) dedupedHistory.push(item);
      if (dedupedHistory.length >= MAX_AVATAR_HISTORY) break;
    }
    const avatarHistory =
      customAvatarDataUrl && !dedupedHistory.includes(customAvatarDataUrl)
        ? appendAvatarHistory(dedupedHistory, customAvatarDataUrl)
        : dedupedHistory;
    const selectedAvatarUrl = isValidAvatarSelection(parsed.selectedAvatarUrl)
      ? parsed.selectedAvatarUrl
      : customAvatarDataUrl;
    const normalized: AriaRoomProfile = {
      peerId: typeof parsed.peerId === "string" && parsed.peerId.trim() ? parsed.peerId.trim() : fallback.peerId,
      mode: parsed.mode === "custom" ? "custom" : "inherit",
      preferredSource:
        parsed.preferredSource === "netease" ||
        parsed.preferredSource === "qq" ||
        parsed.preferredSource === "bilibili" ||
        parsed.preferredSource === "youtube"
          ? parsed.preferredSource
          : "auto",
      customNickname: typeof parsed.customNickname === "string" ? parsed.customNickname : "",
      customAvatarDataUrl,
      selectedAvatarUrl,
      avatarHistory,
      shareEnabled: typeof parsed.shareEnabled === "boolean" ? parsed.shareEnabled : true,
    };
    return normalized;
  } catch {
    return fallback;
  }
}

export function writeAriaRoomProfile(profile: AriaRoomProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

export function resolveAriaRoomIdentity(
  profile: AriaRoomProfile,
  accounts: AriaSourceAccountSummary[],
): ResolvedAriaRoomIdentity {
  const suffix = profile.peerId.slice(-4).toUpperCase();
  const defaultNickname = `Aria 听友-${suffix}`;

  const connectedBySource = new Map<AriaSourceAccountSummary["source"], AriaSourceAccountSummary>();
  for (const item of accounts) {
    if (item.connected) connectedBySource.set(item.source, item);
  }

  let inherited: AriaSourceAccountSummary | undefined;
  if (profile.preferredSource !== "auto") {
    inherited = connectedBySource.get(profile.preferredSource);
  }
  if (!inherited) {
    for (const source of SOURCE_PRIORITY) {
      const candidate = connectedBySource.get(source);
      if (candidate) {
        inherited = candidate;
        break;
      }
    }
  }

  if (profile.mode === "custom") {
    const customName = profile.customNickname.trim();
    return {
      peerId: profile.peerId,
      nickname: customName || inherited?.nickname?.trim() || defaultNickname,
      avatarUrl: profile.selectedAvatarUrl || profile.customAvatarDataUrl || inherited?.avatarUrl || null,
      isInherited: !customName && Boolean(inherited?.nickname?.trim()),
      inheritedFromSource: !customName && inherited ? inherited.source : null,
    };
  }

  if (inherited) {
    return {
      peerId: profile.peerId,
      nickname: inherited.nickname?.trim() || defaultNickname,
      avatarUrl: profile.selectedAvatarUrl || inherited.avatarUrl || profile.customAvatarDataUrl || null,
      isInherited: true,
      inheritedFromSource: inherited.source,
    };
  }

  return {
    peerId: profile.peerId,
    nickname: profile.customNickname.trim() || defaultNickname,
    avatarUrl: profile.selectedAvatarUrl || profile.customAvatarDataUrl || null,
    isInherited: false,
    inheritedFromSource: null,
  };
}

/**
 * Center-crops and compresses an uploaded image to 128x128 JPEG data URL so
 * zero external image hosting or Aria account backend is ever required.
 */
export async function compressAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件作为头像");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("无法解码所选图片"));
      el.src = objectUrl;
    });
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持头像画布处理");

    const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = Math.max(0, Math.floor(((img.naturalWidth || img.width) - minSide) / 2));
    const sy = Math.max(0, Math.floor(((img.naturalHeight || img.height) - minSide) / 2));
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export type AriaRoomSavedSession = {
  role: "host" | "guest";
  networkMode: "direct" | "cloudflare" | "hybrid";
  controlMode: "host-only" | "collaborative";
  roomId: string | null;
  directHost?: string | null;
  directPort?: number | null;
  directToken?: string | null;
  publicHost?: string | null;
  savedAt: number;
};

const SESSION_STORAGE_KEY = "aria-room-session-v1";

export function readSavedAriaRoomSession(): AriaRoomSavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AriaRoomSavedSession>;
    if (parsed.role !== "host" && parsed.role !== "guest") return null;
    const networkMode =
      parsed.networkMode === "direct" || parsed.networkMode === "hybrid" ? parsed.networkMode : "cloudflare";
    const controlMode = parsed.controlMode === "host-only" ? "host-only" : "collaborative";
    const roomId = typeof parsed.roomId === "string" && parsed.roomId.trim() ? parsed.roomId.trim() : null;
    const directHost = typeof parsed.directHost === "string" && parsed.directHost.trim() ? parsed.directHost.trim() : null;
    const directToken = typeof parsed.directToken === "string" && parsed.directToken.trim() ? parsed.directToken.trim() : null;
    const directPort =
      typeof parsed.directPort === "number" && Number.isFinite(parsed.directPort) ? parsed.directPort : null;
    if (parsed.role === "guest") {
      if (networkMode === "direct" && (!directHost || !directToken)) return null;
      if (networkMode !== "direct" && !roomId) return null;
    } else if (networkMode !== "direct" && !roomId) {
      return null;
    }
    return {
      role: parsed.role,
      networkMode,
      controlMode,
      roomId,
      directHost,
      directPort,
      directToken,
      publicHost: typeof parsed.publicHost === "string" && parsed.publicHost.trim() ? parsed.publicHost.trim() : null,
      savedAt: typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt) ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeSavedAriaRoomSession(session: AriaRoomSavedSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

export function clearSavedAriaRoomSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
