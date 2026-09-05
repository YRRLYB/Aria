import neteaseApi from "NeteaseCloudMusicApi";
import { readStore, updateStore } from "../store";

export type NeteaseAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
  cookiePreview: string | null;
};

export async function saveNeteaseCookie(cookie: string) {
  await updateStore((store) => ({ ...store, neteaseCookie: cookie }));
  return getNeteaseAccountSummary();
}

export async function startNeteaseQrLogin() {
  const keyResponse = await neteaseApi.login_qr_key({ timestamp: Date.now() } as never);
  const key = String((keyResponse.body?.data as { unikey?: string } | undefined)?.unikey ?? "");
  if (!key) throw new Error("Failed to create Netease QR login key.");

  const qrResponse = await neteaseApi.login_qr_create({
    key,
    qrimg: true,
    platform: "web",
    timestamp: Date.now(),
  } as never);
  const data = qrResponse.body?.data as { qrurl?: string; qrimg?: string } | undefined;

  return {
    key,
    qrUrl: data?.qrurl ?? "",
    qrImage: data?.qrimg ?? "",
    expiresIn: 180,
  };
}

export async function checkNeteaseQrLogin(key: string) {
  const response = await neteaseApi.login_qr_check({
    key,
    timestamp: Date.now(),
    noCookie: true,
  } as never);
  const body = response.body as { code?: number; message?: string; cookie?: string; data?: { code?: number } } | undefined;
  const code = Number(body?.code ?? body?.data?.code ?? 0);
  const cookie = typeof body?.cookie === "string" ? body.cookie : Array.isArray(response.cookie) ? response.cookie.join(";") : "";

  if (code === 803) {
    if (!cookie) throw new Error("Netease QR login succeeded without a cookie.");
    const account = await saveNeteaseCookie(cookie);
    return {
      code,
      status: "success" as const,
      message: body?.message ?? "Login confirmed.",
      account,
    };
  }

  const status =
    code === 800 ? "expired" :
    code === 802 ? "scanned" :
    "waiting";

  return {
    code,
    status,
    message: body?.message ?? (status === "expired" ? "QR code expired." : status === "scanned" ? "Waiting for confirmation." : "Waiting for scan."),
    account: null,
  };
}

export async function getNeteaseAccountSummary(): Promise<NeteaseAccountSummary> {
  const store = await readStore();
  if (!store.neteaseCookie) {
    return {
      connected: false,
      nickname: null,
      userId: null,
      avatarUrl: null,
      cookiePreview: null,
    };
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await neteaseApi.user_account({ cookie: store.neteaseCookie });
      const profile =
        findNeteaseProfile(response.body) ??
        findNeteaseProfile((await neteaseApi.login_status({ cookie: store.neteaseCookie })).body);

      if (profile?.userId) {
        return {
          connected: true,
          nickname: profile.nickname ?? "Netease Account",
          userId: String(profile.userId),
          avatarUrl: profile.avatarUrl ?? null,
          cookiePreview: maskCookie(store.neteaseCookie),
        };
      }
    } catch {
      // A saved cookie may need one short retry while the provider session settles.
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    connected: false,
    nickname: null,
    userId: null,
    avatarUrl: null,
    cookiePreview: maskCookie(store.neteaseCookie),
  };
}

function findNeteaseProfile(value: unknown): { userId?: number | string; nickname?: string; avatarUrl?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const candidates = [
    record.profile,
    record.account && typeof record.account === "object" ? (record.account as Record<string, unknown>).profile : undefined,
    record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>).profile : undefined,
    record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>).account : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const profile = candidate as Record<string, unknown>;
    if (profile.userId) {
      return {
        userId: profile.userId as string | number,
        nickname: typeof profile.nickname === "string" ? profile.nickname : undefined,
        avatarUrl: typeof profile.avatarUrl === "string" ? profile.avatarUrl : undefined,
      };
    }
  }
  return undefined;
}

function maskCookie(cookie: string) {
  const compact = cookie.replace(/\s+/g, "");
  if (compact.length <= 18) return "saved";
  return `${compact.slice(0, 10)}...${compact.slice(-6)}`;
}
