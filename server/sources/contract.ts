import type { ProviderAlbum, ProviderArtist, ProviderPlaylist, ProviderTrack } from "../providers/musicProvider";
import type { LyricLine } from "../../src/lib/lyricTypes";
import { HttpError } from "../utils/httpError";

/**
 * Identifiers for built-in sources. `bilibili` and `youtube` are reserved so
 * their track keys remain parseable before the modules themselves land.
 */
export type SourceId = "netease" | "qq" | "bilibili" | "youtube";

export const SOURCE_IDS: readonly SourceId[] = ["netease", "qq", "bilibili", "youtube"];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

/**
 * A track identity is `<source>:<externalId>`. The contract only owns the
 * prefix split; each source defines its own `externalId` syntax, including
 * composite ids such as `bilibili:BV1xx:cid`.
 */
export type TrackKey = `${SourceId}:${string}`;

export type ParsedTrackKey = { source: SourceId; externalId: string };

export function formatTrackKey(source: SourceId, externalId: string): TrackKey {
  return `${source}:${externalId}`;
}

/** Returns null for malformed keys instead of throwing; callers decide fallbacks. */
export function parseTrackKey(key: string): ParsedTrackKey | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const source = key.slice(0, separator);
  const externalId = key.slice(separator + 1);
  if (!isSourceId(source) || !externalId) return null;
  return { source, externalId };
}

export type AriaLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster";

export const ARIA_LEVELS: readonly AriaLevel[] = ["standard", "higher", "exhigh", "lossless", "hires", "jymaster"];

export function isAriaLevel(value: string): value is AriaLevel {
  return (ARIA_LEVELS as readonly string[]).includes(value);
}

/** Levels ordered from lowest to highest; used for graceful degradation. */
export function levelsUpTo(level: AriaLevel | null | undefined): AriaLevel[] {
  if (!level) return [];
  const index = ARIA_LEVELS.indexOf(level);
  return index < 0 ? [] : ARIA_LEVELS.slice(0, index + 1);
}

export type SourceSearchMode = "tracks" | "artists" | "playlists" | "albums";

export type SourceCapabilities = {
  /** Search modes this source can answer. Unsupported modes return empty data. */
  searchModes: SourceSearchMode[];
  playback: boolean;
  lyrics: boolean;
  wordLyrics: boolean;
  account: boolean;
  liked: boolean;
  playlistsRead: boolean;
  playlistsWrite: boolean;
  recommendations: boolean;
  artistDetail: boolean;
  albumDetail: boolean;
  qualitySelection: boolean;
  /** Muxed video stream in addition to the audio stream. */
  videoPlayback: boolean;
};

export type SourceSearchQuery = {
  query: string;
  mode: SourceSearchMode;
  limit: number;
  offset: number;
};

export type SourceSearchPage = {
  tracks: ProviderTrack[];
  artists: ProviderArtist[];
  playlists: ProviderPlaylist[];
  albums?: ProviderAlbum[];
};

export type SourceAccount = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
};

export type SourceQrLoginStart = {
  /** Session handle for checkQrLogin. */
  key: string;
  /** data: URL of the QR image, ready for <img src>. */
  qrImage: string;
  /** Seconds until the QR expires; the caller should offer regeneration. */
  expiresIn: number;
};

export type SourceQrLoginStatus = "waiting" | "scanned" | "expired" | "success";

export type SourceQrLoginCheck = {
  /** Platform status code (66 waiting / 67 scanned / 65 expired / 0 success). */
  code: number;
  status: SourceQrLoginStatus;
  message: string;
  account: SourceAccount | null;
};

/**
 * What a stream proxy needs to fetch audio. `headers` are upstream request
 * headers (Referer/User-Agent/Cookie) and must never reach the renderer; the
 * stream-meta route strips them before responding.
 */
export type SourceStreamMeta = {
  url: string;
  headers?: Record<string, string>;
  /** Upstream MIME type to expose when the CDN sends octet-stream. */
  mimeType?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  size?: number | null;
  quality?: ProviderTrack["quality"] | null;
  currentLevel?: AriaLevel | null;
  availableLevels?: AriaLevel[];
  /** Unix ms after which the URL is assumed stale; proxies re-resolve past it. */
  expiresAt?: number | null;
};

export type SourceVideoMeta = {
  url: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
  quality?: string | null;
  /** Platform quality id (Bilibili qn) currently granted. */
  qualityId?: number | null;
  /** Selectable qualities reported by the platform for this video. */
  availableQualities?: Array<{ id: number; label: string }>;
  width?: number | null;
  height?: number | null;
  expiresAt?: number | null;
};

export type SourceManifest = {
  id: SourceId;
  name: string;
  shortName: string;
  version: string;
  /** Hosts the source is allowed to proxy artwork from (suffix match). */
  artworkHosts: string[];
  capabilities: SourceCapabilities;
};

export type SourceErrorCode =
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "UNSUPPORTED"
  | "TIMEOUT"
  | "UPSTREAM_FAILED";

const SOURCE_ERROR_STATUS: Record<SourceErrorCode, number> = {
  AUTH_REQUIRED: 401,
  RATE_LIMITED: 429,
  UNAVAILABLE: 404,
  UNSUPPORTED: 400,
  TIMEOUT: 504,
  UPSTREAM_FAILED: 502,
};

export class SourceError extends Error {
  readonly source?: SourceId;
  readonly retryAfterMs?: number;

  constructor(
    readonly code: SourceErrorCode,
    message: string,
    options: { source?: SourceId; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.source = options.source;
    this.retryAfterMs = options.retryAfterMs;
  }

  toHttpError(): HttpError {
    return new HttpError(SOURCE_ERROR_STATUS[this.code], this.message, `SOURCE_${this.code}`);
  }
}

export type MusicSource = {
  readonly manifest: SourceManifest;
  search(query: SourceSearchQuery, signal?: AbortSignal): Promise<SourceSearchPage>;
  /**
   * Resolve a playable URL. `options.refresh` bypasses any internal URL cache
   * after the stream proxy saw an upstream expiry (403/410).
   */
  resolveStreamMeta(
    trackId: string,
    options: { level?: AriaLevel; refresh?: boolean },
    signal?: AbortSignal,
  ): Promise<SourceStreamMeta>;
  /** Optional muxed video stream (Bilibili). Audio playback uses resolveStreamMeta. */
  resolveVideoMeta?(
    trackId: string,
    options: { level?: AriaLevel; refresh?: boolean; qn?: number },
    signal?: AbortSignal,
  ): Promise<SourceVideoMeta>;
  getLyrics?(trackId: string, signal?: AbortSignal): Promise<LyricLine[]>;
  getAccount?(signal?: AbortSignal): Promise<SourceAccount>;
  /** Account-owned favourites/liked tracks, when the source can read them. */
  getLikedTracks?(): Promise<ProviderTrack[]>;
  /** Resolve a pasted platform link (video, album, favourite folder, ...). */
  resolveLink?(url: string): Promise<{ kind: "video" | "folder" | "playlist"; title?: string; tracks: ProviderTrack[] }>;
  /** 收藏/取消收藏（QQ 红心、B站默认收藏夹等）；未实现的源不提供该入口。 */
  setLike?(trackId: string, liked: boolean): Promise<{ ok: boolean; liked: boolean }>;
  /** 歌手详情页（简介 + 基础资料）。 */
  getArtistDetail?(artistId: string): Promise<{ artist: ProviderArtist; description: string; sections: Array<{ title: string; text: string }> }>;
  /** 歌手专辑分页。 */
  getArtistAlbums?(artistId: string, limit: number, offset: number): Promise<{ albums: ProviderAlbum[]; more: boolean }>;
  /** 歌手曲目分页。 */
  getArtistTracks?(artistId: string, limit: number, offset: number): Promise<{ tracks: ProviderTrack[]; more: boolean }>;
  /** 专辑详情 + 曲目。 */
  getAlbum?(albumId: string): Promise<{ album: ProviderAlbum; tracks: ProviderTrack[] }>;
  /** 每日推荐(源内聚实现;网易云走旧路由,这里服务于新源)。 */
  getDailyRecommendTracks?(signal?: AbortSignal): Promise<ProviderTrack[]>;
  /** 私人漫游:随机发现,excludeIds 为最近播放的 TrackKey。 */
  getRoamTracks?(limit: number, excludeIds: string[], signal?: AbortSignal): Promise<ProviderTrack[]>;
  saveCookie?(cookie: string): Promise<SourceAccount>;
  clearCookie?(): Promise<SourceAccount>;
  startQrLogin?(): Promise<SourceQrLoginStart>;
  checkQrLogin?(key: string): Promise<SourceQrLoginCheck>;
};

export const SEARCH_TIMEOUT_MS = 8_000;
export const STREAM_RESOLVE_TIMEOUT_MS = 12_000;
export const LYRICS_TIMEOUT_MS = 8_000;
