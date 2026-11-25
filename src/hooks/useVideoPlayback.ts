import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { api } from "@/lib/api";
import { commitPlaybackTime, getPlaybackTime, subscribePlaybackTime } from "@/lib/playbackClock";

export type VideoControl = {
  element: HTMLVideoElement | null;
  seek: (seconds: number) => void;
  pause: () => void;
  play?: () => void;
};

function perceptualVideoVolume(volume: number): number {
  return Math.max(0, Math.min(1, volume / 100)) ** 2;
}

/**
 * Video playback coordinator:
 * - For Bilibili / YouTube (`standaloneAudio = false`), runs as a muted visual
 *   companion synchronized to `playbackClock` while `useAudioEngine` owns audio.
 * - For NetEase / QQ official MVs (`standaloneAudio = true`), plays the muxed
 *   MP4 audio directly at perceptual volume and drives `playbackClock` itself.
 */
export function useVideoPlayback(options: {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef?: RefObject<HTMLAudioElement | null>;
  active: boolean;
  videoUrl?: string | null;
  audioUrl?: string | null;
  standaloneAudio?: boolean;
  playing: boolean;
  volume: number;
  controlRef: RefObject<VideoControl | null>;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onError: (message: string) => void;
}) {
  const standaloneAudio = Boolean(options.standaloneAudio);
  const sourceRef = useRef<string | null>(null);
  const playingRef = useRef(options.playing);
  playingRef.current = options.playing;
  const volumeRef = useRef(options.volume);
  volumeRef.current = options.volume;
  const onDuration = useEffectEvent((seconds: number) => options.onDuration?.(seconds));
  const onEnded = useEffectEvent(() => options.onEnded?.());
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

    if (standaloneAudio) {
      video.muted = false;
      video.defaultMuted = false;
      video.volume = perceptualVideoVolume(volumeRef.current);
    } else {
      video.muted = true;
      video.defaultMuted = true;
    }
    const src = api.resolveUrl(options.videoUrl);

    const alignToAudioClock = (forceJump = false) => {
      if (standaloneAudio || video.readyState < 1) return;
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
      if (standaloneAudio) {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        if (duration !== null) onDuration(duration);
        const resumeTarget = Math.max(0, getPlaybackTime());
        if (resumeTarget > 0) {
          const clamped = duration !== null ? Math.min(resumeTarget, Math.max(0, duration - 0.15)) : resumeTarget;
          try {
            video.currentTime = clamped;
            commitPlaybackTime(clamped, true);
          } catch {
            // Seek will apply once ready.
          }
        }
        video.volume = perceptualVideoVolume(volumeRef.current);
        if (playingRef.current) {
          video.play().catch(() => undefined);
        }
        return;
      }
      alignToAudioClock(true);
      if (playingRef.current) {
        video.play().catch(() => undefined);
      }
    };
    const handlePlaying = () => {
      if (!standaloneAudio) alignToAudioClock(false);
    };
    const handleTimeUpdate = () => {
      if (!standaloneAudio) return;
      if (Number.isFinite(video.currentTime)) {
        commitPlaybackTime(video.currentTime);
      }
    };
    const handleEnded = () => {
      if (standaloneAudio) onEnded();
    };
    const handleError = () => {
      onError(standaloneAudio ? "MV 视频加载失败，已切回音频播放。" : "视频画面加载失败，已收起视频（音频继续播放）。");
    };

    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("canplay", handlePlaying);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    const unsubscribeClock = standaloneAudio
      ? () => undefined
      : subscribePlaybackTime(() => {
          alignToAudioClock(false);
        });
    const driftTimer = standaloneAudio
      ? null
      : window.setInterval(() => {
          if (!video.paused && !video.seeking) alignToAudioClock(false);
        }, 500);

    options.controlRef.current = {
      element: video,
      seek: (seconds: number) => {
        if (!Number.isFinite(seconds)) return;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seconds;
        const clamped = Math.max(0, Math.min(seconds, duration));
        try {
          video.currentTime = clamped;
          video.playbackRate = 1;
          if (standaloneAudio) commitPlaybackTime(clamped, true);
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
      if (driftTimer !== null) window.clearInterval(driftTimer);
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("canplay", handlePlaying);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.pause();
      video.playbackRate = 1;
      video.removeAttribute("src");
      video.load();
      sourceRef.current = null;
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
    };
  }, [options.active, options.videoUrl, options.videoRef, options.controlRef, standaloneAudio]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video || !options.active || !options.videoUrl) return;
    if (standaloneAudio) {
      video.muted = false;
      video.volume = perceptualVideoVolume(options.volume);
    } else {
      video.muted = true;
    }
    if (options.playing) {
      if (!standaloneAudio && video.readyState >= 1) {
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
  }, [options.active, options.playing, options.videoUrl, options.videoRef, standaloneAudio]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video || !standaloneAudio || !options.active) return;
    video.muted = false;
    video.volume = perceptualVideoVolume(options.volume);
  }, [options.active, options.volume, options.videoRef, standaloneAudio]);
}
