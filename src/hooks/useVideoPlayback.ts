import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { api } from "@/lib/api";
import { commitPlaybackTime, getPlaybackTime } from "@/lib/playbackClock";

export type VideoControl = {
  element: HTMLVideoElement;
  seek: (seconds: number) => void;
  pause: () => void;
};

/**
 * Small, self-contained video playback lane used by Bilibili tracks. Audio
 * playback remains owned by useAudioEngine; when video mode is active that
 * engine is paused and this element is the audible source (video mode uses the
 * system mixer rather than mpv/EQ).
 *
 * High-quality Bilibili video is delivered as DASH: a video-only stream plus a
 * separate audio stream (AAC / Dolby / FLAC). Both elements are kept in sync
 * here; muxed MP4 videos simply leave `audioUrl` empty.
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
  onDuration: (seconds: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}) {
  const sourceRef = useRef<string | null>(null);
  const audioSourceRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const onDuration = useEffectEvent(options.onDuration);
  const onEnded = useEffectEvent(options.onEnded);
  const onError = useEffectEvent(options.onError);

  useEffect(() => {
    const video = options.videoRef.current;
    const audio = options.audioRef?.current ?? null;
    if (!video || !options.active || !options.videoUrl) {
      video?.pause();
      audio?.pause();
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
      return;
    }

    const src = api.resolveUrl(options.videoUrl);
    const audioSrc = options.audioUrl ? api.resolveUrl(options.audioUrl) : null;

    const syncAudioToVideo = (force = false) => {
      if (!audio || !Number.isFinite(video.currentTime)) return;
      const target = Math.max(0, video.currentTime);
      if (force || Math.abs(audio.currentTime - target) > 0.2) {
        try {
          audio.currentTime = target;
        } catch {
          // The audio element may still be loading; its loadedmetadata handler
          // will align it again.
        }
      }
    };

    if (sourceRef.current !== src) {
      sourceRef.current = src;
      pendingSeekRef.current = getPlaybackTime();
      video.src = src;
      video.load();
    }

    if (audio) {
      if (audioSrc) {
        if (audioSourceRef.current !== audioSrc) {
          audioSourceRef.current = audioSrc;
          audio.src = audioSrc;
          audio.load();
        }
      } else if (audioSourceRef.current) {
        audioSourceRef.current = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    }

    const applyPendingSeek = (element: HTMLMediaElement) => {
      const target = pendingSeekRef.current;
      if (target == null || target <= 1) return;
      const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : target;
      try {
        element.currentTime = Math.min(target, Math.max(0, duration - 0.1));
      } catch {
        // Metadata can race with a source change; timeupdate will catch up.
      }
    };

    const handleLoaded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) onDuration(video.duration);
      applyPendingSeek(video);
      pendingSeekRef.current = null;
      if (audio && audioSrc) {
        const target = Number.isFinite(video.currentTime) ? video.currentTime : getPlaybackTime();
        if (Math.abs(audio.currentTime - target) > 0.15) {
          try {
            audio.currentTime = Math.max(0, target);
          } catch {
            // Audio metadata may arrive a moment later; handled below.
          }
        }
      }
    };
    const handleTime = () => {
      if (!video.seeking) commitPlaybackTime(video.currentTime);
      // timeupdate fires a few times per second; correct drift before it
      // becomes audible as an echo between the two streams.
      if (audio && audioSrc && !video.paused && !video.seeking) syncAudioToVideo();
    };
    const handleSeeking = () => syncAudioToVideo(true);
    const handlePlaying = () => syncAudioToVideo(true);
    const handleEnded = () => onEnded();
    const handleError = () => {
      onError("视频加载失败，已切回封面播放。");
    };
    const handleAudioLoaded = () => syncAudioToVideo(true);

    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("durationchange", handleLoaded);
    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    audio?.addEventListener("loadedmetadata", handleAudioLoaded);
    options.controlRef.current = {
      element: video,
      seek: (seconds: number) => {
        if (!Number.isFinite(seconds)) return;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seconds;
        const next = Math.max(0, Math.min(seconds, duration));
        video.currentTime = next;
        if (audio) {
          try {
            audio.currentTime = next;
          } catch {
            // Audio will align on its next loadedmetadata/timeupdate.
          }
        }
        commitPlaybackTime(seconds, true);
      },
      pause: () => {
        video.pause();
        audio?.pause();
      },
    };

    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("durationchange", handleLoaded);
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      audio?.removeEventListener("loadedmetadata", handleAudioLoaded);
      // Preserve the outgoing video's position before another video element
      // (normal player vs immersive) takes over.
      commitPlaybackTime(video.currentTime, true);
      audio?.pause();
      if (options.controlRef.current?.element === video) options.controlRef.current = null;
    };
  }, [options.active, options.videoUrl, options.audioUrl, options.videoRef, options.audioRef, options.controlRef]);

  useEffect(() => {
    const video = options.videoRef.current;
    const audio = options.audioRef?.current ?? null;
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
      if (audio && options.audioUrl) {
        const drift = audio.currentTime - video.currentTime;
        if (!Number.isFinite(drift) || Math.abs(drift) > 0.3) {
          try {
            audio.currentTime = Math.max(0, video.currentTime);
          } catch {
            // The audio element may not have metadata yet.
          }
        }
        audio.play().catch(() => {
          // Autoplay policies can reject the separate DASH audio element. Keep
          // the video playing and retry on the first user gesture below.
          const resume = () => {
            if (!video.paused) audio.play().catch(() => undefined);
            window.removeEventListener("pointerdown", resume);
          };
          window.addEventListener("pointerdown", resume, { once: true });
        });
      }
      video.play().catch(() => {
        // Autoplay policies can reject a programmatic resume; the play button
        // remains available and the error is non-fatal.
      });
    } else {
      video.pause();
      audio?.pause();
    }
  }, [options.active, options.playing, options.videoUrl, options.audioUrl, options.videoRef, options.audioRef]);

  useEffect(() => {
    if (!options.active || !options.audioUrl) return;
    const video = options.videoRef.current;
    const audio = options.audioRef?.current ?? null;
    if (!video || !audio) return;
    const timer = window.setInterval(() => {
      if (video.paused || video.seeking || audio.paused) return;
      const drift = audio.currentTime - video.currentTime;
      if (Number.isFinite(drift) && Math.abs(drift) > 0.2) {
        try {
          audio.currentTime = Math.max(0, video.currentTime);
        } catch {
          // Ignore a transient seek failure; the next tick retries.
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [options.active, options.audioUrl, options.videoRef, options.audioRef]);

  useEffect(() => {
    const video = options.videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, options.volume / 100));
    const audio = options.audioRef?.current ?? null;
    if (audio) audio.volume = Math.max(0, Math.min(1, options.volume / 100));
  }, [options.volume, options.videoRef, options.audioRef]);
}
