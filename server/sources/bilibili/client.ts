import type { ProviderTrack } from "../../providers/musicProvider";
import type {
  AriaLevel,
  SourceAccount,
  SourceQrLoginCheck,
  SourceQrLoginStart,
  SourceStreamMeta,
  SourceVideoMeta,
} from "../contract";
import { SourceError } from "../contract";
import type { LyricLine } from "../../../src/lib/lyricTypes";
import { createHash } from "node:crypto";
import { readStore, updateStore } from "../../store";
import { HttpError } from "../../utils/httpError";
import QRCode from "qrcode";

const BILIBILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BILIBILI_REFERER = "https://www.bilibili.com/";
const BILIBILI_HOME = "https://www.bilibili.com/";
const COOKIE_TTL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 9_000;
const STREAM_URL_TTL_MS = 90 * 60_000;

type BiliAudio = {
  id: number;
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
  codecs?: string;
  mimeType?: string;
  mime_type?: string;
  /** Special DASH buckets: FLAC (Hi-Res) / Dolby Atmos. */
  kind?: "flac" | "dolby";
};

type BiliPlayData = {
  quality?: number;
  format?: string;
  accept_quality?: number[];
  accept_description?: string[];
  dash?: {
    audio?: BiliAudio[];
    dolby?: { type?: number; audio?: BiliAudio | null };
    flac?: { display?: boolean; audio?: BiliAudio | null };
    video?: Array<{ id?: number; baseUrl?: string; base_url?: string; width?: number; height?: number }>;
  };
  durl?: Array<{ url?: string; backup_url?: string[]; size?: number; length?: number }>;
};

type BiliViewData = {
  bvid: string;
  aid?: number;
  cid: number;
  title: string;
  pic?: string;
  duration?: number;
  owner?: { name?: string };
  typename?: string;
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
};

const AUDIO_LEVELS: Array<{
  id: number;
  level: AriaLevel;
  quality: ProviderTrack["quality"];
  label: string;
}> = [
  { id: 30251, level: "hires", quality: "Hi-Res", label: "Hi-Res" },
  { id: 30250, level: "lossless", quality: "Lossless", label: "杜比全景声" },
  { id: 30280, level: "exhigh", quality: "320K", label: "192K" },
  { id: 30232, level: "higher", quality: "128K", label: "132K" },
  { id: 30216, level: "standard", quality: "AAC", label: "64K" },
];

const RISK_CODES = new Set([-352, -412, -509, -799]);

let cookies = new Map<string, string>();
let cookiesExpireAt = 0;
let cookiePromise: Promise<string> | null = null;
const viewCache = new Map<string, { at: number; data: BiliViewData }>();

function abortSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(response: Response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const line of setCookies) {
    const [pair] = line.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  cookiesExpireAt = Date.now() + COOKIE_TTL_MS;
}

async function ensureCookies(force = false): Promise<string> {
  if (!force && cookies.size > 0 && Date.now() < cookiesExpireAt) return cookieHeader();
  if (cookiePromise) return cookiePromise;
  cookiePromise = (async () => {
    try {
      const response = await fetch(BILIBILI_HOME, {
        headers: {
          "User-Agent": BILIBILI_UA,
          Accept: "text/html,application/xhtml+xml",
        },
        signal: abortSignal(),
      });
      absorbCookies(response);
      // The homepage is only fetched for the buvid cookies; do not buffer the HTML.
      await response.body?.cancel().catch(() => undefined);
    } catch {
      // Search can still work without buvid on some networks; the request path
      // will surface a useful error if the API rejects anonymous traffic.
    }
    if (!cookies.has("buvid3") && !cookies.has("buvid4")) {
      cookies.set("buvid3", `aria-${Date.now().toString(36)}`);
    }
    return cookieHeader();
  })().finally(() => {
    cookiePromise = null;
  });
  return cookiePromise;
}

const AUTH_COOKIE_CACHE_MS = 2_000;
const ACCOUNT_CACHE_MS = 5 * 60_000;
const LIKED_CACHE_MS = 2 * 60_000;
const QR_SESSION_TTL_MS = 180_000;
const MAX_QR_SESSIONS = 16;
const FAV_PAGE_SIZE = 20;
const FAV_MAX_PAGES = 25;
const ARIA_FAV_FOLDER_TITLE = "Aria";

type BiliNavData = {
  isLogin?: boolean;
  mid?: number;
  uname?: string;
  face?: string;
  wbi_img?: { img_url?: string; sub_url?: string };
};

type BiliFavFolder = {
  id: number;
  fid?: number;
  title: string;
  media_count?: number;
};

type BiliFavMedia = {
  type?: number;
  attr?: number;
  bvid?: string;
  title?: string;
  cover?: string;
  duration?: number;
  fav_time?: number;
  upper?: { name?: string };
};

type BiliFavPage = {
  info?: { media_count?: number };
  medias?: BiliFavMedia[] | null;
  has_more?: boolean;
};

type BiliQrSession = {
  key: string;
  createdAt: number;
  expiresAt: number;
  status: "waiting" | "scanned" | "expired" | "success";
  account: SourceAccount | null;
};

let authCookieCache: { value: string; at: number } | null = null;
let accountCache: { cookie: string; at: number; value: SourceAccount } | null = null;
let likedCache: { cookie: string; at: number; tracks: ProviderTrack[] } | null = null;
let ariaFolderCache: { cookie: string; at: number; folder: BiliFavFolder | null } | null = null;
let ariaFolderCreatePromise: Promise<BiliFavFolder | null> | null = null;
let wbiKeysCache: { imgKey: string; subKey: string; at: number } | null = null;
const qrSessions = new Map<string, BiliQrSession>();

const WBI_KEYS_TTL_MS = 6 * 60 * 60_000;
const WBI_MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

function extractWbiKey(url: string | undefined) {
  if (!url) return "";
  const filename = url.slice(url.lastIndexOf("/") + 1);
  return filename.slice(0, filename.lastIndexOf("."));
}

function rememberWbiKeys(nav: BiliNavData | null) {
  const imgKey = extractWbiKey(nav?.wbi_img?.img_url);
  const subKey = extractWbiKey(nav?.wbi_img?.sub_url);
  if (imgKey && subKey) wbiKeysCache = { imgKey, subKey, at: Date.now() };
}

function getMixinKey(imgKey: string, subKey: string) {
  const raw = imgKey + subKey;
  return WBI_MIXIN_TAB.map((index) => raw[index] ?? "").join("").slice(0, 32);
}

/** Sign an API query with Bilibili's WBI scheme (used by the web player). */
function signWbiQuery(params: Record<string, string>, imgKey: string, subKey: string) {
  const all: Record<string, string> = { ...params, wts: String(Math.floor(Date.now() / 1000)) };
  const query = Object.keys(all)
    .sort()
    .map((key) => {
      const value = all[key].replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");
  const wRid = createHash("md5").update(query + getMixinKey(imgKey, subKey)).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

function parseCookiePairs(header: string | null | undefined): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of String(header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) pairs.set(name, value);
  }
  return pairs;
}

function mergeCookieHeaders(...headers: Array<string | null | undefined>): string {
  const merged = new Map<string, string>();
  for (const header of headers) {
    for (const [name, value] of parseCookiePairs(header)) merged.set(name, value);
  }
  return [...merged.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function readAuthCookie(force = false): Promise<string> {
  if (!force && authCookieCache && Date.now() - authCookieCache.at < AUTH_COOKIE_CACHE_MS) {
    return authCookieCache.value;
  }
  const store = await readStore();
  const value = typeof store.bilibiliCookie === "string" ? store.bilibiliCookie : "";
  authCookieCache = { value, at: Date.now() };
  return value;
}

/** Anonymous buvid cookies plus the stored login cookie; auth values win. */
async function requestCookie(): Promise<string> {
  const [anonymous, auth] = await Promise.all([ensureCookies(), readAuthCookie()]);
  return mergeCookieHeaders(anonymous, auth);
}

function disconnectedAccount(): SourceAccount {
  return { connected: false, nickname: null, userId: null, avatarUrl: null };
}

function accountFromNav(nav: BiliNavData): SourceAccount {
  if (!nav.isLogin || !nav.mid) return disconnectedAccount();
  return {
    connected: true,
    nickname: nav.uname ? stripHtml(nav.uname) : "B站用户",
    userId: String(nav.mid),
    avatarUrl: normalizeCover(nav.face) ?? null,
  };
}

async function fetchBilibiliNav(cookie: string, signal?: AbortSignal): Promise<BiliNavData | null> {
  try {
    const response = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Accept: "application/json, text/plain, */*",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: abortSignal(signal),
    });
    const body = (await response.json()) as { code?: number; data?: BiliNavData };
    if (body?.data) rememberWbiKeys(body.data);
    return body?.data ?? null;
  } catch {
    return null;
  }
}

async function biliAuthJson<T>(
  url: string,
  options: { method?: string; body?: URLSearchParams; signal?: AbortSignal } = {},
): Promise<T> {
  const auth = await readAuthCookie();
  if (!auth) {
    throw new SourceError("AUTH_REQUIRED", "登录B站后可同步收藏", { source: "bilibili" });
  }
  const cookie = mergeCookieHeaders(await ensureCookies(), auth);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER,
      Accept: "application/json, text/plain, */*",
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      Cookie: cookie,
    },
    body: options.body?.toString(),
    signal: abortSignal(options.signal),
  });
  const text = await response.text();
  let body: { code?: number; message?: string; data?: T } | null = null;
  try {
    body = JSON.parse(text) as { code?: number; message?: string; data?: T };
  } catch {
    throw new SourceError("UPSTREAM_FAILED", "B站返回了无法解析的响应", { source: "bilibili" });
  }
  if (!response.ok || body.code !== 0) {
    const code = Number(body.code ?? response.status);
    if (code === -101 || code === -111) {
      throw new SourceError("AUTH_REQUIRED", "B站登录已过期，请重新登录", { source: "bilibili" });
    }
    throw new SourceError(
      "UPSTREAM_FAILED",
      stripHtml(String(body.message ?? "B站请求失败")),
      { source: "bilibili" },
    );
  }
  return body.data as T;
}

export async function getBilibiliAccount(signal?: AbortSignal): Promise<SourceAccount> {
  const auth = await readAuthCookie(true);
  if (!auth) return disconnectedAccount();
  if (accountCache?.cookie === auth && Date.now() - accountCache.at < ACCOUNT_CACHE_MS) {
    return accountCache.value;
  }
  const cookie = mergeCookieHeaders(await ensureCookies(), auth);
  const nav = await fetchBilibiliNav(cookie, signal);
  const account = accountFromNav(nav ?? {});
  accountCache = { cookie: auth, at: Date.now(), value: account };
  return account;
}

function clearBilibiliAuthCaches() {
  authCookieCache = null;
  accountCache = null;
  likedCache = null;
  ariaFolderCache = null;
  ariaFolderCreatePromise = null;
}

export async function saveBilibiliCookie(cookie: string): Promise<SourceAccount> {
  const trimmed = cookie.trim();
  const parsed = parseCookiePairs(trimmed);
  if (!parsed.has("SESSDATA")) {
    throw new HttpError(
      400,
      "Bilibili Cookie 无效：缺少 SESSDATA，请粘贴完整 Cookie",
      "BILIBILI_COOKIE_INVALID",
    );
  }
  const merged = mergeCookieHeaders(await ensureCookies(), trimmed);
  const nav = await fetchBilibiliNav(merged);
  if (!nav?.isLogin) {
    throw new HttpError(
      400,
      "Bilibili Cookie 已过期或无效，请重新扫码登录",
      "BILIBILI_COOKIE_INVALID",
    );
  }
  await updateStore((store) => ({ ...store, bilibiliCookie: trimmed }));
  clearBilibiliAuthCaches();
  authCookieCache = { value: trimmed, at: Date.now() };
  const account = accountFromNav(nav);
  accountCache = { cookie: trimmed, at: Date.now(), value: account };
  return account;
}

export async function clearBilibiliCookie(): Promise<SourceAccount> {
  await updateStore((store) => ({ ...store, bilibiliCookie: null }));
  clearBilibiliAuthCaches();
  return disconnectedAccount();
}

function pruneQrSessions() {
  const now = Date.now();
  for (const [key, session] of qrSessions) {
    if (now - session.createdAt > QR_SESSION_TTL_MS) qrSessions.delete(key);
  }
  while (qrSessions.size >= MAX_QR_SESSIONS) {
    const oldest = qrSessions.keys().next().value;
    if (oldest === undefined) break;
    qrSessions.delete(oldest);
  }
}

export async function startBilibiliQrLogin(): Promise<SourceQrLoginStart> {
  pruneQrSessions();
  const response = await fetch(
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header",
    {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Accept: "application/json, text/plain, */*",
      },
      signal: abortSignal(),
    },
  );
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { url?: string; qrcode_key?: string };
  };
  const url = body?.data?.url;
  const key = body?.data?.qrcode_key;
  if (!response.ok || body.code !== 0 || !url || !key) {
    throw new HttpError(502, "B站二维码获取失败，请稍后重试", "BILIBILI_QR_FAILED");
  }
  let qrImage = "";
  try {
    qrImage = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
  } catch {
    throw new HttpError(502, "B站二维码生成失败，请稍后重试", "BILIBILI_QR_FAILED");
  }
  qrSessions.set(key, {
    key,
    createdAt: Date.now(),
    expiresAt: Date.now() + QR_SESSION_TTL_MS,
    status: "waiting",
    account: null,
  });
  return { key, qrImage, expiresIn: Math.round(QR_SESSION_TTL_MS / 1000) };
}

export async function checkBilibiliQrLogin(key: string): Promise<SourceQrLoginCheck> {
  const session = qrSessions.get(key);
  if (!session) {
    throw new HttpError(404, "二维码会话不存在或已过期，请重新生成", "BILIBILI_QR_SESSION_MISSING");
  }
  if (session.status === "success" && session.account) {
    return { code: 0, status: "success", message: "登录成功", account: session.account };
  }
  if (Date.now() > session.expiresAt) {
    session.status = "expired";
    return { code: 86038, status: "expired", message: "二维码已过期，请重新生成", account: null };
  }

  const response = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`,
    {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Accept: "application/json, text/plain, */*",
      },
      signal: abortSignal(),
    },
  );
  const body = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { code?: number; message?: string; url?: string };
  };
  const data = body?.data;
  if (body.code !== 0 || !data) {
    throw new HttpError(502, "B站登录状态查询失败，请稍后重试", "BILIBILI_QR_POLL_FAILED");
  }
  if (data.code === 86101) {
    session.status = "waiting";
    return { code: 86101, status: "waiting", message: "等待扫码", account: null };
  }
  if (data.code === 86090) {
    session.status = "scanned";
    return { code: 86090, status: "scanned", message: "已扫码，请在手机上确认登录", account: null };
  }
  if (data.code === 86038) {
    session.status = "expired";
    return { code: 86038, status: "expired", message: "二维码已过期，请重新生成", account: null };
  }
  if (data.code !== 0) {
    return { code: Number(data.code ?? -1), status: "waiting", message: data.message || "等待确认", account: null };
  }

  const setCookies = response.headers.getSetCookie?.() ?? [];
  const pairs = new Map<string, string>();
  for (const line of setCookies) {
    const [pair] = line.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name && value) pairs.set(name, value);
  }
  const cookie = [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (!cookie.includes("SESSDATA=")) {
    session.status = "expired";
    return { code: -1, status: "expired", message: "登录凭证获取失败，请重新扫码", account: null };
  }
  try {
    const account = await saveBilibiliCookie(cookie);
    session.status = "success";
    session.account = account;
    return { code: 0, status: "success", message: "登录成功", account };
  } catch (error) {
    session.status = "expired";
    return {
      code: -1,
      status: "expired",
      message: error instanceof Error ? error.message : "登录确认失败，请重新扫码",
      account: null,
    };
  }
}

async function listBilibiliFavFolders(mid: string, signal?: AbortSignal): Promise<BiliFavFolder[]> {
  const data = await biliAuthJson<{ list?: BiliFavFolder[] } | BiliFavFolder[]>(
    `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}`,
    { signal },
  );
  return Array.isArray(data) ? data : data?.list ?? [];
}

function isAriaFavFolder(folder: BiliFavFolder) {
  return folder.title.trim().toLowerCase() === ARIA_FAV_FOLDER_TITLE.toLowerCase();
}

async function findBilibiliAriaFolder(mid: string, signal?: AbortSignal): Promise<BiliFavFolder | null> {
  const auth = await readAuthCookie();
  if (ariaFolderCache?.cookie === auth && Date.now() - ariaFolderCache.at < LIKED_CACHE_MS) {
    return ariaFolderCache.folder;
  }
  const folders = await listBilibiliFavFolders(mid, signal);
  const folder = folders.find(isAriaFavFolder) ?? null;
  ariaFolderCache = { cookie: auth, at: Date.now(), folder };
  return folder;
}

async function ensureBilibiliAriaFolder(mid: string, signal?: AbortSignal): Promise<BiliFavFolder> {
  const existing = await findBilibiliAriaFolder(mid, signal);
  if (existing) return existing;
  if (ariaFolderCreatePromise) {
    const created = await ariaFolderCreatePromise;
    if (created) return created;
  }
  ariaFolderCreatePromise = (async () => {
    const auth = await readAuthCookie();
    const csrf = parseCookiePairs(auth).get("bili_jct");
    if (!csrf) {
      throw new SourceError("AUTH_REQUIRED", "B站登录信息缺少 bili_jct，请重新登录", { source: "bilibili" });
    }
    const data = await biliAuthJson<{ id?: number; fid?: number; title?: string } | null>(
      "https://api.bilibili.com/x/v3/fav/folder/add",
      {
        method: "POST",
        body: new URLSearchParams({ title: ARIA_FAV_FOLDER_TITLE, privacy: "1", csrf }),
        signal,
      },
    );
    const id = Number(data?.id ?? data?.fid);
    if (Number.isFinite(id) && id > 0) {
      const folder = { id, title: ARIA_FAV_FOLDER_TITLE, media_count: 0 } satisfies BiliFavFolder;
      ariaFolderCache = { cookie: auth, at: Date.now(), folder };
      return folder;
    }
    // Some API responses omit the new folder id; re-list once to find it.
    const folders = await listBilibiliFavFolders(mid, signal);
    const folder = folders.find(isAriaFavFolder) ?? null;
    ariaFolderCache = { cookie: auth, at: Date.now(), folder };
    return folder;
  })().finally(() => {
    ariaFolderCreatePromise = null;
  });
  const created = await ariaFolderCreatePromise;
  if (!created) {
    throw new SourceError("UPSTREAM_FAILED", "B站收藏夹「Aria」创建失败，请稍后重试", { source: "bilibili" });
  }
  return created;
}

async function fetchBilibiliFavPage(mediaId: number, page: number): Promise<BiliFavPage> {
  return biliAuthJson<BiliFavPage>(
    `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${page}&ps=${FAV_PAGE_SIZE}&platform=web`,
  );
}

function mapBilibiliFavMedia(media: BiliFavMedia, folderTitle: string): ProviderTrack | null {
  const bvid = typeof media.bvid === "string" ? media.bvid : "";
  if (!/^BV[0-9A-Za-z]+$/.test(bvid)) return null;
  if (media.type !== undefined && media.type !== 2) return null;
  // attr 0 is a normal video; deleted/private favourites carry other flags.
  if (media.attr !== undefined && media.attr !== 0) return null;
  const title = stripHtml(String(media.title ?? "B站视频")).trim();
  return {
    id: bvid,
    title: title || "B站视频",
    artist: stripHtml(String(media.upper?.name ?? "B站 UP 主")),
    album: folderTitle ? `B站 · ${folderTitle}` : "B站收藏",
    duration: Number(media.duration ?? 0) || 0,
    quality: "320K",
    source: "bilibili",
    streamUrl: `/api/sources/bilibili/tracks/${encodeURIComponent(bvid)}/stream`,
    videoUrl: `/api/sources/bilibili/tracks/${encodeURIComponent(bvid)}/video`,
    hasVideo: true,
    videoQuality: null,
    coverUrl: normalizeCover(media.cover),
    bitrate: null,
    sampleRate: null,
    currentLevel: null,
    availableLevels: ["standard", "higher", "exhigh", "lossless", "hires"],
    vip: false,
    bpm: null,
    likedAt: media.fav_time ? media.fav_time * 1000 : null,
  };
}

export async function getBilibiliLikedTracks(): Promise<ProviderTrack[]> {
  const auth = await readAuthCookie();
  if (!auth) {
    throw new SourceError("AUTH_REQUIRED", "登录B站后可同步收藏", { source: "bilibili" });
  }
  if (likedCache?.cookie === auth && Date.now() - likedCache.at < LIKED_CACHE_MS) {
    return likedCache.tracks;
  }
  const account = await getBilibiliAccount();
  if (!account.connected || !account.userId) {
    throw new SourceError("AUTH_REQUIRED", "B站登录已过期，请重新登录", { source: "bilibili" });
  }
  const folder = await findBilibiliAriaFolder(account.userId);
  if (!folder) {
    likedCache = { cookie: auth, at: Date.now(), tracks: [] };
    return [];
  }

  const tracks: ProviderTrack[] = [];
  const seen = new Set<string>();
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= FAV_MAX_PAGES) {
    // Five pages in flight keeps a large Aria folder responsive without
    // hammering Bilibili hard enough to trigger its risk-control responses.
    const batchSize = Math.min(5, FAV_MAX_PAGES - page + 1);
    const pages = await Promise.all(
      Array.from({ length: batchSize }, (_, index) => fetchBilibiliFavPage(folder.id, page + index)),
    );
    for (const data of pages) {
      for (const media of data?.medias ?? []) {
        const track = mapBilibiliFavMedia(media, folder.title);
        if (!track || seen.has(track.id)) continue;
        seen.add(track.id);
        tracks.push(track);
      }
    }
    hasMore = pages.at(-1)?.has_more === true;
    page += batchSize;
  }
  tracks.sort((left, right) => (right.likedAt ?? 0) - (left.likedAt ?? 0));
  likedCache = { cookie: auth, at: Date.now(), tracks };
  return tracks;
}

export async function setBilibiliLike(trackId: string, liked: boolean): Promise<{ ok: boolean; liked: boolean }> {
  const auth = await readAuthCookie();
  if (!auth) {
    throw new SourceError("AUTH_REQUIRED", "登录B站后可同步收藏", { source: "bilibili" });
  }
  const csrf = parseCookiePairs(auth).get("bili_jct");
  if (!csrf) {
    throw new SourceError("AUTH_REQUIRED", "B站登录信息缺少 bili_jct，请重新登录", { source: "bilibili" });
  }
  const account = await getBilibiliAccount();
  if (!account.connected || !account.userId) {
    throw new SourceError("AUTH_REQUIRED", "B站登录已过期，请重新登录", { source: "bilibili" });
  }
  const view = await getBilibiliView(trackId);
  if (!view.aid) {
    throw new SourceError("UNAVAILABLE", "无法解析B站视频的 avid", { source: "bilibili" });
  }
  const folder = liked
    ? await ensureBilibiliAriaFolder(account.userId)
    : await findBilibiliAriaFolder(account.userId);
  if (!folder) {
    // Removing a video that was never in the Aria folder is already a no-op.
    return { ok: true, liked: false };
  }
  const body = new URLSearchParams({
    rid: String(view.aid),
    type: "2",
    add_media_ids: liked ? String(folder.id) : "",
    del_media_ids: liked ? "" : String(folder.id),
    csrf,
  });
  await biliAuthJson("https://api.bilibili.com/x/v3/fav/resource/deal", {
    method: "POST",
    body,
  });
  likedCache = null;
  accountCache = null;
  return { ok: true, liked };
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
function normalizeCover(value: string | undefined | null) {
  if (!value) return undefined;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://")) return `https://${value.slice(7)}`;
  return value;
}

export function parseBilibiliDuration(value: string | number | undefined | null): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (!value) return 0;
  const parts = String(value).split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]));
  if (parts.length === 2) return Math.max(0, Math.round(parts[0] * 60 + parts[1]));
  return 0;
}

export function parseBilibiliTrackId(trackId: string): { bvid: string; cid?: string } {
  const [bvid, cid] = trackId.split(":", 2);
  if (!/^BV[0-9A-Za-z]+$/.test(bvid ?? "")) {
    throw new SourceError("UNAVAILABLE", "B站视频 ID 无效", { source: "bilibili" });
  }
  return { bvid, cid: cid && /^\d+$/.test(cid) ? cid : undefined };
}

async function biliJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cookie = attempt > 0
      ? mergeCookieHeaders(await ensureCookies(true), await readAuthCookie())
      : await requestCookie();
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": BILIBILI_UA,
          Referer: BILIBILI_REFERER,
          Accept: "application/json, text/plain, */*",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        signal: abortSignal(signal),
      });
      absorbCookies(response);
      const text = await response.text();
      let body: { code?: number; message?: string; data?: T } | null = null;
      try {
        body = JSON.parse(text) as { code?: number; message?: string; data?: T };
      } catch {
        throw new SourceError("UPSTREAM_FAILED", "B站返回了无法解析的响应", {
          source: "bilibili",
        });
      }
      if (RISK_CODES.has(Number(body.code)) && attempt === 0) {
        cookiesExpireAt = 0;
        continue;
      }
      if (!response.ok || body.code !== 0) {
        const code = Number(body.code ?? response.status);
        const message = stripHtml(String(body.message ?? "B站请求失败"));
        if (RISK_CODES.has(code)) {
          throw new SourceError("RATE_LIMITED", "B站请求过于频繁，请稍后再试", {
            source: "bilibili",
            retryAfterMs: 30_000,
          });
        }
        throw new SourceError("UPSTREAM_FAILED", message || "B站请求失败", { source: "bilibili" });
      }
      return body.data as T;
    } catch (error) {
      lastError = error;
      if (error instanceof SourceError) throw error;
      if (attempt === 0) continue;
    }
  }
  throw new SourceError("UPSTREAM_FAILED", lastError instanceof Error ? lastError.message : "B站请求失败", {
    source: "bilibili",
  });
}

export async function searchBilibiliTracks(query: string, limit: number, offset: number): Promise<ProviderTrack[]> {
  const pageSize = Math.max(1, Math.min(30, limit));
  const page = Math.floor(offset / pageSize) + 1;
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`;
  const data = await biliJson<{ result?: Array<Record<string, unknown>> }>(url);
  const items = Array.isArray(data?.result) ? data.result : [];
  return items.flatMap((item, index) => {
    const bvid = typeof item.bvid === "string" ? item.bvid : "";
    if (!/^BV[0-9A-Za-z]+$/.test(bvid)) return [];
    const title = stripHtml(String(item.title ?? "B站视频")).trim();
    const artist = stripHtml(String(item.author ?? "B站 UP 主")).trim();
    const duration = parseBilibiliDuration(item.duration as string | number | undefined);
    const typename = stripHtml(String(item.typename ?? "")).trim();
    return [{
      id: bvid,
      title: title || "B站视频",
      artist: artist || "B站 UP 主",
      album: typename ? `B站 · ${typename}` : "B站视频",
      duration,
      quality: "320K",
      source: "bilibili",
      streamUrl: `/api/sources/bilibili/tracks/${encodeURIComponent(bvid)}/stream`,
      videoUrl: `/api/sources/bilibili/tracks/${encodeURIComponent(bvid)}/video`,
      hasVideo: true,
      videoQuality: null,
      coverUrl: normalizeCover(typeof item.pic === "string" ? item.pic : undefined),
      bitrate: null,
      sampleRate: null,
      currentLevel: null,
      availableLevels: ["standard", "higher", "exhigh", "lossless", "hires"],
      vip: false,
      bpm: null,
      likedAt: null,
    } satisfies ProviderTrack];
  });
}

export async function getBilibiliView(trackId: string, signal?: AbortSignal): Promise<BiliViewData> {
  const { bvid } = parseBilibiliTrackId(trackId);
  const cached = viewCache.get(bvid);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.data;
  const data = await biliJson<BiliViewData>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    signal,
  );
  if (!data?.cid) throw new SourceError("UNAVAILABLE", "B站视频没有可播放的音轨", { source: "bilibili" });
  const normalized: BiliViewData = {
    ...data,
    bvid,
    cid: Number(data.pages?.[0]?.cid ?? data.cid),
    title: stripHtml(String(data.title ?? "B站视频")),
    pic: normalizeCover(data.pic),
    duration: parseBilibiliDuration(data.duration),
    owner: { name: stripHtml(String(data.owner?.name ?? "B站 UP 主")) },
    typename: data.typename ? stripHtml(data.typename) : undefined,
  };
  viewCache.set(bvid, { at: Date.now(), data: normalized });
  if (viewCache.size > 120) {
    const oldest = viewCache.keys().next().value;
    if (oldest) viewCache.delete(oldest);
  }
  return normalized;
}

function audioBaseUrl(audio: BiliAudio) {
  return audio.baseUrl ?? audio.base_url ?? "";
}

function audioMime(audio: BiliAudio) {
  if (audio.kind === "flac" || /flac/i.test(audio.codecs ?? "")) return "audio/flac";
  const mime = audio.mimeType ?? audio.mime_type;
  if (mime) return mime;
  return "audio/mp4";
}

function requestedLevel(level: AriaLevel | undefined) {
  if (!level || level === "jymaster") return "hires";
  return level;
}

function audioMatchesEntry(audio: BiliAudio, entry: (typeof AUDIO_LEVELS)[number]) {
  if (audio.id === entry.id) return true;
  if (entry.level === "hires" && audio.kind === "flac") return true;
  if (entry.level === "lossless" && audio.kind === "dolby") return true;
  return false;
}

function chooseAudio(audios: BiliAudio[], level: AriaLevel | undefined) {
  const requested = requestedLevel(level);
  const requestedIndex = AUDIO_LEVELS.findIndex((entry) => entry.level === requested);
  const present = AUDIO_LEVELS.filter((entry) => audios.some((audio) => audioMatchesEntry(audio, entry)));
  if (!present.length) return null;
  const find = (entry: (typeof AUDIO_LEVELS)[number]) => audios.find((audio) => audioMatchesEntry(audio, entry))!;
  const exact = present.find((entry) => entry.level === requested);
  if (exact) return { entry: exact, audio: find(exact) };
  // Graceful degradation: prefer the highest format at or below the request,
  // then the lowest available format above it.
  const ordered = [...present].sort((left, right) => AUDIO_LEVELS.indexOf(left) - AUDIO_LEVELS.indexOf(right));
  const lower = requestedIndex < 0 ? [] : ordered.filter((entry) => AUDIO_LEVELS.indexOf(entry) <= requestedIndex);
  const entry = lower.at(-1) ?? ordered[0];
  return { entry, audio: find(entry) };
}

async function playurl(
  trackId: string,
  fnval: number,
  level: AriaLevel | undefined,
  signal?: AbortSignal,
  qnOverride?: number,
) {
  const view = await getBilibiliView(trackId, signal);
  const requestedQn = qnOverride ?? (level === "standard" ? 64 : 120);
  const data = await biliJson<BiliPlayData>(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(view.bvid)}&cid=${view.cid}&fnval=${fnval}&fnver=0&fourk=1&qn=${requestedQn}`,
    signal,
  );
  return { view, data };
}

export async function resolveBilibiliStreamMeta(
  trackId: string,
  options: { level?: AriaLevel; refresh?: boolean },
  signal?: AbortSignal,
): Promise<SourceStreamMeta> {
  const { data } = await playurl(trackId, 4048, options.level, signal);
  const audios: BiliAudio[] = [...(data?.dash?.audio ?? [])];
  const flacAudio = data?.dash?.flac?.audio;
  if (flacAudio) audios.push({ ...flacAudio, id: flacAudio.id || 30251, kind: "flac" });
  const dolbyAudio = data?.dash?.dolby?.audio;
  if (dolbyAudio) audios.push({ ...dolbyAudio, id: dolbyAudio.id || 30250, kind: "dolby" });
  const chosen = chooseAudio(audios, options.level);
  const durl = data?.durl?.[0]?.url;
  const url = chosen ? audioBaseUrl(chosen.audio) : durl;
  if (!url) {
    throw new SourceError("UNAVAILABLE", "B站没有返回可播放的音轨", { source: "bilibili" });
  }
  const availableLevels = AUDIO_LEVELS
    .filter((entry) => audios.some((audio) => audioMatchesEntry(audio, entry)))
    .map((entry) => entry.level);
  return {
    url: url.startsWith("//") ? `https:${url}` : url,
    headers: {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER,
      Cookie: await requestCookie(),
    },
    mimeType: chosen ? audioMime(chosen.audio) : "audio/mp4",
    bitrate: chosen?.audio.bandwidth ?? null,
    sampleRate: null,
    quality: chosen?.entry.quality ?? "320K",
    currentLevel: chosen?.entry.level ?? "exhigh",
    availableLevels: availableLevels.length ? availableLevels : ["standard", "higher", "exhigh"],
    expiresAt: Date.now() + STREAM_URL_TTL_MS,
  };
}

export async function resolveBilibiliVideoMeta(
  trackId: string,
  options: { level?: AriaLevel },
  signal?: AbortSignal,
): Promise<SourceVideoMeta> {
  const { data } = await playurl(trackId, 0, "hires", signal, 120);
  const durl = data?.durl?.[0];
  const url = durl?.url;
  if (!url) {
    throw new SourceError("UNAVAILABLE", "该B站视频暂不提供可播放的视频流", { source: "bilibili" });
  }
  const qualityIndex = data?.accept_quality?.findIndex((value) => value === data?.quality) ?? -1;
  const quality =
    qualityIndex >= 0
      ? data?.accept_description?.[qualityIndex]
      : data?.accept_description?.[0] ?? "360P";
  return {
    url: url.startsWith("//") ? `https:${url}` : url,
    headers: {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER,
      Cookie: await requestCookie(),
    },
    mimeType: "video/mp4",
    quality: quality ?? "360P",
    expiresAt: Date.now() + STREAM_URL_TTL_MS,
  };
}

type BiliSubtitle = {
  lan?: string;
  lan_doc?: string;
  subtitle_url?: string;
};

async function getBilibiliWbiKeys(signal?: AbortSignal) {
  if (wbiKeysCache && Date.now() - wbiKeysCache.at < WBI_KEYS_TTL_MS) return wbiKeysCache;
  const cookie = await requestCookie();
  const nav = await fetchBilibiliNav(cookie, signal);
  rememberWbiKeys(nav);
  return wbiKeysCache;
}

async function getBilibiliSubtitles(view: BiliViewData, signal?: AbortSignal): Promise<BiliSubtitle[]> {
  const params = new URLSearchParams({
    bvid: view.bvid,
    cid: String(view.cid),
  });
  if (view.aid) params.set("aid", String(view.aid));
  try {
    const legacy = await biliJson<{ subtitle?: { subtitles?: BiliSubtitle[] } }>(
      `https://api.bilibili.com/x/player/v2?${params}`,
      signal,
    );
    const subtitles = legacy?.subtitle?.subtitles ?? [];
    if (subtitles.length) return subtitles;
  } catch {
    // Fall through to the signed endpoint used by the web player.
  }

  const keys = await getBilibiliWbiKeys(signal);
  if (!keys) return [];
  const queryParams: Record<string, string> = {
    bvid: view.bvid,
    cid: String(view.cid),
  };
  if (view.aid) queryParams.aid = String(view.aid);
  try {
    const signed = await biliJson<{ subtitle?: { subtitles?: BiliSubtitle[] } }>(
      `https://api.bilibili.com/x/player/wbi/v2?${signWbiQuery(queryParams, keys.imgKey, keys.subKey)}`,
      signal,
    );
    return signed?.subtitle?.subtitles ?? [];
  } catch {
    return [];
  }
}

function formatLyricTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export async function getBilibiliLyrics(trackId: string, signal?: AbortSignal): Promise<LyricLine[]> {
  try {
    const view = await getBilibiliView(trackId, signal);
    const subtitles = await getBilibiliSubtitles(view, signal);
    const preferred = subtitles.find((item) => /zh|ai-zh/i.test(item.lan ?? "")) ?? subtitles[0];
    if (!preferred?.subtitle_url) return [];
    const url = preferred.subtitle_url.startsWith("//")
      ? `https:${preferred.subtitle_url}`
      : preferred.subtitle_url;
    const response = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        Cookie: await requestCookie(),
      },
      signal: abortSignal(signal),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { body?: Array<{ from?: number; content?: string }> };
    return (body.body ?? []).flatMap((line) => {
      const text = String(line.content ?? "").trim();
      if (!text) return [];
      const startTime = Number(line.from ?? 0);
      return [{ time: formatLyricTime(startTime), startTime, text, timingVersion: 1 } satisfies LyricLine];
    });
  } catch {
    // Subtitle availability is optional; a missing lyric must never block playback.
    return [];
  }
}

export function resetBilibiliStateForTests() {
  cookies = new Map();
  cookiesExpireAt = 0;
  cookiePromise = null;
  viewCache.clear();
  authCookieCache = null;
  accountCache = null;
  likedCache = null;
  ariaFolderCache = null;
  ariaFolderCreatePromise = null;
  wbiKeysCache = null;
  qrSessions.clear();
}
