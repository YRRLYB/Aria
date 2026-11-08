import type { ProviderAlbum, ProviderArtist, ProviderPlaylist, ProviderTrack } from "../../providers/musicProvider";
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
import { decodeAg1Response, encodeAg1Request, zzcSign } from "./signing";

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
  id?: number | string;
  mid?: string;
  name?: string;
  type?: number;
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

type QqSingerSearchItem = {
  singerID?: number;
  singerMID?: string;
  singerName?: string;
  singerPic?: string;
  songNum?: number;
  albumNum?: number;
};

type QqAlbumSearchItem = {
  albumID?: number;
  albumMID?: string;
  albumName?: string;
  albumPic?: string;
  singerName?: string;
  singerMID?: string;
  publicTime?: string;
  song_count?: number;
};

type QqPlaylistSearchItem = {
  dissid?: number | string;
  dissname?: string;
  song_count?: number;
  imgurl?: string;
  introduction?: string;
  creator?: { name?: string };
  listennum?: number;
};

type QqSearchBody = {
  song?: { list?: QqSearchSong[] };
  singer?: { list?: QqSingerSearchItem[] };
  album?: { list?: QqAlbumSearchItem[] };
  songlist?: { list?: QqPlaylistSearchItem[] };
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

type MusicuOptions = {
  cookie?: string | null;
  signal?: AbortSignal;
  /** 默认用 requestKey；搜索模块要求用 module 名作为外层 key。 */
  envelopeKey?: string;
  /** 搜索模块不接受顶层 comm，只带 Cookie 头。 */
  includeComm?: boolean;
};

type MusicuSection = { code?: number; msg?: string; message?: string; data?: unknown };

async function musicu<T>(
  requestKey: string,
  moduleName: string,
  method: string,
  param: Record<string, unknown>,
  options: MusicuOptions = {},
): Promise<T> {
  const identity = options.cookie ? parseQqCookie(options.cookie) : null;
  const envelopeKey = options.envelopeKey ?? requestKey;
  const response = await fetch(`${MUSICU_URL}?format=json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: REFERER,
      "User-Agent": USER_AGENT,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: JSON.stringify({
      ...(options.includeComm !== false && identity ? {
        comm: {
          ct: 24, cv: 0,
          uin: identity.uin,
          authst: identity.key,
          tmeLoginType: identity.loginType === 2 ? 1 : 2,
        },
      } : {}),
      [envelopeKey]: { module: moduleName, method, param },
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new SourceError("UPSTREAM_FAILED", `QQ音乐接口请求失败 (${response.status})`, { source: "qq" });
  }
  const payload = (await response.json().catch(() => null)) as Record<string, MusicuSection | undefined> | null;
  const section = payload?.[envelopeKey] ?? payload?.[requestKey];
  const code = Number(section?.code ?? 0);
  // QQ 搜索/账号模块在频控时返回 2001（业务块 code，HTTP 仍是 200）。
  if (code === 2001) {
    throw new SourceError("RATE_LIMITED", "QQ音乐提示操作过于频繁，请稍后再试", {
      source: "qq",
      retryAfterMs: 1_500,
    });
  }
  if (!section || code !== 0) {
    const message = String(section?.msg ?? section?.message ?? "").trim();
    throw new SourceError(
      "UPSTREAM_FAILED",
      message ? `QQ音乐接口返回异常：${message}` : "QQ音乐接口返回异常",
      { source: "qq" },
    );
  }
  return section.data as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
// 红心写入需要数字 songId，而推荐/榜单路径只有 MID；搜索和歌单响应里顺手缓存。
const songMetaCache = new Map<string, { songId: number; songType: number }>();
// 客户端防抖：同一关键词/类型/页码在 20 秒内只打一次上游，避免连点“加载更多”触发 2001。
const searchPageCache = new Map<string, { expiresAt: number; body: QqSearchBody }>();
const searchPageCacheTtl = 20_000;
const searchPageCacheMax = 160;
// 每次切页面都探测一次 QQ 资料很容易撞上 2001；按 Cookie 缓存 30 秒，
// 登录/退出时由 saveQqCookie/clearQqCookie 主动失效。
let accountCache: { cookie: string; expiresAt: number; value: SourceAccount } | null = null;
// 窗口重新聚焦时可能连续触发多次同步；短缓存既保持“刚点完红心”的新鲜度，
// 又避免同一秒内反复打 QQ 个人主页。
let likedTracksCache: { cookie: string; expiresAt: number; tracks: ProviderTrack[] } | null = null;
let playlistsCache: { cookie: string; expiresAt: number; playlists: ProviderPlaylist[] } | null = null;

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
  const numericId = Number(song.id);
  if (Number.isSafeInteger(numericId) && numericId > 0) {
    songMetaCache.set(song.mid, {
      songId: numericId,
      songType: Number.isSafeInteger(Number(song.type)) ? Math.max(0, Number(song.type)) : 0,
    });
    if (songMetaCache.size > 1000) {
      const oldest = songMetaCache.keys().next().value;
      if (oldest !== undefined) songMetaCache.delete(oldest);
    }
  }
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
    // pay_play === 0 才能匿名/免费播放；缺失 pay 字段时不能默认当成 VIP，
    // 否则免费歌曲也会被错误标成“需要会员”。这个标记只表示“整首收听需要
    // 会员”，仅高音质受限（pay_down/pay_month）不参与。
    vip: Number(song.pay?.pay_play ?? 0) > 0,
  };
}

/**
 * QQ 的搜索类型：0 单曲、1 歌手、2 专辑、3 歌单。非单曲类型目前只返回
 * 对应列表；搜索结果同样会间歇返回 2001，所以统一走这套退避 + 缓存。
 */
async function fetchQqSearchBody(
  query: string,
  searchType: 0 | 1 | 2 | 3,
  limit: number,
  offset: number,
): Promise<QqSearchBody> {
  const safeQuery = query.trim().slice(0, 120);
  if (!safeQuery) return {};
  const pageSize = Math.max(1, Math.min(50, limit));
  const page = Math.floor(offset / pageSize) + 1;
  const cacheKey = `${searchType}\u0000${safeQuery}\u0000${pageSize}\u0000${page}`;
  const cached = searchPageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  if (cached) searchPageCache.delete(cacheKey);

  const cookie = (await optionalQqCookie())?.cookie;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const data = await musicu<{ body?: QqSearchBody }>(
        "search",
        "music.search.SearchCgiService",
        "DoSearchForQQMusicDesktop",
        {
          search_type: searchType,
          query: safeQuery,
          page_num: page,
          num_per_page: pageSize,
        },
        {
          cookie,
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
          // 规范形状：外层 key 必须等于 module 名，且搜索结果不接受顶层 comm。
          envelopeKey: "music.search.SearchCgiService",
          includeComm: false,
        },
      );
      const body = data.body ?? {};
      searchPageCache.set(cacheKey, { expiresAt: Date.now() + searchPageCacheTtl, body });
      if (searchPageCache.size > searchPageCacheMax) {
        const oldest = searchPageCache.keys().next().value;
        if (oldest !== undefined) searchPageCache.delete(oldest);
      }
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof SourceError && error.code === "RATE_LIMITED";
      if (!retryable || attempt === 3) throw error;
      await sleep(300 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function searchQqTracks(query: string, limit: number, offset: number): Promise<ProviderTrack[]> {
  const body = await fetchQqSearchBody(query, 0, limit, offset);
  const songs = body.song?.list ?? [];
  songs.forEach(rememberFileInfo);
  return songs.map(normalizeQqSong).filter((track) => track.id);
}

export async function searchQqArtists(query: string, limit: number, offset: number): Promise<ProviderArtist[]> {
  const body = await fetchQqSearchBody(query, 1, limit, offset);
  return (body.singer?.list ?? []).flatMap((item) => {
    const id = item.singerMID?.trim();
    if (!id) return [];
    return [{
      id,
      name: item.singerName ?? "未知歌手",
      source: "qq",
      avatarUrl: item.singerPic
        ? httpsAvatar(item.singerPic)
        : `https://y.gtimg.cn/music/photo_new/T001R300x300M000${id}.jpg`,
      trackCount: Number(item.songNum) || null,
      albumCount: Number(item.albumNum) || null,
    } satisfies ProviderArtist];
  });
}

function normalizeQqAlbum(item: QqAlbumSearchItem): ProviderAlbum | null {
  const id = item.albumMID?.trim();
  if (!id) return null;
  const publishTime = item.publicTime ? Date.parse(item.publicTime) : Number.NaN;
  return {
    id,
    name: item.albumName ?? "未知专辑",
    source: "qq",
    artist: item.singerName ?? "未知歌手",
    artistId: item.singerMID ?? null,
    coverUrl: item.albumPic
      ? httpsAvatar(item.albumPic)
      : `https://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg`,
    publishTime: Number.isFinite(publishTime) ? publishTime : null,
    trackCount: Number(item.song_count) || null,
  };
}

export async function searchQqAlbums(query: string, limit: number, offset: number): Promise<ProviderAlbum[]> {
  const body = await fetchQqSearchBody(query, 2, limit, offset);
  return (body.album?.list ?? []).flatMap((item) => {
    const album = normalizeQqAlbum(item);
    return album ? [album] : [];
  });
}

export async function searchQqPlaylists(query: string, limit: number, offset: number): Promise<ProviderPlaylist[]> {
  const body = await fetchQqSearchBody(query, 3, limit, offset);
  return (body.songlist?.list ?? []).flatMap((item) => {
    if (item.dissid == null || !item.dissname) return [];
    return [{
      id: String(item.dissid),
      name: item.dissname,
      source: "qq",
      trackCount: Number(item.song_count) || 0,
      subscribed: false,
      owned: false,
      coverColor: "#31C27C",
      coverUrl: item.imgurl ? httpsAvatar(item.imgurl) : null,
      description: item.introduction ?? undefined,
      creatorName: item.creator?.name ?? undefined,
    } satisfies ProviderPlaylist];
  });
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
  const now = Date.now();
  if (accountCache?.cookie === session.cookie && accountCache.expiresAt > now) {
    return accountCache.value;
  }
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  let account: SourceAccount | null = null;
  try {
    account = await fetchLoginUserInfo(session.parsed, session.cookie, signal);
  } catch {
    // Fall through to the web-session probe.
  }
  if (!account) {
    try {
      account = await fetchProfileHomepage(session.parsed.uin, session.cookie, signal);
    } catch {
      account = null;
    }
  }
  const value = account ?? disconnectedAccount();
  if (value.connected) {
    accountCache = { cookie: session.cookie, expiresAt: now + 30_000, value };
  }
  return value;
}

function clearQqReadCaches() {
  clearPurlCache();
  payCache.clear();
  vipProbeState = "unknown";
  fileInfoCache.clear();
  songMetaCache.clear();
  searchPageCache.clear();
  accountCache = null;
  likedTracksCache = null;
  playlistsCache = null;
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
  clearQqReadCaches();
  return getQqAccount();
}

/** Sign out of QQ Music: drop the stored cookie and every cached URL. */
export async function clearQqCookie(): Promise<SourceAccount> {
  await updateStore((store) => ({ ...store, qqCookie: null }));
  clearQqReadCaches();
  return getQqAccount();
}

/** 仅测试用:重置会话级解析状态(账号能力探测、档位/付费标记缓存)。 */
export function resetQqStreamStateForTests() {
  clearQqReadCaches();
}

/** QQ 官网 g_tk：与 qqHash33(key) 相同，写接口 comm 里两个 token 都用它。 */
function qqHash33(value: string): number {
  let hash = 5381;
  for (const char of value) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) & 0x7fffffff;
  }
  return hash;
}

type QqSongDetail = {
  track_info?: { id?: number | string; songid?: number | string; type?: number; songtype?: number };
  info?: { id?: number | string; songid?: number | string; type?: number; songtype?: number };
};

/**
 * 红心/歌单写入只接受数字 songId；搜索与歌单详情通常会带 id，榜单和旧缓存
 * 只有 MID。这里按需补一次详情并缓存，避免每次点心都多打接口。
 */
async function resolveQqSongMeta(
  session: { cookie: string; parsed: QqSessionIdentity },
  songmid: string,
): Promise<{ songId: number; songType: number }> {
  const cached = songMetaCache.get(songmid);
  if (cached) return cached;

  const readMeta = (value: QqSongDetail | null | undefined) => {
    const info = value?.track_info ?? value?.info;
    const songId = Number(info?.id ?? info?.songid);
    if (!Number.isSafeInteger(songId) || songId <= 0) return null;
    const songType = Number(info?.type ?? info?.songtype ?? 0);
    return {
      songId,
      songType: Number.isSafeInteger(songType) ? Math.max(0, songType) : 0,
    };
  };

  const requests: Array<[string, string, Record<string, unknown>]> = [
    ["req_1", "music.pf_song_detail_svr", { song_mid: songmid }],
    ["req_2", "music.musicasset.song_info", { song_mid: songmid }],
  ];
  for (const [requestKey, moduleName, param] of requests) {
    try {
      const data = await musicu<QqSongDetail>(
        requestKey,
        moduleName,
        moduleName === "music.pf_song_detail_svr" ? "get_song_detail_yqq" : "get_song_info_all",
        param,
        { cookie: session.cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
      );
      const meta = readMeta(data);
      if (meta) {
        songMetaCache.set(songmid, meta);
        return meta;
      }
    } catch {
      // 第一个详情接口偶发不可用时继续尝试第二个。
    }
  }
  throw new SourceError("UNAVAILABLE", "无法获取该歌曲的数字 ID，暂时不能同步红心", { source: "qq" });
}

/**
 * 红心 / 取消红心：固定写入 dirId 201（我喜欢）。
 * 官网写接口需要 zzc 签名 + ag-1 加密；任何一步失败都不回退明文，避免
 * 产生“接口返回 0 但实际没写”的假成功。
 */
export async function setQqLike(trackId: string, liked: boolean): Promise<{ ok: boolean; liked: boolean }> {
  const songmid = trackId.trim();
  if (!songmid || /[/?#]/.test(songmid)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐歌曲 ID", { source: "qq" });
  }
  const session = await optionalQqCookie();
  if (!session) {
    throw new SourceError("AUTH_REQUIRED", "登录 QQ 音乐后才能同步我喜欢（设置 → 播放源）", { source: "qq" });
  }
  const { songId, songType } = await resolveQqSongMeta(session, songmid);
  const identity = session.parsed;
  const gtk = qqHash33(identity.key);
  const payload = {
    comm: {
      ct: 24,
      cv: 4747474,
      platform: "yqq.json",
      uin: identity.uin,
      qq: identity.uin,
      authst: identity.key,
      tmeLoginType: identity.loginType === 2 ? 1 : 2,
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      notice: 0,
      need_new_code: 1,
    },
    req_0: {
      module: "music.musicasset.PlaylistDetailWrite",
      method: liked ? "AddSonglist" : "DelSonglist",
      param: {
        dirId: 201,
        v_songInfo: [{ songId, songType }],
      },
    },
  };
  const bodyText = JSON.stringify(payload);
  const encrypted = encodeAg1Request(bodyText);
  const sign = zzcSign(bodyText);
  const response = await fetch(
    `https://u6.y.qq.com/cgi-bin/musics.fcg?_=${Date.now()}&encoding=ag-1&sign=${encodeURIComponent(sign)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Referer: REFERER,
        "User-Agent": USER_AGENT,
        Cookie: session.cookie,
      },
      body: new Uint8Array(encrypted),
      signal: AbortSignal.timeout(STREAM_RESOLVE_TIMEOUT_MS),
    },
  );
  const bytes = await response.arrayBuffer().catch(() => null);
  if (!bytes) {
    throw new SourceError("UPSTREAM_FAILED", "QQ音乐红心接口没有返回内容，请稍后再试", { source: "qq" });
  }
  let parsed: {
    code?: number;
    req_0?: { code?: number; msg?: string; message?: string; data?: { retCode?: number; msg?: string } };
  } | null = null;
  try {
    parsed = JSON.parse(decodeAg1Response(bytes));
  } catch {
    throw new SourceError("UPSTREAM_FAILED", "QQ音乐红心响应解析失败，请稍后再试", { source: "qq" });
  }
  const section = parsed?.req_0;
  // 逐层检查：外层 code、目标业务块 code、内层 data.retCode。只检查其中
  // 一层曾把 80105 之类的失败误判成成功。
  const resultCode = [parsed?.code, section?.code, section?.data?.retCode]
    .map((value) => Number(value ?? 0))
    .find((value) => Number.isFinite(value) && value !== 0) ?? 0;
  if (!response.ok || resultCode !== 0) {
    const message = String(section?.msg ?? section?.message ?? section?.data?.msg ?? "").trim();
    if ([301, 1000, 1001].includes(resultCode)) {
      throw new SourceError("AUTH_REQUIRED", "QQ 音乐登录已过期，请到设置重新扫码登录", { source: "qq" });
    }
    throw new SourceError(
      "UPSTREAM_FAILED",
      message
        ? `QQ音乐${liked ? "收藏" : "取消收藏"}失败：${message}`
        : `QQ音乐${liked ? "收藏" : "取消收藏"}失败${resultCode ? `（代码 ${resultCode}）` : ""}`,
      { source: "qq" },
    );
  }
  likedTracksCache = null;
  playlistsCache = null;
  return { ok: true, liked };
}

// —— 歌手 / 专辑详情 ——

type QqSingerDetailData = {
  singer_info?: { mid?: string; name?: string };
  singer_brief?: string;
  total_song?: number;
  total_album?: number;
};

type QqSingerSongData = {
  totalNum?: number;
  songList?: Array<{ songInfo?: QqSearchSong }>;
};

type QqSingerAlbumItem = {
  albumMid?: string;
  albumName?: string;
  singerName?: string;
  publishDate?: string;
  totalNum?: number;
};

type QqSingerAlbumData = {
  total?: number;
  albumList?: QqSingerAlbumItem[];
};

type QqAlbumDetailData = {
  basicInfo?: {
    albumMid?: string;
    albumName?: string;
    publishDate?: string;
    desc?: string;
    albumID?: number;
  };
  singer?: {
    singerList?: Array<{ mid?: string; name?: string }>;
  };
};

type QqAlbumSongData = {
  totalNum?: number;
  songList?: Array<{ songInfo?: QqSearchSong }>;
};

function qqArtistAvatar(artistId: string): string {
  return `https://y.gtimg.cn/music/photo_new/T001R300x300M000${artistId}.jpg`;
}

function qqAlbumCover(albumId: string): string {
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumId}.jpg`;
}

export async function getQqArtistTracks(
  artistId: string,
  limit = 60,
  offset = 0,
): Promise<{ tracks: ProviderTrack[]; more: boolean }> {
  const id = artistId.trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐歌手 ID", { source: "qq" });
  }
  const cookie = (await optionalQqCookie())?.cookie;
  const num = Math.max(1, Math.min(100, Math.floor(limit)));
  const begin = Math.max(0, Math.floor(offset));
  const data = await musicu<QqSingerSongData>(
    "req_0",
    "musichall.song_list_server",
    "GetSingerSongList",
    { singermid: id, order: 1, begin, num },
    { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
  );
  const songs = (data.songList ?? []).flatMap((item) => (item.songInfo ? [item.songInfo] : []));
  songs.forEach(rememberFileInfo);
  const tracks = songs.map(normalizeQqSong).filter((track) => track.id);
  return { tracks, more: tracks.length > 0 && begin + num < Number(data.totalNum ?? 0) };
}

export async function getQqArtistAlbums(
  artistId: string,
  limit = 30,
  offset = 0,
): Promise<{ albums: ProviderAlbum[]; more: boolean }> {
  const id = artistId.trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐歌手 ID", { source: "qq" });
  }
  const cookie = (await optionalQqCookie())?.cookie;
  const num = Math.max(1, Math.min(80, Math.floor(limit)));
  const begin = Math.max(0, Math.floor(offset));
  const data = await musicu<QqSingerAlbumData>(
    "req_0",
    "music.musichallAlbum.AlbumListServer",
    "GetAlbumList",
    { singermid: id, begin, num },
    { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
  );
  const total = Number(data.total ?? 0);
  const albums = (data.albumList ?? []).flatMap((item) => {
    const albumId = item.albumMid?.trim();
    if (!albumId) return [];
    const publishTime = item.publishDate ? Date.parse(item.publishDate) : Number.NaN;
    return [{
      id: albumId,
      name: item.albumName ?? "未知专辑",
      source: "qq",
      artist: item.singerName ?? "未知歌手",
      artistId: id,
      coverUrl: qqAlbumCover(albumId),
      publishTime: Number.isFinite(publishTime) ? publishTime : null,
      trackCount: Number(item.totalNum) || null,
    } satisfies ProviderAlbum];
  });
  return { albums, more: albums.length > 0 && begin + num < total };
}

export async function getQqArtistDetail(
  artistId: string,
): Promise<{ artist: ProviderArtist; description: string; sections: Array<{ title: string; text: string }> }> {
  const id = artistId.trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐歌手 ID", { source: "qq" });
  }
  const cookie = (await optionalQqCookie())?.cookie;
  let detail: QqSingerDetailData | null = null;
  try {
    detail = await musicu<QqSingerDetailData>(
      "req_0",
      "music.web_singer_info_svr",
      "get_singer_detail_info",
      { singermid: id, number: 10 },
      { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    );
  } catch {
    // 部分账号/地区会返回 400；用曲目里的歌手名兜底，页面仍可打开。
  }
  let fallbackTrack: ProviderTrack | null = null;
  if (!detail?.singer_info?.name) {
    fallbackTrack = (await getQqArtistTracks(id, 1, 0).catch(() => ({ tracks: [], more: false }))).tracks[0] ?? null;
  }
  const name = detail?.singer_info?.name || fallbackTrack?.artist || "未知歌手";
  const description = detail?.singer_brief?.trim() ?? "";
  const artist: ProviderArtist = {
    id,
    name,
    source: "qq",
    avatarUrl: qqArtistAvatar(id),
    trackCount: Number(detail?.total_song) || null,
    albumCount: Number(detail?.total_album) || null,
  };
  return {
    artist,
    description,
    sections: description ? [{ title: "艺人简介", text: description }] : [],
  };
}

async function getQqAlbumTracks(albumId: string): Promise<{ tracks: ProviderTrack[]; total: number }> {
  const cookie = (await optionalQqCookie())?.cookie;
  const data = await musicu<QqAlbumSongData>(
    "req_0",
    "music.musichallAlbum.AlbumSongList",
    "GetAlbumSongList",
    { albumMid: albumId, begin: 0, num: 500 },
    { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
  );
  const songs = (data.songList ?? []).flatMap((item) => (item.songInfo ? [item.songInfo] : []));
  songs.forEach(rememberFileInfo);
  return {
    tracks: songs.map(normalizeQqSong).filter((track) => track.id),
    total: Number(data.totalNum ?? songs.length),
  };
}

export async function getQqAlbum(
  albumId: string,
): Promise<{ album: ProviderAlbum; tracks: ProviderTrack[] }> {
  const id = albumId.trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new SourceError("UNAVAILABLE", "无效的 QQ 音乐专辑 ID", { source: "qq" });
  }
  const cookie = (await optionalQqCookie())?.cookie;
  const [detail, songs] = await Promise.all([
    musicu<QqAlbumDetailData>(
      "req_0",
      "music.musichallAlbum.AlbumInfoServer",
      "GetAlbumDetail",
      { albumMId: id },
      { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    ),
    getQqAlbumTracks(id),
  ]);
  const basic = detail.basicInfo ?? {};
  const singers = detail.singer?.singerList ?? [];
  const publishTime = basic.publishDate ? Date.parse(basic.publishDate) : Number.NaN;
  return {
    album: {
      id,
      name: basic.albumName ?? "未知专辑",
      source: "qq",
      artist: singers.map((singer) => singer.name).filter(Boolean).join(" / ") || "未知歌手",
      artistId: singers[0]?.mid ?? null,
      coverUrl: qqAlbumCover(id),
      publishTime: Number.isFinite(publishTime) ? publishTime : null,
      trackCount: songs.total || songs.tracks.length || null,
      description: basic.desc ?? undefined,
    },
    tracks: songs.tracks,
  };
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

type QqRadarData = {
  VecSongs?: Array<{ Track?: QqSearchSong }>;
  HasMore?: boolean;
};

/** QQ 官方私人雷达：优先真实 GetRadarSong，失败时回落到榜单随机。 */
async function fetchQqRadarTracks(limit: number, excludeIds: string[]): Promise<ProviderTrack[]> {
  const cookie = (await optionalQqCookie())?.cookie;
  const excluded = new Set(excludeIds.map((id) => id.replace(/^qq:/, "")));
  const tracks: ProviderTrack[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 4 && tracks.length < limit; page += 1) {
    const data = await musicu<QqRadarData>(
      "req_0",
      "music.recommend.TrackRelationServer",
      "GetRadarSong",
      { Page: page },
      { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    );
    const songs = (data.VecSongs ?? []).flatMap((item) => (item.Track ? [item.Track] : []));
    if (!songs.length) break;
    songs.forEach(rememberFileInfo);
    for (const song of songs) {
      const track = normalizeQqSong(song);
      if (!track.id || seen.has(track.id) || excluded.has(track.id)) continue;
      seen.add(track.id);
      tracks.push(track);
      if (tracks.length >= limit) break;
    }
    if (data.HasMore === false) break;
  }
  return tracks;
}

function findDailyDissId(value: unknown, seen = new Set<object>()): string | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDailyDissId(item, seen);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (Number(record.subtype) === 510) {
    const miscellany = (record.miscellany ?? {}) as Record<string, unknown>;
    const extra = (record.extra_info ?? {}) as Record<string, unknown>;
    const candidates = [
      record.id,
      record.dissid,
      record.tid,
      miscellany.dissid,
      miscellany.dissId,
      miscellany.DissID,
      miscellany.tid,
      extra.dissid,
    ];
    for (const candidate of candidates) {
      const id = String(candidate ?? "");
      if (/^\d{3,}$/.test(id)) return id;
    }
  }
  for (const item of Object.values(record)) {
    const found = findDailyDissId(item, seen);
    if (found) return found;
  }
  return null;
}

/**
 * QQ 版“每日推荐”：优先账号的 RecommendFeed（subtype 510 动态歌单），
 * 未登录/接口降级时回落到官方榜单聚合，保证页面永远有内容。
 */
export async function getQqDailyRecommendTracks(): Promise<ProviderTrack[]> {
  const cached = recommendCache.get("daily");
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;
  try {
    const cookie = (await optionalQqCookie())?.cookie;
    const feed = await musicu<Record<string, unknown>>(
      "req_0",
      "music.recommend.RecommendFeed",
      "get_recommend_feed",
      { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 },
      { cookie, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    );
    const dissId = findDailyDissId(feed);
    if (dissId) {
      const tracks = (await getQqPlaylistTracks(dissId)).slice(0, 30);
      if (tracks.length) {
        recommendCache.set("daily", { expiresAt: Date.now() + recommendCacheTtl, tracks });
        return tracks;
      }
    }
  } catch {
    // 未登录账号会拿不到 subtype 510；继续用榜单兜底。
  }
  return fetchToplistTracks();
}

/** QQ 版“私人漫游”：真实雷达优先，失败时榜单池随机 + 排除最近播放。 */
export async function getQqRoamTracks(limit = 30, excludeIds: string[] = []): Promise<ProviderTrack[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const radar = await fetchQqRadarTracks(safeLimit, excludeIds);
    if (radar.length) return radar;
  } catch {
    // 雷达需要登录态；匿名用户继续使用榜单随机。
  }
  const pool = await fetchToplistTracks();
  const excluded = new Set(excludeIds.map((id) => id.replace(/^qq:/, "")));
  const candidates = pool.filter((track) => !excluded.has(track.id));
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, safeLimit);
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
  if (playlistsCache?.cookie === session.cookie && playlistsCache.expiresAt > Date.now()) {
    return playlistsCache.playlists;
  }
  const profile = await fetchProfileData(session);
  const playlists: ProviderPlaylist[] = [];
  const likedId = (profile.mymusic ?? []).find((entry) => entry.title === LIKED_PLAYLIST_TITLE && entry.id != null)?.id;
  if (likedId != null) {
    playlists.push({
      id: String(likedId),
      name: LIKED_PLAYLIST_TITLE,
      source: "qq",
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
      source: "qq",
      trackCount: diss.song_cnt ?? diss.songcnt ?? 0,
      subscribed: false,
      owned: true,
      coverColor: "#8fa7ff",
      coverUrl: diss.picurl ?? diss.logo ?? null,
    });
  }
  playlistsCache = { cookie: session.cookie, expiresAt: Date.now() + 20_000, playlists };
  return playlists;
}

/**
 * 歌单详情走的是旧版 `fcg_ucc_getcdinfo_byids_cp.fcg`，它的字段名和
 * musicu 搜索完全不同（songmid/songname/albummid/strMediaMid/size128）。
 * 这里先统一成 QqSearchSong，再复用 normalizeQqSong。
 */
type QqLegacySong = {
  id?: number | string;
  songid?: number | string;
  mid?: string;
  songmid?: string;
  name?: string;
  songname?: string;
  type?: number;
  songtype?: number;
  interval?: number;
  singer?: QqSinger[];
  album?: { mid?: string; title?: string; name?: string };
  albummid?: string;
  albumname?: string;
  strMediaMid?: string;
  size128?: number | string;
  size320?: number | string;
  sizeflac?: number | string;
  sizehires?: number | string;
  size_48aac?: number | string;
  size_96aac?: number | string;
  size_128mp3?: number | string;
  size_320mp3?: number | string;
  size_flac?: number | string;
  size_hires?: number | string;
  file?: QqSearchSong["file"];
  pay?: { pay_play?: number; payplay?: number };
};

function normalizeLegacyQqSong(song: QqLegacySong): QqSearchSong {
  return {
    id: song.id ?? song.songid,
    mid: song.mid ?? song.songmid,
    name: song.name ?? song.songname,
    type: song.type ?? song.songtype,
    interval: song.interval,
    singer: song.singer,
    album: {
      mid: song.album?.mid ?? song.albummid,
      title: song.album?.title ?? song.album?.name ?? song.albumname,
      name: song.album?.name ?? song.albumname,
    },
    pay: song.pay
      ? { pay_play: song.pay.pay_play ?? song.pay.payplay }
      : undefined,
    file: {
      media_mid: song.file?.media_mid ?? song.strMediaMid,
      size_128mp3: song.file?.size_128mp3 ?? song.size_128mp3 ?? song.size128,
      size_320mp3: song.file?.size_320mp3 ?? song.size_320mp3 ?? song.size320,
      size_flac: song.file?.size_flac ?? song.size_flac ?? song.sizeflac,
      size_hires: song.file?.size_hires ?? song.size_hires ?? song.sizehires,
      size_48aac: song.file?.size_48aac ?? song.size_48aac,
      size_96aac: song.file?.size_96aac ?? song.size_96aac,
    },
  };
}

/** Playlist songs; old fcg rows are normalized into the search-song shape. */
export async function getQqPlaylistTracks(disstid: string): Promise<ProviderTrack[]> {
  // 公开歌单匿名也能读；只有“我喜欢”等私有目录才需要 Cookie。
  const session = await optionalQqCookie();
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
    headers: { Referer: REFERER, "User-Agent": USER_AGENT, Cookie: session?.cookie ?? "" },
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
  const songs = (payload.cdlist?.[0]?.songlist ?? []) as QqLegacySong[];
  const normalizedSongs = songs.map(normalizeLegacyQqSong);
  normalizedSongs.forEach(rememberFileInfo);
  return normalizedSongs.map(normalizeQqSong).filter((track) => track.id);
}

/** The 我喜欢 playlist tracks; empty (not an error) when the playlist is absent. */
export async function getQqLikedTracks(): Promise<ProviderTrack[]> {
  const session = await optionalQqCookie();
  if (!session) return [];
  if (likedTracksCache?.cookie === session.cookie && likedTracksCache.expiresAt > Date.now()) {
    return likedTracksCache.tracks;
  }
  const likedId = await getQqLikedPlaylistId();
  const tracks = likedId ? await getQqPlaylistTracks(likedId) : [];
  likedTracksCache = { cookie: session.cookie, expiresAt: Date.now() + 3_000, tracks };
  return tracks;
}
