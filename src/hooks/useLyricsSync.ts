import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import { canonicalTrackId } from "@/lib/ariaRoomSync";
import { BILIBILI_LYRICS_ENABLED } from "@/lib/features";
import { normalizeBilingualLyrics } from "@/lib/lyricNormalize";
import { hasSyncedLyrics, writeCachedLyrics } from "@/lib/playerPresentation";
import { idleTrack } from "@/lib/trackMappers";
import { cleanYoutubeTrackQuery, selectAutomaticMetadataCandidate } from "@/lib/localMetadata";
import { memoryLimits, trimMapCache } from "@/lib/memoryCache";

// Owns lyric acquisition: binding-driven rebinds for local tracks, automatic
// sync (and bilingual translation refresh) for the active track.
export function useLyricsSync(options: {
  applyTrackUpdate: (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void;
  activeTrack: Track;
  localTracks: Track[];
}) {
  const { applyTrackUpdate } = options;
  const [lyricBindings, setLyricBindings] = useState<Record<string, string>>({});
  const lyricBindingsRef = useRef(lyricBindings);
  lyricBindingsRef.current = lyricBindings;
  const activeTrackRef = useRef(options.activeTrack);
  activeTrackRef.current = options.activeTrack;
  const lyricSyncingRef = useRef<Set<string>>(new Set());
  const lyricEnrichmentRefreshRef = useRef<Set<string>>(new Set());
  // 首曲恢复/冷启动时后端可能还没就绪，歌词请求会失败一次。以前失败后
  // 没有重试，用户看到的就是“第一首歌没歌词”。这里对同一首歌最多重试 3 次。
  const lyricRetryCountRef = useRef<Map<string, number>>(new Map());
  const lyricRetryTimerRef = useRef<number | null>(null);
  const [lyricRetryTick, setLyricRetryTick] = useState(0);

  function resolveBindingKey(trackId: string): string {
    if (activeTrackRef.current.id === trackId) {
      return canonicalTrackId(activeTrackRef.current);
    }
    const matchedLocal = options.localTracks.find((item) => item.id === trackId);
    return matchedLocal ? canonicalTrackId(matchedLocal) : trackId;
  }

  function applyLyricsToTrack(trackId: string, lyrics: Track["lyrics"], candidateId?: string) {
    const normalized = normalizeBilingualLyrics(lyrics);
    if (!normalized.length) return;
    const bindingKey = resolveBindingKey(trackId);
    if (candidateId) {
      lyricBindingsRef.current = { ...lyricBindingsRef.current, [bindingKey]: candidateId };
      setLyricBindings((current) => ({ ...current, [bindingKey]: candidateId }));
    }
    writeCachedLyrics(bindingKey, normalized);
    applyTrackUpdate(
      trackId,
      (track) =>
        track.id === trackId || canonicalTrackId(track) === bindingKey
          ? { ...track, lyrics: normalized, lyricStatus: "linked" as const }
          : track,
      { includeHistory: true },
    );
  }

  function markLyricsMissing(trackId: string) {
    applyTrackUpdate(
      trackId,
      (track) => (track.id === trackId ? { ...track, lyrics: [], lyricStatus: "missing" as const } : track),
      { includeHistory: false },
    );
  }

  async function acquireLyricsForTrack(track: Track): Promise<"applied" | "empty" | "unavailable"> {
    const bindingKey = canonicalTrackId(track);
    const binding = lyricBindingsRef.current[bindingKey] ?? lyricBindingsRef.current[track.id];
    if (binding) {
      const result = await api.bindLyric(bindingKey, binding, binding);
      const latestBinding = lyricBindingsRef.current[bindingKey] ?? lyricBindingsRef.current[track.id];
      if (!result.accepted || latestBinding !== binding) return "unavailable";
      const normalized = Array.isArray(result.lyrics) ? normalizeBilingualLyrics(result.lyrics) : [];
      if (normalized.length) {
        applyLyricsToTrack(track.id, normalized);
        return "applied";
      }
      if (track.source === "local" || track.source === "youtube") {
        markLyricsMissing(track.id);
        return "empty";
      }
    }

    const providerId = track.providerId ?? (track.id.startsWith(`${track.source}:`) ? track.id.slice(track.source.length + 1) : undefined);
    if (track.source === "qq" || track.source === "subsonic" || track.source === "webdav") {
      if (!providerId) return "unavailable";
      const result = await api.getSourceLyrics(track.source, providerId);
      const normalized = Array.isArray(result.lyrics) ? normalizeBilingualLyrics(result.lyrics) : [];
      if (normalized.length) {
        applyLyricsToTrack(track.id, normalized);
        return "applied";
      }
      markLyricsMissing(track.id);
      return "empty";
    }
    if (track.source === "bilibili") {
      if (!BILIBILI_LYRICS_ENABLED || !providerId) return "unavailable";
      const result = await api.getSourceLyrics("bilibili", providerId);
      const normalized = Array.isArray(result.lyrics) ? normalizeBilingualLyrics(result.lyrics) : [];
      if (normalized.length) {
        applyLyricsToTrack(track.id, normalized);
        return "applied";
      }
      markLyricsMissing(track.id);
      return "empty";
    }
    if (track.source === "netease") {
      if (!providerId) return "unavailable";
      const result = await api.getNeteaseLyrics(providerId);
      const normalized = Array.isArray(result.lyrics) ? normalizeBilingualLyrics(result.lyrics) : [];
      if (normalized.length) {
        applyLyricsToTrack(track.id, normalized);
        return "applied";
      }
      try {
        const searchInput = { title: track.title, artist: track.artist, album: track.album };
        const candidates = await api.searchLyrics(searchInput);
        const best = selectAutomaticMetadataCandidate(searchInput, candidates.candidates);
        if (best && !(lyricBindingsRef.current[bindingKey] ?? lyricBindingsRef.current[track.id])) {
          const bound = await api.bindLyric(bindingKey, best.id, null);
          const boundNormalized = Array.isArray(bound.lyrics) ? normalizeBilingualLyrics(bound.lyrics) : [];
          if (
            bound.accepted &&
            boundNormalized.length &&
            !(lyricBindingsRef.current[bindingKey] ?? lyricBindingsRef.current[track.id])
          ) {
            applyLyricsToTrack(track.id, boundNormalized, best.id);
            return "applied";
          }
        }
      } catch {
        // Cross-source fallback is best-effort; confirmed empty primary still resolves cleanly.
      }
      markLyricsMissing(track.id);
      return "empty";
    }

    if (track.source === "local" || track.source === "youtube") {
      const searchInput = track.source === "youtube"
        ? cleanYoutubeTrackQuery(track)
        : { title: track.title, artist: track.artist, album: track.album };
      const candidates = await api.searchLyrics(searchInput);
      const best = selectAutomaticMetadataCandidate(searchInput, candidates.candidates);
      if (!best || (lyricBindingsRef.current[bindingKey] ?? lyricBindingsRef.current[track.id]) !== binding) {
        if (!best) markLyricsMissing(track.id);
        return best ? "unavailable" : "empty";
      }
      const result = await api.bindLyric(bindingKey, best.id, binding ?? null);
      if (!result.accepted || (lyricBindingsRef.current[bindingKey] ?? lyricBindingsRef.current[track.id]) !== binding) {
        return "unavailable";
      }
      const normalized = Array.isArray(result.lyrics) ? normalizeBilingualLyrics(result.lyrics) : [];
      if (!normalized.length) {
        markLyricsMissing(track.id);
        return "empty";
      }
      applyLyricsToTrack(track.id, normalized, best.id);
      return "applied";
    }
    return "unavailable";
  }

  async function syncLyricsForTrack(track: Track): Promise<boolean> {
    return (await acquireLyricsForTrack(track)) === "applied";
  }

  useEffect(() => {
    const boundTracks = options.localTracks
      .filter((track) => lyricBindings[track.id] && !hasSyncedLyrics(track) && !lyricSyncingRef.current.has(track.id))
      .slice(0, 8);
    if (!boundTracks.length) return;

    boundTracks.forEach((track) => {
      const binding = lyricBindings[track.id];
      lyricSyncingRef.current.add(track.id);
      api
        .bindLyric(track.id, binding, binding)
        .then((result) => {
          if (!result.accepted || lyricBindingsRef.current[track.id] !== binding) return;
          applyLyricsToTrack(track.id, result.lyrics);
        })
        .catch(() => {
          // Keep using cached placeholder if rebinding fails.
        })
        .finally(() => {
          lyricSyncingRef.current.delete(track.id);
        });
    });
  }, [options.localTracks, lyricBindings]);

  function scheduleLyricRetry(trackId: string) {
    const attempt = lyricRetryCountRef.current.get(trackId) ?? 0;
    if (attempt >= 3) return;
    if (lyricRetryTimerRef.current !== null) {
      window.clearTimeout(lyricRetryTimerRef.current);
      lyricRetryTimerRef.current = null;
    }
    const delay = [1_200, 3_000, 7_000][attempt] ?? 7_000;
    lyricRetryTimerRef.current = window.setTimeout(() => {
      lyricRetryTimerRef.current = null;
      if (activeTrackRef.current.id !== trackId || hasSyncedLyrics(activeTrackRef.current)) return;
      lyricRetryCountRef.current.set(trackId, attempt + 1);
      trimMapCache(lyricRetryCountRef.current, memoryLimits.lyricRetries);
      setLyricRetryTick((value) => value + 1);
    }, delay);
  }

  useEffect(() => () => {
    if (lyricRetryTimerRef.current !== null) window.clearTimeout(lyricRetryTimerRef.current);
    lyricRetryTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (lyricRetryTimerRef.current !== null) window.clearTimeout(lyricRetryTimerRef.current);
    lyricRetryTimerRef.current = null;
  }, [options.activeTrack.id]);

  const syncActiveTrackLyrics = useEffectEvent(() => {
    const activeTrack = options.activeTrack;
    if (activeTrack.source === "bilibili" && !BILIBILI_LYRICS_ENABLED) return;
    const bindingKey = canonicalTrackId(activeTrack);
    const hasBinding = Boolean(lyricBindings[bindingKey] || lyricBindings[activeTrack.id]);
    const hasLyrics = hasSyncedLyrics(activeTrack);
    if (!hasLyrics && activeTrack.lyricStatus === "missing" && !hasBinding) return;
    const needsTranslation = activeTrack.source === "netease" && !activeTrack.lyrics.some((line) => Boolean(line.translation));
    const canRefreshTiming =
      activeTrack.source === "netease" ||
      ((activeTrack.source === "local" || activeTrack.source === "youtube") && hasBinding);
    const needsTiming = canRefreshTiming && !activeTrack.lyrics.some((line) => line.timingVersion === 1);
    const needsEnrichment = needsTranslation || needsTiming;
    if (activeTrack.id === idleTrack.id || (hasLyrics && !needsEnrichment)) return;
    if (hasLyrics && needsEnrichment && lyricEnrichmentRefreshRef.current.has(activeTrack.id)) return;
    if (lyricSyncingRef.current.has(activeTrack.id)) return;

    if (needsEnrichment) {
      lyricEnrichmentRefreshRef.current.add(activeTrack.id);
      if (lyricEnrichmentRefreshRef.current.size > 240) {
        const oldestTrackId = lyricEnrichmentRefreshRef.current.values().next().value;
        if (oldestTrackId) lyricEnrichmentRefreshRef.current.delete(oldestTrackId);
      }
    }
    lyricSyncingRef.current.add(activeTrack.id);
    acquireLyricsForTrack(activeTrack)
      .then((outcome) => {
        if (outcome === "applied" || outcome === "empty") {
          lyricRetryCountRef.current.delete(activeTrack.id);
          return;
        }
        if (activeTrackRef.current.id === activeTrack.id) scheduleLyricRetry(activeTrack.id);
      })
      .catch(() => {
        // Keep the track searchable; the manual lyrics panel can retry.
        lyricEnrichmentRefreshRef.current.delete(activeTrack.id);
        if (activeTrackRef.current.id === activeTrack.id) scheduleLyricRetry(activeTrack.id);
      })
      .finally(() => {
        lyricSyncingRef.current.delete(activeTrack.id);
      });
  });

  useEffect(() => {
    syncActiveTrackLyrics();
  }, [syncActiveTrackLyrics, options.activeTrack.id, options.activeTrack.providerId, options.activeTrack.lyricStatus, options.activeTrack.lyrics, options.activeTrack.source, lyricBindings, lyricRetryTick]);

  return {
    lyricBindings,
    setLyricBindings,
    lyricSyncingRef,
    applyLyricsToTrack,
    syncLyricsForTrack,
  };
}
