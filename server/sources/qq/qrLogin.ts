import { randomUUID } from "node:crypto";
import { HttpError } from "../../utils/httpError";
import type { SourceAccount, SourceQrLoginCheck, SourceQrLoginStart } from "../contract";
import { saveQqCookie, MUSICU_URL, QQ_REFERER } from "./client";

/**
 * QQ Music QR login, mirroring the web player's ptlogin2 flow:
 * xlogin → ptqrshow → ptqrlogin poll → check_sig → oauth2.0/authorize →
 * QQConnectLogin.LoginServer/QQLogin, whose data.musicid/musickey are the
 * uin/qm_keyst pair saved into the app store. Session state lives in memory
 * only; cookies never reach the renderer.
 */

const PT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const XLOGIN_URL = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin";
const PTQRSHOW_URL = "https://xui.ptlogin2.qq.com/ssl/ptqrshow";
const PTQRLOGIN_URL = "https://xui.ptlogin2.qq.com/ssl/ptqrlogin";
const AUTHORIZE_URL = "https://graph.qq.com/oauth2.0/authorize";
const APPID = "716027609";
const DAID = "383";
const PT_3RD_AID = "100497308";
const U1 = "https://graph.qq.com/oauth2.0/login_jump";
const REDIRECT_URI = "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F";
const QR_TTL_MS = 110_000;
const SESSION_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 32;

/** DJB2 hash: seed 0 for ptqrtoken, the default 5381 for g_tk. */
export function hash33(value: string, seed = 5381): number {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash += (hash << 5) + value.charCodeAt(index);
    hash &= 0x7fffffff;
  }
  return hash;
}

type QrSession = {
  id: string;
  createdAt: number;
  expiresAt: number;
  jar: Map<string, string>;
  ptLoginSig: string;
  qrsig: string;
  status: "waiting" | "scanned" | "expired" | "success";
  account: SourceAccount | null;
};

const sessions = new Map<string, QrSession>();

function collectCookies(jar: Map<string, string>, response: Response) {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = line.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export async function startQqQrLogin(): Promise<SourceQrLoginStart> {
  pruneSessions();
  const jar = new Map<string, string>();

  const xloginParams = new URLSearchParams({
    appid: APPID,
    daid: DAID,
    style: "33",
    hide_title_bar: "1",
    hide_border: "1",
    target: "self",
    s_url: U1,
    pt_3rd_aid: PT_3RD_AID,
    theme: "2",
  });
  const xlogin = await fetch(`${XLOGIN_URL}?${xloginParams.toString()}`, {
    headers: { "User-Agent": PT_UA },
  });
  collectCookies(jar, xlogin);
  await xlogin.body?.cancel();
  const ptLoginSig = jar.get("pt_login_sig");
  if (!ptLoginSig) {
    throw new HttpError(502, "QQ 登录会话创建失败（pt_login_sig 缺失）", "QQ_QR_SESSION_FAILED");
  }

  const qrParams = new URLSearchParams({
    appid: APPID,
    e: "2",
    l: "M",
    s: "3",
    d: "72",
    v: "4",
    t: String(Math.random()),
    daid: DAID,
    pt_3rd_aid: PT_3RD_AID,
    u1: U1,
  });
  const qr = await fetch(`${PTQRSHOW_URL}?${qrParams.toString()}`, {
    headers: { "User-Agent": PT_UA, Referer: "https://xui.ptlogin2.qq.com/", Accept: "image/*,*/*;q=0.8" },
  });
  collectCookies(jar, qr);
  if (!qr.ok) {
    await qr.body?.cancel();
    throw new HttpError(502, "二维码获取失败，请稍后重试", "QQ_QR_IMAGE_FAILED");
  }
  const png = Buffer.from(await qr.arrayBuffer());
  const qrsig = jar.get("qrsig");
  if (!qrsig) {
    throw new HttpError(502, "二维码获取失败（qrsig 缺失）", "QQ_QR_IMAGE_FAILED");
  }

  const session: QrSession = {
    id: randomUUID(),
    createdAt: Date.now(),
    expiresAt: Date.now() + QR_TTL_MS,
    jar,
    ptLoginSig,
    qrsig,
    status: "waiting",
    account: null,
  };
  sessions.set(session.id, session);
  return {
    key: session.id,
    qrImage: `data:image/png;base64,${png.toString("base64")}`,
    expiresIn: Math.round(QR_TTL_MS / 1000),
  };
}

function parsePtuiCallback(text: string): string[] | null {
  const match = text.match(/ptuiCB\(([^)]*)\)/);
  if (!match) return null;
  return match[1].split(",").map((arg) => arg.trim().replace(/^'(.*)'$/s, "$1"));
}

export async function checkQqQrLogin(key: string): Promise<SourceQrLoginCheck> {
  const session = sessions.get(key);
  if (!session) {
    throw new HttpError(404, "二维码会话不存在或已过期，请重新生成", "QQ_QR_SESSION_MISSING");
  }
  if (session.status === "success" && session.account) {
    return { code: 0, status: "success", message: "登录成功", account: session.account };
  }
  if (Date.now() > session.expiresAt) {
    session.status = "expired";
    return { code: 65, status: "expired", message: "二维码已过期，请重新生成", account: null };
  }

  const params = new URLSearchParams({
    u1: U1,
    ptqrtoken: String(hash33(session.qrsig, 0)),
    ptredirect: "0",
    h: "1",
    t: "1",
    g: "1",
    from_ui: "1",
    ptlang: "2052",
    action: `0-0-${Date.now()}`,
    js_ver: "26030415",
    js_type: "1",
    login_sig: session.ptLoginSig,
    pt_uistyle: "40",
    aid: APPID,
    daid: DAID,
    pt_3rd_aid: PT_3RD_AID,
  });
  const poll = await fetch(`${PTQRLOGIN_URL}?${params.toString()}`, {
    headers: { "User-Agent": PT_UA, Referer: "https://xui.ptlogin2.qq.com/", Cookie: cookieHeader(session.jar) },
  });
  collectCookies(session.jar, poll);
  const text = await poll.text();
  const args = parsePtuiCallback(text);
  const code = args ? Number(args[0]) : 66;

  if (code === 67) {
    session.status = "scanned";
    return { code, status: "scanned", message: "已扫码，请在手机上确认登录", account: null };
  }
  if (code === 65) {
    session.status = "expired";
    return { code, status: "expired", message: "二维码已过期，请重新生成", account: null };
  }
  if (code === 0) {
    const checkSigUrl = safeDecode(args?.[2] ?? "");
    const nickname = args?.[5] ?? "";
    try {
      const account = await completeLogin(session, checkSigUrl, nickname);
      session.status = "success";
      session.account = account;
      return { code: 0, status: "success", message: "登录成功", account };
    } catch (error) {
      sessions.delete(session.id);
      const message = error instanceof HttpError ? error.message : "登录确认失败，请重新扫码";
      return { code: -1, status: "expired", message, account: null };
    }
  }
  return { code: 66, status: "waiting", message: "等待扫码", account: null };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type LoginChain = {
  code: string | null;
  finalUrl: string;
  cookieNames: string[];
  trace: string[];
};

function refererFor(url: string): string {
  if (url.includes("graph.qq.com")) return "https://graph.qq.com/";
  if (url.includes("ptlogin2.qq.com")) return "https://xui.ptlogin2.qq.com/";
  return QQ_REFERER;
}

/** Cookie lookup that treats an empty value (e.g. `p_skey=;`) as absent. */
function jarValue(jar: Map<string, string>, name: string): string {
  const value = jar.get(name);
  return value && value.trim() ? value.trim() : "";
}

function signingCookie(jar: Map<string, string>): string {
  // `g_tk` is derived from p_skey (or the older skey); other tokens such as
  // pt4_token/supertoken are not signing cookies and produce an invalid g_tk.
  return jarValue(jar, "p_skey") || jarValue(jar, "skey");
}

function extractAuthCode(url: string): string | null {
  const match = url.match(/[?&]code=([^&#]+)/);
  return match ? safeDecode(match[1]) : null;
}

/** Landing pages sometimes hand the redirect to JS/meta instead of a Location header. */
function extractCodeFromBody(body: string): string | null {
  const normalized = normalizeHtml(body);
  const direct = normalized.match(/[?#&]code=([^"'&#\s<>]{4,})/);
  if (direct) return safeDecode(direct[1]);
  const redirect = normalized.match(/https?:\/\/[^"'\s<>]*wx_redirect[^"'\s<>]*/);
  return redirect ? extractAuthCode(redirect[0]) : null;
}

function normalizeHtml(body: string): string {
  return body.replace(/&amp;/g, "&").replace(/\\\//g, "/");
}

/**
 * `graph.qq.com/oauth2.0/login_jump` finishes in the browser with a script that
 * navigates to the signed authorize URL (which carries `pt_login_type`,
 * `pt_oauth_token` and `g_tk`). The plain authorize endpoint without those
 * parameters only shows the consent page, so that URL has to be followed.
 */
function extractRedirectUrl(body: string): string | null {
  const normalized = normalizeHtml(body);
  const urls = normalized.match(/https?:\/\/[^"'\s<>\\]+/g) ?? [];
  const candidate = urls.find(
    (url) => /oauth2\.0\/authorize|wx_redirect/.test(url) && !/oauth2\.0\/show/.test(url),
  );
  if (candidate) return candidate;
  const relative = normalized.match(/\/oauth2\.0\/authorize\?[^"'\s<>\\]+/);
  return relative ? relative[0] : null;
}

/** Shape-only summary of a landing page, safe to surface in an error message. */
function describeBody(body: string): string {
  const flags: string[] = [];
  if (/<form/i.test(body)) flags.push("form");
  if (/<script/i.test(body)) flags.push("script");
  if (/http-equiv=["']?refresh/i.test(body)) flags.push("meta-refresh");
  const urls = body.match(/https?:\/\//g)?.length ?? 0;
  if (urls) flags.push(`urls=${urls}`);
  return flags.join(",") || "empty";
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 72);
  } catch {
    return url.slice(0, 72);
  }
}

/**
 * The ptlogin callback hands back a `check_sig` URL. Following it with the
 * session cookies walks the real browser chain (check_sig → login_jump →
 * authorize → redirect_uri); the OAuth `code` ends up either in a Location
 * header or inside a landing page.
 *
 * That chain is the whole login: `p_skey` is only needed for the fallback where
 * the chain stops early and the authorize request has to be signed by hand.
 * PT login frequently sets `p_skey` to an empty value together with
 * `p_skey_forbid`, so treating any presence of that cookie as “signed” breaks
 * confirmation right after the phone approved the scan.
 */
async function followLoginChain(session: QrSession, startUrl: string): Promise<LoginChain> {
  let target: string | null = startUrl;
  let code: string | null = null;
  const trace: string[] = [];
  const visited = new Set<string>();
  for (let hop = 0; hop < 10 && target; hop += 1) {
    if (visited.has(target)) {
      trace.push(`loop ${shortUrl(target)}`);
      break;
    }
    visited.add(target);
    const response = await fetch(target, {
      headers: {
        "User-Agent": PT_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: refererFor(target),
        Cookie: cookieHeader(session.jar),
      },
      redirect: "manual",
    });
    collectCookies(session.jar, response);
    const location = response.headers.get("location");
    const setNames = (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [])
      .map((line) => line.split("=", 1)[0].trim())
      .filter(Boolean);
    const setSuffix = setNames.length ? ` set:${setNames.join("/")}` : "";
    if (location) {
      await response.body?.cancel();
      const next = new URL(location, target).href;
      trace.push(`${response.status} ${shortUrl(target)} → ${shortUrl(next)}${setSuffix}`);
      code = code ?? extractAuthCode(next);
      target = next;
      if (code) break;
      continue;
    }
    const body = await response.text().catch(() => "");
    const bodyCode = extractCodeFromBody(body);
    if (bodyCode) {
      code = bodyCode;
      trace.push(`${response.status} ${shortUrl(target)}${setSuffix} code=body`);
      break;
    }
    const scripted = extractRedirectUrl(body);
    if (scripted) {
      const next = new URL(scripted, target).href;
      trace.push(`${response.status} ${shortUrl(target)}${setSuffix} →js ${shortUrl(next)}`);
      target = next;
      continue;
    }
    trace.push(`${response.status} ${shortUrl(target)}${setSuffix} code=no(${describeBody(body)})`);
    break;
  }
  return { code, finalUrl: target ?? startUrl, cookieNames: [...session.jar.keys()].sort(), trace };
}

/** Fallback: sign the authorize request ourselves with p_skey/skey. */
function authorizeParams(session: QrSession): URLSearchParams {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: PT_3RD_AID,
    redirect_uri: REDIRECT_URI,
    scope: "get_user_info,get_app_friends",
    state: "state",
    from_ptlogin: "1",
    update_auth: "1",
    openapi: "1010_1030",
    auth_time: String(Date.now()),
    ui: (session.jar.get("ui") ?? "").toUpperCase(),
  });
  // login_jump hands the browser a parameter-signed authorize URL. Without
  // these ptlogin markers graph.qq.com stops at the consent page instead of
  // redirecting back with a code, so mirror whatever the session has.
  const loginType = jarValue(session.jar, "pt_login_type");
  if (loginType) params.set("pt_login_type", loginType);
  const oauthToken = jarValue(session.jar, "pt_oauth_token");
  if (oauthToken) params.set("pt_oauth_token", oauthToken);
  const pt4Token = jarValue(session.jar, "pt4_token");
  if (pt4Token) params.set("pt4_token", pt4Token);
  const signing = signingCookie(session.jar);
  if (signing) params.set("g_tk", String(hash33(signing)));
  return params;
}

/** Fallback: hit the authorize endpoint directly with the session cookies. */
async function requestAuthorizeCode(session: QrSession): Promise<string | null> {
  const authorize = await fetch(AUTHORIZE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": PT_UA,
      Origin: "https://graph.qq.com",
      Referer: "https://graph.qq.com/",
      Cookie: cookieHeader(session.jar),
    },
    body: authorizeParams(session).toString(),
    redirect: "manual",
  });
  collectCookies(session.jar, authorize);
  await authorize.body?.cancel();
  return extractAuthCode(authorize.headers.get("location") ?? "");
}

function buildAuthorizeUrl(session: QrSession): string {
  return `${AUTHORIZE_URL}?${authorizeParams(session).toString()}`;
}

async function completeLogin(session: QrSession, checkSigUrl: string, nickname: string): Promise<SourceAccount> {
  if (!/^https:\/\//i.test(checkSigUrl)) {
    throw new HttpError(502, "QQ 登录回调地址无效", "QQ_QR_CONFIRM_FAILED");
  }
  const chain = await followLoginChain(session, checkSigUrl);
  // `p_skey=` empty (paired with `p_skey_forbid`) must not count as signed.
  let gtkKey = signingCookie(session.jar);
  let code = chain.code;
  let trace = chain.trace;
  if (!code) {
    // The chain may stop on login_jump's scripted page. Browser-load the
    // parameter-signed authorize URL next so graph.qq.com completes the grant
    // instead of showing its consent page.
    const authorizeRedirect = await followLoginChain(session, buildAuthorizeUrl(session));
    code = authorizeRedirect.code;
    trace = trace.concat(authorizeRedirect.trace);
    gtkKey = signingCookie(session.jar);
    if (!code) {
      const cookieNames = authorizeRedirect.cookieNames.join(", ") || "无";
      const traceText = trace.slice(-4).join(" ; ").slice(0, 320);
      throw new HttpError(
        502,
        `QQ 登录确认失败（授权链路未返回 code，cookies: ${cookieNames}；链路: ${traceText}），请重新扫码`,
        "QQ_QR_CONFIRM_FAILED",
      );
    }
  }
  if (!code) {
    code = await requestAuthorizeCode(session);
  }
  if (!code) {
    const traceText = trace.slice(-4).join(" ; ").slice(0, 320);
    throw new HttpError(502, `QQ 授权失败（未取得 code；链路: ${traceText}）`, "QQ_QR_AUTHORIZE_FAILED");
  }

  // Exchange the code for the music credentials.
  const exchangeKey = session.jar.get("qqmusic_key") ?? gtkKey;
  const exchange = await fetch(`${MUSICU_URL}?format=json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: QQ_REFERER,
      "User-Agent": PT_UA,
      Cookie: cookieHeader(session.jar),
    },
    body: JSON.stringify({
      comm: { g_tk: exchangeKey ? hash33(exchangeKey) : 5381, platform: "yqq", ct: 24, cv: 0 },
      req: { module: "QQConnectLogin.LoginServer", method: "QQLogin", param: { code } },
    }),
  });
  if (!exchange.ok) {
    throw new HttpError(502, "QQ 音乐凭据换取失败", "QQ_QR_EXCHANGE_FAILED");
  }
  const payload = (await exchange.json()) as {
    req?: { code?: number; data?: { musicid?: number | string; musickey?: string } };
  };
  const data = payload.req?.data;
  if (!data?.musickey) {
    throw new HttpError(502, "QQ 登录成功但换取音乐凭据失败", "QQ_QR_EXCHANGE_FAILED");
  }
  const uin = String(data.musicid ?? "");
  const saved = await saveQqCookie(`uin=o${uin}; qqmusic_key=${data.musickey}`);
  return {
    connected: saved.connected,
    nickname: saved.nickname ?? (nickname || null),
    userId: saved.userId ?? (uin || null),
    avatarUrl: saved.avatarUrl,
  };
}
