import type { ProviderTrack } from "../../providers/musicProvider";
import type {
  AriaLevel,
  SourceStreamMeta,
  SourceVideoMeta,
} from "../contract";
import { SourceError } from "../contract";
import type { LyricLine } from "../../../src/lib/lyricTypes";

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
};

type BiliPlayData = {
  quality?: number;
  format?: string;
  accept_quality?: number[];
  accept_description?: string[];
  dash?: {
    audio?: BiliAudio[];
    video?: Array<{ id?: number; baseUrl?: string; base_url?: string; width?: number; height?: number }>;
  };
  durl?: Array<{ url?: string; backup_url?: string[]; size?: number; length?: number }>;
};

type BiliViewData = {
  bvid: string;
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
    const cookie = await ensureCookies(attempt > 0);
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
  const mime = audio.mimeType ?? audio.mime_type;
  if (mime) return mime;
  return "audio/mp4";
}

function requestedLevel(level: AriaLevel | undefined) {
  if (!level || level === "jymaster") return "hires";
  return level;
}

function chooseAudio(audios: BiliAudio[], level: AriaLevel | undefined) {
  const requested = requestedLevel(level);
  const requestedIndex = AUDIO_LEVELS.findIndex((entry) => entry.level === requested);
  const present = AUDIO_LEVELS.filter((entry) => audios.some((audio) => audio.id === entry.id));
  if (!present.length) return null;
  const exact = present.find((entry) => entry.level === requested);
  if (exact) return { entry: exact, audio: audios.find((audio) => audio.id === exact.id)! };
  // Graceful degradation: prefer the highest format at or below the request,
  // then the lowest available format above it.
  const ordered = [...present].sort((left, right) => AUDIO_LEVELS.indexOf(left) - AUDIO_LEVELS.indexOf(right));
  const lower = requestedIndex < 0 ? [] : ordered.filter((entry) => AUDIO_LEVELS.indexOf(entry) <= requestedIndex);
  const entry = lower.at(-1) ?? ordered[0];
  return { entry, audio: audios.find((audio) => audio.id === entry.id)! };
}

async function playurl(
  trackId: string,
  fnval: number,
  level: AriaLevel | undefined,
  signal?: AbortSignal,
) {
  const view = await getBilibiliView(trackId, signal);
  const requestedQn = level === "hires" || level === "lossless" ? 80 : 64;
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
  const { view, data } = await playurl(trackId, 16, options.level, signal);
  const audios = data?.dash?.audio ?? [];
  const chosen = chooseAudio(audios, options.level);
  const durl = data?.durl?.[0]?.url;
  const url = chosen ? audioBaseUrl(chosen.audio) : durl;
  if (!url) {
    throw new SourceError("UNAVAILABLE", "B站没有返回可播放的音轨", { source: "bilibili" });
  }
  const availableLevels = AUDIO_LEVELS
    .filter((entry) => audios.some((audio) => audio.id === entry.id))
    .map((entry) => entry.level);
  return {
    url: url.startsWith("//") ? `https:${url}` : url,
    headers: {
      "User-Agent": BILIBILI_UA,
      Referer: BILIBILI_REFERER,
      Cookie: await ensureCookies(),
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
  const { data } = await playurl(trackId, 0, options.level, signal);
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
      Cookie: await ensureCookies(),
    },
    mimeType: "video/mp4",
    quality: quality ?? "360P",
    expiresAt: Date.now() + STREAM_URL_TTL_MS,
  };
}

function formatLyricTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export async function getBilibiliLyrics(trackId: string, signal?: AbortSignal): Promise<LyricLine[]> {
  try {
    const view = await getBilibiliView(trackId, signal);
    const data = await biliJson<{
      subtitle?: {
        subtitles?: Array<{
          lan?: string;
          lan_doc?: string;
          subtitle_url?: string;
        }>;
      };
    }>(
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(view.bvid)}&cid=${view.cid}`,
      signal,
    );
    const subtitles = data?.subtitle?.subtitles ?? [];
    const preferred = subtitles.find((item) => /zh|ai-zh/i.test(item.lan ?? "")) ?? subtitles[0];
    if (!preferred?.subtitle_url) return [];
    const url = preferred.subtitle_url.startsWith("//")
      ? `https:${preferred.subtitle_url}`
      : preferred.subtitle_url;
    const response = await fetch(url, {
      headers: {
        "User-Agent": BILIBILI_UA,
        Referer: BILIBILI_REFERER,
        ...(cookies.size ? { Cookie: cookieHeader() } : {}),
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
}
