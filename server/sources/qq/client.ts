import type { ProviderPlaylist, ProviderTrack } from "../../providers/musicProvider";
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
const CREATED_DISS_URL = "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss";
const PROFILE_CID = "205360838";
const PLAYLIST_DETAIL_URL = "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg";
const LIKED_PLAYLIST_TITLE = "我喜欢";
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
  pay?: { pay_play?: number };
  file?: {
    media_mid?: string;
    size_128mp3?: number | string;
    size_320mp3?: number | string;
    size_flac?: number | string;
    size_hires?: number | string;
    size_48aac?: number | string;
    size_96aac?: number | string;
    size_128aac?: number | string;
  };
};

type QqFileSpec = { formats: Array<{ prefix: string; extension: string; label: ProviderTrack["quality"] }>; bitrate: number | null };

/**
 * Aria level -> vkey filename encoding. QQ has no distinct 192k tier.
 * 2026-11 实测：GetEVkey 对登录 Cookie + 免费歌曲会下发明文 purl，但放行哪个
 * 格式不稳定（M500 128k MP3 与 C400 AAC 交替出现），因此每个档位声明多个
 * 格式候选、一次请求全部带上，哪个返回 purl 就用哪个。加密格式（mflac/mgg）
 * 按红线不解密、也不请求。M800/F000/RS01 明文在无 VIP 账号上通常为空，
 * 但保留候选——授权账号或腾讯策略变化时可自动生效。
 */
const QQ_FILE_SPECS: Partial<Record<AriaLevel, QqFileSpec>> = {
  standard: {
    formats: [
      { prefix: "M500", extension: "mp3", label: "128K" },
      { prefix: "C400", extension: "m4a", label: "AAC" },
    ],
    bitrate: null,
  },
  exhigh: { formats: [{ prefix: "M800", extension: "mp3", label: "320K" }], bitrate: 320_000 },
  lossless: { formats: [{ prefix: "F000", extension: "flac", label: "FLAC" }], bitrate: null },
  hires: { formats: [{ prefix: "RS01", extension: "flac", label: "Hi-Res" }], bitrate: null },
};

const LEVEL_FALLBACK: AriaLevel[] = ["hires", "lossless", "exhigh", "standard"];

function qualityLabel(level: AriaLevel, formatIndex = 0): ProviderTrack["quality"] {
  if (level === "standard") return QQ_FILE_SPECS.standard?.formats[formatIndex]?.label ?? "128K";
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
  if (positiveSize(file.size_128mp3) || positiveSize(file.size_128aac) || positiveSize(file.size_96aac) || positiveSize(file.size_48aac)) levels.push("standard");
  if (positiveSize(file.size_320mp3)) levels.push("exhigh");
  if (positiveSize(file.size_flac)) levels.push("lossless");
  if (positiveSize(file.size_hires)) levels.push("hires");
  return levels;
}

export type QqSessionIdentity = { uin: string; key: string; loginType: 1 | 2 };

/** QQ and WeChat sessions use different identity and music-key cookie names. */
export function parseQqCookie(cookie: string): QqSessionIdentity | null {
  const values = new Map<string, string>();
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim().toLowerCase();
    const value = pair.slice(separator + 1).trim();
    if (value && !values.has(name)) values.set(name, value);
  }
  const validUin = (value: string | undefined) => {
    const normalized = value?.replace(/^o/i, "") ?? "";
    return /^\d{4,}$/.test(normalized) ? normalized : "";
  };
  const wxUin = validUin(values.get("wxuin"));
  const qqUin = validUin(values.get("uin") ?? values.get("qqmusic_uin") ?? values.get("p_uin"));
  const wxKey = values.get("wxmusic_key");
  const qqKey = values.get("qm_keyst") ?? values.get("qqmusic_key");
  // An explicit WeChat login must not be paired with a leftover QQ uin/key.
  if (values.get("login_type") === "2" || (!qqKey && wxKey)) {
    const uin = wxUin || qqUin;
    const key = wxKey ?? qqKey;
    return uin && key ? { uin, key, loginType: 2 } : null;
  }
  if (qqUin && qqKey) return { uin: qqUin, key: qqKey, loginType: 1 };
  return wxUin && wxKey ? { uin: wxUin, key: wxKey, loginType: 2 } : null;
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
    body: JSON.stringify({
      ...(options.cookie && parseQqCookie(options.cookie) ? {
        comm: {
          ct: 24, cv: 0,
          uin: parseQqCookie(options.cookie)!.uin,
          authst: parseQqCookie(options.cookie)!.key,
          tmeLoginType: parseQqCookie(options.cookie)!.loginType === 2 ? 1 : 2,
        },
      } : {}),
      [requestKey]: { module: moduleName, method, param },
    }),
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

async function optionalQqCookie(): Promise<{ cookie: string; parsed: QqSessionIdentity } | null> {
  const store = await readStore();
  if (!store.qqCookie) return null;
  const parsed = parseQqCookie(store.qqCookie);
  if (!parsed) return null;
  return { cookie: store.qqCookie, parsed };
}

// Search results carry the file metadata needed to resolve streams later; the
// data is tiny and bounded by the number of searched songs per session.
const fileInfoCache = new Map<string, { mediaMid: string; availableLevels: AriaLevel[]; durationSeconds: number | null }>();

/**
 * 歌曲 VIP 标记缓存(true=免费)。2026-11-06 实测:GetEVkey 请求里只要混入
 * 付费档位文件名(F000/M800),免费账号的整个请求都会被拒——连 M500 都拿
 * 不到。因此请求必须按"档位类别"分开:免费歌只发免费候选,付费候选只在
 * 确认账号有 VIP 能力时才发。
 */
const payCache = new Map<string, boolean>();

/** 会话级账号能力探测:unknown → 探测后 capable / incapable。 */
let vipProbeState: "unknown" | "capable" | "incapable" = "unknown";

function rememberFileInfo(song: QqSearchSong) {
  if (!song.mid) return;
  if (song.pay) payCache.set(song.mid, song.pay.pay_play === 0);
  const availableLevels = availableQqLevels(song.file);
  if (!availableLevels.length && !song.file?.media_mid) return;
  fileInfoCache.set(song.mid, {
    mediaMid: song.file?.media_mid ?? song.mid,
    availableLevels,
    durationSeconds: typeof song.interval === "number" && song.interval > 0 ? Math.round(song.interval) : null,
  });
  if (fileInfoCache.size > 1000) {
    const oldest = fileInfoCache.keys().next().value;
    if (oldest !== undefined) fileInfoCache.delete(oldest);
  }
}

/**
 * QQ's search/playlist rows carry per-tier file sizes but only some tiers have
 * a fixed nominal bitrate. Estimate the rest from size/duration so the list and
 * player can show a real "FLAC · 952k" instead of only the codec name before
 * playback resolves the exact stream metadata.
 */
function estimateQqBitrate(
  file: QqSearchSong["file"],
  level: AriaLevel,
  durationSeconds: number,
): number | null {
  if (!file) return null;
  const sizes = level === "standard"
    ? [file.size_128mp3, file.size_128aac, file.size_96aac, file.size_48aac]
    : level === "exhigh"
      ? [file.size_320mp3]
      : level === "lossless"
        ? [file.size_flac]
        : level === "hires"
          ? [file.size_hires]
          : [];
  const size = sizes
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0) ?? 0;
  if (size > 0 && durationSeconds > 0) {
    const estimated = Math.round((size * 8) / durationSeconds / 1000) * 1000;
    return Math.max(32_000, Math.min(10_000_000, estimated));
  }
  if (level === "standard") return 128_000;
  if (level === "exhigh") return 320_000;
  return null;
}

export function normalizeQqSong(song: QqSearchSong): ProviderTrack {
  const availableLevels = availableQqLevels(song.file);
  const currentLevel = availableLevels.at(-1) ?? null;
  const albumMid = song.album?.mid ?? null;
  const durationSeconds = Math.max(0, Math.round(song.interval ?? 0));
  return {
    id: song.mid ?? "",
    title: song.name ?? "未知歌曲",
    artist: (song.singer ?? []).map((singer) => singer.name ?? "").filter(Boolean).join(" / ") || "Unknown Artist",
    album: song.album?.title ?? song.album?.name ?? "Unknown Album",
    albumId: albumMid,
    artistIds: (song.singer ?? []).flatMap((singer) => (singer.mid ? [singer.mid] : [])),
    duration: durationSeconds,
    quality: currentLevel ? qualityLabel(currentLevel) : "320K",
    source: "qq",
    streamUrl: `/api/sources/qq/tracks/${song.mid}/stream`,
    coverUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null,
    likedAt: null,
    bpm: null,
    bitrate: currentLevel
      ? estimateQqBitrate(song.file, currentLevel, durationSeconds)
      : null,
    sampleRate: null,
    currentLevel,
    availableLevels,
    // pay_play === 0 才能匿名/免费播放；热门歌曲几乎全是 VIP 专属，
    // 提前标出来让用户知道哪些点了会拿不到播放地址。
    vip: song.pay?.pay_play !== 0,
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
  formatIndex: number;
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
  const isFreeSong = payCache.get(songmid);
  const requestLevel = options.level ?? "lossless";
  // 免费候选(任何账号都安全)与付费候选(仅确认有 VIP 能力的账号才发)。
  const freeLevels: AriaLevel[] = ["standard"];
  const paidLevels = LEVEL_FALLBACK.filter((level) => level !== "standard" && levelsUpTo(requestLevel).includes(level));
  const knownVipSong = isFreeSong === false;
  if (knownVipSong && vipProbeState === "incapable") {
    // 已确认账号无 VIP:不再打接口,省下频控配额。
    throw new SourceError("UNAVAILABLE", "该歌曲需要 QQ 音乐 VIP（绿钻）才能播放", { source: "qq" });
  }

  const fetchVkey = async (levels: AriaLevel[]) => {
    const mediaMid = fileInfo?.mediaMid ?? songmid;
    const filenames = levels.flatMap((level) =>
      QQ_FILE_SPECS[level]!.formats.map((format) => `${format.prefix}${mediaMid}.${format.extension}`),
    );
    const signal = AbortSignal.timeout(STREAM_RESOLVE_TIMEOUT_MS);
    // GetEVkey is the only vkey module that still answers anonymous requests;
    // plaintext filenames require a logged-in cookie, otherwise QQ only serves
    // its encrypted formats, which Aria deliberately does not decrypt.
    return musicu<VkeyData>(
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
  };

  /** 在一次 vkey 响应里按档位顺序挑第一个有 purl 的格式;命中即写缓存。 */
  const collectEntry = (levels: AriaLevel[], data: VkeyData): PurlEntry | null => {
    const midurlinfo = data.midurlinfo ?? [];
    const byFilename = new Map(midurlinfo.map((item) => [item.filename ?? "", item]));
    const mediaMid = fileInfo?.mediaMid ?? songmid;
    for (const level of levels) {
      const spec = QQ_FILE_SPECS[level]!;
      for (const [formatIndex, format] of spec.formats.entries()) {
        const info = byFilename.get(`${format.prefix}${mediaMid}.${format.extension}`);
        const purl = info?.purl ?? "";
        if (!purl) continue;
        // C400 responses carry no per-tier bitrate: derive it from the file size
        // and the duration cached at search time; both missing means report null.
        const fileSize = normalizeSize(info?.filesize);
        const bitrate = spec.bitrate
          ?? (fileSize && fileInfo?.durationSeconds ? Math.round((fileSize * 8) / fileInfo.durationSeconds / 1000) * 1000 : null);
        const entry: PurlEntry = {
          url: upstreamUrl(purl, data.sip),
          level,
          bitrate,
          formatIndex,
          expiresAt: Date.now() + PURL_TTL_MS,
        };
        purlCache.set(`${songmid}:${level}`, entry);
        if (purlCache.size > PURL_CACHE_MAX) {
          const oldest = purlCache.keys().next().value;
          if (oldest !== undefined) purlCache.delete(oldest);
        }
        return entry;
      }
    }
    return null;
  };

  const cachedLookupLevels = vipProbeState === "capable" && requestLevel !== "standard"
    ? [...paidLevels, ...freeLevels]
    : freeLevels;
  if (!options.refresh) {
    for (const level of cachedLookupLevels) {
      const cached = purlCache.get(`${songmid}:${level}`);
      if (cached && cached.expiresAt > Date.now()) return toStreamMeta(cached, fileInfo);
      if (cached) purlCache.delete(`${songmid}:${level}`);
    }
  }

  const unavailableError = () =>
    new SourceError(
      "UNAVAILABLE",
      session
        ? "该歌曲暂无可播放的音频链接：可能需要 QQ 音乐 VIP，或登录已过期（设置 → 播放源 重新登录）"
        : "该歌曲暂无可播放的音频链接：QQ 音乐要求登录 Cookie，请到 设置 → 播放源 绑定",
      { source: "qq" },
    );

  // 已确认有 VIP 能力的账号:VIP 歌直接走付费档(单独请求,不与免费档混发)。
  if (vipProbeState === "capable" && !isFreeSong) {
    if (paidLevels.length) {
      const entry = collectEntry(paidLevels, await fetchVkey(paidLevels));
      if (entry) return toStreamMeta(entry, fileInfo);
    }
    const freeEntry = collectEntry(freeLevels, await fetchVkey(freeLevels));
    if (freeEntry) return toStreamMeta(freeEntry, fileInfo);
    throw unavailableError();
  }

  // 第一发:免费候选(免费账号必中;VIP 歌必然空)。
  const freeData = await fetchVkey(freeLevels);
  const freeEntry = collectEntry(freeLevels, freeData);
  if (freeEntry) return toStreamMeta(freeEntry, fileInfo);

  // 免费候选全空:确认的 VIP 歌 → 探测账号付费能力;未知歌 → 也试一次。
  if ((knownVipSong || isFreeSong === undefined) && paidLevels.length) {
    const paidEntry = collectEntry(paidLevels, await fetchVkey(paidLevels));
    if (paidEntry) {
      vipProbeState = "capable";
      return toStreamMeta(paidEntry, fileInfo);
    }
    // 只有确认的 VIP 歌才能判定"账号无 VIP"(免费歌全空另有原因)。
    if (knownVipSong) vipProbeState = "incapable";
  }
  throw unavailableError();
}

function toStreamMeta(
  entry: PurlEntry,
  fileInfo: { mediaMid: string; availableLevels: AriaLevel[]; durationSeconds: number | null } | undefined,
) {
  return {
    url: entry.url,
    headers: STREAM_HEADERS,
    bitrate: entry.bitrate,
    sampleRate: null,
    size: null,
    quality: qualityLabel(entry.level, entry.formatIndex),
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
function androidComm(identity: QqSessionIdentity, originalCookie: string) {
  const { uin, key, loginType } = identity;
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
      tmeLoginType: loginType === 2 ? 1 : 2,
    },
    cookie: loginType === 2
      ? `${originalCookie}; guid=${guid}`
      : `${originalCookie}; qqmusic_uin=${uin}; guid=${guid}`,
  };
}

async function fetchLoginUserInfo(identity: QqSessionIdentity, originalCookie: string, signal: AbortSignal): Promise<SourceAccount | null> {
  const { uin } = identity;
  const { comm, cookie } = androidComm(identity, originalCookie);
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
    const fromAndroid = await fetchLoginUserInfo(session.parsed, session.cookie, signal);
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
      "无法识别的 QQ 音乐 Cookie，请粘贴包含 QQ 或微信音乐账号和音乐凭据的完整 Cookie",
      "QQ_COOKIE_INVALID",
    );
  }
  await updateStore((store) => ({ ...store, qqCookie: trimmed }));
  clearPurlCache();
  fileInfoCache.clear();
  payCache.clear();
  vipProbeState = "unknown";
  return getQqAccount();
}

/** Sign out of QQ Music: drop the stored cookie and every cached URL. */
export async function clearQqCookie(): Promise<SourceAccount> {
  await updateStore((store) => ({ ...store, qqCookie: null }));
  clearPurlCache();
  payCache.clear();
  vipProbeState = "unknown";
  fileInfoCache.clear();
  return getQqAccount();
}

/** 仅测试用:重置会话级解析状态(账号能力探测、档位/付费标记缓存)。 */
export function resetQqStreamStateForTests() {
  vipProbeState = "unknown";
  purlCache.clear();
  payCache.clear();
  fileInfoCache.clear();
}

// —— 推荐流(QQ 官方榜单聚合,作每日推荐/私人漫游) ——

type QqToplistSongRef = { songId?: number; albumMid?: string; title?: string; singerName?: string; singerMid?: string; cover?: string };

const recommendCache = new Map<string, { expiresAt: number; tracks: ProviderTrack[] }>();
const recommendCacheTtl = 10 * 60_000;
const albumMidCache = new Map<string, { expiresAt: number; mids: Array<{ mid: string; name: string; singers: string; interval: number; mediaMid: string | null }> }>();

/** 榜单内嵌歌曲只有数字 songId + albumMid;用经典专辑接口换回 songmid。 */
async function resolveAlbumSongs(albumMid: string, signal?: AbortSignal): Promise<Array<{ mid: string; name: string; singers: string; interval: number; mediaMid: string | null }>> {
  const cached = albumMidCache.get(albumMid);
  if (cached && cached.expiresAt > Date.now()) return cached.mids;
  const response = await fetch(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(albumMid)}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`, {
    headers: { Referer: REFERER, "User-Agent": USER_AGENT, Cookie: (await optionalQqCookie())?.cookie ?? "" },
    signal,
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as {
    data?: { list?: Array<{ songmid?: string; songname?: string; singer?: Array<{ name?: string }>; interval?: number; file?: { media_mid?: string } }> };
  } | null;
  const songs = (payload?.data?.list ?? []).map((song) => ({
    mid: song.songmid ?? "",
    name: song.songname ?? "",
    singers: (song.singer ?? []).map((singer) => singer.name ?? "").filter(Boolean).join(" / "),
    interval: Math.max(0, Math.round(song.interval ?? 0)),
    mediaMid: song.file?.media_mid ?? song.songmid ?? null,
  })).filter((song) => song.mid);
  albumMidCache.set(albumMid, { expiresAt: Date.now() + recommendCacheTtl, mids: songs });
  if (albumMidCache.size > 500) {
    const oldest = albumMidCache.keys().next().value;
    if (oldest !== undefined) albumMidCache.delete(oldest);
  }
  return songs;
}

async function fetchToplistTracks(): Promise<ProviderTrack[]> {
  const cached = recommendCache.get("toplist");
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;
  const data = await musicu<{ group?: Array<{ toplist?: Array<{ topId?: number; title?: string; song?: QqToplistSongRef[] }> }> }>(
    "toplist",
    "music.musicToplist.Toplist",
    "GetAll",
    {},
    { cookie: (await optionalQqCookie())?.cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
  );
  // 聚合全部榜单的内嵌歌曲,按"歌名+歌手"去重(多榜同歌只留一份)。
  const refs: Array<QqToplistSongRef & { rankName: string }> = [];
  const seen = new Set<string>();
  for (const group of data.group ?? []) {
    for (const toplist of group.toplist ?? []) {
      for (const song of toplist.song ?? []) {
        const key = `${song.title ?? ""}\u0000${song.singerName ?? ""}`.toLowerCase();
        if (!song.title || seen.has(key)) continue;
        seen.add(key);
        refs.push({ ...song, rankName: toplist.title ?? group.groupName ?? "" });
      }
    }
  }
  // 只保留能换到 songmid 的(前 40 首,节制专辑接口的调用量)。
  const picked = refs.slice(0, 40);
  const pool = 3;
  let cursor = 0;
  const tracks: ProviderTrack[] = [];
  const tracksById = new Map<string, ProviderTrack>();
  await Promise.all(Array.from({ length: pool }, async () => {
    while (cursor < picked.length) {
      const ref = picked[cursor++];
      try {
        const albumSongs = await resolveAlbumSongs(ref.albumMid ?? "", AbortSignal.timeout(SEARCH_TIMEOUT_MS));
        const match = albumSongs.find((song) => song.name === ref.title) ?? albumSongs.find((song) => song.name?.includes(ref.title ?? "\u0000")) ?? albumSongs[0];
        if (!match) continue;
        if (tracksById.has(match.mid)) continue;
        tracksById.set(match.mid, {
          id: match.mid,
          title: ref.title ?? match.name,
          artist: ref.singerName ?? match.singers,
          album: match.name && match.name !== ref.title ? match.name : (ref.rankName || "QQ音乐"),
          albumId: ref.albumMid ?? null,
          artistIds: ref.singerMid ? [ref.singerMid] : [],
          duration: match.interval,
          // The toplist path only ships the plaintext 128k tier; show the
          // matching codec instead of a stale "320K" label.
          quality: qualityLabel("standard"),
          source: "qq",
          streamUrl: `/api/sources/qq/tracks/${match.mid}/stream`,
          coverUrl: ref.cover ?? (ref.albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${ref.albumMid}.jpg` : null),
          likedAt: null,
          bpm: null,
          bitrate: 128_000,
          sampleRate: null,
          currentLevel: "standard",
          availableLevels: ["standard"],
          // 榜单歌曲不知道 pay 状态;按 VIP 歌的保守路径解析(免费档先行,空则探测)。
        });
      } catch {
        // 单个专辑失败只丢一首,不影响整体推荐。
      }
    }
  }));
  tracks.push(...tracksById.values());
  if (tracks.length) recommendCache.set("toplist", { expiresAt: Date.now() + recommendCacheTtl, tracks });
  return tracks;
}

/** QQ 版"每日推荐":官方榜单聚合(每日更新,10 分钟缓存)。 */
export async function getQqDailyRecommendTracks(): Promise<ProviderTrack[]> {
  return fetchToplistTracks();
}

/** QQ 版"私人漫游":榜单池随机 + 排除最近播放。 */
export async function getQqRoamTracks(limit = 30, excludeIds: string[] = []): Promise<ProviderTrack[]> {
  const pool = await fetchToplistTracks();
  const excluded = new Set(excludeIds.map((id) => id.replace(/^qq:/, "")));
  const candidates = pool.filter((track) => !excluded.has(track.id));
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, Math.max(1, Math.min(50, limit)));
}

// —— 用户歌单 / 我喜欢（只读） ——

type QqProfileMusicEntry = { id?: string | number; title?: string; type?: number };

type QqProfileDissEntry = {
  dirid?: number;
  dissid?: number | string;
  tid?: number | string;
  diss_name?: string;
  dissname?: string;
  song_cnt?: number;
  songcnt?: number;
  picurl?: string;
  logo?: string;
};

type QqProfileData = {
  mymusic?: QqProfileMusicEntry[];
  mydiss?: { num?: number; list?: QqProfileDissEntry[] };
};

/**
 * Some accounts omit 我喜欢 from the profile `mymusic` payload even though the
 * dirid-201 playlist exists. The "created diss" endpoint still returns it, so
 * use it as a fallback before declaring the liked list empty.
 */
async function fetchCreatedDissLikedId(session: { cookie: string; parsed: QqSessionIdentity }): Promise<string | null> {
  const params = new URLSearchParams({
    hostUin: "0",
    hostuin: session.parsed.uin,
    sin: "0",
    size: "200",
    g_tk: "5381",
    loginUin: "0",
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq.json",
    needNewCode: "0",
  });
  const response = await fetch(`${CREATED_DISS_URL}?${params.toString()}`, {
    headers: { Referer: REFERER, "User-Agent": USER_AGENT, Cookie: session.cookie },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { data?: { disslist?: Array<{ dirid?: number; tid?: number | string }> } }
    | null;
  const liked = (payload?.data?.disslist ?? []).find(
    (entry) => Number(entry.dirid) === 201 && entry.tid != null,
  );
  return liked?.tid != null ? String(liked.tid) : null;
}

/** 我喜欢 is a special dirid-201 playlist; its disstid comes from the profile. */
export async function getQqLikedPlaylistId(): Promise<string | null> {
  const session = await optionalQqCookie();
  if (!session) return null;
  const profile = await fetchProfileData(session);
  const liked = (profile.mymusic ?? []).find((entry) => entry.title === LIKED_PLAYLIST_TITLE && entry.id != null);
  if (liked?.id != null) return String(liked.id);
  return fetchCreatedDissLikedId(session);
}

async function fetchProfileData(session: { cookie: string; parsed: QqSessionIdentity }): Promise<QqProfileData> {
  const params = new URLSearchParams({
    cid: PROFILE_CID,
    userid: session.parsed.uin,
    reqfrom: "1",
    g_tk: "5381",
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
    platform: "yqq.json",
    needNewCode: "0",
  });
  const response = await fetch(`${PROFILE_URL}?${params.toString()}`, {
    headers: { Referer: REFERER, "User-Agent": USER_AGENT, Cookie: session.cookie },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SourceError("UPSTREAM_FAILED", `QQ音乐个人主页请求失败 (${response.status})`, { source: "qq" });
  }
  const payload = (await response.json().catch(() => null)) as { data?: QqProfileData } | null;
  if (!payload?.data) {
    throw new SourceError("AUTH_REQUIRED", "QQ 音乐登录已过期，请到设置重新扫码登录", { source: "qq" });
  }
  return payload.data;
}

/** The signed-in user's playlists: 我喜欢 plus any created ones on the profile. */
export async function getQqPlaylists(): Promise<ProviderPlaylist[]> {
  const session = await optionalQqCookie();
  if (!session) {
    throw new SourceError("AUTH_REQUIRED", "登录 QQ 音乐后即可读取你的歌单（设置 → 播放源）", { source: "qq" });
  }
  const profile = await fetchProfileData(session);
  const playlists: ProviderPlaylist[] = [];
  const likedId = (profile.mymusic ?? []).find((entry) => entry.title === LIKED_PLAYLIST_TITLE && entry.id != null)?.id;
  if (likedId != null) {
    playlists.push({
      id: String(likedId),
      name: LIKED_PLAYLIST_TITLE,
      trackCount: 0,
      subscribed: false,
      owned: true,
      coverColor: "#f3b0c3",
    });
  }
  for (const diss of profile.mydiss?.list ?? []) {
    // dirid is a per-user folder number; the detail endpoint needs the global disstid.
    const id = diss.dissid ?? diss.tid;
    const name = diss.diss_name ?? diss.dissname;
    if (id == null || !name) continue;
    playlists.push({
      id: String(id),
      name,
      trackCount: diss.song_cnt ?? diss.songcnt ?? 0,
      subscribed: false,
      owned: true,
      coverColor: "#8fa7ff",
      coverUrl: diss.picurl ?? diss.logo ?? null,
    });
  }
  return playlists;
}

/** Playlist songs; the shape matches search songs, so reuse the same mapping. */
export async function getQqPlaylistTracks(disstid: string): Promise<ProviderTrack[]> {
  const session = await optionalQqCookie();
  if (!session) {
    throw new SourceError("AUTH_REQUIRED", "登录 QQ 音乐后即可读取你的歌单（设置 → 播放源）", { source: "qq" });
  }
  const id = disstid.trim();
  if (!/^\d+$/.test(id)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐歌单 ID", { source: "qq" });
  }
  const params = new URLSearchParams({
    type: "1",
    json: "1",
    utf8: "1",
    onlysong: "0",
    disstid: id,
    format: "json",
    inCharset: "utf-8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq.json",
    needNewCode: "0",
    g_tk: "5381",
  });
  const response = await fetch(`${PLAYLIST_DETAIL_URL}?${params.toString()}`, {
    headers: { Referer: REFERER, "User-Agent": USER_AGENT, Cookie: session.cookie },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SourceError("UPSTREAM_FAILED", `QQ音乐歌单请求失败 (${response.status})`, { source: "qq" });
  }
  const payload = (await response.json().catch(() => null)) as
    | { code?: number; cdlist?: Array<{ dissname?: string; songnum?: number; songlist?: QqSearchSong[] }> }
    | null;
  if (!payload || payload.code !== 0) {
    throw new SourceError("AUTH_REQUIRED", "QQ 音乐登录已过期，请到设置重新扫码登录", { source: "qq" });
  }
  const songs = payload.cdlist?.[0]?.songlist ?? [];
  songs.forEach(rememberFileInfo);
  return songs.map(normalizeQqSong).filter((track) => track.id);
}

/** The 我喜欢 playlist tracks; empty (not an error) when the playlist is absent. */
export async function getQqLikedTracks(): Promise<ProviderTrack[]> {
  const likedId = await getQqLikedPlaylistId();
  if (!likedId) return [];
  return getQqPlaylistTracks(likedId);
}
