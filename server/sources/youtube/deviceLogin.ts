import QRCode from "qrcode";
import type { SourceAccount, SourceQrLoginCheck, SourceQrLoginStart } from "../contract";
import { SourceError } from "../contract";
import { saveYoutubeOauthSession, youtubeRawFetch } from "./client";

/**
 * YouTube 设备码登录（RFC 8628，智能电视同款授权通道）。
 *
 * Google 对第三方嵌入浏览器登录 accounts.google.com 有一套不透明且粘性的
 * 风控（「此浏览器或应用可能不安全」），窗口登录在个别账号上仍可能被拦。
 * 设备码流程从结构上绕开了这堵墙：
 *
 *   1. `POST oauth2.googleapis.com/device/code`（YouTube TV 客户端凭证，
 *      与 SmartTube / yt-dlp / YouTube.js 同源）→ 拿到 user_code 与激活网址；
 *   2. 用户在手机上任意浏览器（通常已登录 Google）打开激活网址输入代码并
 *      确认——凭据输入发生在用户自己的浏览器里，Aria 全程不接触密码页；
 *   3. 轮询 `POST oauth2.googleapis.com/token` 直到授权完成；
 *   4. 用 access token 走 `accounts.google.com/accounts/OAuthLogin?source=
 *      youtube&issueuberauth=1` → 302 到 MergeSession → 跟随重定向收集
 *      Set-Cookie，得到标准 youtube.com 会话 Cookie（SID/SAPISID/LOGIN_INFO
 *      等与窗口登录捕获完全同种），交给现有 saveYoutubeCookie 管线。
 *
 * 契约与 QQ/B站一致（startQrLogin/checkQrLogin），复用泛型
 * `/api/sources/:id/qr/*` 路由；区别只是多一个需要用户抄录的 user_code。
 *
 * 流量全部经 `youtubeRawFetch` 走用户配置的 YouTube 代理（同搜索/播放）。
 */

const DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TV_HOME_URL = "https://www.youtube.com/tv";
const OAUTH_LOGIN_URL = "https://accounts.google.com/accounts/OAuthLogin?source=youtube&issueuberauth=1";

// SmartTube 系客户端多年验证的 TV OAuth 凭证兜底值；优先从 YouTube 自家
// base.js 里现抓（同 SmartTube Android 的做法），抓不到才落到这里。
const FALLBACK_TV_CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com";
const FALLBACK_TV_CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT";

// `openid` 换取 gaiaId（Multilogin 备用通道需要）；gdata/youtube(-paid-content)
// 与 SmartTube 完全一致——这套 scope 与 OAuthLogin 换 Cookie 步骤配套验证过。
const OAUTH_SCOPE =
  "openid profile http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content https://www.googleapis.com/auth/youtube";

const TV_UA =
  "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/56.0.2924.0 TV Safari/537.36";
const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEVICE_TIMEOUT_MS = 12_000;
const MERGE_TIMEOUT_MS = 15_000;
const MAX_REDIRECT_HOPS = 10;
const CREDENTIALS_TTL_MS = 6 * 60 * 60 * 1000;

type TvCredentials = { clientId: string; clientSecret: string };
let credCache: (TvCredentials & { at: number }) | null = null;

type YoutubeDeviceSession = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  clientId: string;
  clientSecret: string;
  intervalSeconds: number;
  expiresAt: number;
};
const sessions = new Map<string, YoutubeDeviceSession>();

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
}

/** 从 YouTube TV 页面的 base.js 里现抓 TV OAuth 凭证（SmartTube Android 同款）。 */
async function scrapeTvCredentials(): Promise<TvCredentials | null> {
  try {
    const home = await youtubeRawFetch(TV_HOME_URL, {
      headers: { "user-agent": TV_UA, accept: "text/html" },
      signal: AbortSignal.timeout(DEVICE_TIMEOUT_MS),
    });
    if (!home.ok) return null;
    const html = await home.text();
    const baseMatch = html.match(/id="base-js" src="([^"]+)"/);
    if (!baseMatch) return null;
    const baseJsUrl = new URL(baseMatch[1], "https://www.youtube.com").toString();
    const jsResponse = await youtubeRawFetch(baseJsUrl, {
      headers: { "user-agent": TV_UA },
      signal: AbortSignal.timeout(DEVICE_TIMEOUT_MS),
    });
    if (!jsResponse.ok) return null;
    const js = await jsResponse.text();
    const clientId = js.match(/clientId:"([-\w.]+\.apps\.googleusercontent\.com)"/)?.[1];
    const clientSecret = js.match(/clientId:"[-\w.]+\.apps\.googleusercontent\.com",\s*[\w$]+:"(\w+)"/)?.[1];
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

async function loadTvCredentials(): Promise<TvCredentials> {
  if (credCache && Date.now() - credCache.at < CREDENTIALS_TTL_MS) {
    return { clientId: credCache.clientId, clientSecret: credCache.clientSecret };
  }
  const scraped = await scrapeTvCredentials();
  const creds = scraped ?? { clientId: FALLBACK_TV_CLIENT_ID, clientSecret: FALLBACK_TV_CLIENT_SECRET };
  credCache = { ...creds, at: Date.now() };
  return creds;
}

async function formPost(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await youtubeRawFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": WEB_UA,
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(DEVICE_TIMEOUT_MS),
  });
  let json: Record<string, unknown>;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new SourceError("UPSTREAM_FAILED", `Google 授权服务响应异常（HTTP ${response.status}）`, { source: "youtube" });
  }
  return json;
}

/** 测试专用：清空凭证缓存与待确认会话，避免跨用例状态泄漏。 */
export function resetYoutubeDeviceStateForTests() {
  credCache = null;
  sessions.clear();
}

/** 发起设备码登录：返回二维码与需要用户在手机上输入的代码。 */
export async function startYoutubeDeviceLogin(): Promise<SourceQrLoginStart> {
  pruneExpiredSessions();
  const creds = await loadTvCredentials();
  const json = await formPost(DEVICE_CODE_URL, {
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: OAUTH_SCOPE,
  });
  const deviceCode = typeof json.device_code === "string" ? json.device_code : "";
  const userCode = typeof json.user_code === "string" ? json.user_code : "";
  const verificationUrl = typeof json.verification_url === "string" ? json.verification_url : "";
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 0;
  const interval = typeof json.interval === "number" ? json.interval : 5;
  if (!deviceCode || !userCode || !verificationUrl || expiresIn <= 0) {
    throw new SourceError("UPSTREAM_FAILED", "Google 设备码响应不完整，请稍后重试", { source: "youtube" });
  }
  sessions.set(deviceCode, {
    deviceCode,
    userCode,
    verificationUrl,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    intervalSeconds: Math.max(5, interval),
    expiresAt: Date.now() + expiresIn * 1000,
  });
  let qrImage: string;
  try {
    qrImage = await QRCode.toDataURL(verificationUrl, { margin: 1, width: 320, errorCorrectionLevel: "M" });
  } catch {
    throw new SourceError("UPSTREAM_FAILED", "二维码生成失败，请稍后重试", { source: "youtube" });
  }
  return { key: deviceCode, qrImage, expiresIn, userCode, verificationUrl };
}

// ---------------------------------------------------------------------------
// access token → youtube.com 会话 Cookie（OAuthLogin → MergeSession 链）
// ---------------------------------------------------------------------------

type JarEntry = { name: string; value: string; domain: string };

function hostMatchesDomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function addCookieFromHeader(jar: Map<string, JarEntry>, setCookieLine: string, requestUrl: string) {
  const parts = setCookieLine.split(";");
  const [namePart, ...attrParts] = parts;
  const eq = namePart.indexOf("=");
  if (eq <= 0) return;
  const name = namePart.slice(0, eq).trim();
  const value = namePart.slice(eq + 1).trim();
  if (!name || !value) return;
  let domain: string;
  const domainAttr = attrParts
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("domain="));
  if (domainAttr) {
    domain = domainAttr.slice("domain=".length).replace(/^\./, "").toLowerCase();
  } else {
    try {
      domain = new URL(requestUrl).hostname.toLowerCase();
    } catch {
      return;
    }
  }
  // 后写覆盖前写，模拟浏览器对同名 Cookie 的更新语义。
  jar.set(`${name}@${domain}`, { name, value, domain });
}

function cookieHeaderFor(jar: Map<string, JarEntry>, url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
  const matching = [...jar.values()].filter((entry) => hostMatchesDomain(host, entry.domain));
  return matching.map((entry) => `${entry.name}=${entry.value}`).join("; ");
}

function youtubeCookieHeader(jar: Map<string, JarEntry>): string | null {
  const entries = [...jar.values()].filter((entry) => entry.domain === "youtube.com" || entry.domain.endsWith(".youtube.com"));
  const names = new Set(entries.map((entry) => entry.name));
  const hasSession = names.has("SID") || names.has("__Secure-1PSID") || names.has("__Secure-3PSID");
  const hasLoginMarker =
    names.has("SAPISID") ||
    names.has("__Secure-1PAPISID") ||
    names.has("__Secure-3PAPISID") ||
    names.has("LOGIN_INFO");
  if (!hasSession || !hasLoginMarker) return null;
  return entries.map((entry) => `${entry.name}=${entry.value}`).join("; ");
}

/**
 * 用设备码流程拿到的 access token 换取 youtube.com 标准会话 Cookie。
 * 链路（SmartTube / yt-dlp 同款）：
 *   GET accounts.google.com/accounts/OAuthLogin?source=youtube&issueuberauth=1
 *     （Bearer，手动停住重定向）→ 302 Location 带 uberauth 的 MergeSession
 *   GET MergeSession → 跟随重定向并逐跳收集 Set-Cookie → youtube.com 会话。
 */
export async function mintYoutubeSessionCookie(accessToken: string): Promise<string> {
  const step1 = await youtubeRawFetch(OAUTH_LOGIN_URL, {
    headers: { authorization: `Bearer ${accessToken}`, "user-agent": WEB_UA, accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(MERGE_TIMEOUT_MS),
  });
  const location = step1.headers.get("location");
  if (!location || step1.status < 300 || step1.status >= 400) {
    throw new SourceError(
      "UPSTREAM_FAILED",
      `Google 未签发会话跳转（HTTP ${step1.status}），授权可能未包含 YouTube 权限`,
      { source: "youtube" },
    );
  }
  const jar = new Map<string, JarEntry>();
  let currentUrl = location;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    const response = await youtubeRawFetch(currentUrl, {
      headers: {
        "user-agent": WEB_UA,
        accept: "text/html",
        ...(jar.size > 0 ? { cookie: cookieHeaderFor(jar, currentUrl) } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(MERGE_TIMEOUT_MS),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      addCookieFromHeader(jar, line, currentUrl);
    }
    const nextLocation = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && nextLocation) {
      currentUrl = new URL(nextLocation, currentUrl).toString();
      continue;
    }
    break;
  }
  const header = youtubeCookieHeader(jar);
  if (!header) {
    throw new SourceError(
      "UPSTREAM_FAILED",
      "授权成功，但未能从 Google 换取完整的 YouTube 会话 Cookie，请改用窗口登录或 Cookie 备用绑定",
      { source: "youtube" },
    );
  }
  return header;
}

/** 轮询设备码状态；授权完成后换取 Cookie 并直接保存为 YouTube 登录态。 */
export async function checkYoutubeDeviceLogin(key: string): Promise<SourceQrLoginCheck> {
  const session = sessions.get(key);
  if (!session) {
    return { code: 65, status: "expired", message: "设备码会话不存在或已过期，请重新生成。", account: null };
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return { code: 65, status: "expired", message: "设备码已过期，请重新生成。", account: null };
  }
  const json = await formPost(TOKEN_URL, {
    code: key,
    client_id: session.clientId,
    client_secret: session.clientSecret,
    grant_type: "http://oauth.net/grant_type/device/1.0",
  });
  const error = typeof json.error === "string" ? json.error : null;
  if (error === "authorization_pending" || error === "slow_down") {
    return { code: 66, status: "waiting", message: "等待手机确认授权…", account: null };
  }
  if (error === "access_denied") {
    sessions.delete(key);
    return { code: 65, status: "expired", message: "已在手机上取消授权，请重新生成后再试。", account: null };
  }
  if (error === "expired_token") {
    sessions.delete(key);
    return { code: 65, status: "expired", message: "设备码已过期，请重新生成。", account: null };
  }
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) {
    return {
      code: 65,
      status: "expired",
      message: `Google 授权失败（${error ?? "未知错误"}），请重新生成后再试。`,
      account: null,
    };
  }
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
  const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
  const tokenType = typeof json.token_type === "string" ? json.token_type : null;
  sessions.delete(key);

  let mintedCookie: string | null = null;
  try {
    mintedCookie = await mintYoutubeSessionCookie(accessToken);
  } catch {
    // Google 已限制/停用部分账号的 legacy OAuthLogin→MergeSession 换取浏览器
    // Cookie 链路；保留 OAuth2 Bearer 会话仍可完成完整登录与账号读取。
    mintedCookie = null;
  }

  let account: SourceAccount;
  try {
    account = await saveYoutubeOauthSession({
      accessToken,
      refreshToken,
      expiresIn,
      clientId: session.clientId,
      clientSecret: session.clientSecret,
      tokenType,
      cookie: mintedCookie,
    });
  } catch (error) {
    const message = error instanceof SourceError ? error.message : error instanceof Error ? error.message : "未知错误";
    return {
      code: 65,
      status: "expired",
      message: `手机授权成功，但登录会话建立失败：${message}`,
      account: null,
    };
  }
  return { code: 0, status: "success", message: "登录成功", account };
}
