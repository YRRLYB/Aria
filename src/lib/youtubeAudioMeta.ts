import type { Track } from "@/data/music";
import { normalizeQuality } from "@/lib/playerPresentation";

export type YoutubeAudioMetaEntry = {
  bitrate?: number | null;
  sampleRate?: number | null;
  quality?: Track["quality"];
  currentLevel?: Track["currentLevel"];
  availableLevels?: Track["availableLevels"];
};

const AUDIO_META_STORAGE_KEY = "aria-youtube-audio-meta-v1";
const MAX_CACHED_AUDIO_META = 500;

function readYoutubeAudioMetaStore(): Record<string, YoutubeAudioMetaEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AUDIO_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, YoutubeAudioMetaEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeYoutubeAudioMetaStore(entries: Record<string, YoutubeAudioMetaEntry>) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(entries);
    if (keys.length > MAX_CACHED_AUDIO_META) {
      const trimmed: Record<string, YoutubeAudioMetaEntry> = {};
      for (const key of keys.slice(keys.length - MAX_CACHED_AUDIO_META)) {
        trimmed[key] = entries[key];
      }
      window.localStorage.setItem(AUDIO_META_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(AUDIO_META_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Cache writes are best-effort.
  }
}

export function saveYoutubeAudioMeta(providerId: string, meta: YoutubeAudioMetaEntry) {
  if (!providerId) return;
  const entries = readYoutubeAudioMetaStore();
  const previous = entries[providerId];
  entries[providerId] = {
    bitrate: meta.bitrate ?? previous?.bitrate ?? null,
    sampleRate: meta.sampleRate ?? previous?.sampleRate ?? null,
    quality: meta.quality ? normalizeQuality(meta.quality) : previous?.quality,
    currentLevel: meta.currentLevel ?? previous?.currentLevel ?? null,
    availableLevels: meta.availableLevels?.length ? meta.availableLevels : previous?.availableLevels,
  };
  writeYoutubeAudioMetaStore(entries);
}

export function applyYoutubeCachedAudioMeta(track: Track): Track {
  if (track.source !== "youtube") return track;
  const key = track.providerId ?? (track.id.startsWith("youtube:") ? track.id.slice("youtube:".length) : "");
  const cached = key ? readYoutubeAudioMetaStore()[key] : undefined;
  if (!cached) return track;
  return {
    ...track,
    bitrate: cached.bitrate ?? track.bitrate ?? null,
    sampleRate: cached.sampleRate ?? track.sampleRate ?? null,
    quality: cached.quality ?? track.quality,
    currentLevel: cached.currentLevel ?? track.currentLevel ?? null,
    availableLevels: cached.availableLevels?.length ? cached.availableLevels : track.availableLevels,
  };
}
