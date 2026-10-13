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

  async function syncLyricsForTrack(track: Track) {
    const providerId = track.providerId ?? (track.id.startsWith("netease:") ? track.id.slice("netease:".length) : undefined);
    if (track.source === "netease" && providerId) {
      const result = await api.getNeteaseLyrics(providerId);
      applyLyricsToTrack(track.id, result.lyrics);
      return;
    }

    if (track.source === "local") {
      const binding = lyricBindingsRef.current[track.id];
      if (binding) {
        const result = await api.bindLyric(track.id, binding, binding);
        if (!result.accepted || lyricBindingsRef.current[track.id] !== binding) return;
        applyLyricsToTrack(track.id, result.lyrics);
        return;
      }
      const candidates = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      const best = selectAutomaticMetadataCandidate(track, candidates.candidates);
      if (!best || lyricBindingsRef.current[track.id] !== binding) return;
      const result = await api.bindLyric(track.id, best.id, binding ?? null);
      if (!result.accepted || lyricBindingsRef.current[track.id] !== binding) return;
      applyLyricsToTrack(track.id, result.lyrics, best.id);
    }
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
      .catch(() => {
        // Keep the track searchable; the manual lyrics panel can retry.
        lyricEnrichmentRefreshRef.current.delete(activeTrack.id);
      })
      .finally(() => {
        lyricSyncingRef.current.delete(activeTrack.id);
      });
  });

  useEffect(() => {
    syncActiveTrackLyrics();
  }, [syncActiveTrackLyrics, options.activeTrack.id, options.activeTrack.providerId, options.activeTrack.lyricStatus, options.activeTrack.lyrics, options.activeTrack.source, lyricBindings]);

  return {
    lyricBindings,
    setLyricBindings,
    lyricSyncingRef,
    applyLyricsToTrack,
    syncLyricsForTrack,
  };
}
