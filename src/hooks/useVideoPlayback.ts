import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { api } from "@/lib/api";
import { commitPlaybackTime, getPlaybackTime } from "@/lib/playbackClock";

export type VideoControl = {
  element: HTMLVideoElement;
  seek: (seconds: number) => void;
};

/**
 * Small, self-contained video playback lane used by Bilibili tracks. Audio
 * playback remains owned by useAudioEngine; when video mode is active that
 * engine is paused and this element is the audible source (video mode uses the
 * system mixer rather than mpv/EQ).
 */
export function useVideoPlayback(options: {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  videoUrl?: string | null;
  playing: boolean;
  volume: number;
  controlRef: RefObject<VideoControl | null>;
  onDuration: (seconds: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}) {
  const sourceRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const onDuration = useEffectEvent(options.onDuration);
  const onEnded = useEffectEvent(options.onEnded);
  const onError = useEffectEvent(options.onError);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video || !options.active || !options.videoUrl) {
      if (video) video.pause();
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
      return;
    }

    const src = api.resolveUrl(options.videoUrl);
    if (sourceRef.current !== src) {
      sourceRef.current = src;
      pendingSeekRef.current = getPlaybackTime();
      video.src = src;
      video.load();
    }

    const handleLoaded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) onDuration(video.duration);
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (target != null && target > 1 && Math.abs(video.currentTime - target) > 1) {
        try {
          video.currentTime = Math.min(target, Math.max(0, video.duration - 0.1));
        } catch {
          // Metadata can race with a source change; timeupdate will catch up.
        }
      }
    };
    const handleTime = () => {
      if (!video.seeking) commitPlaybackTime(video.currentTime);
    };
    const handleEnded = () => onEnded();
    const handleError = () => {
      onError("视频加载失败，已切回封面播放。");
    };
    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("durationchange", handleLoaded);
    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    options.controlRef.current = {
      element: video,
      seek: (seconds: number) => {
        if (!Number.isFinite(seconds)) return;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seconds;
        video.currentTime = Math.max(0, Math.min(seconds, duration));
        commitPlaybackTime(seconds, true);
      },
    };

    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("durationchange", handleLoaded);
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      // Preserve the outgoing video's position before another video element
      // (normal player vs immersive) takes over.
      commitPlaybackTime(video.currentTime, true);
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
    };
  }, [options.active, options.videoUrl, options.videoRef, options.controlRef]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video || !options.active || !options.videoUrl) return;
    const target = getPlaybackTime();
    if (target > 1 && Math.abs(video.currentTime - target) > 1) {
      try {
        video.currentTime = Math.min(target, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : target);
      } catch {
        // The source may still be loading; loadedmetadata will apply the cue.
      }
    }
    if (options.playing) {
      video.play().catch(() => {
        // Autoplay policies can reject a programmatic resume; the play button
        // remains available and the error is non-fatal.
      });
    } else {
      video.pause();
    }
  }, [options.active, options.playing, options.videoUrl, options.videoRef]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, options.volume / 100));
  }, [options.volume, options.videoRef]);
}
