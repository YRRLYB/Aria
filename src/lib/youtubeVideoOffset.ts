const VIDEO_OFFSET_STORAGE_KEY = "aria-youtube-video-offset-v1";
const MAX_CACHED_VIDEO_OFFSETS = 500;
const MIN_OFFSET_SECONDS = -15;
const MAX_OFFSET_SECONDS = 15;

export function clampYoutubeVideoOffset(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const clamped = Math.max(MIN_OFFSET_SECONDS, Math.min(MAX_OFFSET_SECONDS, seconds));
  const rounded = Math.round(clamped * 20) / 20;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function readOffsetStore(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VIDEO_OFFSET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key] = clampYoutubeVideoOffset(value);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeOffsetStore(entries: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(entries);
    if (keys.length > MAX_CACHED_VIDEO_OFFSETS) {
      const trimmed: Record<string, number> = {};
      for (const key of keys.slice(keys.length - MAX_CACHED_VIDEO_OFFSETS)) {
        trimmed[key] = entries[key];
      }
      window.localStorage.setItem(VIDEO_OFFSET_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(VIDEO_OFFSET_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort persistence.
  }
}

export function readYoutubeVideoOffset(videoId?: string | null): number {
  if (!videoId) return 0;
  const entries = readOffsetStore();
  return entries[videoId] ?? 0;
}

export function saveYoutubeVideoOffset(videoId: string, seconds: number): number {
  const next = clampYoutubeVideoOffset(seconds);
  if (!videoId) return next;
  const entries = readOffsetStore();
  if (next === 0) {
    delete entries[videoId];
  } else {
    delete entries[videoId];
    entries[videoId] = next;
  }
  writeOffsetStore(entries);
  return next;
}

export function nudgeYoutubeVideoOffset(current: number, delta: number): number {
  return clampYoutubeVideoOffset(current + delta);
}

export function formatYoutubeVideoOffset(seconds: number): string {
  const normalized = clampYoutubeVideoOffset(seconds);
  if (Math.abs(normalized) < 0.025) return "0.0s";
  const prefix = normalized > 0 ? "+" : "-";
  return `${prefix}${Math.abs(normalized).toFixed(1)}s`;
}

export type YoutubeMappedQuality = {
  id: number;
  label: string;
  ytCode: string;
};

const YOUTUBE_QUALITY_MAP: Record<string, { id: number; label: string }> = {
  highres: { id: 4320, label: "8K 超清" },
  hd2160: { id: 2160, label: "4K 2160P" },
  hd1440: { id: 1440, label: "2K 1440P" },
  hd1080: { id: 1080, label: "1080P 全高清" },
  hd720: { id: 720, label: "720P 高清" },
  large: { id: 480, label: "480P 清晰" },
  medium: { id: 360, label: "360P 流畅" },
};

const QUALITY_ORDER = ["highres", "hd2160", "hd1440", "hd1080", "hd720", "large", "medium"];

export function mapYoutubeQualityOptions(levels: string[]): YoutubeMappedQuality[] {
  const seen = new Set<string>();
  const normalized = levels.map((l) => l.trim().toLowerCase()).filter((l) => l in YOUTUBE_QUALITY_MAP);
  const unique = normalized.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  unique.sort((a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b));
  return unique.map((ytCode) => ({
    id: YOUTUBE_QUALITY_MAP[ytCode].id,
    label: YOUTUBE_QUALITY_MAP[ytCode].label,
    ytCode,
  }));
}

export function youtubeCodeForQualityId(qualityId: number | null | undefined): string | null {
  if (!qualityId) return null;
  for (const [ytCode, entry] of Object.entries(YOUTUBE_QUALITY_MAP)) {
    if (entry.id === qualityId) return ytCode;
  }
  return null;
}

export type YoutubeSyncDecision =
  | { action: "seek"; target: number; playbackRate: 1 }
  | { action: "rate"; playbackRate: number }
  | { action: "none"; playbackRate: 1 };

export function computeYoutubeSyncDecision(
  videoTime: number,
  targetTime: number,
  playing: boolean,
): YoutubeSyncDecision {
  // Never emit drift seeks or playbackRate nudges while paused: HTML5 video
  // players often auto-resume briefly around seeks, causing ~0.5s pause loops.
  if (!playing || !Number.isFinite(videoTime) || !Number.isFinite(targetTime)) {
    return { action: "none", playbackRate: 1 };
  }
  const safeTarget = Math.max(0, targetTime);
  const drift = videoTime - safeTarget;
  if (Math.abs(drift) > 0.35) {
    return { action: "seek", target: safeTarget, playbackRate: 1 };
  }
  if (Math.abs(drift) > 0.12) {
    return { action: "rate", playbackRate: drift > 0 ? 0.96 : 1.04 };
  }
  return { action: "none", playbackRate: 1 };
}
