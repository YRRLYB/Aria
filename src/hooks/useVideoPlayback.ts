import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { api } from "@/lib/api";
import { getPlaybackTime, subscribePlaybackTime } from "@/lib/playbackClock";

export type VideoControl = {
  element: HTMLVideoElement;
  seek: (seconds: number) => void;
  pause: () => void;
};

/**
 * Muted visual companion for Bilibili tracks.
 *
 * Audio playback stays 100% owned by `useAudioEngine` (mpv / WASAPI / WebAudio /
 * 10-band EQ / normalization), so opening or closing live video causes zero
 * audio interruption and zero loudness shift. This hook keeps a muted `<video>`
 * locked onto `playbackClock` via hard-seek for large jumps and gentle rate
 * nudges for sub-second drift.
 */
export function useVideoPlayback(options: {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef?: RefObject<HTMLAudioElement | null>;
  active: boolean;
  videoUrl?: string | null;
  audioUrl?: string | null;
  playing: boolean;
  volume: number;
  controlRef: RefObject<VideoControl | null>;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onError: (message: string) => void;
}) {
  const sourceRef = useRef<string | null>(null);
  const playingRef = useRef(options.playing);
  playingRef.current = options.playing;
  const onError = useEffectEvent(options.onError);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video || !options.active || !options.videoUrl) {
      if (video) {
        video.pause();
        video.playbackRate = 1;
      }
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
      return;
    }

    video.muted = true;
    video.defaultMuted = true;
    const src = api.resolveUrl(options.videoUrl);

    const alignToAudioClock = (forceJump = false) => {
      if (video.readyState < 1) return;
      const target = Math.max(0, getPlaybackTime());
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      const clampedTarget = duration !== null ? Math.min(target, Math.max(0, duration - 0.08)) : target;
      const drift = video.currentTime - clampedTarget;

      if (!Number.isFinite(drift) || forceJump || Math.abs(drift) > 0.45) {
        try {
          video.currentTime = clampedTarget;
          video.playbackRate = 1;
        } catch {
          // Stream metadata may still be settling; the next clock tick aligns it.
        }
        return;
      }

      if (playingRef.current && !video.paused && Math.abs(drift) > 0.09) {
        video.playbackRate = drift > 0 ? 0.96 : 1.04;
      } else if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    };

    if (sourceRef.current !== src) {
      sourceRef.current = src;
      video.src = src;
      video.load();
    }

    const handleLoaded = () => {
      alignToAudioClock(true);
      if (playingRef.current) {
        video.play().catch(() => undefined);
      }
    };
    const handlePlaying = () => alignToAudioClock(false);
    const handleError = () => {
      onError("视频画面加载失败，已收起视频（音频继续播放）。");
    };

    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("canplay", handlePlaying);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleError);

    const unsubscribeClock = subscribePlaybackTime(() => {
      alignToAudioClock(false);
    });
    const driftTimer = window.setInterval(() => {
      if (!video.paused && !video.seeking) alignToAudioClock(false);
    }, 500);

    options.controlRef.current = {
      element: video,
      seek: (seconds: number) => {
        if (!Number.isFinite(seconds)) return;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seconds;
        try {
          video.currentTime = Math.max(0, Math.min(seconds, duration));
          video.playbackRate = 1;
        } catch {
          // Will catch up on loadedmetadata / clock subscription.
        }
      },
      pause: () => {
        video.pause();
        video.playbackRate = 1;
      },
    };

    return () => {
      unsubscribeClock();
      window.clearInterval(driftTimer);
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("canplay", handlePlaying);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("error", handleError);
      video.pause();
      video.playbackRate = 1;
      video.removeAttribute("src");
      video.load();
      sourceRef.current = null;
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
    };
  }, [options.active, options.videoUrl, options.videoRef, options.controlRef]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video || !options.active || !options.videoUrl) return;
    video.muted = true;
    if (options.playing) {
      if (video.readyState >= 1) {
        const target = Math.max(0, getPlaybackTime());
        if (Math.abs(video.currentTime - target) > 0.45) {
          try {
            video.currentTime = target;
          } catch {
            // Ignored until metadata arrives.
          }
        }
      }
      video.play().catch(() => undefined);
    } else {
      video.pause();
      video.playbackRate = 1;
    }
  }, [options.active, options.playing, options.videoUrl, options.videoRef]);
}
