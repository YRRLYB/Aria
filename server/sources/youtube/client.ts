import { createHash } from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import type { ProviderPlaylist, ProviderTrack } from "../../providers/musicProvider";
import type { AriaLevel, SourceStreamMeta, SourceVideoMeta, SourceVideoQuality } from "../contract";
import { SourceError, levelsUpTo } from "../contract";
import { readStore, updateStore } from "../../store";

/**
 * YouTube Music source client.
 *
 * Everything here speaks the internal `youtubei` (Innertube) API that the
 * YouTube web clients use: search against music.youtube.com (WEB_REMIX) and
 * stream resolution against www.youtube.com/player with a fallback chain of
 * client contexts (IOS → ANDROID → WEB_EMBEDDED_PLAYER), because the web
 * client's formats need signature deciphering while the app-style contexts
 * usually return direct progressive/DASH audio URLs.
 *
 * Proxy: YouTube is commonly unreachable without one from mainland networks.
 * The user configures a proxy in 设置 → 播放源 → YouTube（端口）， and ONLY
 * this source routes through it — NetEase/QQ/Bilibili always stay direct so
 * domestic playback is never detoured through a foreign exit.
 */

const SEARCH_TIMEOUT_MS = 10_000;
const PLAYER_TIMEOUT_MS = 12_000;
const STREAM_META_TTL_MS = 30 * 60_000;
const CONTINUATION_TTL_MS = 5 * 60_000;
const MAX_CONTINUATION_CACHE = 64;
const SEARCH_PAGE_SIZE = 24;
const LIKED_CACHE_MS = 2 * 60_000;
/** 公网常驻视频（"Me at the zoo"），仅用于登录态探测。 */
const VALIDATION_VIDEO_ID = "jNQXAC9IVRw";

const INNERTUBE_API_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WE4FDp30";
const MUSIC_SEARCH_URL = `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
const ACCOUNT_MENU_URL = `https://music.youtube.com/youtubei/v1/account/account_menu?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
const LIKE_ACTION_URL = `https://music.youtube.com/youtubei/v1/like/like?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
const REMOVELIKE_ACTION_URL = `https://music.youtube.com/youtubei/v1/like/removelike?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
const PLAYER_URL = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`;

type InnertubeContext = Record<string, unknown>;

function musicSearchContext(): InnertubeContext {
  return {
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20250210.01.00",
      hl: "zh-CN",
      gl: "US",
    },
  };
}

/**
 * 登录态探测专用：`responseContext.mainAppWebResponseContext.loggedin` 在
 * WEB 客户端上下文里最可靠，WEB_REMIX 不一定带这个字段。
 */
function webAccountProbeContext(): InnertubeContext {
  return {
    client: {
      clientName: "WEB",
      clientVersion: "2.20240726.00.00",
      hl: "zh-CN",
      gl: "US",
    },
  };
}

/** Android returns PO-token-free progressive muxed MP4 (`formats`), with iOS/Web fallback. */
const PLAYER_CLIENTS: Array<{ id: string; context: () => InnertubeContext }> = [
  {
    id: "ANDROID",
    context: () => ({
      client: {
        clientName: "ANDROID",
        clientVersion: "20.10.38",
        androidSdkVersion: 34,
        osName: "Android",
        osVersion: "14",
        hl: "zh-CN",
      },
    }),
  },
  {
    id: "IOS",
    context: () => ({
      client: {
        clientName: "IOS",
        clientVersion: "20.10.4",
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iPhone",
        osVersion: "18.3.2.22D82",
        hl: "zh-CN",
      },
    }),
  },
  {
    id: "WEB_EMBEDDED_PLAYER",
    context: () => ({
      client: {
        clientName: "WEB_EMBEDDED_PLAYER",
        clientVersion: "1.20240401.01.00",
        hl: "zh-CN",
      },
      thirdParty: { embedUrl: "https://www.youtube.com/" },
    }),
  },
];

const YOUTUBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)";
const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const WEB_UA = YOUTUBE_UA;

function clientUserAgent(contextId: string) {
  if (contextId === "IOS") return IOS_UA;
  if (contextId === "ANDROID") return ANDROID_UA;
  return WEB_UA;
}

// ---------------------------------------------------------------------------
// Proxy plumbing (YouTube only; every other source stays direct).
// ---------------------------------------------------------------------------

type ProxyState = {
  /** Raw user value from the store, e.g. "127.0.0.1:7890". */
  raw: string | null;
  /** Effective URI (may point at the Windows local relay when active). */
  effectiveUri: string | null;
  agent: ProxyAgent | null;
  fetchedAt: number;
};

const PROXY_RECHECK_MS = 2_000;
let proxyState: ProxyState = { raw: null, effectiveUri: null, agent: null, fetchedAt: 0 };

/** Normalize "7890"/"127.0.0.1:7890"/"http://127.0.0.1:7890" to a full URI. */
export function normalizeYoutubeProxyInput(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  // Full URL form. undici's ProxyAgent speaks HTTP(S) CONNECT; other schemes
  // (socks) are rejected up front with a clear settings error instead of a
  // confusing upstream failure later.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (url.protocol === "https:" && /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(url.hostname)) {
        if (!url.port) return null;
        url.protocol = "http:";
        return url.origin;
      }
      if (!url.port && url.protocol === "http:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  // Bare port ("7890") or host:port.
  const match = trimmed.match(/^(?:([\w.-]+):)?(\d{2,5})$/);
  if (!match) return null;
  const host = match[1] || "127.0.0.1";
  const port = Number(match[2]);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return `http://${host}:${port}`;
}

async function currentProxyDispatcher(): Promise<Dispatcher | null> {
  const now = Date.now();
  if (now - proxyState.fetchedAt < PROXY_RECHECK_MS) return proxyState.agent;
  proxyState.fetchedAt = now;
  let raw: string | null = null;
  try {
    const store = await readStore();
    raw = normalizeYoutubeProxyInput(store.youtubeProxy ?? null);
  } catch {
    raw = null;
  }
  const relayFn = (globalThis as { __ariaEnsureYoutubeProxyRelay?: (uri: string) => Promise<string | null> })
    .__ariaEnsureYoutubeProxyRelay;
  let effectiveUri: string | null = raw;
  if (raw && typeof relayFn === "function") {
    try {
      effectiveUri = (await relayFn(raw)) || raw;
    } catch {
      effectiveUri = raw;
    }
  }
  if (raw !== proxyState.raw || effectiveUri !== proxyState.effectiveUri) {
    proxyState.agent?.close().catch(() => undefined);
    proxyState = {
      raw,
      effectiveUri,
      agent: effectiveUri ? new ProxyAgent({ uri: effectiveUri, requestTls: { timeout: 15_000 } }) : null,
      fetchedAt: now,
    };
  }
  return proxyState.agent;
}

function buildSapisidAuthorization(cookie: string, origin: string): string | null {
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID|__Secure-1PAPISID)=([^;]+)/);
  const sapisid = match?.[1]?.trim();
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const hash = createHash("sha1").update(`${ts} ${sapisid} ${origin}`).digest("hex");
  return `SAPISIDHASH ${ts}_${hash} SAPISID1PHASH ${ts}_${hash} SAPISID3PHASH ${ts}_${hash}`;
}

/** All YouTube API traffic goes through here: proxied when configured, direct otherwise. */
async function youtubeFetch(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    cookie?: string;
    userAgent?: string;
    origin?: string;
    includeSapisidAuth?: boolean;
  } = {},
) {
  const dispatcher = await currentProxyDispatcher();
  const origin = init.origin ?? "https://music.youtube.com";
  const authHeader =
    init.cookie && init.includeSapisidAuth !== false ? buildSapisidAuthorization(init.cookie, origin) : null;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": init.userAgent ?? YOUTUBE_UA,
    origin,
    "x-origin": origin,
    "x-goog-authuser": "0",
    ...(init.cookie ? { cookie: init.cookie } : {}),
    ...(authHeader ? { authorization: authHeader } : {}),
  };
  let response: Response;
  try {
    response = await undiciFetch(url, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(dispatcher ? { dispatcher } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SourceError(
      "UPSTREAM_FAILED",
      dispatcher
        ? `无法通过代理访问 YouTube，请确认代理端口正在运行（${detail}）`
        : `无法连接 YouTube，请检查网络或在「设置 → 播放源 → YouTube」里配置代理端口`,
      { source: "youtube" },
    );
  }
  return response;
}

/**
 * Low-level proxied fetch for non-innertube YouTube/Google endpoints (the
 * RFC 8628 device-code login and its session merge). Callers own headers,
 * bodies and redirect handling; only the proxy routing is shared so device
 * login follows 设置 → 播放源 → YouTube 的代理配置 exactly like search/play.
 */
export async function youtubeRawFetch(url: string, init: Parameters<typeof undiciFetch>[1] = {}) {
  const dispatcher = await currentProxyDispatcher();
  return undiciFetch(url, { ...init, ...(dispatcher ? { dispatcher } : {}) });
}

/**
 * Stable `fetch`-compatible cover fetcher for the shared RemoteCoverCache.
 * Reads the current proxy on every call so settings changes apply without a
 * server restart, and falls back to a direct request when no proxy is set.
 */
export const youtubeCoverFetcher: typeof fetch = async (input, init) => {
  const dispatcher = await currentProxyDispatcher();
  if (!dispatcher) return fetch(input, init);
  return undiciFetch(String(input), {
    ...(init as Record<string, unknown>),
    dispatcher,
  }) as unknown as Promise<Response>;
};

// ---------------------------------------------------------------------------
// Account (cookie binding)
// ---------------------------------------------------------------------------

let authCookieCache: { value: string; at: number } | null = null;
const AUTH_COOKIE_CACHE_MS = 2_000;

/** Current YouTube cookie, short-cached like the other sources. */
async function readAuthCookie(): Promise<string | null> {
  if (authCookieCache && Date.now() - authCookieCache.at < AUTH_COOKIE_CACHE_MS) return authCookieCache.value || null;
  try {
    const store = await readStore();
    authCookieCache = { value: (store.youtubeCookie ?? "").trim(), at: Date.now() };
  } catch {
    authCookieCache = { value: "", at: Date.now() };
  }
  return authCookieCache.value || null;
}

function clearYoutubeAuthCaches() {
  authCookieCache = null;
  accountCache = null;
  playlistsCacheState = null;
  likedCacheState = null;
  streamMetaCache.clear();
  videoMetaCache.clear();
}

type YoutubeAccountState = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
};

const ACCOUNT_CACHE_MS = 5 * 60_000;
let accountCache: { cookie: string; at: number; value: YoutubeAccountState } | null = null;

function pickLargestThumbnail(thumbnails: Array<Record<string, unknown>> | undefined): string | null {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return null;
  const sorted = [...thumbnails]
    .filter((entry) => typeof entry?.url === "string" && entry.url.trim())
    .sort((left, right) => (Number(right.width ?? 0) || 0) - (Number(left.width ?? 0) || 0));
  const raw = sorted[0]?.url;
  return typeof raw === "string" ? raw : null;
}

async function fetchYoutubeProfile(cookie: string): Promise<{
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
}> {
  try {
    const response = await youtubeFetch(ACCOUNT_MENU_URL, {
      method: "POST",
      timeoutMs: 6_000,
      cookie,
      body: { context: musicSearchContext() },
    });
    if (!response.ok) return { nickname: null, userId: null, avatarUrl: null };
    const data = (await response.json()) as unknown;
    const header = findKey(data, "activeAccountHeaderRenderer") as Record<string, unknown> | undefined;
    if (!header) return { nickname: null, userId: null, avatarUrl: null };
    const nickname = readInnertubeText(header.accountName as InnertubeText | undefined) || null;
    const handle = readInnertubeText(header.channelHandle as InnertubeText | undefined) || null;
    const thumbnails = (header.accountPhoto as { thumbnails?: Array<Record<string, unknown>> } | undefined)?.thumbnails;
    const avatarUrl = pickLargestThumbnail(thumbnails);
    return { nickname, userId: handle, avatarUrl };
  } catch {
    return { nickname: null, userId: null, avatarUrl: null };
  }
}

/**
 * 登录态探测：带上 Cookie 请求一次 player（"Me at the zoo"，公网常驻视频），
 * WEB_REMIX 响应的 responseContext.mainAppWebResponseContext.loggedin 会如实
 * 反映会话是否有效；确认在线后再读取 account_menu 的昵称与头像。
 * 字段缺失或暂无法联网时按「已保存」处理，避免上游结构微调把用户锁在外面。
 */
export async function getYoutubeAccount(): Promise<YoutubeAccountState> {
  const cookie = await readAuthCookie();
  if (!cookie) {
    return { connected: false, nickname: null, userId: null, avatarUrl: null };
  }
  if (accountCache?.cookie === cookie && Date.now() - accountCache.at < ACCOUNT_CACHE_MS) {
    return accountCache.value;
  }
  let value: YoutubeAccountState;
  try {
    const response = await youtubeFetch(PLAYER_URL, {
      method: "POST",
      timeoutMs: 8_000,
      origin: "https://www.youtube.com",
      cookie,
      body: {
        context: webAccountProbeContext(),
        videoId: VALIDATION_VIDEO_ID,
        contentCheckOk: true,
      },
    });
    if (!response.ok) {
      value = { connected: false, nickname: null, userId: null, avatarUrl: null };
    } else {
      const data = (await response.json()) as {
        responseContext?: { mainAppWebResponseContext?: { loggedin?: boolean; loggedOut?: boolean } };
      };
      const mainCtx = data.responseContext?.mainAppWebResponseContext;
      const connected =
        mainCtx?.loggedin !== undefined
          ? mainCtx.loggedin !== false
          : mainCtx?.loggedOut !== undefined
            ? mainCtx.loggedOut === false
            : true;
      const profile = connected
        ? await fetchYoutubeProfile(cookie)
        : { nickname: null, userId: null, avatarUrl: null };
      value = {
        connected,
        nickname: profile.nickname,
        userId: profile.userId,
        avatarUrl: profile.avatarUrl,
      };
    }
  } catch {
    // 网络不可达（未配代理/代理挂了）不代表 Cookie 失效：保持“已保存”。
    value = { connected: true, nickname: null, userId: null, avatarUrl: null };
  }
  accountCache = { cookie, at: Date.now(), value };
  return value;
}

export async function saveYoutubeCookie(cookie: string): Promise<YoutubeAccountState> {
  const trimmed = cookie.trim();
  if (!trimmed) {
    throw new SourceError("UNAVAILABLE", "请先粘贴 Cookie", { source: "youtube" });
  }
  if (!/SID=/.test(trimmed)) {
    throw new SourceError(
      "UNAVAILABLE",
      "Cookie 里缺少 SID 会话字段：请在已登录 YouTube 的浏览器标签页打开开发者工具 → Network，复制 music.youtube.com 请求的完整 Cookie 头",
      { source: "youtube" },
    );
  }
  await updateStore((store) => ({ ...store, youtubeCookie: trimmed }));
  clearYoutubeAuthCaches();
  // 保存后立刻探测一次；探测不了也保持“已保存”，与其它源的措辞一致。
  return getYoutubeAccount();
}

export async function clearYoutubeCookie(): Promise<YoutubeAccountState> {
  await updateStore((store) => ({ ...store, youtubeCookie: null }));
  clearYoutubeAuthCaches();
  return { connected: false, nickname: null, userId: null, avatarUrl: null };
}

// ---------------------------------------------------------------------------
// Account playlists (unified playlist page)
// ---------------------------------------------------------------------------

const MUSIC_BROWSE_URL = `https://music.youtube.com/youtubei/v1/browse?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
/** YouTube Music「喜欢的音乐」逻辑 ID；真实请求若 FEmusic_liked_songs 返回 400 则自动回退到 VLLM。 */
const LIKED_MUSIC_BROWSE_ID = "FEmusic_liked_songs";
const LIKED_MUSIC_VLLM_ID = "VLLM";
const PLAYLISTS_BROWSE_ID = "FEmusic_playlists";
const PLAYLISTS_LIKED_BROWSE_ID = "FEmusic_liked_playlists";
const BROWSE_PAGE_SIZE = 25;
const BROWSE_MAX_PAGES = 50;

let playlistsCacheState: { cookie: string; at: number; playlists: ProviderPlaylist[] } | null = null;
let likedCacheState: { cookie: string; at: number; tracks: ProviderTrack[] } | null = null;

/** 提取 browse 响应里的 continuation 令牌（搜索与歌单分页字段结构不同）。 */
function extractBrowseContinuationToken(data: unknown): string | null {
  const command = findKey(data, "continuationCommand") as Record<string, unknown> | undefined;
  const fromCommand = (command?.token as string | undefined) ?? undefined;
  if (fromCommand) return fromCommand;
  const continuations = findKey(data, "continuations") as Array<Record<string, unknown>> | undefined;
  const fromNext = (continuations?.[0]?.next as Record<string, unknown> | undefined)?.continuation as
    | string
    | undefined;
  if (fromNext) return fromNext;
  const item = findKey(data, "continuationItemRenderer") as Record<string, unknown> | undefined;
  const fromItem = (item?.token as string | undefined) ?? ((item?.continuationCommand as Record<string, unknown> | undefined)?.token as string | undefined);
  return fromItem ?? null;
}

/** 收集响应里全部货架（含 continuation 响应）中的行。 */
function collectShelfRows(data: unknown): Array<Record<string, unknown>> {
  const shelves: Array<Record<string, unknown>> = [];
  collectAll(data, "musicPlaylistShelfRenderer", shelves);
  collectAll(data, "musicShelfRenderer", shelves);
  collectAll(data, "musicPlaylistShelfContinuation", shelves);
  collectAll(data, "musicShelfContinuation", shelves);
  const rows: Array<Record<string, unknown>> = [];
  for (const shelf of shelves) {
    const contents = shelf.contents as Array<Record<string, unknown>> | undefined;
    for (const row of contents ?? []) rows.push(row);
  }
  const appendActions: Array<Record<string, unknown>> = [];
  collectAll(data, "appendContinuationItemsAction", appendActions);
  for (const action of appendActions) {
    const items = action.continuationItems as Array<Record<string, unknown>> | undefined;
    for (const row of items ?? []) rows.push(row);
  }
  return rows;
}

async function browseWithRetry(body: Record<string, unknown>): Promise<unknown> {
  const cookie = await readAuthCookie();
  const response = await youtubeFetch(MUSIC_BROWSE_URL, { method: "POST", body, ...(cookie ? { cookie } : {}) });
  if (response.ok) return (await response.json()) as unknown;

  // YouTube Music 近期将部分账号的「播放列表」和「赞过的音乐」browseId
  // 切换到了 FEmusic_liked_playlists / VLLM，旧 ID 会返回 400。
  const browseId = typeof body.browseId === "string" ? body.browseId : null;
  const fallbackBrowseId =
    browseId === PLAYLISTS_BROWSE_ID
      ? PLAYLISTS_LIKED_BROWSE_ID
      : browseId === LIKED_MUSIC_BROWSE_ID
        ? LIKED_MUSIC_VLLM_ID
        : null;
  if (fallbackBrowseId) {
    const fallbackResponse = await youtubeFetch(MUSIC_BROWSE_URL, {
      method: "POST",
      body: { ...body, browseId: fallbackBrowseId },
      ...(cookie ? { cookie } : {}),
    });
    if (fallbackResponse.ok) return (await fallbackResponse.json()) as unknown;
    throw new SourceError("UPSTREAM_FAILED", `YouTube 数据请求失败（${fallbackResponse.status}）`, { source: "youtube" });
  }
  throw new SourceError("UPSTREAM_FAILED", `YouTube 数据请求失败（${response.status}）`, { source: "youtube" });
}

/**
 * 登录账号的歌单清单（只读）。固定在最前面合成一张「喜欢的音乐」，
 * 其余来自账号「播放列表」货架；需要登录 Cookie，匿名返回明确错误。
 */
export async function getYoutubePlaylists(): Promise<ProviderPlaylist[]> {
  const cookie = await readAuthCookie();
  if (!cookie) {
    throw new SourceError("AUTH_REQUIRED", "登录 YouTube 后可同步你的音乐歌单", { source: "youtube" });
  }
  if (playlistsCacheState?.cookie === cookie && Date.now() - playlistsCacheState.at < LIKED_CACHE_MS) {
    return playlistsCacheState.playlists;
  }

  const playlists: ProviderPlaylist[] = [];
  const seen = new Set<string>([LIKED_MUSIC_BROWSE_ID, "LM", "VLLM"]);
  const likedMusic: ProviderPlaylist = {
    id: LIKED_MUSIC_BROWSE_ID,
    name: "喜欢的音乐",
    source: "youtube",
    trackCount: likedCacheState?.cookie === cookie ? likedCacheState.tracks.length : 0,
    subscribed: false,
    owned: true,
    canEdit: false,
    coverColor: "#FF0033",
    coverUrl: null,
    description: "YouTube Music 喜欢的音乐",
  };
  playlists.push(likedMusic);

  const data = await browseWithRetry({ context: musicSearchContext(), browseId: PLAYLISTS_BROWSE_ID });
  const cards: Array<Record<string, unknown>> = [];
  collectAll(data, "musicTwoRowItemRenderer", cards);
  collectAll(data, "musicResponsiveListItemRenderer", cards);
  for (const card of cards) {
    const rawBrowseId = findKey(card, "browseId") as string | undefined;
    const rawPlaylistId = findKey(card, "playlistId") as string | undefined;
    const playlistId = (rawPlaylistId ?? rawBrowseId ?? "").replace(/^VL/, "").trim();
    if (!playlistId || playlistId === "SE" || seen.has(playlistId)) continue;
    const title = readInnertubeText(findKey(card, "title") as InnertubeText | undefined);
    if (!title || title === "新建播放列表" || title === "稍后再听") continue;
    const subtitle = readInnertubeText(findKey(card, "subtitle") as InnertubeText | undefined);
    const trackCount = Number((subtitle.match(/[\d,]+/) ?? ["0"])[0].replace(/,/g, "")) || 0;
    const thumbnails = (findKey(card, "thumbnails") as Array<Record<string, unknown>> | undefined) ?? [];
    const coverUrl = typeof thumbnails?.[0]?.url === "string" ? (thumbnails[0].url as string) : null;
    seen.add(playlistId);
    playlists.push({
      id: playlistId,
      name: title,
      source: "youtube",
      trackCount,
      subscribed: false,
      owned: true,
      canEdit: false,
      coverColor: "#FF0033",
      coverUrl,
      description: "YouTube Music 播放列表",
    });
  }

  playlistsCacheState = { cookie, at: Date.now(), playlists };
  return playlists;
}

/** 获取账号「喜欢的音乐」（用于「我喜欢」页聚合与 YouTube 独立分栏）。 */
export async function getYoutubeLikedTracks(): Promise<ProviderTrack[]> {
  const cookie = await readAuthCookie();
  if (!cookie) {
    throw new SourceError("AUTH_REQUIRED", "登录 YouTube 后可同步喜欢的音乐", { source: "youtube" });
  }
  if (likedCacheState?.cookie === cookie && Date.now() - likedCacheState.at < LIKED_CACHE_MS) {
    return likedCacheState.tracks;
  }
  const result = await getYoutubePlaylistTracks(LIKED_MUSIC_BROWSE_ID);
  const now = Date.now();
  const tracks = result.tracks.map((track, index) => ({
    ...track,
    likedAt: track.likedAt ?? now - index * 1000,
  }));
  likedCacheState = { cookie, at: now, tracks };
  return tracks;
}

export async function setYoutubeLike(trackId: string, liked: boolean): Promise<{ ok: boolean; liked: boolean }> {
  const cookie = await readAuthCookie();
  if (!cookie) {
    throw new SourceError("AUTH_REQUIRED", "登录 YouTube 后才能收藏歌曲", { source: "youtube" });
  }
  const cleanId = trackId.trim();
  if (!/^[\w-]{6,16}$/.test(cleanId)) {
    throw new SourceError("UNAVAILABLE", "无效的 YouTube 曲目 ID", { source: "youtube" });
  }
  const url = liked ? LIKE_ACTION_URL : REMOVELIKE_ACTION_URL;
  const response = await youtubeFetch(url, {
    method: "POST",
    cookie,
    body: {
      context: musicSearchContext(),
      target: { videoId: cleanId },
    },
  });
  if (!response.ok) {
    throw new SourceError("UPSTREAM_FAILED", `YouTube 红心操作失败（${response.status}）`, { source: "youtube" });
  }
  likedCacheState = null;
  return { ok: true, liked };
}

/**
 * 歌单曲目详情。playlistId 为 `FEmusic_liked_songs`（喜欢的音乐）或
 * 普通 `PL…` 播放列表 ID（browse 时加 VL 前缀）；自动跟随 continuation 翻页。
 */
export async function getYoutubePlaylistTracks(playlistId: string): Promise<{
  title?: string;
  tracks: ProviderTrack[];
}> {
  const cookie = await readAuthCookie();
  if (!cookie) {
    throw new SourceError("AUTH_REQUIRED", "登录 YouTube 后可读取歌单曲目", { source: "youtube" });
  }
  const browseId = playlistId === LIKED_MUSIC_BROWSE_ID
    ? LIKED_MUSIC_BROWSE_ID
    : `VL${playlistId.replace(/^VL/, "")}`;

  const tracks: ProviderTrack[] = [];
  const seen = new Set<string>();
  const seenTokens = new Set<string>();
  let title = "";
  let body: Record<string, unknown> = { context: musicSearchContext(), browseId };
  for (let page = 0; page < BROWSE_MAX_PAGES; page += 1) {
    const data = await browseWithRetry(body);
    if (!title) {
      const foundTitle = readInnertubeText(findKey(data, "title") as InnertubeText | undefined);
      if (foundTitle) title = foundTitle;
    }
    for (const row of collectShelfRows(data)) {
      const parsed = parseSearchRow(row);
      if (!parsed || seen.has(parsed.videoId as string)) continue;
      seen.add(parsed.videoId as string);
      const track = rowToProviderTrack(parsed, tracks.length);
      if (track) tracks.push(track);
    }
    const token = extractBrowseContinuationToken(data);
    if (!token || seenTokens.has(token)) break;
    seenTokens.add(token);
    body = { context: musicSearchContext(), continuation: token };
  }
  if (!tracks.length && playlistId !== LIKED_MUSIC_BROWSE_ID) {
    throw new SourceError("UNAVAILABLE", "该 YouTube 歌单为空，或需要登录账号才能读取", { source: "youtube" });
  }
  // 「喜欢的音乐」为空是合法状态：返回空列表而不是报错。
  return { title: title || undefined, tracks };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

type InnertubeTextRun = { text?: string };
type InnertubeText = { runs?: InnertubeTextRun[]; simpleText?: string };

function readInnertubeText(value: InnertubeText | undefined | null): string {
  if (!value) return "";
  if (value.simpleText) return value.simpleText;
  return (value.runs ?? []).map((run) => run.text ?? "").join("").trim();
}

/** Deep-search a nested Innertube response for the first matching key. */
function findKey(value: unknown, key: string, depth = 0): unknown {
  if (depth > 32 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record[key] !== undefined) return record[key];
  for (const child of Object.values(record)) {
    const found = findKey(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Collect every object stored under `key`, at any depth (search shelves). */
function collectAll(value: unknown, key: string, out: Array<Record<string, unknown>>, depth = 0) {
  if (depth > 32 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectAll(item, key, out, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [childKey, child] of Object.entries(record)) {
    if (childKey === key && child && typeof child === "object") {
      out.push(child as Record<string, unknown>);
      continue;
    }
    collectAll(child, key, out, depth + 1);
  }
}

function parseDurationText(text: string): number {
  const match = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

type SearchRow = {
  videoId?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationText?: string;
};

const DURATION_TEXT_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

function parseSearchRow(item: Record<string, unknown>): SearchRow | null {
  const renderer = (item.musicResponsiveListItemRenderer ?? item.musicTwoRowItemRenderer) as
    | Record<string, unknown>
    | undefined;
  if (!renderer) return null;

  // videoId: play overlay endpoint, navigation endpoint, or playlistItemData.
  const videoId =
    (findKey(renderer, "videoId") as string | undefined) ??
    ((renderer.playlistItemData as Record<string, unknown> | undefined)?.videoId as string | undefined);
  if (typeof videoId !== "string" || !/^[\w-]{6,16}$/.test(videoId)) return null;

  const flexColumns = (renderer.flexColumns as Array<Record<string, unknown>> | undefined) ?? [];
  const columnTexts = flexColumns
    .map((column) => readInnertubeText((column.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined)?.text as InnertubeText | undefined))
    .filter(Boolean);

  const title = columnTexts[0] ?? "";
  if (!title) return null;

  // 两种列布局都要能解析：搜索行是 [标题, "歌手 · 专辑", 时长]，
  // 歌单详情行是 [标题, 歌手, 专辑?, 时长]。
  const subtitleText = columnTexts[1] ?? "";
  let artist = "";
  let album = "";
  if (subtitleText.includes("•")) {
    const parts = subtitleText
      .split(/\s*•\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const kindPrefixes = new Set(["歌曲", "Song", "视频", "Video", "专辑", "Album", "播客", "Podcast"]);
    const firstIsKind = kindPrefixes.has(parts[0] ?? "");
    artist = firstIsKind ? (parts[1] ?? parts[0] ?? "") : (parts[0] ?? "");
    const restStart = firstIsKind ? 2 : 1;
    album = parts.slice(restStart).filter((part) => !DURATION_TEXT_RE.test(part)).join(" · ");
  } else {
    artist = subtitleText;
    const albumCandidate = columnTexts[2] ?? "";
    if (albumCandidate && !DURATION_TEXT_RE.test(albumCandidate.trim())) album = albumCandidate;
  }

  // Duration lives in fixedColumns (VLLM / playlist detail) or the last
  // flexColumn / subtitle tail for search rows.
  const fixedColumns = (renderer.fixedColumns as Array<Record<string, unknown>> | undefined) ?? [];
  const fixedTexts = fixedColumns
    .map((column) => readInnertubeText((column.musicResponsiveListItemFixedColumnRenderer as Record<string, unknown> | undefined)?.text as InnertubeText | undefined))
    .filter(Boolean);
  let durationText = fixedTexts.find((item) => DURATION_TEXT_RE.test(item.trim())) ?? "";
  if (!durationText) {
    const lastFlex = columnTexts.at(-1) ?? "";
    if (DURATION_TEXT_RE.test(lastFlex.trim())) {
      durationText = lastFlex;
    } else {
      const tail = subtitleText.split(/\s*•\s*/).map((part) => part.trim()).at(-1) ?? "";
      durationText = DURATION_TEXT_RE.test(tail) ? tail : "";
    }
  }

  return { videoId, title, artist, album, durationText: durationText.trim() };
}

function rowToProviderTrack(row: SearchRow, index: number): ProviderTrack | null {
  const duration = parseDurationText(row.durationText ?? "");
  const levels: AriaLevel[] = ["standard", "higher", "exhigh"];
  const encodedId = encodeURIComponent(row.videoId as string);
  return {
    id: row.videoId as string,
    title: row.title ?? "YouTube 视频",
    artist: row.artist?.trim() || "YouTube Music",
    album: row.album?.trim() || "YouTube Music",
    duration,
    quality: "AAC",
    source: "youtube",
    streamUrl: `/api/sources/youtube/tracks/${encodedId}/stream`,
    videoUrl: `/api/sources/youtube/tracks/${encodedId}/video`,
    hasVideo: true,
    videoQuality: null,
    coverUrl: `https://i.ytimg.com/vi/${row.videoId}/hqdefault.jpg`,
    bitrate: 128_000,
    sampleRate: 44_100,
    currentLevel: null,
    availableLevels: levels,
    vip: false,
    bpm: null,
    likedAt: null,
  };
}

type ContinuationCacheEntry = { token: string; query: string; at: number };
const continuationCache = new Map<string, ContinuationCacheEntry>();

function rememberContinuation(query: string, offset: number, limit: number, token: unknown) {
  if (typeof token !== "string" || !token) return;
  const step = Math.max(1, Math.min(limit || SEARCH_PAGE_SIZE, 40));
  const key = `${query}\u0000${offset + step}`;
  continuationCache.set(key, { token, query, at: Date.now() });
  if (continuationCache.size > MAX_CONTINUATION_CACHE) {
    const oldest = [...continuationCache.values()].sort((left, right) => left.at - right.at)[0];
    if (oldest) {
      for (const [mapKey, entry] of continuationCache) {
        if (entry === oldest) {
          continuationCache.delete(mapKey);
          break;
        }
      }
    }
  }
}

function takeContinuation(query: string, offset: number): string | null {
  const key = `${query}\u0000${offset}`;
  const entry = continuationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CONTINUATION_TTL_MS) {
    continuationCache.delete(key);
    return null;
  }
  return entry.token;
}

function extractContinuationToken(data: unknown): string | null {
  const command = findKey(data, "continuationCommand") as Record<string, unknown> | undefined;
  const token = (command?.token as string | undefined) ?? (findKey(data, "continuationItemRenderer") as Record<string, unknown> | undefined)?.token as string | undefined;
  return typeof token === "string" && token ? token : null;
}

export async function searchYoutubeTracks(
  query: string,
  limit: number,
  offset: number,
): Promise<ProviderTrack[]> {
  const text = query.trim();
  if (!text) return [];
  const continuation = offset > 0 ? takeContinuation(text, offset) : null;
  if (offset > 0 && !continuation) {
    // The continuation state for this page expired; the caller treats an
    // empty page as "no more results".
    return [];
  }

  const body: Record<string, unknown> = {
    context: musicSearchContext(),
    ...(continuation ? { continuation } : { query: text, params: "ggMGAQ==" }),
  };
  const response = await youtubeFetch(MUSIC_SEARCH_URL, { method: "POST", body });
  if (!response.ok) {
    throw new SourceError("UPSTREAM_FAILED", `YouTube 搜索请求失败（${response.status}）`, { source: "youtube" });
  }
  const data = (await response.json()) as unknown;

  // The response nests rows inside musicShelfRenderer, musicCardShelfRenderer
  // or itemSectionRenderer depending on query/account locale. Collect all of
  // them; items without a playable videoId are dropped by parseSearchRow.
  const shelves: Array<Record<string, unknown>> = [];
  collectAll(data, "musicShelfRenderer", shelves);
  collectAll(data, "musicCardShelfRenderer", shelves);
  collectAll(data, "itemSectionRenderer", shelves);
  const rows: Array<Record<string, unknown>> = [];
  for (const shelf of shelves) {
    const contents = shelf.contents as Array<Record<string, unknown>> | undefined;
    for (const row of contents ?? []) rows.push(row);
  }
  if (!rows.length) {
    collectAll(data, "musicResponsiveListItemRenderer", rows);
  }
  const tracks: ProviderTrack[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = parseSearchRow(row);
    if (!parsed || seen.has(parsed.videoId as string)) continue;
    seen.add(parsed.videoId as string);
    const track = rowToProviderTrack(parsed, tracks.length);
    if (track) tracks.push(track);
    if (tracks.length >= Math.max(1, Math.min(limit || SEARCH_PAGE_SIZE, 40))) break;
  }

  if (continuation || offset === 0) {
    rememberContinuation(text, offset, limit, extractContinuationToken(data));
  }
  return tracks;
}

// ---------------------------------------------------------------------------
// Stream resolution (player)
// ---------------------------------------------------------------------------

type AdaptiveFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  qualityLabel?: string;
  audioSampleRate?: string;
  audioQuality?: string;
};

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { videoId?: string; title?: string; author?: string; lengthSeconds?: string };
  streamingData?: {
    formats?: AdaptiveFormat[];
    adaptiveFormats?: AdaptiveFormat[];
    expiresInSeconds?: number;
  };
};

/** AAC 128k → standard, Opus ~70k → higher, Opus ~160k / Premium 256k → exhigh. */
const FORMAT_LEVELS: Record<number, AriaLevel> = {
  140: "standard",
  141: "exhigh",
  250: "higher",
  251: "exhigh",
  774: "exhigh",
};

function formatLevel(format: AdaptiveFormat): AriaLevel | null {
  if (format.itag && FORMAT_LEVELS[format.itag]) return FORMAT_LEVELS[format.itag];
  const mime = format.mimeType ?? "";
  if (!mime.startsWith("audio/")) return null;
  const bitrate = Number(format.bitrate ?? 0);
  if (!Number.isFinite(bitrate) || bitrate <= 0) return null;
  if (bitrate <= 64_000) return "standard";
  if (bitrate <= 100_000) return "higher";
  return "exhigh";
}

const streamMetaCache = new Map<string, { at: number; level: AriaLevel | null; meta: SourceStreamMeta }>();
const videoMetaCache = new Map<string, { at: number; meta: SourceVideoMeta }>();

async function requestYoutubePlayer(
  trackId: string,
): Promise<{
  attempts: Array<{ clientId: string; response: PlayerResponse }>;
}> {
  const authCookie = await readAuthCookie();
  const attempts: Array<{ clientId: string; response: PlayerResponse }> = [];
  for (const client of PLAYER_CLIENTS) {
    // 移动端上下文（IOS/ANDROID）携带 SAPISIDHASH 会被 YouTube 判定为 400 Invalid Argument，
    // 仅 Web 上下文携带 SAPISIDHASH，移动客户端仅带 Cookie 与对应设备 User-Agent。
    const isWebClient = client.id.startsWith("WEB");
    const response = await youtubeFetch(PLAYER_URL, {
      method: "POST",
      timeoutMs: PLAYER_TIMEOUT_MS,
      userAgent: clientUserAgent(client.id),
      origin: "https://www.youtube.com",
      includeSapisidAuth: isWebClient,
      ...(authCookie ? { cookie: authCookie } : {}),
      body: {
        context: client.context(),
        videoId: trackId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
    });
    if (!response.ok) continue;
    const data = (await response.json()) as PlayerResponse;
    attempts.push({ clientId: client.id, response: data });
    if (data.playabilityStatus?.status === "OK") {
      const hasAnyUrl =
        Boolean(data.streamingData?.adaptiveFormats?.some((format) => format.url)) ||
        Boolean(data.streamingData?.formats?.some((format) => format.url));
      if (hasAnyUrl) return { attempts };
    }
  }
  return { attempts };
}

function throwYoutubePlayerFailure(attempts: Array<{ clientId: string; response: PlayerResponse }>, fallbackMessage: string): never {
  const loginBlocked = attempts.some(({ response }) => response.playabilityStatus?.status === "LOGIN_REQUIRED");
  if (loginBlocked) {
    throw new SourceError(
      "UNAVAILABLE",
      "YouTube 要求人机验证或登录，请稍后再试；若持续出现，建议在设置里更换可用的代理出口",
      { source: "youtube" },
    );
  }
  const reason = attempts.find(({ response }) => response.playabilityStatus?.reason)?.response.playabilityStatus
    ?.reason;
  if (reason) {
    throw new SourceError("UNAVAILABLE", `该 YouTube 视频无法播放：${reason}`, { source: "youtube" });
  }
  throw new SourceError("UPSTREAM_FAILED", fallbackMessage, {
    source: "youtube",
  });
}

function chooseYoutubeAudioFormat(
  formats: AdaptiveFormat[],
  requestedLevel?: AriaLevel,
): { chosen: { format: AdaptiveFormat; level: AriaLevel }; available: AriaLevel[] } | null {
  const audioFormats = formats
    .map((format) => ({ format, level: formatLevel(format) }))
    .filter((entry): entry is { format: AdaptiveFormat; level: AriaLevel } => entry.level !== null)
    .sort((left, right) => Number(right.format.bitrate ?? 0) - Number(left.format.bitrate ?? 0));
  if (!audioFormats.length) return null;

  const available = [...new Set(audioFormats.map((entry) => entry.level))];
  const order: AriaLevel[] = ["standard", "higher", "exhigh"];
  available.sort((left, right) => order.indexOf(left) - order.indexOf(right));
  const candidates: AriaLevel[] = requestedLevel
    ? [...levelsUpTo(requestedLevel)].reverse()
    : [...order].reverse();
  let chosen: { format: AdaptiveFormat; level: AriaLevel } | null = null;
  for (const level of candidates) {
    const hit = audioFormats.find((entry) => entry.level === level);
    if (hit) {
      chosen = hit;
      break;
    }
  }
  if (!chosen) {
    chosen = audioFormats.reduce((best, entry) => (entry.level > best.level ? entry : best), audioFormats[0]);
  }
  return { chosen, available };
}

const STREAM_PROBE_TIMEOUT_MS = 3_500;

/**
 * Probe whether an adaptive googlevideo URL allows full `bytes=0-` downloads
 * without a PO Token (returns 403 on PO-token-gated uploads, 200/206 otherwise).
 */
async function probeYoutubeStreamReadable(url: string, headers: Record<string, string>): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_PROBE_TIMEOUT_MS);
  try {
    const response = await youtubeStreamFetcher(url, {
      headers: { ...headers, Range: "bytes=0-" },
      signal: controller.signal,
    });
    await response.body?.cancel();
    return response.status === 200 || response.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function buildProgressiveStreamMeta(
  muxed: AdaptiveFormat[],
  clientId: string,
  expiresAt: number | null,
): SourceStreamMeta {
  const chosenMuxed = muxed.find((format) => format.itag === 18) ?? muxed[0]!;
  return {
    url: chosenMuxed.url as string,
    headers: { "User-Agent": clientUserAgent(clientId) },
    mimeType: "audio/mp4",
    bitrate: 128_000,
    sampleRate: 44_100,
    currentLevel: "standard",
    availableLevels: ["standard"],
    expiresAt,
    fetcher: youtubeStreamFetcher,
  };
}

export async function resolveYoutubeStreamMeta(
  trackId: string,
  options: { level?: AriaLevel; refresh?: boolean },
): Promise<SourceStreamMeta> {
  const cacheKey = `${trackId}\u0000${options.level ?? ""}`;
  const cached = streamMetaCache.get(cacheKey);
  if (!options.refresh && cached && Date.now() - cached.at < STREAM_META_TTL_MS) return cached.meta;

  const { attempts } = await requestYoutubePlayer(trackId);
  for (const { clientId, response: data } of attempts) {
    if (data.playabilityStatus?.status !== "OK") continue;
    const expiresAt = data.streamingData?.expiresInSeconds
      ? Date.now() + Number(data.streamingData.expiresInSeconds) * 1000
      : null;
    const headers = { "User-Agent": clientUserAgent(clientId) };
    const muxed = data.streamingData?.formats?.filter((format) => format.url) ?? [];
    const formats = data.streamingData?.adaptiveFormats?.filter((format) => format.url) ?? [];
    const selectedAudio = chooseYoutubeAudioFormat(formats, options.level);

    if (selectedAudio) {
      const { chosen, available } = selectedAudio;
      // Only probe adaptive readability when a muxed fallback is available;
      // adaptive-only client responses rely on the direct adaptive stream.
      const adaptiveReadable =
        muxed.length === 0 || (await probeYoutubeStreamReadable(chosen.format.url as string, headers));
      if (!adaptiveReadable) {
        const meta = buildProgressiveStreamMeta(muxed, clientId, expiresAt);
        streamMetaCache.set(cacheKey, { at: Date.now(), level: options.level ?? null, meta });
        return meta;
      }
      const bitrate = Number(chosen.format.bitrate ?? 0) || null;
      const sampleRate = Number(chosen.format.audioSampleRate ?? 0) || null;
      const mime = chosen.format.mimeType?.split(";", 1)[0] || null;
      const meta: SourceStreamMeta = {
        url: chosen.format.url as string,
        headers,
        mimeType: mime && mime.startsWith("audio/") ? mime : "audio/mp4",
        bitrate,
        sampleRate,
        currentLevel: chosen.level,
        availableLevels: available,
        expiresAt,
        fetcher: youtubeStreamFetcher,
      };
      streamMetaCache.set(cacheKey, { at: Date.now(), level: options.level ?? null, meta });
      return meta;
    }

    if (muxed.length) {
      const meta = buildProgressiveStreamMeta(muxed, clientId, expiresAt);
      streamMetaCache.set(cacheKey, { at: Date.now(), level: options.level ?? null, meta });
      return meta;
    }
  }

  throwYoutubePlayerFailure(attempts, "YouTube 播放地址解析失败，请检查代理设置或稍后重试");
}

function extractVideoCodecs(mimeType: string | undefined): string {
  const match = mimeType?.match(/codecs="([^"]+)"/i);
  return match?.[1] ?? "";
}

function youtubeVideoCodecRank(mimeType: string | undefined): number {
  const codecs = extractVideoCodecs(mimeType).toLowerCase();
  if (codecs.startsWith("avc1")) return 0;
  if (codecs.startsWith("av01")) return 1;
  if (codecs.startsWith("vp09") || codecs.startsWith("vp9")) return 2;
  return 3;
}

function resolveVideoQualityHeight(format: AdaptiveFormat): number {
  if (typeof format.height === "number" && Number.isFinite(format.height) && format.height > 0) {
    return format.height;
  }
  const match = format.qualityLabel?.match(/(\d{3,4})p/i);
  return match ? Number(match[1]) : 360;
}

function buildProgressiveVideoMeta(
  muxed: AdaptiveFormat[],
  clientId: string,
  expiresAt: number | null,
): SourceVideoMeta {
  const sorted = [...muxed].sort((left, right) => resolveVideoQualityHeight(right) - resolveVideoQualityHeight(left));
  const chosen = sorted[0]!;
  const height = resolveVideoQualityHeight(chosen);
  return {
    url: chosen.url as string,
    headers: { "User-Agent": clientUserAgent(clientId) },
    audioUrl: null,
    mode: "muxed",
    mimeType: chosen.mimeType?.split(";", 1)[0] || "video/mp4",
    quality: chosen.qualityLabel ?? `${height}P`,
    qualityId: height,
    availableQualities: sorted.map((item) => {
      const itemHeight = resolveVideoQualityHeight(item);
      return {
        id: itemHeight,
        label: item.qualityLabel ?? `${itemHeight}P`,
        width: item.width ?? null,
        height: item.height ?? itemHeight,
        codecs: extractVideoCodecs(item.mimeType) || null,
      };
    }),
    width: chosen.width ?? null,
    height: chosen.height ?? height,
    expiresAt,
    fetcher: youtubeStreamFetcher,
  };
}

function formatYoutubeAudioLabel(selected: { format: AdaptiveFormat; level: AriaLevel }): string {
  const kbps = Math.round(Number(selected.format.bitrate ?? 0) / 1000);
  const isOpus = (selected.format.mimeType ?? "").toLowerCase().includes("opus") || (selected.format.mimeType ?? "").toLowerCase().includes("webm");
  const codec = isOpus ? "Opus" : "AAC";
  if (kbps > 0) return `${codec} ${kbps}K`;
  return selected.level === "standard" ? "AAC 128K" : selected.level === "higher" ? "Opus 70K" : "Opus 160K";
}

/** 解析 YouTube 视频画面流（优先 1080p DASH + 独立高码率音轨，受限时自动回退至 progressive 360p MP4）。 */
export async function resolveYoutubeVideoMeta(
  trackId: string,
  options: { level?: AriaLevel; qn?: number; refresh?: boolean },
): Promise<SourceVideoMeta> {
  const targetQn = options.qn ?? 1080;
  const cacheKey = `${trackId}\u0000${targetQn}\u0000${options.level ?? ""}`;
  const cached = videoMetaCache.get(cacheKey);
  if (!options.refresh && cached && Date.now() - cached.at < STREAM_META_TTL_MS) {
    return cached.meta;
  }

  const { attempts } = await requestYoutubePlayer(trackId);
  for (const { clientId, response: data } of attempts) {
    if (data.playabilityStatus?.status !== "OK") continue;
    const expiresAt = data.streamingData?.expiresInSeconds
      ? Date.now() + Number(data.streamingData.expiresInSeconds) * 1000
      : null;
    const headers = { "User-Agent": clientUserAgent(clientId) };
    const adaptive = data.streamingData?.adaptiveFormats?.filter((format) => format.url) ?? [];
    const muxed = data.streamingData?.formats?.filter((format) => format.url) ?? [];
    const videoFormats = adaptive.filter((format) => (format.mimeType ?? "").startsWith("video/"));
    const selectedAudio = chooseYoutubeAudioFormat(adaptive, options.level);

    if (videoFormats.length) {
      const grouped = new Map<number, AdaptiveFormat[]>();
      for (const format of videoFormats) {
        const height = resolveVideoQualityHeight(format);
        const list = grouped.get(height) ?? [];
        list.push(format);
        grouped.set(height, list);
      }
      const heights = [...grouped.keys()].sort((left, right) => right - left);
      const pickBestForHeight = (height: number) =>
        (grouped.get(height) ?? [])
          .slice()
          .sort(
            (left, right) =>
              youtubeVideoCodecRank(left.mimeType) - youtubeVideoCodecRank(right.mimeType) ||
              (Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0)),
          )[0]!;

      const chosenHeight = heights.includes(targetQn)
        ? targetQn
        : heights.find((height) => height <= targetQn) ?? heights[heights.length - 1]!;
      const chosenVideo = pickBestForHeight(chosenHeight);

      let videoReadable = true;
      let audioReadable = Boolean(selectedAudio);
      if (muxed.length > 0) {
        const [vOk, aOk] = await Promise.all([
          probeYoutubeStreamReadable(chosenVideo.url as string, headers),
          selectedAudio
            ? probeYoutubeStreamReadable(selectedAudio.chosen.format.url as string, headers)
            : Promise.resolve(false),
        ]);
        videoReadable = vOk;
        audioReadable = aOk;
      }

      if (videoReadable) {
        const availableQualities: SourceVideoQuality[] = heights.map((height) => {
          const best = pickBestForHeight(height);
          return {
            id: height,
            label: `${height}P`,
            width: best.width ?? null,
            height: best.height ?? height,
            codecs: extractVideoCodecs(best.mimeType) || null,
          };
        });
        const mime = chosenVideo.mimeType?.split(";", 1)[0] || "video/mp4";
        const useAudio = Boolean(audioReadable && selectedAudio);
        const meta: SourceVideoMeta = {
          url: chosenVideo.url as string,
          headers,
          audioUrl: useAudio ? (selectedAudio!.chosen.format.url as string) : null,
          audioQuality: useAudio ? formatYoutubeAudioLabel(selectedAudio!.chosen) : null,
          audioCodecs: useAudio ? extractVideoCodecs(selectedAudio!.chosen.format.mimeType) || null : null,
          availableAudioLevels: useAudio ? selectedAudio!.available : [],
          mode: useAudio ? "dash" : "muxed",
          mimeType: mime.startsWith("video/") ? mime : "video/mp4",
          quality: chosenVideo.qualityLabel ?? `${chosenHeight}P`,
          qualityId: chosenHeight,
          availableQualities,
          width: chosenVideo.width ?? null,
          height: chosenVideo.height ?? chosenHeight,
          expiresAt,
          fetcher: youtubeStreamFetcher,
        };
        videoMetaCache.set(cacheKey, { at: Date.now(), meta });
        return meta;
      }
    }

    if (muxed.length) {
      const meta = buildProgressiveVideoMeta(muxed, clientId, expiresAt);
      videoMetaCache.set(cacheKey, { at: Date.now(), meta });
      return meta;
    }
  }

  throwYoutubePlayerFailure(attempts, "YouTube 视频流解析失败，请检查代理设置或稍后重试");
}

export function resetYoutubeStateForTests() {
  proxyState = { raw: null, effectiveUri: null, agent: null, fetchedAt: 0 };
  authCookieCache = null;
  accountCache = null;
  playlistsCacheState = null;
  likedCacheState = null;
  streamMetaCache.clear();
  videoMetaCache.clear();
  continuationCache.clear();
}

/** Exported for the stream proxy: YouTube CDN URLs must go through the same proxy that resolved them. */
export async function youtubeStreamFetcher(url: string, init?: RequestInit): Promise<Response> {
  const dispatcher = await currentProxyDispatcher();
  return undiciFetch(
    url,
    dispatcher
      ? { ...(init as Record<string, unknown>), dispatcher }
      : (init as Record<string, unknown>),
  ) as unknown as Promise<Response>;
}
