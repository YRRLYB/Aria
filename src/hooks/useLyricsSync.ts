import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import { hasSyncedLyrics, writeCachedLyrics } from "@/lib/playerPresentation";
import { idleTrack } from "@/lib/trackMappers";
import { selectAutomaticMetadataCandidate } from "@/lib/localMetadata";

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
  const lyricSyncingRef = useRef<Set<string>>(new Set());
  const lyricEnrichmentRefreshRef = useRef<Set<string>>(new Set());
  // 首曲恢复/冷启动时后端可能还没就绪，歌词请求会失败一次。以前失败后
  // 没有重试，用户看到的就是“第一首歌没歌词”。这里对同一首歌最多重试 3 次。
  const lyricRetryCountRef = useRef<Map<string, number>>(new Map());
  const lyricRetryTimerRef = useRef<number | null>(null);
  const [lyricRetryTick, setLyricRetryTick] = useState(0);

  function applyLyricsToTrack(trackId: string, lyrics: Track["lyrics"], candidateId?: string) {
    if (!lyrics.length) return;
    if (candidateId) {
      lyricBindingsRef.current = { ...lyricBindingsRef.current, [trackId]: candidateId };
      setLyricBindings((current) => ({ ...current, [trackId]: candidateId }));
    }
    writeCachedLyrics(trackId, lyrics);
    applyTrackUpdate(trackId, (track) => (track.id === trackId ? { ...track, lyrics, lyricStatus: "linked" as const } : track), {
      includeHistory: true,
    });
  }

  async function syncLyricsForTrack(track: Track): Promise<boolean> {
    const providerId = track.providerId ?? (track.id.startsWith(`${track.source}:`) ? track.id.slice(track.source.length + 1) : undefined);
    if (track.source === "qq" && providerId) {
      const result = await api.getSourceLyrics("qq", providerId);
      if (!result.lyrics.length) return false;
      applyLyricsToTrack(track.id, result.lyrics);
      return true;
    }
    if (track.source === "bilibili" && providerId) {
      const result = await api.getSourceLyrics("bilibili", providerId);
      if (!result.lyrics.length) return false;
      applyLyricsToTrack(track.id, result.lyrics);
      return true;
    }
    if (track.source === "netease" && providerId) {
      const result = await api.getNeteaseLyrics(providerId);
      if (!result.lyrics.length) return false;
      applyLyricsToTrack(track.id, result.lyrics);
      return true;
    }

    if (track.source === "local") {
      const binding = lyricBindingsRef.current[track.id];
      if (binding) {
        const result = await api.bindLyric(track.id, binding, binding);
        if (!result.accepted || lyricBindingsRef.current[track.id] !== binding) return false;
        if (!result.lyrics.length) return false;
        applyLyricsToTrack(track.id, result.lyrics);
        return true;
      }
      const candidates = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      const best = selectAutomaticMetadataCandidate(track, candidates.candidates);
      if (!best || lyricBindingsRef.current[track.id] !== binding) return false;
      const result = await api.bindLyric(track.id, best.id, binding ?? null);
      if (!result.accepted || lyricBindingsRef.current[track.id] !== binding) return false;
      if (!result.lyrics.length) return false;
      applyLyricsToTrack(track.id, result.lyrics, best.id);
      return true;
    }
    return false;
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
      if (options.activeTrack.id !== trackId || hasSyncedLyrics(options.activeTrack)) return;
      lyricRetryCountRef.current.set(trackId, attempt + 1);
      setLyricRetryTick((value) => value + 1);
    }, delay);
  }

  useEffect(() => () => {
    if (lyricRetryTimerRef.current !== null) window.clearTimeout(lyricRetryTimerRef.current);
    lyricRetryTimerRef.current = null;
  }, []);

  const syncActiveTrackLyrics = useEffectEvent(() => {
    const activeTrack = options.activeTrack;
    const hasLyrics = hasSyncedLyrics(activeTrack);
    const needsTranslation = activeTrack.source === "netease" && !activeTrack.lyrics.some((line) => Boolean(line.translation));
    const canRefreshTiming = activeTrack.source === "netease" || (activeTrack.source === "local" && Boolean(lyricBindings[activeTrack.id]));
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
    syncLyricsForTrack(activeTrack)
      .then((applied) => {
        if (applied) {
          lyricRetryCountRef.current.delete(activeTrack.id);
          return;
        }
        if (options.activeTrack.id === activeTrack.id) scheduleLyricRetry(activeTrack.id);
      })
      .catch(() => {
        // Keep the track searchable; the manual lyrics panel can retry.
        lyricEnrichmentRefreshRef.current.delete(activeTrack.id);
        if (options.activeTrack.id === activeTrack.id) scheduleLyricRetry(activeTrack.id);
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
