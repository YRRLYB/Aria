import { randomUUID } from "node:crypto";
import { HttpError } from "../../utils/httpError";
import type { SourceAccount, SourceQrLoginCheck, SourceQrLoginStart } from "../contract";
import { saveQqCookie, MUSICU_URL, QQ_REFERER } from "./client";
import { CookieJar } from "./cookieJar";

/**
 * QQ Music QR login, following the ptlogin2 ptqrlogin flow used by the web and
 * desktop clients:
 *
 *   ptqrshow → ptqrlogin poll → check_sig (302, no cookies) →
 *   oauth2.0/authorize (POST, signed with p_skey) → QQConnectLogin.LoginServer
 *
 * Three details make or break it, and all three are easy to get wrong:
 *  - `xlogin` must NOT be called: it hands out pt4_token/supertoken/oauthtoken
 *    for the xui session, and carrying those cookies into `check_sig` makes the
 *    PT login server answer with `p_skey_forbid` and an empty `p_skey`.
 *  - the three graph cookies (`p_uin`, `p_skey`, `pt_oauth_token`) come from the
 *    `check_sig` 302 itself, not from a followed redirect chain.
 *  - `oauth2.0/authorize` has to be a POST signed with `g_tk = hash33(p_skey)`.
 *    Without that signature graph.qq.com returns the consent page
 *    (`oauth2.0/show`) instead of redirecting back with a `code`.
 */

const PT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const PTQRSHOW_URL = "https://ssl.ptlogin2.qq.com/ptqrshow";
const PTQRLOGIN_URL = "https://ssl.ptlogin2.qq.com/ptqrlogin";
const AUTHORIZE_URL = "https://graph.qq.com/oauth2.0/authorize";
const APPID = "716027609";
const DAID = "383";
const PT_3RD_AID = "100497308";
const U1 = "https://graph.qq.com/oauth2.0/login_jump";
const REDIRECT_URI = "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F";
const GRAPH_ORIGIN = "https://graph.qq.com/";
const QR_TTL_MS = 120_000;
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
  qrsig: string;
  status: "waiting" | "scanned" | "expired" | "success";
  account: SourceAccount | null;
};

const sessions = new Map<string, QrSession>();

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

  const params = new URLSearchParams({
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
  const qr = await fetch(`${PTQRSHOW_URL}?${params.toString()}`, {
    headers: { "User-Agent": PT_UA, Referer: "https://xui.ptlogin2.qq.com/", Accept: "image/*,*/*;q=0.8" },
  });
  if (!qr.ok) {
    await qr.body?.cancel();
    throw new HttpError(502, "二维码获取失败，请稍后重试", "QQ_QR_IMAGE_FAILED");
  }
  const setCookies = typeof qr.headers.getSetCookie === "function" ? qr.headers.getSetCookie() : [];
  const qrsig = cookieValue(setCookies, "qrsig");
  const png = Buffer.from(await qr.arrayBuffer());
  if (!qrsig) {
    throw new HttpError(502, "二维码获取失败（qrsig 缺失）", "QQ_QR_IMAGE_FAILED");
  }

  const session: QrSession = {
    id: randomUUID(),
    createdAt: Date.now(),
    expiresAt: Date.now() + QR_TTL_MS,
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

function cookieValue(setCookies: string[], name: string): string {
  for (const line of setCookies) {
    const pair = line.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    if (value) return value;
  }
  return "";
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
    js_ver: "20102616",
    js_type: "1",
    pt_uistyle: "40",
    aid: APPID,
    daid: DAID,
    pt_3rd_aid: PT_3RD_AID,
    has_onekey: "1",
  });
  const poll = await fetch(`${PTQRLOGIN_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": PT_UA,
      Referer: "https://xui.ptlogin2.qq.com/",
      // Only the QR cookie belongs on the poll: every extra ptlogin cookie
      // changes what the server is willing to issue at check_sig.
      Cookie: `qrsig=${session.qrsig}`,
    },
  });
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
      const account = await completeLogin(checkSigUrl, nickname);
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

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

/**
 * `check_sig` answers with a 302 whose Set-Cookie carries the three graph
 * cookies; the browser then loads `login_jump` and POSTs the signed authorize
 * request. Replaying that by hand is what finally yields the OAuth `code`.
 */
async function completeLogin(checkSigUrl: string, nickname: string): Promise<SourceAccount> {
  if (!/^https:\/\//i.test(checkSigUrl)) {
    throw new HttpError(502, "QQ 登录回调地址无效", "QQ_QR_CONFIRM_FAILED");
  }

  const checkSig = await fetch(checkSigUrl, {
    headers: { "User-Agent": PT_UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "manual",
  });
  const jar = new CookieJar();
  jar.store(checkSig, checkSigUrl);
  const jumpUrl = checkSig.headers.get("location");
  await checkSig.body?.cancel();

  const pUin = jar.get("p_uin", GRAPH_ORIGIN);
  const pSkey = jar.get("p_skey", GRAPH_ORIGIN);
  const ptOauthToken = jar.get("pt_oauth_token", GRAPH_ORIGIN);
  if (!jumpUrl || !pUin || !pSkey || !ptOauthToken) {
    throw new HttpError(
      502,
      `QQ 登录确认失败（check_sig 未返回所需 Cookie：${jar.names().join(", ") || "无"}），请重新扫码`,
      "QQ_QR_CONFIRM_FAILED",
    );
  }

  const graphCookie = `p_uin=${pUin}; p_skey=${pSkey}; pt_oauth_token=${ptOauthToken}`;
  // login_jump completes the PT handshake in the browser; the body is a script
  // we do not need, only its side effect on the graph session.
  const jump = await fetch(new URL(jumpUrl, checkSigUrl).href, {
    headers: { "User-Agent": PT_UA, Cookie: graphCookie },
    redirect: "manual",
  });
  await jump.body?.cancel();

  const authorize = await fetch(AUTHORIZE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": PT_UA,
      Origin: GRAPH_ORIGIN.slice(0, -1),
      Referer: GRAPH_ORIGIN,
      Cookie: graphCookie,
    },
    body: new URLSearchParams({
      response_type: "code",
      client_id: PT_3RD_AID,
      redirect_uri: REDIRECT_URI,
      scope: "get_user_info,get_app_friends",
      state: randomUUID().replace(/-/g, ""),
      switch: "",
      from_ptlogin: "1",
      src: "1",
      update_auth: "1",
      openapi: "1010_1030",
      g_tk: String(hash33(pSkey)),
      auth_time: String(Date.now()),
      ui: randomUUID(),
    }).toString(),
    redirect: "manual",
  });
  const authorizeLocation = authorize.headers.get("location") ?? "";
  await authorize.body?.cancel();
  const code = authorizeLocation.match(/[?&]code=([^&#]+)/)?.[1] ?? "";
  if (!code) {
    throw new HttpError(
      502,
      `QQ 授权失败（${authorize.status} ${shortUrl(authorizeLocation || "无跳转")}），请重新扫码`,
      "QQ_QR_AUTHORIZE_FAILED",
    );
  }

  const exchange = await fetch(`${MUSICU_URL}?format=json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: QQ_REFERER,
      Origin: "https://y.qq.com",
      "User-Agent": PT_UA,
    },
    body: JSON.stringify({
      comm: { g_tk: 5381, platform: "yqq", ct: 24, cv: 0 },
      req: { module: "QQConnectLogin.LoginServer", method: "QQLogin", param: { code } },
    }),
  });
  const payload = (await exchange.json().catch(() => null)) as {
    code?: number;
    req?: { code?: number; data?: { musicid?: number | string; musickey?: string } };
  } | null;
  const data = payload?.req?.data;
  if (!exchange.ok || !data?.musickey) {
    throw new HttpError(502, "QQ 登录成功但换取音乐凭据失败", "QQ_QR_EXCHANGE_FAILED");
  }
  const uin = String(data.musicid ?? "").replace(/\D/g, "");
  const saved = await saveQqCookie(`uin=o${uin}; qm_keyst=${data.musickey}; qqmusic_key=${data.musickey}`);
  return {
    connected: saved.connected,
    nickname: saved.nickname ?? (nickname || null),
    userId: saved.userId ?? (uin || null),
    avatarUrl: saved.avatarUrl,
  };
}
