import { randomBytes } from "node:crypto";
import neteaseApi from "NeteaseCloudMusicApi";
import { withNeteaseIdentity } from "../clients/neteaseIdentity";
import { readStore, updateStore } from "../store";
import type { StoredNeteaseAccount } from "../types";
import { HttpError } from "../utils/httpError";

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

/** Sign out without deleting the device fingerprint used by QR login. */
export async function clearNeteaseCookie(): Promise<NeteaseAccountSummary> {
  invalidateNeteaseAccountCache();
  await updateStore((store) => ({ ...store, neteaseCookie: null, neteaseAccount: null }));
  return disconnectedSummary();
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


// Keep the device fingerprint and response cookies together for the entire
// challenge. The SDK otherwise generates a new _ntes_nuid for every request.
type NeteaseQrResult = {
  code: number;
  status: "success" | "expired" | "scanned" | "waiting";
  message: string;
  account: NeteaseAccountSummary | null;
};
type NeteaseQrSession = {
  cookie: string;
  expiresAt: number;
  result?: NeteaseQrResult;
  request?: Promise<NeteaseQrResult>;
};
const qrSessions = new Map<string, NeteaseQrSession>();
const qrSessionTtl = 180_000;
const maxQrSessions = 32;
const qrUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 NeteaseMusicDesktop/3.1.17.204416";

/**
 * 2025+ 网易风控要求登录请求携带稳定的设备指纹：eapi header 里的 deviceId
 * 必须跨 key/create/check 一致，且跨重启保持不变（登录会话与设备绑定）。
 * 首次生成 16 位十六进制并持久化到 store，之后每次登录复用同一台"设备"。
 */
const NETEASE_DEVICE_ID_KEY = "neteaseDeviceId";
async function neteaseDeviceId(): Promise<string> {
  const store = await readStore();
  const existing = (store as Record<string, unknown> | null)?.[NETEASE_DEVICE_ID_KEY];
  if (typeof existing === "string" && /^[0-9a-f]{16,32}$/i.test(existing)) return existing;
  const deviceId = randomBytes(8).toString("hex");
  await updateStore((current) => ({ ...current, [NETEASE_DEVICE_ID_KEY]: deviceId }));
  return deviceId;
}

/** eapi 加密链的设备 Cookie；request.js 会把同名字段写进 eapi header。 */
async function qrDeviceCookie(): Promise<string> {
  const deviceId = await neteaseDeviceId();
  return [
    `os=pc`,
    `appver=3.1.17.204416`,
    `osver=Microsoft-Windows-10--buildver`,
    `deviceId=${deviceId}`,
    `resolution=1920x1080`,
    `channel=netease`,
  ].join("; ");
}

/**
 * eapi + 稳定设备指纹。调用方传入的会话 Cookie（key/create 返回的
 * __csrf、NMTID 等）叠加在设备字段之上，同名以会话为准——整个扫码挑战
 * 必须跑在同一台"设备"上，这是 2025+ 风控的硬要求。
 */
async function withEapiDevice(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  const identity = await withNeteaseIdentity(query);
  const sessionCookie = typeof query.cookie === "string" && query.cookie.trim() ? query.cookie : undefined;
  return {
    ...identity,
    crypto: "eapi",
    ua: qrUserAgent,
    cookie: mergeCookies(await qrDeviceCookie(), sessionCookie),
    timestamp: Date.now(),
  };
}

/** Set-Cookie attributes must never become entries in a Cookie request header. */
function mergeCookies(...values: unknown[]): string {
  const pairs = new Map<string, string>();
  const attributes = /^(?:path|domain|expires|max-age|samesite|secure|httponly|priority|partitioned)$/i;
  for (const value of values) {
    for (const line of Array.isArray(value) ? value : [value]) {
      if (typeof line !== "string") continue;
      for (const segment of line.split(";")) {
        const separator = segment.indexOf("=");
        if (separator < 1) continue;
        const name = segment.slice(0, separator).trim();
        if (attributes.test(name)) continue;
        pairs.set(name, segment.slice(separator + 1).trim());
      }
    }
  }
  return [...pairs].map(([name, value]) => `${name}=${value}`).join("; ");
}

function qrFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const upstream = error as { body?: { code?: number; message?: string; msg?: string }; message?: string } | null;
  const bodyCode = Number(upstream?.body?.code ?? 0);
  const bodyText = upstream?.body?.message ?? upstream?.body?.msg ?? "";
  if (bodyCode === 460 || /环境异常/.test(bodyText)) {
    return new HttpError(502, "网易云拒绝了当前登录环境，请关闭代理后重新生成二维码，或使用网页登录后导入 Cookie。", "NETEASE_LOGIN_ENVIRONMENT_REJECTED");
  }
  if (bodyCode === -462 || bodyCode === 8821 || bodyCode === 462) {
    return new HttpError(502, "网易云风控拦截了本次登录，请稍后重试；如持续失败请使用网页登录后导入 Cookie。", "NETEASE_LOGIN_RISK_REJECTED");
  }
  return new HttpError(502, "网易云扫码状态请求失败，请重新生成二维码或使用 Cookie 登录。", "NETEASE_QR_REQUEST_FAILED");
}

export async function startNeteaseQrLogin() {
  const now = Date.now();
  for (const [key, session] of qrSessions) {
    if (session.expiresAt <= now) qrSessions.delete(key);
  }
  while (qrSessions.size >= maxQrSessions) qrSessions.delete(qrSessions.keys().next().value!);

  const initialCookie = await qrDeviceCookie();
  try {
    const keyResponse = await neteaseApi.login_qr_key(await withEapiDevice({ cookie: initialCookie }));
    const key = String((keyResponse.body?.data as { unikey?: string } | undefined)?.unikey ?? "");
    if (!key) throw qrFailure({ body: keyResponse.body });
    const keyCookie = mergeCookies(initialCookie, keyResponse.cookie);
    const qrResponse = await neteaseApi.login_qr_create(await withEapiDevice({
      key,
      qrimg: true,
      platform: "pc",
      cookie: keyCookie,
    }));
    const data = qrResponse.body?.data as { qrurl?: string; qrimg?: string } | undefined;
    if (!data?.qrurl || !data.qrimg) throw qrFailure(null);
    qrSessions.set(key, { cookie: mergeCookies(keyCookie, qrResponse.cookie), expiresAt: now + qrSessionTtl });
    return { key, qrUrl: data.qrurl, qrImage: data.qrimg, expiresIn: qrSessionTtl / 1000 };
  } catch (error) {
    throw qrFailure(error);
  }
}

export async function checkNeteaseQrLogin(key: string): Promise<NeteaseQrResult> {
  const session = qrSessions.get(key);
  if (!session) {
    // 后端重启等情况会话丢失：仍匿名轮询一次，让网易告知二维码的真实状态
    // （800 过期 / 801 等待），而不是本地直接判定过期。
    return pollNeteaseQrLogin(key, null);
  }
  if (session.expiresAt <= Date.now()) {
    qrSessions.delete(key);
    return { code: 800, status: "expired", message: "二维码已过期，请重新生成。", account: null };
  }
  // A repeated/in-flight poll must not consume the provider challenge twice or
  // reset the saved account after the phone has confirmed it.
  if (session.result) return session.result;
  if (session.request) return session.request;
  const request = pollNeteaseQrLogin(key, session).finally(() => {
    if (session.request === request) session.request = undefined;
  });
  session.request = request;
  return request;
}

/** Maps a login_qr_check response; `session` is null for anonymous re-polls. */
async function applyNeteaseQrCheckResponse(session: NeteaseQrSession | null, response: {
  body?: { code?: number; message?: string; msg?: string; cookie?: string; data?: { code?: number } };
  cookie?: string[];
}): Promise<NeteaseQrResult> {
  const body = response.body;
  const code = Number(body?.code ?? body?.data?.code ?? 0);
  if (session) session.cookie = mergeCookies(session.cookie, response.cookie, body?.cookie);
  if (code === 803) {
    // 只持久化网易回传的登录 Cookie（MUSIC_U 等），不混入本地设备字段。
    const loginCookie = mergeCookies(response.cookie, body?.cookie);
    if (!/(?:^|;\s*)MUSIC_U=[^;]+/.test(loginCookie)) {
      throw new HttpError(502, "网易云已确认登录但未返回有效凭据，请重新扫码。", "NETEASE_QR_COOKIE_MISSING");
    }
    const account = await saveNeteaseCookie(loginCookie);
    const result: NeteaseQrResult = { code, status: "success", message: body?.message ?? "登录成功。", account };
    if (session) session.result = result;
    return result;
  }
  if (![800, 801, 802].includes(code)) throw qrFailure({ body });
  const status = code === 800 ? "expired" : code === 802 ? "scanned" : "waiting";
  const result: NeteaseQrResult = {
    code,
    status,
    message: body?.message ?? (status === "expired" ? "二维码已过期，请重新生成。" : status === "scanned" ? "已扫码，请在手机上确认。" : "等待扫码。"),
    account: null,
  };
  if (status === "expired" && session) session.result = result;
  return result;
}

async function pollNeteaseQrLogin(key: string, session: NeteaseQrSession | null): Promise<NeteaseQrResult> {
  try {
    const response = session
      ? await neteaseApi.login_qr_check(await withEapiDevice({
          key,
          cookie: session.cookie,
        }))
      : await neteaseApi.login_qr_check({ key, noCookie: true, ua: qrUserAgent, timestamp: Date.now() });
    return await applyNeteaseQrCheckResponse(session, response);
  } catch (error) {
    if (!session) {
      // 没有可重试的会话；网络抖动按过期处理，前端会引导重新生成。
      return { code: 800, status: "expired", message: "二维码已过期，请重新生成。", account: null };
    }
    throw qrFailure(error);
  }
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
      const response = await neteaseApi.user_account(await withNeteaseIdentity({ cookie }));
      const profile =
        findNeteaseProfile(response.body) ??
        findNeteaseProfile((await neteaseApi.login_status(await withNeteaseIdentity({ cookie }))).body);

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
