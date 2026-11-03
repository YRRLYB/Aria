import neteaseApi from "NeteaseCloudMusicApi";
import { readStore, updateStore } from "../store";
import type { StoredNeteaseAccount } from "../types";

export type NeteaseAccountSummary = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
  cookiePreview: string | null;
};

const accountCacheTtl = 30_000;
const accountValidationTtl = 5 * 60_000;
const failedAccountCacheTtl = 1_500;
let accountCache: { cookie: string; expiresAt: number; value: NeteaseAccountSummary } | null = null;
let accountRequest: { cookie: string; promise: Promise<NeteaseAccountSummary> } | null = null;

export function invalidateNeteaseAccountCache() {
  accountCache = null;
  accountRequest = null;
}

export async function saveNeteaseCookie(cookie: string) {
  invalidateNeteaseAccountCache();
  await updateStore((store) => ({ ...store, neteaseCookie: cookie, neteaseAccount: null }));
  return getNeteaseAccountSummary();
}

function disconnectedSummary(cookiePreview: string | null = null): NeteaseAccountSummary {
  return {
    connected: false,
    nickname: null,
    userId: null,
    avatarUrl: null,
    cookiePreview,
  };
}

function publicSummary(account: StoredNeteaseAccount): NeteaseAccountSummary {
  return {
    connected: account.connected,
    nickname: account.nickname,
    userId: account.userId,
    avatarUrl: account.avatarUrl,
    cookiePreview: account.cookiePreview,
  };
}

/** Fast, network-free account state for the first settings response. */
export async function peekNeteaseAccountSummary(): Promise<NeteaseAccountSummary> {
  const store = await readStore();
  const cookie = store.neteaseCookie;
  if (!cookie) return disconnectedSummary();
  // A failed background validation must not make the startup path look signed
  // out; keep showing the persisted identity (or a provisional connection)
  // until the account endpoint explicitly reports otherwise.
  if (store.neteaseAccount?.userId) return publicSummary(store.neteaseAccount);
  if (accountCache?.cookie === cookie && accountCache.expiresAt > Date.now() && accountCache.value.connected) {
    return accountCache.value;
  }
  return {
    connected: true,
    nickname: null,
    userId: null,
    avatarUrl: null,
    cookiePreview: maskCookie(cookie),
  };
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
  const cookie = store.neteaseCookie;
  if (!cookie) return disconnectedSummary();

  // Stream resolution, warmups and playlist reads all need the same account
  // identity. Reusing one successful lookup avoids a burst of duplicate
  // user_account calls whenever a page requests several tracks at once.
  const now = Date.now();
  if (accountCache?.cookie === cookie && accountCache.expiresAt > now) return accountCache.value;
  if (accountRequest?.cookie === cookie) return accountRequest.promise;

  // The account identity is persisted after the first successful lookup. A
  // cold start can therefore render and resolve streams immediately; the
  // provider round trip only validates the cookie in the background.
  if (store.neteaseAccount?.userId) {
    const stored = publicSummary(store.neteaseAccount);
    accountCache = { cookie, value: stored, expiresAt: now + accountCacheTtl };
    if (now - store.neteaseAccount.validatedAt > accountValidationTtl) {
      void refreshNeteaseAccount(cookie).catch(() => undefined);
    }
    return stored;
  }

  return refreshNeteaseAccount(cookie);
}

function refreshNeteaseAccount(cookie: string) {
  if (accountRequest?.cookie === cookie) return accountRequest.promise;
  const request = loadNeteaseAccountSummary(cookie)
    .then(async (value) => {
      if (value.connected && value.userId) {
        await updateStore((store) => store.neteaseCookie === cookie
          ? { ...store, neteaseAccount: { ...value, validatedAt: Date.now() } }
          : store).catch(() => undefined);
      }
      accountCache = {
        cookie,
        value,
        expiresAt: Date.now() + (value.connected ? accountCacheTtl : failedAccountCacheTtl),
      };
      return value;
    })
    .finally(() => {
      if (accountRequest?.promise === request) accountRequest = null;
    });
  accountRequest = { cookie, promise: request };
  return request;
}

async function loadNeteaseAccountSummary(cookie: string): Promise<NeteaseAccountSummary> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await neteaseApi.user_account({ cookie });
      const profile =
        findNeteaseProfile(response.body) ??
        findNeteaseProfile((await neteaseApi.login_status({ cookie })).body);

      if (profile?.userId) {
        return {
          connected: true,
          nickname: profile.nickname ?? "Netease Account",
          userId: String(profile.userId),
          avatarUrl: profile.avatarUrl ?? null,
          cookiePreview: maskCookie(cookie),
        };
      }
    } catch {
      // A saved cookie may need one short retry while the provider session settles.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    connected: false,
    nickname: null,
    userId: null,
    avatarUrl: null,
    cookiePreview: maskCookie(cookie),
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
