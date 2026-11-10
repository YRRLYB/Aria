import type { LocalMetadataOverride } from "../src/lib/localMetadata";

export type ScannedTrack = {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  duration: number | null;
  quality: string;
  format: string;
  size: number;
  bitrate?: number | null;
  sampleRate?: number | null;
  bpm?: number | null;
  hasCover?: boolean;
  trackNumber?: number | null;
  discNumber?: number | null;
  libraryRoot?: string;
  mediaKind?: "file" | "audio-cd";
  nativeDevice?: string | null;
  streamUrl?: string | null;
  nativeStart?: string | null;
  nativeEnd?: string | null;
  cdReadQuality?: "high" | "low";
  requiresNativePlayback?: boolean;
  metadata?: LocalMetadataOverride;
};

export type LyricCandidate = {
  id: string;
  source: "网易云" | "QQ音乐" | "酷狗";
  title: string;
  artist: string;
  album: string;
  coverUrl?: string | null;
  score: number;
  preview: string[];
};

export type StoredNeteaseAccount = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
  avatarUrl: string | null;
  cookiePreview: string | null;
  validatedAt: number;
};

export type AppStore = {
  neteaseCookie: string | null;
  neteaseAccount: StoredNeteaseAccount | null;
  /** Raw QQ Music cookie header; parsed for uin + qqmusic_key/qm_keyst. */
  qqCookie?: string | null;
  /** Raw Bilibili cookie header (SESSDATA/bili_jct/DedeUserID). */
  bilibiliCookie?: string | null;
  /**
   * Mainland egress IP the NetEase client should claim. Only needed when the
   * machine's real exit IP makes NetEase answer 460/"环境异常" (overseas or
   * hosting networks); empty means "use the real connection".
   */
  neteaseRealIp?: string | null;
  /**
   * Per-source switches. A source missing from this record is enabled, so
   * existing stores keep working after an upgrade adds a new source.
   */
  sources?: Record<string, { enabled?: boolean }>;
  lyricBindings: Record<string, string>;
  libraryAutoScanEnabled: boolean;
};
