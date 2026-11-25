import { createElement, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { Track } from "@/data/music";
import type { VideoControl } from "@/hooks/useVideoPlayback";
import { getPlaybackTime } from "@/lib/playbackClock";
import { cn } from "@/lib/utils";
import {
  computeYoutubeSyncDecision,
  mapYoutubeQualityOptions,
  youtubeCodeForQualityId,
} from "@/lib/youtubeVideoOffset";

const YOUTUBE_STAGE_PARTITION = "aria-youtube-stage";
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const STAGE_LOAD_TIMEOUT_MS = 22_000;

const STAGE_HIDE_CHROME_CSS = `
html, body, ytd-app, #content, #page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner {
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: #000 !important;
}
ytd-masthead,
#secondary,
#below,
#comments,
#related,
tp-yt-app-drawer,
ytd-popup-container,
ytd-consent-bump-v2-lightbox,
ytd-enforcement-message-view-model,
tp-yt-paper-dialog,
ytd-watch-metadata,
#chat-container,
ytd-merch-shelf-renderer,
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
.ytp-chrome-top,
.ytp-chrome-bottom,
.ytp-gradient-top,
.ytp-gradient-bottom,
.ytp-watermark,
.ytp-ce-element,
.ytp-pause-overlay,
.ytp-paid-content-overlay,
.ytp-suggested-action,
.ytp-spinner,
.ytp-bezel,
.ytp-bezel-text-wrapper,
.ytp-doubletap-ui,
.ytp-doubletap-ui-legacy,
.ytp-cued-thumbnail-overlay,
.ytp-cued-thumbnail-overlay-image,
.ytp-large-play-button,
.ytp-ad-module,
.ytp-ad-overlay-container,
.ytp-ad-player-overlay,
.ytp-ad-player-overlay-layout,
.ytp-ad-skip-button-container,
.video-ads,
.iv-branding,
.annotation,
.ytp-cards-teaser,
.ytp-cards-button,
.ytp-title,
.ytp-title-channel,
.ytp-show-tiles,
.ytp-endscreen-content,
.ytp-autonav-endscreen-countdown-overlay,
.ytp-caption-window-container {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
ytd-player,
#ytd-player,
#player-container,
#player-container-inner,
#player-container-outer,
#full-bleed-container,
#player-full-bleed-container,
#movie_player {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #000 !important;
  visibility: visible !important;
  opacity: 1 !important;
}
#movie_player {
  z-index: 2147483647 !important;
}
#movie_player .html5-video-container {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #000 !important;
}
#movie_player video.html5-main-video {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  left: 0 !important;
  top: 0 !important;
  transform: none !important;
  object-fit: contain !important;
  visibility: visible !important;
  opacity: 1 !important;
}
`;

const STAGE_HELPER_SCRIPT = `
(() => {
  if (window.__ariaYtStage?.v === 3) return true;
  const pickVideo = () => document.querySelector("#movie_player video.html5-main-video") || document.querySelector("video.html5-main-video") || document.querySelector("video");
  const pickPlayer = () => document.getElementById("movie_player");
  const isAdPlaying = (player) => Boolean(
    player?.classList?.contains("ad-showing") ||
    player?.classList?.contains("ad-interrupting") ||
    document.querySelector(".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout")
  );
  const skipAd = (player, video) => {
    try {
      document.querySelectorAll(".ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern").forEach((btn) => btn.click?.());
    } catch {}
    if (video) {
      try {
        video.muted = true;
        video.volume = 0;
        if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
          video.currentTime = video.duration;
        }
      } catch {}
    }
    try { player?.mute?.(); } catch {}
  };
  window.__ariaYtStage = {
    v: 3,
    configure(initialSeek, ytCode, playing) {
      const player = pickPlayer();
      const video = pickVideo();
      if (!video || !player) return false;
      try { player.setAutonavState?.(1); } catch {}
      if (isAdPlaying(player)) {
        skipAd(player, video);
        return false;
      }
      this.applyQuality(ytCode);
      this.setAudio(true);
      if (Number.isFinite(initialSeek) && initialSeek > 0.2 && video.readyState >= 1) {
        try { video.currentTime = initialSeek; } catch {}
      }
      this.setPlaying(playing);
      return true;
    },
    applyQuality(ytCode) {
      const player = pickPlayer();
      if (!player) return;
      try {
        const levels = typeof player.getAvailableQualityLevels === "function" ? player.getAvailableQualityLevels() : [];
        const preferred = ytCode || levels.find((l) => ["highres", "hd2160", "hd1440", "hd1080", "hd720"].includes(l)) || levels[0] || null;
        if (preferred && typeof player.setPlaybackQualityRange === "function") {
          player.setPlaybackQualityRange(preferred, preferred);
        }
        if (preferred && typeof player.setPlaybackQuality === "function") {
          player.setPlaybackQuality(preferred);
        }
      } catch {}
    },
    setAudio(muted) {
      const player = pickPlayer();
      const video = pickVideo();
      const shouldMute = muted !== false;
      if (player) {
        try {
          if (shouldMute) player.mute?.();
        } catch {}
      }
      if (video) {
        video.muted = shouldMute;
        video.volume = 0;
      }
    },
    setPlaying(playing) {
      const player = pickPlayer();
      const video = pickVideo();
      if (!video) return;
      if (isAdPlaying(player)) {
        skipAd(player, video);
        return;
      }
      if (playing) {
        if (video.paused && !video.ended) {
          Promise.resolve(video.play?.()).catch(() => { try { player?.playVideo?.(); } catch {} });
        }
      } else {
        try { video.pause?.(); } catch {}
        try { player?.pauseVideo?.(); } catch {}
      }
    },
    seek(seconds, shouldPlay) {
      const player = pickPlayer();
      const video = pickVideo();
      if (!video || !Number.isFinite(seconds)) return;
      try {
        video.currentTime = Math.max(0, seconds);
        video.playbackRate = 1;
      } catch {}
      if (shouldPlay === false) {
        try { video.pause?.(); } catch {}
        try { player?.pauseVideo?.(); } catch {}
      }
    },
    sync(decision, shouldPlay) {
      const video = pickVideo();
      if (!video || video.readyState < 1 || !decision) return;
      if (shouldPlay === false) {
        this.setPlaying(false);
        return;
      }
      if (decision.action === "seek" && Number.isFinite(decision.target)) {
        try {
          video.currentTime = Math.max(0, decision.target);
          video.playbackRate = 1;
        } catch {}
      } else if (decision.action === "rate" && Number.isFinite(decision.playbackRate)) {
        if (video.playbackRate !== decision.playbackRate) {
          video.playbackRate = decision.playbackRate;
        }
      } else if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    },
    readState() {
      const player = pickPlayer();
      const video = pickVideo();
      if (!video) return null;
      const isAd = isAdPlaying(player);
      if (isAd) {
        skipAd(player, video);
      }
      let currentQuality = "";
      let availableLevels = [];
      try {
        currentQuality = typeof player?.getPlaybackQuality === "function" ? String(player.getPlaybackQuality() || "") : "";
        availableLevels = typeof player?.getAvailableQualityLevels === "function" ? player.getAvailableQualityLevels() : [];
      } catch {}
      return {
        currentTime: Number(video.currentTime) || 0,
        duration: Number(video.duration) || 0,
        paused: Boolean(video.paused),
        ended: Boolean(video.ended),
        readyState: Number(video.readyState) || 0,
        videoWidth: Number(video.videoWidth) || 0,
        videoHeight: Number(video.videoHeight) || 0,
        isAd,
        currentQuality,
        availableLevels: Array.isArray(availableLevels) ? availableLevels : [],
      };
    },
  };
  return true;
})();
`;

type WebviewGuestElement = HTMLElement & {
  src?: string;
  insertCSS?: (css: string) => Promise<string>;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  setAudioMuted?: (muted: boolean) => void;
};

type PolledStageState = {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  isAd: boolean;
  currentQuality: string;
  availableLevels: string[];
};

const QUALITY_LABELS: Record<string, string> = {
  highres: "8K",
  hd2160: "4K",
  hd1440: "2K",
  hd1080: "1080P",
  hd720: "720P",
  large: "480P",
  medium: "360P",
};

export function YoutubeWebviewStage({
  track,
  active,
  playing,
  qualityId,
  offsetSeconds,
  controlRef,
  onQualities,
  onFallback,
  className,
}: {
  track: Track;
  active: boolean;
  playing: boolean;
  qualityId: number | null;
  offsetSeconds: number;
  controlRef: RefObject<VideoControl | null>;
  onQualities?: (qualities: Array<{ id: number; label: string }>, activeLabel: string | null) => void;
  onFallback: (reason: string) => void;
  className?: string;
}) {
  const webviewRef = useRef<WebviewGuestElement | null>(null);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [domReady, setDomReady] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [adActive, setAdActive] = useState(false);

  const configuredRef = useRef(false);
  const configuringRef = useRef(false);
  const initialSeekAppliedRef = useRef(false);
  const lastQualitySignatureRef = useRef("");
  const prevActiveRef = useRef(active);

  const activeRef = useRef(active);
  activeRef.current = active;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const qualityIdRef = useRef(qualityId);
  qualityIdRef.current = qualityId;
  const offsetRef = useRef(offsetSeconds);
  offsetRef.current = offsetSeconds;

  const fireQualities = useEffectEvent(
    (qualities: Array<{ id: number; label: string }>, activeLabel: string | null) =>
      onQualities?.(qualities, activeLabel),
  );
  const fireFallback = useEffectEvent((reason: string) => onFallback(reason));

  const providerId = track.providerId && YOUTUBE_VIDEO_ID_RE.test(track.providerId) ? track.providerId : null;
  const targetWatchUrl = providerId ? `https://www.youtube.com/watch?v=${providerId}&hl=zh-CN` : null;

  // Effect A1: Only reset guest state when the target video URL actually changes.
  useEffect(() => {
    setDomReady(false);
    setHasFrame(false);
    setAdActive(false);
    setPreparedUrl(null);
    configuredRef.current = false;
    configuringRef.current = false;
    initialSeekAppliedRef.current = false;
    lastQualitySignatureRef.current = "";
  }, [targetWatchUrl]);

  // Effect A2: Prepare the guest URL lazily when active, without clearing it on view switch.
  useEffect(() => {
    if (!active || !targetWatchUrl || preparedUrl === targetWatchUrl) return;
    const stageApi = window.ariaDesktop?.youtubeStage;
    if (!stageApi?.prepare) {
      fireFallback("当前环境不支持 YouTube 高清舞台，已回退普通视频流。");
      return;
    }

    let cancelled = false;
    stageApi
      .prepare()
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          fireFallback(res?.message || "YouTube 高清舞台初始化失败，已回退普通视频流。");
          return;
        }
        setPreparedUrl(targetWatchUrl);
      })
      .catch(() => {
        if (!cancelled) {
          fireFallback("YouTube 高清舞台代理未就绪，已回退普通视频流。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, targetWatchUrl, preparedUrl]);

  useEffect(() => {
    if (!active || hasFrame || !preparedUrl) return;
    const timer = window.setTimeout(() => {
      fireFallback("YouTube 高清舞台加载超时，已自动回退普通视频流。");
    }, STAGE_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [active, hasFrame, preparedUrl]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view || !preparedUrl) return;

    const myControl: VideoControl = {
      element: null,
      seek: (seconds: number) => {
        if (!Number.isFinite(seconds)) return;
        const target = Math.max(0, seconds + offsetRef.current);
        void view.executeJavaScript?.(`window.__ariaYtStage?.seek(${JSON.stringify(target)}, ${JSON.stringify(playingRef.current && activeRef.current)});`, true).catch(() => {});
      },
      pause: () => {
        void view.executeJavaScript?.(`window.__ariaYtStage?.setPlaying(false);`, true).catch(() => {});
      },
      play: () => {
        void view.executeJavaScript?.(`window.__ariaYtStage?.setPlaying(${JSON.stringify(activeRef.current)});`, true).catch(() => {});
      },
    };
    controlRef.current = myControl;

    const ensureInjectedAndConfigured = () => {
      if (configuringRef.current) return;
      configuringRef.current = true;
      try {
        view.setAudioMuted?.(true);
      } catch {
        // Guest may still be warming up.
      }
      void view.insertCSS?.(STAGE_HIDE_CHROME_CSS).catch(() => {});
      const initialSeek = Math.max(0, getPlaybackTime() + offsetRef.current);
      const ytCode = youtubeCodeForQualityId(qualityIdRef.current);
      const shouldPlay = Boolean(playingRef.current && activeRef.current);
      const cmd = `${STAGE_HELPER_SCRIPT}\nwindow.__ariaYtStage?.configure(${JSON.stringify(initialSeek)}, ${JSON.stringify(ytCode)}, ${JSON.stringify(shouldPlay)});`;
      void view
        .executeJavaScript?.(cmd, true)
        .then((ready) => {
          if (ready) {
            configuredRef.current = true;
            if (initialSeek > 0.2) initialSeekAppliedRef.current = true;
          }
        })
        .catch(() => {})
        .finally(() => {
          configuringRef.current = false;
        });
    };

    const handleDomReady = () => {
      setDomReady(true);
      ensureInjectedAndConfigured();
    };

    const handleFinishLoad = () => {
      setDomReady(true);
      ensureInjectedAndConfigured();
    };

    const handleFailLoad = (event: Event & { errorCode?: number; isMainFrame?: boolean }) => {
      if (event.errorCode === -3 || event.isMainFrame === false) return;
      fireFallback("YouTube 高清舞台页面加载失败，已自动回退普通视频流。");
    };

    const handleGone = () => {
      fireFallback("YouTube 高清舞台渲染进程已重置，已回退普通视频流。");
    };

    view.addEventListener("dom-ready", handleDomReady);
    view.addEventListener("did-finish-load", handleFinishLoad);
    view.addEventListener("did-fail-load", handleFailLoad);
    view.addEventListener("render-process-gone", handleGone);
    view.addEventListener("crashed", handleGone);

    return () => {
      view.removeEventListener("dom-ready", handleDomReady);
      view.removeEventListener("did-finish-load", handleFinishLoad);
      view.removeEventListener("did-fail-load", handleFailLoad);
      view.removeEventListener("render-process-gone", handleGone);
      view.removeEventListener("crashed", handleGone);
      if (controlRef.current === myControl) {
        controlRef.current = null;
      }
    };
  }, [preparedUrl, controlRef]);

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    const view = webviewRef.current;
    if (!view || !domReady) return;
    try {
      view.setAudioMuted?.(true);
    } catch {
      // Best-effort mute enforcement.
    }
    if (!active) {
      void view
        .executeJavaScript?.(`window.__ariaYtStage?.setAudio(true); window.__ariaYtStage?.setPlaying(false);`, true)
        .catch(() => {});
      return;
    }
    const ytCode = youtubeCodeForQualityId(qualityId);
    const returningActive = !wasActive && active && configuredRef.current;
    if (returningActive) {
      const target = Math.max(0, getPlaybackTime() + offsetRef.current);
      const code = `window.__ariaYtStage?.setAudio(true); window.__ariaYtStage?.seek(${JSON.stringify(target)}, ${JSON.stringify(playing)}); window.__ariaYtStage?.setPlaying(${JSON.stringify(playing)}); window.__ariaYtStage?.applyQuality(${JSON.stringify(ytCode)});`;
      void view.executeJavaScript?.(code, true).catch(() => {});
      return;
    }
    const code = `window.__ariaYtStage?.setAudio(true); window.__ariaYtStage?.setPlaying(${JSON.stringify(playing)}); window.__ariaYtStage?.applyQuality(${JSON.stringify(ytCode)});`;
    void view.executeJavaScript?.(code, true).catch(() => {});
  }, [active, domReady, playing, qualityId]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view || !active || !domReady) return;

    const timer = window.setInterval(() => {
      if (!configuredRef.current && !configuringRef.current) {
        configuringRef.current = true;
        const initialSeek = Math.max(0, getPlaybackTime() + offsetRef.current);
        const ytCode = youtubeCodeForQualityId(qualityIdRef.current);
        const cmd = `${STAGE_HELPER_SCRIPT}\nwindow.__ariaYtStage?.configure(${JSON.stringify(initialSeek)}, ${JSON.stringify(ytCode)}, ${JSON.stringify(playingRef.current)});`;
        void view
          .executeJavaScript?.(cmd, true)
          .then((ready) => {
            if (ready) {
              configuredRef.current = true;
              if (initialSeek > 0.2) initialSeekAppliedRef.current = true;
            }
          })
          .catch(() => {})
          .finally(() => {
            configuringRef.current = false;
          });
      }

      void view
        .executeJavaScript?.(`window.__ariaYtStage?.readState() || null;`, false)
        .then((raw) => {
          const state = raw as PolledStageState | null;
          if (!state) return;

          setAdActive(Boolean(state.isAd));
          try {
            view.setAudioMuted?.(true);
          } catch {
            // Best-effort mute enforcement.
          }
          if (state.isAd) {
            return;
          }

          if (!initialSeekAppliedRef.current && state.readyState >= 1) {
            initialSeekAppliedRef.current = true;
            const seekTarget = Math.max(0, getPlaybackTime() + offsetRef.current);
            if (Math.abs(state.currentTime - seekTarget) > 0.6) {
              void view
                .executeJavaScript?.(`window.__ariaYtStage?.seek(${JSON.stringify(seekTarget)}, ${JSON.stringify(playingRef.current)});`, true)
                .catch(() => {});
            }
          }

          const readyForDisplay =
            !state.isAd &&
            state.videoWidth > 0 &&
            state.videoHeight > 0 &&
            state.readyState >= 2 &&
            configuredRef.current &&
            (!playingRef.current || !state.paused);
          if (readyForDisplay) {
            setHasFrame(true);
          }

          const mapped = mapYoutubeQualityOptions(state.availableLevels);
          const activeLabel =
            QUALITY_LABELS[state.currentQuality] ?? (state.videoHeight ? `${state.videoHeight}P` : null);
          const sig = `${activeLabel || ""}|${mapped.map((q) => q.id).join(",")}`;
          if (sig !== lastQualitySignatureRef.current) {
            lastQualitySignatureRef.current = sig;
            fireQualities(mapped, activeLabel);
          }

          if (!playingRef.current) {
            if (!state.paused) {
              void view.executeJavaScript?.(`window.__ariaYtStage?.setPlaying(false);`, true).catch(() => {});
            }
            return;
          }

          if (state.paused && !state.ended) {
            void view.executeJavaScript?.(`window.__ariaYtStage?.setPlaying(true);`, true).catch(() => {});
          }

          const target = Math.max(0, getPlaybackTime() + offsetRef.current);
          const decision = computeYoutubeSyncDecision(state.currentTime, target, true);
          if (decision.action !== "none") {
            void view
              .executeJavaScript?.(`window.__ariaYtStage?.sync(${JSON.stringify(decision)}, true);`, true)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 250);

    return () => window.clearInterval(timer);
  }, [active, domReady]);

  if (!targetWatchUrl) {
    return (
      <div className={cn("absolute inset-0 size-full bg-black", className)}>
        <img src={track.coverUrl} alt="" className="size-full object-contain opacity-45" />
      </div>
    );
  }

  const showCurtain = !hasFrame || adActive;

  return (
    <div
      className={cn("absolute inset-0 size-full overflow-hidden bg-black", className)}
      aria-label={`${track.title} YouTube 高清视频舞台`}
    >
      {preparedUrl &&
        createElement("webview", {
          ref: webviewRef,
          src: preparedUrl,
          partition: YOUTUBE_STAGE_PARTITION,
          style: {
            display: "flex",
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          },
          className: "pointer-events-none bg-black",
        })}
      <div
        aria-hidden={!showCurtain}
        className={cn(
          "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-black text-white transition-opacity duration-300",
          showCurtain ? "opacity-100" : "opacity-0",
        )}
      >
        <img
          src={track.coverUrl}
          alt=""
          className="absolute inset-0 size-full scale-105 object-cover opacity-35 blur-2xl"
        />
        <span className="relative z-10 rounded-full border border-white/15 bg-black/65 px-4 py-1.5 text-xs font-medium text-white/85 backdrop-blur-md">
          {adActive ? "正在跳过视频前贴片…" : "正在准备高清画面…"}
        </span>
      </div>
    </div>
  );
}
