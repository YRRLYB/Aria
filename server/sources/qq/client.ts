import type { ProviderTrack } from "../../providers/musicProvider";
import { readStore, updateStore } from "../../store";
import { HttpError } from "../../utils/httpError";
import { parseNeteaseLyrics } from "../../utils/lyricParser";
import type { LyricLine } from "../../../src/lib/lyricTypes";
import {
  LYRICS_TIMEOUT_MS,
  SEARCH_TIMEOUT_MS,
  STREAM_RESOLVE_TIMEOUT_MS,
  SourceError,
  levelsUpTo,
  type AriaLevel,
  type SourceAccount,
} from "../contract";

/**
 * Hand-rolled QQ Music client: pure fetch against the web endpoints, no SDK
 * dependency. All audio requests need `Referer: https://y.qq.com/` and are
 * served through the backend stream proxy; cookies never leave the server.
 */

export const MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
// The legacy `rfc/fcg_get_profile` endpoint is dead (404); this is the one the
// y.qq.com profile page still calls and it accepts the qm_keyst session cookie.
const PROFILE_URL = "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg";
const PROFILE_CID = "205360838";
const LYRIC_URL = "https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";
export const QQ_REFERER = "https://y.qq.com/";
const REFERER = QQ_REFERER;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_SIP = "http://ws.stream.qqmusic.qq.com/";
const STREAM_HEADERS = { Referer: REFERER, "User-Agent": USER_AGENT };
const PURL_TTL_MS = 20 * 60_000;
const PURL_CACHE_MAX = 500;

type QqSinger = { mid?: string; name?: string };

type QqSearchSong = {
  mid?: string;
  name?: string;
  interval?: number;
  singer?: QqSinger[];
  album?: { mid?: string; title?: string; name?: string };
  file?: {
    media_mid?: string;
    size_128mp3?: number | string;
    size_320mp3?: number | string;
    size_flac?: number | string;
    size_hires?: number | string;
  };
};

type QqFileSpec = { prefix: string; extension: string; bitrate: number | null };

/** Aria level -> vkey filename encoding. QQ has no distinct 192k tier. */
const QQ_FILE_SPECS: Partial<Record<AriaLevel, QqFileSpec>> = {
  standard: { prefix: "M500", extension: "mp3", bitrate: 128_000 },
  exhigh: { prefix: "M800", extension: "mp3", bitrate: 320_000 },
  lossless: { prefix: "F000", extension: "flac", bitrate: null },
  hires: { prefix: "RS01", extension: "flac", bitrate: null },
};

const LEVEL_FALLBACK: AriaLevel[] = ["hires", "lossless", "exhigh", "standard"];

function qualityLabel(level: AriaLevel): ProviderTrack["quality"] {
  switch (level) {
    case "jymaster":
      return "臻品";
    case "hires":
      return "Hi-Res";
    case "lossless":
      return "FLAC";
    default:
      return "320K";
  }
}

function positiveSize(value: number | string | undefined): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
  return false;
}

export function availableQqLevels(file: QqSearchSong["file"]): AriaLevel[] {
  if (!file) return [];
  const levels: AriaLevel[] = [];
  if (positiveSize(file.size_128mp3)) levels.push("standard");
  if (positiveSize(file.size_320mp3)) levels.push("exhigh");
  if (positiveSize(file.size_flac)) levels.push("lossless");
  if (positiveSize(file.size_hires)) levels.push("hires");
  return levels;
}

/** Extract `uin` and `qqmusic_key`/`qm_keyst` from a pasted cookie header. */
export function parseQqCookie(cookie: string): { uin: string; key: string } | null {
  const uin = cookie.match(/(?:^|;\s*)uin=o?(\d{4,})/i)?.[1];
  const key = cookie.match(/(?:^|;\s*)(?:qqmusic_key|qm_keyst)=([^;]+)/i)?.[1]?.trim();
  if (!uin || !key) return null;
  return { uin, key };
}

async function musicu<T>(
  requestKey: string,
  moduleName: string,
  method: string,
  param: Record<string, unknown>,
  options: { cookie?: string | null; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${MUSICU_URL}?format=json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: REFERER,
      "User-Agent": USER_AGENT,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: JSON.stringify({ [requestKey]: { module: moduleName, method, param } }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new SourceError("UPSTREAM_FAILED", `QQ音乐接口请求失败 (${response.status})`, { source: "qq" });
  }
  const payload = (await response.json()) as Record<string, { code?: number; data?: unknown } | undefined>;
  const section = payload[requestKey];
  if (!section || (section.code !== undefined && section.code !== 0)) {
    throw new SourceError("UPSTREAM_FAILED", "QQ音乐接口返回异常", { source: "qq" });
  }
  return section.data as T;
}

async function optionalQqCookie(): Promise<{ cookie: string; parsed: { uin: string; key: string } } | null> {
  const store = await readStore();
  if (!store.qqCookie) return null;
  const parsed = parseQqCookie(store.qqCookie);
  if (!parsed) return null;
  return { cookie: store.qqCookie, parsed };
}

// Search results carry the file metadata needed to resolve streams later; the
// data is tiny and bounded by the number of searched songs per session.
const fileInfoCache = new Map<string, { mediaMid: string; availableLevels: AriaLevel[] }>();

function rememberFileInfo(song: QqSearchSong) {
  if (!song.mid) return;
  const availableLevels = availableQqLevels(song.file);
  if (!availableLevels.length && !song.file?.media_mid) return;
  fileInfoCache.set(song.mid, {
    mediaMid: song.file?.media_mid ?? song.mid,
    availableLevels,
  });
  if (fileInfoCache.size > 1000) {
    const oldest = fileInfoCache.keys().next().value;
    if (oldest !== undefined) fileInfoCache.delete(oldest);
  }
}

export function normalizeQqSong(song: QqSearchSong): ProviderTrack {
  const availableLevels = availableQqLevels(song.file);
  const currentLevel = availableLevels.at(-1) ?? null;
  const albumMid = song.album?.mid ?? null;
  return {
    id: song.mid ?? "",
    title: song.name ?? "未知歌曲",
    artist: (song.singer ?? []).map((singer) => singer.name ?? "").filter(Boolean).join(" / ") || "Unknown Artist",
    album: song.album?.title ?? song.album?.name ?? "Unknown Album",
    albumId: albumMid,
    artistIds: (song.singer ?? []).flatMap((singer) => (singer.mid ? [singer.mid] : [])),
    duration: Math.max(0, Math.round(song.interval ?? 0)),
    quality: currentLevel ? qualityLabel(currentLevel) : "320K",
    source: "qq",
    streamUrl: `/api/sources/qq/tracks/${song.mid}/stream`,
    coverUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null,
    likedAt: null,
    bpm: null,
    bitrate: currentLevel ? QQ_FILE_SPECS[currentLevel]?.bitrate ?? null : null,
    sampleRate: null,
    currentLevel,
    availableLevels,
  };
}

export async function searchQqTracks(query: string, limit: number, offset: number): Promise<ProviderTrack[]> {
  const safeQuery = query.trim().slice(0, 120);
  if (!safeQuery) return [];
  const cookie = (await optionalQqCookie())?.cookie;
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const data = await musicu<{ body?: { song?: { list?: QqSearchSong[] } } }>(
    "search",
    "music.search.SearchCgiService",
    "DoSearchForQQMusicDesktop",
    {
      search_type: 0,
      query: safeQuery,
      page_num: Math.floor(offset / Math.max(1, limit)) + 1,
      num_per_page: Math.max(1, Math.min(50, limit)),
    },
    { cookie, signal },
  );
  const songs = data.body?.song?.list ?? [];
  songs.forEach(rememberFileInfo);
  return songs.map(normalizeQqSong).filter((track) => track.id);
}

type MidurlInfo = { purl?: string; filename?: string; filesize?: number | string; bitrate?: number | string };

type VkeyData = { midurlinfo?: MidurlInfo[]; sip?: string[] };

type PurlEntry = {
  url: string;
  level: AriaLevel;
  bitrate: number | null;
  expiresAt: number;
};

const purlCache = new Map<string, PurlEntry>();

function clearPurlCache() {
  purlCache.clear();
}

function upstreamUrl(purl: string, sip?: string[]): string {
  if (/^https?:\/\//i.test(purl)) return purl;
  const prefix = (sip?.[0] ?? DEFAULT_SIP).replace(/\/?$/, "/");
  return `${prefix}${purl}`;
}

function requestCandidates(requested: AriaLevel, availableLevels?: AriaLevel[]): AriaLevel[] {
  // Prefer known-available tiers at or below the request, highest first.
  // LEVEL_FALLBACK is ordered high -> low, so ascending index is highest first.
  const reachable = (availableLevels?.length ? availableLevels : LEVEL_FALLBACK)
    .filter((level) => QQ_FILE_SPECS[level])
    .filter((level) => levelsUpTo(requested).includes(level))
    .sort((a, b) => LEVEL_FALLBACK.indexOf(a) - LEVEL_FALLBACK.indexOf(b));
  // Always keep a fallback path even if search metadata was missing.
  return reachable.length ? reachable : LEVEL_FALLBACK.filter((level) => levelsUpTo(requested).includes(level));
}

export async function resolveQqStreamMeta(
  trackId: string,
  options: { level?: AriaLevel; refresh?: boolean } = {},
): Promise<{
  url: string;
  headers: Record<string, string>;
  bitrate: number | null;
  sampleRate: number | null;
  quality: ProviderTrack["quality"];
  currentLevel: AriaLevel;
  availableLevels: AriaLevel[];
  expiresAt: number;
}> {
  const songmid = trackId.trim();
  if (!songmid || /[/?#]/.test(songmid)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐歌曲 ID", { source: "qq" });
  }
  const session = await optionalQqCookie();
  const fileInfo = fileInfoCache.get(songmid);
  const candidates = requestCandidates(options.level ?? "lossless", fileInfo?.availableLevels);
  if (!candidates.length) {
    throw new SourceError("UNSUPPORTED", "QQ音乐不提供该音质档位", { source: "qq" });
  }

  if (!options.refresh) {
    for (const level of candidates) {
      const cached = purlCache.get(`${songmid}:${level}`);
      if (cached && cached.expiresAt > Date.now()) return toStreamMeta(cached, fileInfo);
      if (cached) purlCache.delete(`${songmid}:${level}`);
    }
  }

  const mediaMid = fileInfo?.mediaMid ?? songmid;
  const filenames = candidates.map((level) => {
    const spec = QQ_FILE_SPECS[level]!;
    return `${spec.prefix}${mediaMid}.${spec.extension}`;
  });
  const signal = AbortSignal.timeout(STREAM_RESOLVE_TIMEOUT_MS);
  // GetEVkey is the only vkey module that still answers anonymous requests;
  // plaintext filenames require a logged-in cookie, otherwise QQ only serves
  // its encrypted formats, which Aria deliberately does not decrypt.
  const data = await musicu<VkeyData>(
    "vkey",
    "music.vkey.GetEVkey",
    "CgiGetEVkey",
    {
      guid: Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000).toString(),
      songmid: [songmid],
      songtype: [0],
      uin: session?.parsed.uin ?? "0",
      loginflag: 1,
      platform: "20",
      filename: filenames,
    },
    { cookie: session?.cookie, signal },
  );

  const midurlinfo = data.midurlinfo ?? [];
  const byFilename = new Map(midurlinfo.map((item) => [item.filename ?? "", item]));
  for (const level of candidates) {
    const spec = QQ_FILE_SPECS[level]!;
    const info = byFilename.get(`${spec.prefix}${mediaMid}.${spec.extension}`);
    const purl = info?.purl ?? "";
    if (!purl) continue;
    const entry: PurlEntry = {
      url: upstreamUrl(purl, data.sip),
      level,
      bitrate: spec.bitrate ?? normalizeSize(info?.filesize),
      expiresAt: Date.now() + PURL_TTL_MS,
    };
    purlCache.set(`${songmid}:${level}`, entry);
    if (purlCache.size > PURL_CACHE_MAX) {
      const oldest = purlCache.keys().next().value;
      if (oldest !== undefined) purlCache.delete(oldest);
    }
    return toStreamMeta(entry, fileInfo);
  }
  throw new SourceError(
    "UNAVAILABLE",
    session
      ? "该歌曲暂无可播放的音频链接（Cookie 可能已过期，请到设置重新绑定）"
      : "该歌曲暂无可播放的音频链接：QQ 音乐要求登录 Cookie，请到 设置 → 播放源 绑定",
    { source: "qq" },
  );
}

function toStreamMeta(
  entry: PurlEntry,
  fileInfo: { mediaMid: string; availableLevels: AriaLevel[] } | undefined,
) {
  return {
    url: entry.url,
    headers: STREAM_HEADERS,
    bitrate: entry.bitrate,
    sampleRate: null,
    size: null,
    quality: qualityLabel(entry.level),
    currentLevel: entry.level,
    availableLevels: fileInfo?.availableLevels ?? [],
    expiresAt: entry.expiresAt,
  };
}

function normalizeSize(value: number | string | undefined): number | null {
  const size = typeof value === "string" ? Number(value) : value;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? Math.round(size) : null;
}

export async function getQqLyrics(songmid: string): Promise<LyricLine[]> {
  const id = songmid.trim();
  if (!id || /[/?#]/.test(id)) return [];
  const cookie = (await optionalQqCookie())?.cookie;
  const signal = AbortSignal.timeout(LYRICS_TIMEOUT_MS);
  const params = new URLSearchParams({
    songmid: id,
    g_tk: "5381",
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
    platform: "yqq.json",
    needNewCode: "0",
  });
  const response = await fetch(`${LYRIC_URL}?${params.toString()}`, {
    headers: {
      Referer: REFERER,
      "User-Agent": USER_AGENT,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal,
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as { lyric?: string; trans?: string } | null;
  const lyric = payload?.lyric ? Buffer.from(payload.lyric, "base64").toString("utf8") : "";
  if (!lyric) return [];
  const translation = payload?.trans ? Buffer.from(payload.trans, "base64").toString("utf8") : "";
  return parseNeteaseLyrics({ lrc: { lyric }, tlyric: translation ? { lyric: translation } : undefined });
}

function disconnectedAccount(): SourceAccount {
  return { connected: false, nickname: null, userId: null, avatarUrl: null };
}

function httpsAvatar(value: string | null | undefined): string | null {
  if (!value) return null;
  // QQ still hands out `http://` avatar URLs; upgrading avoids a mixed-content
  // block inside the renderer.
  return value.replace(/^http:\/\//i, "https://");
}

/**
 * Authenticated modules only answer the android client profile
 * (`ct: 11 / cv: 20090008`) with `authst=<musickey>` in `comm` plus the
 * matching cookie; the web profile (`ct: 24 / yqq.json`) rejects the same
 * session with `500003 / 860100001`. The batch key is `req_0`, not `req`.
 */
function androidComm(uin: string, key: string) {
  const guid = "aria0qqmusic0guid0desktop00000";
  return {
    comm: {
      ct: 11,
      cv: 20090008,
      v: 20090008,
      chid: "10003505",
      qq: uin,
      authst: key,
      tmeAppID: "qqmusic",
      guid,
      tmeLoginType: 2,
    },
    cookie: `uin=${uin}; qqmusic_uin=${uin}; qm_keyst=${key}; qqmusic_key=${key}; guid=${guid}`,
  };
}

async function fetchLoginUserInfo(uin: string, key: string, signal: AbortSignal): Promise<SourceAccount | null> {
  const { comm, cookie } = androidComm(uin, key);
  const response = await fetch(MUSICU_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      Referer: REFERER,
      Origin: "https://y.qq.com",
      "User-Agent": "QQMusic 20090008(android 14)",
      Cookie: cookie,
    },
    body: JSON.stringify({
      comm,
      req_0: { module: "music.UserInfo.userInfoServer", method: "GetLoginUserInfo", param: {} },
    }),
    signal,
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { req_0?: { code?: number; data?: { info?: { nick?: string; logo?: string; encryptUin?: string } } } }
    | null;
  const section = payload?.req_0;
  const info = section?.data?.info;
  if (section?.code !== 0 || !info?.nick) return null;
  return {
    connected: true,
    nickname: info.nick,
    userId: uin,
    avatarUrl: httpsAvatar(info.logo),
  };
}

/** Web-session fallback: the endpoint the y.qq.com profile page still calls. */
async function fetchProfileHomepage(uin: string, cookie: string, signal: AbortSignal): Promise<SourceAccount | null> {
  const params = new URLSearchParams({
    cid: PROFILE_CID,
    userid: uin,
    reqfrom: "1",
    g_tk: "5381",
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
    platform: "yqq.json",
    needNewCode: "0",
  });
  const response = await fetch(`${PROFILE_URL}?${params.toString()}`, {
    headers: {
      Referer: REFERER,
      "User-Agent": USER_AGENT,
      Cookie: cookie,
    },
    signal,
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { data?: { creator?: { nick?: string; headpic?: string; uin?: number | string } } }
    | null;
  const creator = payload?.data?.creator;
  if (!creator?.nick) return null;
  return {
    connected: true,
    nickname: creator.nick,
    userId: creator.uin != null && String(creator.uin) !== "0" ? String(creator.uin) : uin,
    avatarUrl: httpsAvatar(creator.headpic),
  };
}

export async function getQqAccount(): Promise<SourceAccount> {
  const session = await optionalQqCookie();
  if (!session) return disconnectedAccount();
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  try {
    const fromAndroid = await fetchLoginUserInfo(session.parsed.uin, session.parsed.key, signal);
    if (fromAndroid) return fromAndroid;
  } catch {
    // Fall through to the web-session probe.
  }
  try {
    return (await fetchProfileHomepage(session.parsed.uin, session.cookie, signal)) ?? disconnectedAccount();
  } catch {
    return disconnectedAccount();
  }
}

export async function saveQqCookie(cookie: string): Promise<SourceAccount> {
  const trimmed = cookie.trim();
  if (!parseQqCookie(trimmed)) {
    throw new HttpError(
      400,
      "无法识别的 QQ 音乐 Cookie，请粘贴包含 uin 与 qqmusic_key（或 qm_keyst）的完整 Cookie",
      "QQ_COOKIE_INVALID",
    );
  }
  await updateStore((store) => ({ ...store, qqCookie: trimmed }));
  clearPurlCache();
  fileInfoCache.clear();
  return getQqAccount();
}

/** Sign out of QQ Music: drop the stored cookie and every cached URL. */
export async function clearQqCookie(): Promise<SourceAccount> {
  await updateStore((store) => ({ ...store, qqCookie: null }));
  clearPurlCache();
  fileInfoCache.clear();
  return getQqAccount();
}
