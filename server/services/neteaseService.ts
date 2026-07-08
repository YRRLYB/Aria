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
  const body = response.body as { code?: number; message?: string; cookie?: string } | undefined;
  const code = Number(body?.code ?? 0);
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

  try {
    const response = await neteaseApi.user_account({ cookie: store.neteaseCookie });
    const profile = response.body?.profile as
      | {
          userId?: number | string;
          nickname?: string;
          avatarUrl?: string;
        }
      | undefined;

    if (response.body?.code === 200 && profile?.userId) {
      return {
        connected: true,
        nickname: profile.nickname ?? "Netease Account",
        userId: String(profile.userId),
        avatarUrl: profile.avatarUrl ?? null,
        cookiePreview: maskCookie(store.neteaseCookie),
      };
    }
  } catch {
    // A saved cookie exists, but the remote profile could not be read right now.
  }

  return {
    connected: false,
    nickname: null,
    userId: null,
    avatarUrl: null,
    cookiePreview: maskCookie(store.neteaseCookie),
  };
}

function maskCookie(cookie: string) {
  const compact = cookie.replace(/\s+/g, "");
  if (compact.length <= 18) return "saved";
  return `${compact.slice(0, 10)}...${compact.slice(-6)}`;
}
