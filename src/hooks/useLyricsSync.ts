import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import { writeCachedLyrics } from "@/lib/playerPresentation";
import { idleTrack } from "@/lib/trackMappers";

// Owns lyric acquisition: binding-driven rebinds for local tracks, automatic
// sync (and bilingual translation refresh) for the active track.
export function useLyricsSync(options: {
  applyTrackUpdate: (trackId: string, updateTrack: (track: Track) => Track, updateOptions?: { includeHistory?: boolean }) => void;
  activeTrack: Track;
  localTracks: Track[];
}) {
  const { applyTrackUpdate } = options;
  const [lyricBindings, setLyricBindings] = useState<Record<string, string>>({});
  const lyricSyncingRef = useRef<Set<string>>(new Set());
  const lyricTranslationRefreshRef = useRef<Set<string>>(new Set());

  function applyLyricsToTrack(trackId: string, lyrics: Track["lyrics"]) {
    if (!lyrics.length) return;
    writeCachedLyrics(trackId, lyrics);
    applyTrackUpdate(trackId, (track) => (track.id === trackId ? { ...track, lyrics, lyricStatus: "linked" as const } : track), {
      includeHistory: true,
    });
  }

  async function syncLyricsForTrack(track: Track) {
    if (track.source === "netease" && track.providerId) {
      const result = await api.getNeteaseLyrics(track.providerId);
      applyLyricsToTrack(track.id, result.lyrics);
      return;
    }

    if (track.source === "local") {
      const candidates = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      const best = candidates.candidates[0];
      if (!best) return;
      const result = await api.bindLyric(track.id, best.id);
      applyLyricsToTrack(track.id, result.lyrics);
    }
  }

  useEffect(() => {
    const boundTracks = options.localTracks
      .filter((track) => lyricBindings[track.id] && track.lyricStatus !== "linked" && !lyricSyncingRef.current.has(track.id))
      .slice(0, 8);
    if (!boundTracks.length) return;

    boundTracks.forEach((track) => {
      lyricSyncingRef.current.add(track.id);
      api
        .bindLyric(track.id, lyricBindings[track.id])
        .then((result) => {
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
    const needsTranslation = activeTrack.source === "netease" && !activeTrack.lyrics.some((line) => Boolean(line.translation));
    if (activeTrack.id === idleTrack.id || (activeTrack.lyricStatus === "linked" && !needsTranslation)) return;
    if (needsTranslation && lyricTranslationRefreshRef.current.has(activeTrack.id)) return;
    if (lyricSyncingRef.current.has(activeTrack.id)) return;

    if (needsTranslation) {
      lyricTranslationRefreshRef.current.add(activeTrack.id);
      if (lyricTranslationRefreshRef.current.size > 240) {
        const oldestTrackId = lyricTranslationRefreshRef.current.values().next().value;
        if (oldestTrackId) lyricTranslationRefreshRef.current.delete(oldestTrackId);
      }
    }
    lyricSyncingRef.current.add(activeTrack.id);
    syncLyricsForTrack(activeTrack)
      .catch(() => {
        // Keep the track searchable; the manual lyrics panel can retry.
      })
      .finally(() => {
        lyricSyncingRef.current.delete(activeTrack.id);
      });
  });

  useEffect(() => {
    syncActiveTrackLyrics();
  }, [syncActiveTrackLyrics, options.activeTrack.id, options.activeTrack.lyricStatus, options.activeTrack.lyrics, options.activeTrack.source]);

  return {
    lyricBindings,
    setLyricBindings,
    lyricSyncingRef,
    applyLyricsToTrack,
    syncLyricsForTrack,
  };
}
