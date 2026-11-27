import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense } from "react";
import {
  AudioLines,
  Captions,
  Copy,
  BookOpen,
  ImagePlus,
  Languages,
  Image as ImageIcon,
  PictureInPicture2,
  Video,
} from "lucide-react";
import { AriaSelect } from "@/components/ui/aria-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AriaIcon, ariaVolumeIcon } from "@/components/icons/aria";
import { AddToPlaylistButton } from "./PlaylistActions";
import { WordLyricText } from "./WordLyricText";
import { getLyricStartTime } from "@/lib/lyricTiming";
import { normalizeBilingualLyrics } from "@/lib/lyricNormalize";
import { SpectrumCanvas } from "@/components/music/SpectrumCanvas";
import { CopyableTrackText, CoverArt } from "@/components/music/shared";
import { VideoStage } from "@/components/music/VideoStage";
import type { VideoControl } from "@/hooks/useVideoPlayback";
import type { Track } from "@/data/music";
import { copyArtworkToClipboard } from "@/lib/clipboard";
import {
  adaptPaletteForTheme,
  colorWithAlpha,
  formatAudioDetail,
  formatDuration,
  getActiveLyricIndex,
  parseDuration,
  qualityOptions,
  readableForegroundForAccent,
  resolveDisplayedQualityLevel,
  type AudioOutputMode,
  type CoverPalette,
  type QualityLevel,
} from "@/lib/playerPresentation";
import { sourceLabel } from "@/lib/trackLabels";
import { formatYoutubeVideoOffset } from "@/lib/youtubeVideoOffset";
import { BILIBILI_LYRICS_ENABLED, BILIBILI_VIDEO_ENABLED, canPlayTrackVideo, isStandaloneMvSource } from "@/lib/features";
import { getPlaybackTime, subscribePlaybackTime, usePlaybackTime } from "@/lib/playbackClock";
import { LyricContextMenu, type LyricContextMenuTarget } from "./LyricContextMenu";
import { cn } from "@/lib/utils";
const SongEncyclopediaDialog = lazy(() => import("./SongEncyclopediaDialog"));

function PlayerTransportCluster({
  playing,
  liked,
  shuffleEnabled,
  repeatMode,
  volume,
  palette,
  controlsAriaLabel = "播放控制",
  volumeAriaLabel = "音量",
  compact = false,
  onTogglePlay,
  onToggleShuffle,
  onCycleRepeatMode,
  onPrevious,
  onNext,
  onToggleLike,
  onVolumeChange,
}: {
  playing: boolean;
  liked: boolean;
  shuffleEnabled: boolean;
  repeatMode: "all" | "one";
  volume: number;
  palette: CoverPalette;
  controlsAriaLabel?: string;
  volumeAriaLabel?: string;
  compact?: boolean;
  onTogglePlay: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onVolumeChange: (volume: number) => void;
}) {
  const lastNonZeroVolumeRef = useRef(volume > 0 ? volume : 65);
  if (volume > 0) lastNonZeroVolumeRef.current = volume;

  return (
    <div className={compact ? "aria-mv-control-bar" : "player-control-stack"}>
      <div className="player-controls" role="group" aria-label={controlsAriaLabel}>
        <Button
          className={cn("player-control-button", shuffleEnabled && "is-active")}
          variant="ghost"
          size="icon"
          aria-label="随机播放"
          aria-pressed={shuffleEnabled}
          title="随机播放"
          onClick={onToggleShuffle}
        >
          <AriaIcon name="shuffle" className="size-5" />
        </Button>
        <Button className="player-control-button" variant="ghost" size="icon" aria-label="上一首" title="上一首" onClick={onPrevious}>
          <AriaIcon name="prev" className="size-5" />
        </Button>
        <Button
          className="player-play-button"
          size="iconLg"
          aria-label={playing ? "暂停" : "播放"}
          title={playing ? "暂停" : "播放"}
          onClick={onTogglePlay}
        >
          <AriaIcon name={playing ? "playing" : "play"} className="size-6" />
        </Button>
        <Button className="player-control-button" variant="ghost" size="icon" aria-label="下一首" title="下一首" onClick={onNext}>
          <AriaIcon name="next" className="size-5" />
        </Button>
        <Button
          className={cn("player-control-button", repeatMode === "one" && "is-active")}
          variant="ghost"
          size="icon"
          aria-label="循环播放"
          aria-pressed={repeatMode === "one"}
          title="循环播放"
          onClick={onCycleRepeatMode}
        >
          <AriaIcon name={repeatMode === "one" ? "repeat-one" : "repeat"} className="size-5" />
        </Button>
        <Button
          className={cn("player-control-button", liked && "is-liked")}
          variant="ghost"
          size="icon"
          aria-label={liked ? "取消喜欢" : "喜欢"}
          aria-pressed={liked}
          title={liked ? "取消喜欢" : "喜欢"}
          onClick={onToggleLike}
        >
          <AriaIcon name={liked ? "heart-fill" : "heart"} className="size-5" />
        </Button>
      </div>
      <div
        className="player-volume"
        onWheel={(event) => {
          event.preventDefault();
          const delta = event.deltaY < 0 ? 2 : -2;
          onVolumeChange(Math.max(0, Math.min(100, Math.round(volume + delta))));
        }}
      >
        <button
          type="button"
          className="player-volume-button"
          aria-label={volume <= 0 ? "恢复音量" : "静音"}
          title={volume <= 0 ? "恢复音量" : "静音"}
          onClick={() => {
            if (volume > 0) {
              lastNonZeroVolumeRef.current = volume;
              onVolumeChange(0);
            } else {
              onVolumeChange(lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 65);
            }
          }}
        >
          <AriaIcon name={ariaVolumeIcon(volume, false)} className="player-volume-icon size-5" />
        </button>
        <input
          aria-label={volumeAriaLabel}
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          className="player-range min-w-0 w-full"
          style={
            {
              "--range-color": palette.primary,
              "--range-value": Math.min(1, Math.max(0, volume / 100)),
            } as CSSProperties
          }
        />
        <span className="player-volume-value text-xs font-medium leading-none tabular-nums text-neutral-500">{volume}</span>
      </div>
    </div>
  );
}

const videoAudioLevelLabels: Record<string, string> = {
  hires: "Hi-Res 无损",
  lossless: "杜比全景声",
  exhigh: "192K",
  higher: "132K",
  standard: "64K",
};

const bilibiliQualityOptions: Array<{ value: QualityLevel; label: string }> = [
  { value: "standard", label: "64K" },
  { value: "higher", label: "132K" },
  { value: "exhigh", label: "192K" },
  { value: "lossless", label: "杜比" },
  { value: "hires", label: "Hi-Res" },
];

const youtubeQualityOptions: Array<{ value: QualityLevel; label: string }> = [
  { value: "standard", label: "AAC 128K" },
  { value: "higher", label: "Opus 70K" },
  { value: "exhigh", label: "Opus 160K" },
];

function sourceQualityOptionsForTrack(source: Track["source"]) {
  if (source === "bilibili") return bilibiliQualityOptions;
  if (source === "youtube") return youtubeQualityOptions;
  return qualityOptions;
}

function MvAudioQualitySelect({
  activeTrack,
  qualityLevel,
  onQualityLevelChange,
  videoAudioLevel = null,
  videoAudioLevels = [],
  videoAudioQuality = null,
  onVideoAudioLevelChange,
  variant = "glass",
}: {
  activeTrack: Track;
  qualityLevel?: QualityLevel;
  onQualityLevelChange?: (level: QualityLevel) => void;
  videoAudioLevel?: string | null;
  videoAudioLevels?: string[];
  videoAudioQuality?: string | null;
  onVideoAudioLevelChange?: (level: string | null) => void;
  variant?: "glass" | "dark";
}) {
  const qualitySwitchableSource =
    activeTrack.source === "netease" ||
    activeTrack.source === "qq" ||
    activeTrack.source === "bilibili" ||
    activeTrack.source === "youtube";
  if (onQualityLevelChange && qualitySwitchableSource) {
    const availableLevels = activeTrack.availableLevels ?? [];
    const hasKnown = availableLevels.length > 0;
    const baseOptions = sourceQualityOptionsForTrack(activeTrack.source);
    const filtered = baseOptions
      .filter((option) => !hasKnown || option.value === "standard" || availableLevels.includes(option.value));
    const options = (filtered.length ? filtered : baseOptions)
      .map((option) => ({ value: option.value, label: `音质 · ${option.label}` }));
    return (
      <AriaSelect
        ariaLabel="音质选择"
        variant={variant}
        size="sm"
        align="right"
        value={qualityLevel ?? "hires"}
        onChange={(value) => {
          const nextLevel = value as QualityLevel;
          onQualityLevelChange(nextLevel);
          if (onVideoAudioLevelChange) {
            onVideoAudioLevelChange(nextLevel);
          }
        }}
        options={options}
      />
    );
  }
  if (onVideoAudioLevelChange && videoAudioLevels.length > 0) {
    return (
      <AriaSelect
        ariaLabel="音质选择"
        variant={variant}
        size="sm"
        align="right"
        value={videoAudioLevel ?? ""}
        onChange={(value) => onVideoAudioLevelChange(value || null)}
        options={[
          { value: "", label: videoAudioQuality ? `自动 · ${videoAudioQuality}` : "自动音质" },
          ...videoAudioLevels.map((level) => ({ value: level, label: videoAudioLevelLabels[level] ?? level })),
        ]}
      />
    );
  }
  return null;
}

function PlayerVideoCurtain({
  activeTrack,
  palette,
  playing,
  immersive = false,
  volume,
  onVolumeChange,
  liked,
  onToggleLike,
  exclusiveMode,
  shuffleEnabled,
  repeatMode,
  onToggleShuffle,
  onCycleRepeatMode,
  videoActive,
  standaloneMvAudio = false,
  videoControlRef,
  videoUrl,
  videoQualities,
  videoQualityId,
  onVideoQualityChange,
  qualityLevel,
  onQualityLevelChange,
  videoAudioLevel,
  videoAudioLevels,
  videoAudioQuality,
  onVideoAudioLevelChange,
  onVideoDuration,
  onVideoEnded,
  onVideoError,
  youtubeWebviewActive = false,
  youtubeActiveQuality = null,
  youtubeOffsetSeconds = 0,
  onYoutubeOffsetChange,
  onYoutubeQualities,
  onYoutubeWebviewFallback,
  onSeek,
  durationSeconds,
  onTogglePlay,
  onPrevious,
  onNext,
  onOpenImmersive,
  onCloseImmersive,
  onCloseVideo,
}: {
  activeTrack: Track;
  palette: CoverPalette;
  playing: boolean;
  immersive?: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  liked: boolean;
  onToggleLike: () => void;
  exclusiveMode: boolean;
  shuffleEnabled: boolean;
  repeatMode: "all" | "one";
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  videoActive: boolean;
  standaloneMvAudio?: boolean;
  videoControlRef: { current: VideoControl | null };
  videoUrl?: string;
  videoQualities: Array<{ id: number; label: string }>;
  videoQualityId: number | null;
  onVideoQualityChange?: (qn: number | null) => void;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  videoAudioLevel?: string | null;
  videoAudioLevels?: string[];
  videoAudioQuality?: string | null;
  onVideoAudioLevelChange?: (level: string | null) => void;
  onVideoDuration: (seconds: number) => void;
  onVideoEnded: () => void;
  onVideoError: (message: string) => void;
  youtubeWebviewActive?: boolean;
  youtubeActiveQuality?: string | null;
  youtubeOffsetSeconds?: number;
  onYoutubeOffsetChange?: (deltaOrReset: number | "reset") => void;
  onYoutubeQualities?: (qualities: Array<{ id: number; label: string }>, activeLabel: string | null) => void;
  onYoutubeWebviewFallback?: (reason: string) => void;
  onSeek: (time: number) => void;
  durationSeconds: number;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onOpenImmersive: () => void;
  onCloseImmersive?: () => void;
  onCloseVideo: () => void;
}) {
  const pipSupported = !youtubeWebviewActive && typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const chromeHoveredRef = useRef(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHideChrome = useCallback(() => {
    clearHideTimer();
    if (!immersive || !playing || chromeHoveredRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (chromeHoveredRef.current) return;
      if (stageRef.current?.querySelector('[role="listbox"]')) return;
      setChromeVisible(false);
    }, 2600);
  }, [clearHideTimer, immersive, playing]);

  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHideChrome();
  }, [scheduleHideChrome]);

  useEffect(() => {
    if (!immersive || !playing) {
      clearHideTimer();
      setChromeVisible(true);
      return;
    }
    setChromeVisible(true);
    scheduleHideChrome();
    return clearHideTimer;
  }, [clearHideTimer, immersive, playing, scheduleHideChrome]);

  async function togglePictureInPicture() {
    try {
      const element = videoControlRef.current?.element;
      if (!element) return;
      if (document.pictureInPictureElement === element) {
        await document.exitPictureInPicture();
      } else {
        await element.requestPictureInPicture();
      }
    } catch {
      // PiP may be unavailable before the first video frame is decoded.
    }
  }

  const activeCurtainPalette = useMemo(
    () => (immersive ? adaptPaletteForTheme(palette, true) : palette),
    [immersive, palette],
  );
  const audioDetailText = formatAudioDetail(activeTrack);
  const selectVariant = immersive ? "dark" : "glass";
  const controlsDimmed = immersive && playing && !chromeVisible;

  return (
    <motion.div
      ref={stageRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={
        immersive
          ? ({
              ["--track-accent" as string]: activeCurtainPalette.primary,
              ["--track-accent-fg" as string]: readableForegroundForAccent(activeCurtainPalette.primary),
            } as CSSProperties)
          : ({
              ["--track-accent" as string]: activeCurtainPalette.primary,
              ["--track-accent-fg" as string]: readableForegroundForAccent(activeCurtainPalette.primary),
              backgroundImage: `linear-gradient(155deg, var(--player-panel-sheen), ${colorWithAlpha(activeCurtainPalette.primary, 0.14)} 48%, ${colorWithAlpha(activeCurtainPalette.secondary, 0.22)})`,
            } as CSSProperties)
      }
      onPointerMove={immersive ? wakeChrome : undefined}
      onPointerDown={immersive ? wakeChrome : undefined}
      className={cn(
        immersive
          ? "aria-immersive aria-mv-stage aria-mv-immersive fixed inset-0 z-[80] overflow-hidden bg-black text-white"
          : "aria-mv-stage video-stage absolute inset-0 z-20 grid h-full max-h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-4 pb-7 sm:p-6 sm:pb-9 2xl:p-7 2xl:pb-10",
        controlsDimmed && "cursor-none",
      )}
      aria-label={
        activeTrack.source === "youtube"
          ? "YouTube 实时视频舞台"
          : isStandaloneMvSource(activeTrack.source)
            ? `${sourceLabel[activeTrack.source]}官方 MV 舞台`
            : "B站实时视频舞台"
      }
    >
      {!immersive && (
        <div
          className="pointer-events-none absolute inset-0 opacity-85"
          aria-hidden="true"
          style={{
            background: `radial-gradient(circle at 22% 24%, ${palette.primary}34, transparent 26rem), radial-gradient(circle at 82% 78%, ${palette.secondary}28, transparent 22rem)`,
          }}
        />
      )}

      {/* Top header */}
      <div
        onPointerEnter={immersive ? () => { chromeHoveredRef.current = true; clearHideTimer(); setChromeVisible(true); } : undefined}
        onPointerLeave={immersive ? () => { chromeHoveredRef.current = false; scheduleHideChrome(); } : undefined}
        className={cn(
          "relative z-20 flex flex-wrap items-start justify-between gap-3",
          immersive && "aria-immersive-header absolute inset-x-0 top-0 bg-gradient-to-b from-black/78 via-black/38 to-transparent p-5 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] sm:p-7",
          controlsDimmed && "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className={cn("flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em]", immersive ? "text-white/60" : "text-neutral-500")}>
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: palette.primary }} />
            <span className="truncate">
              {youtubeWebviewActive
                ? `YouTube Music · 音画融合${youtubeActiveQuality ? ` · ${youtubeActiveQuality}` : ""}`
                : isStandaloneMvSource(activeTrack.source)
                  ? `${sourceLabel[activeTrack.source]} · 官方 MV ${immersive ? "沉浸播放" : "原声播放"}`
                  : `${sourceLabel[activeTrack.source]} · MV ${immersive ? "沉浸画面" : "实时画面"} · ${exclusiveMode ? "直通播放" : "独立音频输出"}`}
            </span>
          </p>
          <h2 className={cn("mt-1 truncate text-base font-semibold sm:text-lg", immersive ? "text-white" : "text-neutral-950")} title={activeTrack.title}>
            {activeTrack.title}
          </h2>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
            <span className={cn("min-w-0 truncate font-medium", immersive ? "text-white/65" : "text-neutral-500")}>
              {activeTrack.artist}
            </span>
            <span className={cn("shrink-0 whitespace-nowrap", immersive ? "text-white/55" : "text-neutral-400")}>
              · {audioDetailText}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {youtubeWebviewActive && onYoutubeOffsetChange && (
            <div
              role="group"
              aria-label="音画偏移微调"
              className={cn(
                "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px]",
                immersive
                  ? "border-white/15 bg-black/55 text-white/80"
                  : "border-neutral-200/80 bg-white/75 text-neutral-700",
              )}
            >
              <button
                type="button"
                aria-label="画面提前 0.1 秒"
                onClick={() => onYoutubeOffsetChange(-0.1)}
                className="rounded-full px-1.5 py-0.5 hover:bg-black/10"
              >
                -0.1s
              </button>
              <button
                type="button"
                aria-label="重置音画偏移"
                title="点击归零音画偏移"
                onClick={() => onYoutubeOffsetChange("reset")}
                className="min-w-[3.1rem] text-center font-mono tabular-nums"
              >
                {formatYoutubeVideoOffset(youtubeOffsetSeconds)}
              </button>
              <button
                type="button"
                aria-label="画面延后 0.1 秒"
                onClick={() => onYoutubeOffsetChange(0.1)}
                className="rounded-full px-1.5 py-0.5 hover:bg-black/10"
              >
                +0.1s
              </button>
            </div>
          )}
          {onVideoQualityChange && (
            <AriaSelect
              ariaLabel="视频画质"
              variant={selectVariant}
              size="sm"
              align="right"
              value={videoQualityId !== null ? String(videoQualityId) : ""}
              onChange={(value) => onVideoQualityChange(value ? Number(value) : null)}
              options={[
                {
                  value: "",
                  label: youtubeWebviewActive
                    ? youtubeActiveQuality
                      ? `自动 · ${youtubeActiveQuality}`
                      : "自动画质"
                    : activeTrack.videoQuality
                      ? `自动 · ${activeTrack.videoQuality}`
                      : "自动画质",
                },
                ...videoQualities.map((quality) => ({ value: String(quality.id), label: quality.label })),
              ]}
            />
          )}
          {!standaloneMvAudio && (
            <MvAudioQualitySelect
              activeTrack={activeTrack}
              qualityLevel={qualityLevel}
              onQualityLevelChange={onQualityLevelChange}
              videoAudioLevel={videoAudioLevel}
              videoAudioLevels={videoAudioLevels}
              videoAudioQuality={videoAudioQuality}
              onVideoAudioLevelChange={onVideoAudioLevelChange}
              variant={selectVariant}
            />
          )}
          {pipSupported && (
            <Button
              variant={immersive ? "ghost" : "glass"}
              size="sm"
              className={cn("size-8 px-0", immersive && "bg-white/12 text-white hover:bg-white/20")}
              aria-label="画中画悬浮窗"
              title="弹出画中画小窗（切页面也可继续观看）"
              onClick={() => void togglePictureInPicture()}
            >
              <PictureInPicture2 className="size-3.5" />
            </Button>
          )}
          {immersive ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 bg-white/12 px-0 text-white hover:bg-white/20"
                aria-label="切回封面与音频模式"
                title="切回封面与音频模式"
                onClick={onCloseVideo}
              >
                <ImageIcon className="size-4" />
              </Button>
              <Button
                className="size-8 bg-white px-0 text-neutral-950 hover:bg-white/90"
                size="sm"
                aria-label="退出沉浸全屏"
                title="退出沉浸全屏 (Esc)"
                onClick={() => (onCloseImmersive ?? onCloseVideo)()}
              >
                <AriaIcon name="close" className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="glass"
                size="sm"
                className="size-8 px-0"
                aria-label="沉浸全屏观看"
                title="进入沉浸全屏观看"
                onClick={onOpenImmersive}
              >
                <AriaIcon name="immersive" className="size-4" />
              </Button>
              <Button
                variant="glass"
                size="sm"
                className="size-8 px-0"
                aria-label="收起实时视频"
                title="收起视频画面，返回专辑封面（音乐不中断）"
                onClick={onCloseVideo}
              >
                <AriaIcon name="close" className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Preserved 3-div wrapper structure around VideoStage so windowed <-> immersive never unmounts <video> */}
      <div className={immersive ? "absolute inset-0 z-10" : "player-video-area relative z-10 min-h-0 min-w-0"}>
        <div className={immersive ? "size-full" : "player-video-frame"}>
          <div
            onClick={() => {
              onTogglePlay();
              if (immersive) wakeChrome();
            }}
            onDoubleClick={immersive ? (onCloseImmersive ?? onCloseVideo) : onOpenImmersive}
            className={
              immersive
                ? "relative size-full cursor-pointer overflow-hidden bg-black"
                : "aria-mv-viewport relative max-h-full cursor-pointer overflow-hidden rounded-[1.25rem] border border-white/65 bg-black shadow-[0_22px_60px_rgba(31,35,58,0.18)]"
            }
          >
            {!immersive && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <CoverArt track={activeTrack} className="size-full scale-110 opacity-35 blur-xl" fit="cover" large />
              </div>
            )}
            <VideoStage
              key="active-video-stage"
              track={activeTrack}
              src={videoUrl}
              standaloneAudio={standaloneMvAudio}
              active={videoActive}
              playing={playing}
              volume={volume}
              controlRef={videoControlRef}
              onDuration={onVideoDuration}
              onEnded={onVideoEnded}
              onError={onVideoError}
              youtubeWebviewEnabled={youtubeWebviewActive}
              youtubeQualityId={videoQualityId}
              youtubeOffsetSeconds={youtubeOffsetSeconds}
              onYoutubeQualities={onYoutubeQualities}
              onYoutubeWebviewFallback={onYoutubeWebviewFallback}
              className={immersive ? "absolute inset-0 z-10 size-full bg-black object-contain" : "absolute inset-0 z-10 size-full bg-transparent object-contain"}
            />
            {youtubeWebviewActive && (
              <div className="absolute inset-0 z-20" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Aria progress & transport dock */}
      <div
        onPointerEnter={immersive ? () => { chromeHoveredRef.current = true; clearHideTimer(); setChromeVisible(true); } : undefined}
        onPointerLeave={immersive ? () => { chromeHoveredRef.current = false; scheduleHideChrome(); } : undefined}
        aria-hidden={controlsDimmed}
        className={cn(
          "aria-mv-dock relative z-20",
          immersive
            ? "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 via-black/38 to-transparent p-4 pb-6 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] sm:p-6 sm:pb-8"
            : "z-10 space-y-2.5 pb-1 sm:pb-1.5",
          controlsDimmed && "pointer-events-none translate-y-3 opacity-0",
        )}
      >
        <div
          className={cn(
            "mx-auto w-full space-y-2.5",
            immersive
              ? "max-w-[44rem] space-y-3 rounded-[1.5rem] border border-white/12 bg-black/52 p-4 backdrop-blur-xl"
              : "max-w-[40rem]",
          )}
        >
          <PlaybackProgress
            palette={palette}
            durationSeconds={durationSeconds}
            activeTrack={activeTrack}
            onSeek={onSeek}
            label="视频进度"
            compact
            timeClassName={immersive ? "text-white/60" : undefined}
          />
          <PlayerTransportCluster
            playing={playing}
            liked={liked}
            shuffleEnabled={shuffleEnabled}
            repeatMode={repeatMode}
            volume={volume}
            palette={palette}
            controlsAriaLabel="MV 播放控制"
            volumeAriaLabel="视频舞台音量"
            compact
            onTogglePlay={onTogglePlay}
            onToggleShuffle={onToggleShuffle}
            onCycleRepeatMode={onCycleRepeatMode}
            onPrevious={onPrevious}
            onNext={onNext}
            onToggleLike={onToggleLike}
            onVolumeChange={onVolumeChange}
          />
        </div>
      </div>
    </motion.div>
  );
}

export function PlayerSurface({
  activeTrack,
  palette,
  playing,
  visualizerPlaying,
  visualizerActive,
  shuffleEnabled,
  repeatMode,
  onTogglePlay,
  onToggleShuffle,
  onCycleRepeatMode,
  onNext,
  onPrevious,
  onOpenImmersive,
  immersive = false,
  onCloseImmersive,
  videoMode,
  onToggleVideoMode,
  videoUrlOverride,
  videoAudioUrlOverride,
  videoQualities = [],
  videoQualityId = null,
  videoAudioQuality = null,
  videoAudioLevel = null,
  videoAudioLevels = [],
  onVideoAudioLevelChange,
  onVideoQualityChange,
  videoActive,
  standaloneMvAudio = false,
  videoControlRef,
  onVideoDuration,
  onVideoEnded,
  onVideoError,
  youtubeWebviewActive = false,
  youtubeActiveQuality = null,
  youtubeOffsetSeconds = 0,
  onYoutubeOffsetChange,
  onYoutubeQualities,
  onYoutubeWebviewFallback,
  equalizerEnabled,
  onOpenEqualizer,
  onReplaceLocalArtwork,
  liked,
  onToggleLike,
  volume,
  onVolumeChange,
  qualityLevel,
  onQualityLevelChange,
  hifiEnabled,
  masterQualityEnabled,
  onMasterQualityEnabledChange,
  exclusiveMode,
  durationSeconds,
  analyserRef,
  visualizerMode,
  lyricDisplayMode,
  onLyricDisplayModeChange,
  playbackSpeed = 1,
  onPlaybackSpeedChange,
  playbackSpeedLocked = false,
  sleepTimerMode = "off",
  sleepTimerRemainingSec = null,
  onSleepTimerSelect,
  crossfadeSeconds = 0,
  onCrossfadeSecondsChange,
  crossfadeBypassed = false,
  desktopLyricsOpen = false,
  desktopLyricsLocked = false,
  onToggleDesktopLyrics,
  onToggleDesktopLyricsLock,
  onSeek,
}: {
  activeTrack: Track;
  palette: CoverPalette;
  playing: boolean;
  visualizerPlaying: boolean;
  visualizerActive: boolean;
  shuffleEnabled: boolean;
  repeatMode: "all" | "one";
  onTogglePlay: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onOpenImmersive: () => void;
  immersive?: boolean;
  onCloseImmersive?: () => void;
  videoMode: boolean;
  onToggleVideoMode: () => void;
  standaloneMvAudio?: boolean;
  videoUrlOverride?: string;
  videoAudioUrlOverride?: string;
  videoQualities?: Array<{ id: number; label: string }>;
  videoQualityId?: number | null;
  videoAudioQuality?: string | null;
  videoAudioLevel?: string | null;
  videoAudioLevels?: string[];
  onVideoAudioLevelChange?: (level: string | null) => void;
  onVideoQualityChange?: (qn: number | null) => void;
  videoActive: boolean;
  videoControlRef: { current: VideoControl | null };
  onVideoDuration: (seconds: number) => void;
  onVideoEnded: () => void;
  onVideoError: (message: string) => void;
  youtubeWebviewActive?: boolean;
  youtubeActiveQuality?: string | null;
  youtubeOffsetSeconds?: number;
  onYoutubeOffsetChange?: (deltaOrReset: number | "reset") => void;
  onYoutubeQualities?: (qualities: Array<{ id: number; label: string }>, activeLabel: string | null) => void;
  onYoutubeWebviewFallback?: (reason: string) => void;
  equalizerEnabled: boolean;
  onOpenEqualizer: () => void;
  onReplaceLocalArtwork: (trackId: string, file: File) => Promise<void>;
  liked: boolean;
  onToggleLike: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  hifiEnabled: boolean;
  masterQualityEnabled: boolean;
  onMasterQualityEnabledChange: (enabled: boolean) => void;
  exclusiveMode: boolean;
  durationSeconds: number;
  analyserRef: { current: AnalyserNode | null };
  visualizerMode: AudioOutputMode;
  lyricDisplayMode: "original" | "bilingual";
  onLyricDisplayModeChange: (mode: "original" | "bilingual") => void;
  playbackSpeed?: number;
  onPlaybackSpeedChange?: (speed: number) => void;
  playbackSpeedLocked?: boolean;
  sleepTimerMode?: "off" | "duration" | "track-end";
  sleepTimerRemainingSec?: number | null;
  onSleepTimerSelect?: (option: "off" | "track-end" | number) => void;
  crossfadeSeconds?: number;
  onCrossfadeSecondsChange?: (seconds: 0 | 2 | 4 | 6) => void;
  crossfadeBypassed?: boolean;
  desktopLyricsOpen?: boolean;
  desktopLyricsLocked?: boolean;
  onToggleDesktopLyrics?: () => void;
  onToggleDesktopLyricsLock?: () => void;
  onSeek: (time: number) => void;
}) {
  const canPlayVideo = canPlayTrackVideo(activeTrack);
  const showVideo = canPlayVideo && videoMode;
  void videoAudioUrlOverride;
  const themePrimary = colorWithAlpha(palette.primary, 0.34);
  const themeSecondary = colorWithAlpha(palette.secondary, 0.24);
  const themeSoft = colorWithAlpha(palette.primary, 0.12);
  const availableLevels = activeTrack.availableLevels ?? [];
  const qualitySwitchableSource =
    activeTrack.source === "netease" ||
    activeTrack.source === "qq" ||
    activeTrack.source === "bilibili" ||
    activeTrack.source === "youtube";
  const hasKnownQualityLevels = qualitySwitchableSource && availableLevels.length > 0;
  // When a requested tier (e.g. Hi-Res) is unavailable on the current track,
  // highlight the resolved fallback tier (e.g. 无损) so the pill group never
  // renders with zero active selection.
  const resolvedQualityLevel = qualitySwitchableSource
    ? resolveDisplayedQualityLevel(qualityLevel, availableLevels, activeTrack.currentLevel, hifiEnabled)
    : qualityLevel;
  const [artworkMenuPosition, setArtworkMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [songOptionsOpen, setSongOptionsOpen] = useState(false);
  const [encyclopediaOpen, setEncyclopediaOpen] = useState(false);
  const artworkFileInputRef = useRef<HTMLInputElement | null>(null);
  const canReplaceArtwork = activeTrack.source === "local";

  useEffect(() => {
    setArtworkMenuPosition(null);
    setSongOptionsOpen(false);
    setEncyclopediaOpen(false);
  }, [activeTrack.id]);

  useEffect(() => {
    if (!artworkMenuPosition && !songOptionsOpen) return;
    const closeMenu = () => {
      setArtworkMenuPosition(null);
      setSongOptionsOpen(false);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [artworkMenuPosition, songOptionsOpen]);

  function openArtworkMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 190;
    const menuHeight = canReplaceArtwork ? 108 : 58;
    setArtworkMenuPosition({
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 12),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 12),
    });
  }

  async function handleArtworkFile(file: File | undefined) {
    if (!file || !canReplaceArtwork) return;
    await onReplaceLocalArtwork(activeTrack.id, file);
  }

  const accentForeground = readableForegroundForAccent(palette.primary);

  return (
    <div
      className="player-surface relative grid h-full max-h-full min-h-0 overflow-hidden rounded-[1.5rem] border border-white/55 shadow-[0_22px_70px_rgba(47,55,76,0.12)]"
      style={{
        ["--track-accent" as string]: palette.primary,
        ["--track-accent-fg" as string]: accentForeground,
        background: `linear-gradient(135deg, ${themePrimary}, var(--player-sheen) 42%, ${themeSecondary})`,
      }}
    >
      {encyclopediaOpen && <Suspense fallback={null}><SongEncyclopediaDialog key={activeTrack.id} track={activeTrack} onClose={() => setEncyclopediaOpen(false)} /></Suspense>}
      <input
        ref={artworkFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleArtworkFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {artworkMenuPosition && (
        <div
          className="fixed z-[120] w-48 rounded-[1rem] border border-white/80 bg-white/90 p-1.5 text-sm shadow-[0_18px_48px_rgba(23,23,23,0.16)] backdrop-blur-2xl"
          style={{ left: artworkMenuPosition.x, top: artworkMenuPosition.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-[0.8rem] px-3 py-2 text-left font-medium text-neutral-700 transition hover:bg-neutral-950 hover:text-white"
            onClick={() => {
              setArtworkMenuPosition(null);
              void copyArtworkToClipboard(activeTrack);
            }}
          >
            <Copy className="size-4" />
            复制曲绘
          </button>
          {canReplaceArtwork && (
            <button
              className="mt-1 flex w-full items-center gap-2 rounded-[0.8rem] px-3 py-2 text-left font-medium text-neutral-700 transition hover:bg-neutral-950 hover:text-white"
              onClick={() => {
                setArtworkMenuPosition(null);
                artworkFileInputRef.current?.click();
              }}
            >
              <ImagePlus className="size-4" />
              更换曲绘
            </button>
          )}
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: `radial-gradient(circle at 28% 32%, ${palette.primary}38, transparent 24rem), radial-gradient(circle at 82% 78%, ${palette.secondary}28, transparent 18rem)`,
        }}
      />
      <div className="relative grid h-full min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div
          className="relative min-h-[260px] overflow-hidden bg-neutral-950 lg:h-full lg:min-h-0"
          style={{
            background: `linear-gradient(145deg, ${palette.primary}30, ${palette.secondary}18, var(--cover-lift))`,
          }}
        >
          <div className="absolute inset-0" data-taskbar-anchor="player-cover">
            {activeTrack.id === "idle" ? (
              <div
                className="player-idle-cover flex size-full items-center justify-center p-8 text-center"
                style={{ background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.8), transparent 42%), linear-gradient(145deg, var(--idle-cover-a), var(--idle-cover-b))" }}
              >
                <div>
                  <p className="text-2xl font-semibold text-neutral-900">暂无播放</p>
                  <p className="mt-2 text-sm text-neutral-600">从本地音乐、网易云或 QQ 音乐选择一首歌开始。</p>
                </div>
              </div>
            ) : (
              <div className={cn("aria-cover-breathe size-full origin-center", playing ? "scale-100" : "scale-[0.985]")}>
                <CoverArt
                  track={activeTrack}
                  className="size-full"
                  fit="cover"
                  large
                  onArtworkContextMenu={openArtworkMenu}
                />
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/6 via-transparent to-black/10" />
        </div>

        <div
          className="player-detail-panel no-scrollbar flex h-full min-h-0 min-w-0 flex-col justify-between overflow-y-auto p-5 pb-6 sm:p-7 sm:pb-8 2xl:p-9 2xl:pb-10"
          style={{ background: `linear-gradient(160deg, var(--player-panel-sheen), ${themeSoft} 48%, ${themeSecondary})` }}
        >
          <div className="min-w-0 shrink-0">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 py-1">
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">{sourceLabel[activeTrack.source]} · {exclusiveMode ? "直通播放" : "正在播放"}</p>
                <p className="mt-1 whitespace-nowrap text-xs font-medium leading-5 text-neutral-600">{formatAudioDetail(activeTrack)} <span className="text-neutral-400">· {activeTrack.duration}</span></p>
              </div>
              <div className="player-header-actions ml-auto flex shrink-0 items-center gap-2">
                {activeTrack.source === "netease" && /^\d{1,20}$/.test(activeTrack.providerId ?? activeTrack.id.replace(/^netease:/, "")) && <Button variant="glass" size="icon" aria-label="歌曲百科" title="歌曲百科与制作人员" onClick={() => setEncyclopediaOpen(true)}><BookOpen /></Button>}
                <AddToPlaylistButton track={activeTrack} />
                <div className="relative">
                  <Button
                    variant="glass"
                    size="icon"
                    aria-label="歌曲选项"
                    aria-expanded={songOptionsOpen}
                    title="歌曲选项（歌词 / 倍速 / 定时 / 淡入淡出）"
                    className={cn(
                      "relative",
                      (sleepTimerMode !== "off" || Math.abs(playbackSpeed - 1) > 0.01 || crossfadeSeconds > 0) &&
                        "text-violet-700",
                    )}
                    onClick={() => setSongOptionsOpen((open) => !open)}
                  >
                    <AriaIcon name="sliders" className="size-4" />
                    {(sleepTimerMode !== "off" || Math.abs(playbackSpeed - 1) > 0.01 || crossfadeSeconds > 0) && (
                      <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-violet-500" />
                    )}
                  </Button>
                  <AnimatePresence>
                    {songOptionsOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -3 }}
                        transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                        className="aria-select-menu absolute right-0 top-full z-30 mt-2 w-72 origin-top-right space-y-3 rounded-[1.2rem] border border-white/80 bg-white/94 p-3.5 shadow-[0_18px_46px_rgba(23,23,23,0.16)] backdrop-blur-2xl"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span className="flex items-center gap-2">
                            <Languages className="size-4 text-neutral-500" />
                            播放与歌词选项
                          </span>
                          {sleepTimerMode !== "off" && (
                            <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-semibold text-violet-600 tabular-nums">
                              {sleepTimerMode === "track-end"
                                ? "播完本首停止"
                                : sleepTimerRemainingSec !== null
                                  ? `${formatDuration(sleepTimerRemainingSec)}`
                                  : "定时中"}
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="text-[11px] font-medium text-neutral-500">歌词显示</p>
                          <div className="mt-1.5 grid grid-cols-2 rounded-xl bg-neutral-950/[0.05] p-1">
                            <button
                              className={cn(
                                "rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                                lyricDisplayMode === "original" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950",
                              )}
                              onClick={() => {
                                onLyricDisplayModeChange("original");
                                setSongOptionsOpen(false);
                              }}
                            >
                              仅原文
                            </button>
                            <button
                              className={cn(
                                "rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                                lyricDisplayMode === "bilingual" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950",
                              )}
                              onClick={() => {
                                onLyricDisplayModeChange("bilingual");
                                setSongOptionsOpen(false);
                              }}
                            >
                              双语
                            </button>
                          </div>
                        </div>

                        {onPlaybackSpeedChange && (
                          <div>
                            <div className="flex items-center justify-between text-[11px] text-neutral-500">
                              <span className="font-medium">播放倍速</span>
                              {playbackSpeedLocked && <span className="text-[10px] text-amber-600">一起听锁定 1.0x</span>}
                            </div>
                            <div className="mt-1.5 grid grid-cols-6 gap-1 rounded-xl bg-neutral-950/[0.05] p-1">
                              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => {
                                const active = Math.abs((playbackSpeedLocked ? 1 : playbackSpeed) - speed) < 0.01;
                                return (
                                  <button
                                    key={speed}
                                    type="button"
                                    disabled={playbackSpeedLocked}
                                    onClick={() => onPlaybackSpeedChange(speed)}
                                    className={cn(
                                      "rounded-lg py-1 text-[11px] font-semibold tabular-nums transition disabled:opacity-45",
                                      active ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950",
                                    )}
                                  >
                                    {speed}x
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {onSleepTimerSelect && (
                          <div>
                            <p className="text-[11px] font-medium text-neutral-500">定时关闭（结束前 10s 渐弱淡出）</p>
                            <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-neutral-950/[0.05] p-1">
                              {([
                                { key: "off", label: "关闭" },
                                { key: 15, label: "15 分" },
                                { key: 30, label: "30 分" },
                                { key: 45, label: "45 分" },
                                { key: 60, label: "60 分" },
                                { key: "track-end", label: "播完本首" },
                              ] as const).map((item) => {
                                const active =
                                  (item.key === "off" && sleepTimerMode === "off") ||
                                  (item.key === "track-end" && sleepTimerMode === "track-end");
                                return (
                                  <button
                                    key={String(item.key)}
                                    type="button"
                                    onClick={() => onSleepTimerSelect(item.key)}
                                    className={cn(
                                      "rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition",
                                      active ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950",
                                    )}
                                  >
                                    {item.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {onCrossfadeSecondsChange && (
                          <div>
                            <div className="flex items-center justify-between text-[11px] text-neutral-500">
                              <span className="font-medium">曲间淡入淡出</span>
                              {crossfadeBypassed && <span className="text-[10px] text-amber-600">独占/一起听旁路</span>}
                            </div>
                            <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-xl bg-neutral-950/[0.05] p-1">
                              {([0, 2, 4, 6] as const).map((sec) => {
                                const active = crossfadeSeconds === sec;
                                return (
                                  <button
                                    key={sec}
                                    type="button"
                                    onClick={() => onCrossfadeSecondsChange(sec)}
                                    className={cn(
                                      "rounded-lg py-1 text-[11px] font-semibold tabular-nums transition",
                                      active ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950",
                                    )}
                                  >
                                    {sec === 0 ? "关闭" : `${sec}s`}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {onToggleDesktopLyrics && (
                          <div>
                            <p className="text-[11px] font-medium text-neutral-500">桌面歌词摆件</p>
                            <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-neutral-950/[0.05] p-1">
                              <button
                                type="button"
                                onClick={onToggleDesktopLyrics}
                                className={cn(
                                  "rounded-lg py-1.5 text-[11px] font-semibold transition",
                                  desktopLyricsOpen ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950",
                                )}
                              >
                                {desktopLyricsOpen ? "已开启" : "已关闭"}
                              </button>
                              <button
                                type="button"
                                disabled={!desktopLyricsOpen}
                                onClick={() => onToggleDesktopLyricsLock?.()}
                                className={cn(
                                  "rounded-lg py-1.5 text-[11px] font-semibold transition disabled:opacity-40",
                                  desktopLyricsOpen && desktopLyricsLocked
                                    ? "bg-neutral-950 text-white shadow-sm"
                                    : "text-neutral-500 hover:text-neutral-950",
                                )}
                              >
                                {desktopLyricsLocked ? "已锁定穿透" : "鼠标可拖拽"}
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {onToggleDesktopLyrics && (
                  <Button
                    variant="glass"
                    size="sm"
                    title={desktopLyricsOpen ? (desktopLyricsLocked ? "桌面歌词已开启（穿透锁定）" : "关闭桌面歌词") : "开启桌面歌词"}
                    aria-label={desktopLyricsOpen ? "关闭桌面歌词" : "开启桌面歌词"}
                    aria-pressed={desktopLyricsOpen}
                    className={cn("relative size-8 px-0", desktopLyricsOpen && "text-violet-700")}
                    onClick={onToggleDesktopLyrics}
                  >
                    <Captions />
                    {desktopLyricsOpen && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-violet-500" />}
                  </Button>
                )}
                <Button
                  variant="glass"
                  size="sm"
                  title={equalizerEnabled ? "均衡器已启用，点击调整" : "打开均衡器"}
                  aria-label={equalizerEnabled ? "均衡器已启用，点击调整" : "打开均衡器"}
                  aria-pressed={equalizerEnabled}
                  className={cn("size-8 px-0", equalizerEnabled && "text-violet-700")}
                  onClick={onOpenEqualizer}
                >
                  <AudioLines />
                  {equalizerEnabled && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-violet-500" />}
                </Button>
                {BILIBILI_VIDEO_ENABLED && (
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={!canPlayVideo}
                    title={
                      !canPlayVideo
                        ? "当前曲目暂无关联 MV 或视频（支持网易云、QQ 音乐、B站与 YouTube）"
                        : isStandaloneMvSource(activeTrack.source)
                          ? videoMode
                            ? "收起 MV 画面"
                            : "播放官方 MV"
                          : videoMode
                            ? "收起实时视频"
                            : "播放实时视频（不中断音频输出）"
                    }
                    aria-label={
                      !canPlayVideo
                        ? "当前曲目无视频"
                        : isStandaloneMvSource(activeTrack.source)
                          ? videoMode
                            ? "收起 MV 画面"
                            : "播放官方 MV"
                          : videoMode
                            ? "收起实时视频"
                            : "播放实时视频"
                    }
                    aria-pressed={showVideo}
                    className={cn(
                      "relative size-8 px-0",
                      showVideo && "text-violet-700",
                      !canPlayVideo && "cursor-not-allowed opacity-40",
                    )}
                    onClick={onToggleVideoMode}
                  >
                    <Video />
                    {showVideo && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-violet-500" />}
                  </Button>
                )}
                <Button variant="glass" size="sm" className="size-8 px-0" aria-label="打开沉浸视图" title="打开沉浸视图" onClick={onOpenImmersive}>
                  <AriaIcon name="immersive" className="size-4" />
                </Button>
              </div>
            </div>
            {activeTrack.id === "idle" ? (
              <div className="mt-4 rounded-[1.25rem] border border-white/70 bg-white/55 p-5 shadow-sm">
                <h1 className="text-3xl font-semibold text-neutral-950">暂无播放</h1>
                <p className="mt-2 text-sm text-neutral-500">从本地音乐、网易云或 QQ 音乐选择一首歌开始。</p>
              </div>
            ) : (
              <>
                <h1 className="player-track-title mt-4 font-semibold text-neutral-950" title={activeTrack.title}>
                  <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
                </h1>
                <p className="mt-2 truncate text-xl text-neutral-500">
                  <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                </p>
                <p className="mt-1 truncate text-sm text-neutral-400" title={activeTrack.album}>{activeTrack.album}</p>
              </>
            )}
          </div>

          <div className="mt-3 shrink-0">
            <div className="px-1">
              <SpectrumCanvas
                analyserRef={analyserRef}
                playing={visualizerPlaying}
                active={visualizerActive && !showVideo}
                palette={palette}
                fallback={activeTrack.waveform}
                outputMode={visualizerMode}
                outputVolume={volume}
              />
              <PlaybackProgress
                palette={palette}
                durationSeconds={durationSeconds}
                activeTrack={activeTrack}
                onSeek={onSeek}
              />
            </div>

            <div className="mt-3">
              <PlayerTransportCluster
                playing={playing}
                liked={liked}
                shuffleEnabled={shuffleEnabled}
                repeatMode={repeatMode}
                volume={volume}
                palette={palette}
                onTogglePlay={onTogglePlay}
                onToggleShuffle={onToggleShuffle}
                onCycleRepeatMode={onCycleRepeatMode}
                onPrevious={onPrevious}
                onNext={onNext}
                onToggleLike={onToggleLike}
                onVolumeChange={onVolumeChange}
              />
            </div>

            <div
              className="player-quality mt-3 rounded-[1.25rem] border border-white/35 p-3 shadow-sm"
              style={{ background: `linear-gradient(135deg, var(--player-quality-sheen, rgba(255,255,255,0.28)), ${colorWithAlpha(palette.secondary, 0.1)})` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-neutral-500">音质</p>
                <div className="flex items-center gap-2">
                  {hifiEnabled && <Badge>HiFi 优先</Badge>}
                  <div className="player-quality-group flex flex-wrap gap-1 rounded-full bg-white/60 p-1">
                  {qualityOptions.map((option) => {
                    const isAvailable =
                      qualitySwitchableSource && (!hasKnownQualityLevels || availableLevels.includes(option.value));
                    const isEmptySlot = !isAvailable;
                    const isActive = isAvailable && resolvedQualityLevel === option.value;
                    return (
                      <button
                        key={option.value}
                        aria-pressed={isActive}
                        title={isEmptySlot ? "当前音源暂无此档位" : undefined}
                        className={cn(
                          "player-quality-option rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
                          isActive && "is-active bg-neutral-950 text-white shadow-sm",
                          isEmptySlot && "is-empty-slot border border-dashed border-neutral-300/80 bg-transparent text-neutral-400/75 opacity-60",
                        )}
                        disabled={isEmptySlot}
                        onClick={() => onQualityLevelChange(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  </div>
                </div>
              </div>
              {activeTrack.source === "bilibili" && (
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  B站无损 / Hi-Res 与部分高画质需要大会员；登录后这里会显示账号实际可用的档位。
                </p>
              )}
            </div>
          </div>

        </div>

        <AnimatePresence>
          {showVideo && (
            <PlayerVideoCurtain
              activeTrack={activeTrack}
              palette={palette}
              playing={playing}
              immersive={immersive}
              volume={volume}
              onVolumeChange={onVolumeChange}
              liked={liked}
              onToggleLike={onToggleLike}
              exclusiveMode={exclusiveMode}
              shuffleEnabled={shuffleEnabled}
              repeatMode={repeatMode}
              onToggleShuffle={onToggleShuffle}
              onCycleRepeatMode={onCycleRepeatMode}
              videoActive={videoActive}
              standaloneMvAudio={standaloneMvAudio}
              videoControlRef={videoControlRef}
              videoUrl={videoUrlOverride}
              videoQualities={videoQualities}
              videoQualityId={videoQualityId ?? null}
              onVideoQualityChange={onVideoQualityChange}
              qualityLevel={resolvedQualityLevel}
              onQualityLevelChange={onQualityLevelChange}
              videoAudioLevel={videoAudioLevel}
              videoAudioLevels={videoAudioLevels}
              videoAudioQuality={videoAudioQuality}
              onVideoAudioLevelChange={onVideoAudioLevelChange}
              onVideoDuration={onVideoDuration}
              onVideoEnded={onVideoEnded}
              onVideoError={onVideoError}
              youtubeWebviewActive={youtubeWebviewActive}
              youtubeActiveQuality={youtubeActiveQuality}
              youtubeOffsetSeconds={youtubeOffsetSeconds}
              onYoutubeOffsetChange={onYoutubeOffsetChange}
              onYoutubeQualities={onYoutubeQualities}
              onYoutubeWebviewFallback={onYoutubeWebviewFallback}
              onSeek={onSeek}
              durationSeconds={durationSeconds}
              onTogglePlay={onTogglePlay}
              onPrevious={onPrevious}
              onNext={onNext}
              onOpenImmersive={onOpenImmersive}
              onCloseImmersive={onCloseImmersive}
              onCloseVideo={onToggleVideoMode}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const DEFAULT_IMMERSIVE_LYRICS: Track["lyrics"] = [{ time: "00:00", text: "暂无歌词" }];
const noopHandler = () => undefined;

export function ImmersivePlayerView({
  activeTrack,
  palette,
  playing,
  visualizerPlaying,
  durationSeconds,
  analyserRef,
  visualizerMode,
  volume,
  onVolumeChange,
  shuffleEnabled = false,
  repeatMode = "all",
  liked = false,
  onToggleShuffle = noopHandler,
  onCycleRepeatMode = noopHandler,
  onToggleLike = noopHandler,
  qualityLevel,
  onQualityLevelChange,
  visualizerActive,
  onClose,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  videoMode,
  onToggleVideoMode,
  standaloneMvAudio = false,
  videoControlRef,
  videoUrlOverride,
  videoAudioUrlOverride,
  videoQualities = [],
  videoQualityId = null,
  videoAudioLevel = null,
  videoAudioLevels = [],
  videoAudioQuality = null,
  onVideoAudioLevelChange,
  onVideoQualityChange,
  onVideoDuration,
  onVideoEnded,
  onVideoError,
  videoActive,
  lyricDisplayMode = "bilingual",
  onLyricCopied,
}: {
  activeTrack: Track;
  palette: CoverPalette;
  playing: boolean;
  visualizerPlaying: boolean;
  durationSeconds: number;
  analyserRef: { current: AnalyserNode | null };
  visualizerMode: AudioOutputMode;
  volume: number;
  onVolumeChange: (volume: number) => void;
  shuffleEnabled?: boolean;
  repeatMode?: "all" | "one";
  liked?: boolean;
  onToggleShuffle?: () => void;
  onCycleRepeatMode?: () => void;
  onToggleLike?: () => void;
  qualityLevel?: QualityLevel;
  onQualityLevelChange?: (level: QualityLevel) => void;
  visualizerActive: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  videoMode: boolean;
  onToggleVideoMode: () => void;
  standaloneMvAudio?: boolean;
  videoControlRef: { current: VideoControl | null };
  videoUrlOverride?: string;
  videoAudioUrlOverride?: string;
  videoQualities?: Array<{ id: number; label: string }>;
  videoQualityId?: number | null;
  videoAudioLevel?: string | null;
  videoAudioLevels?: string[];
  videoAudioQuality?: string | null;
  onVideoAudioLevelChange?: (level: string | null) => void;
  onVideoQualityChange?: (qn: number | null) => void;
  onVideoDuration: (seconds: number) => void;
  onVideoEnded: () => void;
  onVideoError: (message: string) => void;
  videoActive: boolean;
  lyricDisplayMode?: "original" | "bilingual";
  onLyricCopied?: (message: string) => void;
}) {
  const lyrics = useMemo(() => {
    if (activeTrack.source === "bilibili" && !BILIBILI_LYRICS_ENABLED) {
      return DEFAULT_IMMERSIVE_LYRICS;
    }
    const normalized = normalizeBilingualLyrics(activeTrack.lyrics);
    if (normalized.length) return normalized;
    return [
      {
        time: "00:00",
        text:
          activeTrack.id !== "idle" && activeTrack.lyricStatus === "searchable"
            ? "正在加载歌词…"
            : "纯音乐或暂无歌词",
      },
    ];
  }, [activeTrack.id, activeTrack.lyricStatus, activeTrack.lyrics, activeTrack.source]);
  const activeLyricIndex = useSyncExternalStore(
    subscribePlaybackTime,
    () => getActiveLyricIndex(lyrics, getPlaybackTime()),
    () => getActiveLyricIndex(lyrics, getPlaybackTime()),
  );
  const videoActiveMode = BILIBILI_VIDEO_ENABLED && videoMode && Boolean(activeTrack.videoUrl);
  const immersiveLineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const manualScrollUntilRef = useRef(0);
  const [manualScrolling, setManualScrolling] = useState(false);
  const [lyricMenu, setLyricMenu] = useState<LyricContextMenuTarget | null>(null);

  useEffect(() => {
    setLyricMenu(null);
  }, [activeTrack.id]);

  useEffect(() => {
    if (videoActiveMode) return;
    if (typeof window !== "undefined" && Date.now() < manualScrollUntilRef.current) return;
    immersiveLineRefs.current[activeLyricIndex]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLyricIndex, activeTrack.id, videoActiveMode]);

  const holdManualScroll = () => {
    manualScrollUntilRef.current = Date.now() + 3500;
    setManualScrolling(true);
    window.setTimeout(() => {
      if (Date.now() >= manualScrollUntilRef.current) {
        setManualScrolling(false);
      }
    }, 3550);
  };

  return (
    <motion.div
      className="aria-immersive fixed inset-0 z-[80] overflow-hidden bg-[#07080c] text-white"
      style={{
        ["--track-accent" as string]: palette.primary,
        ["--track-accent-fg" as string]: readableForegroundForAccent(palette.primary),
      } as CSSProperties}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
    >
      {videoActiveMode ? (
        <div className="relative h-full w-full bg-black" onDoubleClick={onClose}>
          <VideoStage
            track={activeTrack}
            src={videoUrlOverride}
            audioSrc={videoAudioUrlOverride}
            standaloneAudio={standaloneMvAudio}
            active={videoActive}
            playing={playing}
            volume={volume}
            controlRef={videoControlRef}
            onDuration={onVideoDuration}
            onEnded={onVideoEnded}
            onError={onVideoError}
            className="absolute inset-0 size-full"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />

          <div className="aria-immersive-header absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-4 p-5 sm:p-7">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: palette.primary }} />
                <span>Now playing · MV</span>
              </p>
              <h1 className="mt-2 max-w-[62vw] truncate text-2xl font-semibold" title={activeTrack.title}>
                {activeTrack.title}
              </h1>
              <p className="mt-1 truncate text-sm text-white/55">{activeTrack.artist} · {activeTrack.album}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 text-white/75">{formatAudioDetail(activeTrack)}</span>
                {activeTrack.videoQuality && <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/75">{activeTrack.videoQuality}</span>}
                {videoAudioQuality && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-200">{videoAudioQuality} 音轨</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {videoQualities.length > 0 && onVideoQualityChange && (
                <AriaSelect
                  ariaLabel="视频画质"
                  variant="dark"
                  size="sm"
                  align="right"
                  value={videoQualityId !== null ? String(videoQualityId) : ""}
                  onChange={(value) => onVideoQualityChange(value ? Number(value) : null)}
                  options={[
                    { value: "", label: "自动" },
                    ...videoQualities.map((quality) => ({ value: String(quality.id), label: quality.label })),
                  ]}
                />
              )}
              {!standaloneMvAudio && (
                <MvAudioQualitySelect
                  activeTrack={activeTrack}
                  qualityLevel={qualityLevel}
                  onQualityLevelChange={onQualityLevelChange}
                  videoAudioLevel={videoAudioLevel}
                  videoAudioLevels={videoAudioLevels}
                  videoAudioQuality={videoAudioQuality}
                  onVideoAudioLevelChange={onVideoAudioLevelChange}
                  variant="dark"
                />
              )}
              <Button
                className="bg-white/12 text-white hover:bg-white/20"
                size="icon"
                aria-label="切回封面与音频模式"
                title="切回封面与音频模式"
                onClick={onToggleVideoMode}
              >
                <ImageIcon className="size-4" />
              </Button>
              <Button className="bg-white text-neutral-950 hover:bg-white/90" size="icon" aria-label="关闭沉浸视图" onClick={onClose}>
                <AriaIcon name="close" className="size-5" />
              </Button>
            </div>
          </div>

          <div className="aria-mv-dock absolute inset-x-0 bottom-0 z-10 p-4 pb-6 sm:p-6 sm:pb-8">
            <div className="mx-auto w-full max-w-[44rem] space-y-3 rounded-[1.5rem] border border-white/12 bg-black/50 p-4 backdrop-blur-xl">
              <PlaybackProgress
                palette={palette}
                durationSeconds={durationSeconds}
                activeTrack={activeTrack}
                onSeek={onSeek}
                label="视频进度"
                compact
                timeClassName="text-white/60"
              />
              <PlayerTransportCluster
                playing={playing}
                liked={liked}
                shuffleEnabled={shuffleEnabled}
                repeatMode={repeatMode}
                volume={volume}
                palette={palette}
                controlsAriaLabel="MV 播放控制"
                volumeAriaLabel="沉浸音量"
                compact
                onTogglePlay={onTogglePlay}
                onToggleShuffle={onToggleShuffle}
                onCycleRepeatMode={onCycleRepeatMode}
                onPrevious={onPrevious}
                onNext={onNext}
                onToggleLike={onToggleLike}
                onVolumeChange={onVolumeChange}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="relative h-full w-full">
          <div className="absolute inset-0 bg-[linear-gradient(125deg,#080910,#10131d_48%,#07080c)]" />
          <div
            aria-hidden="true"
            className={cn(
              "aria-immersive-ambient",
              (!playing || !visualizerActive) && "is-paused",
            )}
          >
            <div
              className="aria-ambient-orb-a"
              style={{
                background: `radial-gradient(circle at center, ${colorWithAlpha(palette.primary, 0.36)} 0%, transparent 66%)`,
              }}
            />
            <div
              className="aria-ambient-orb-b"
              style={{
                background: `radial-gradient(circle at center, ${colorWithAlpha(palette.secondary, 0.26)} 0%, transparent 64%)`,
              }}
            />
            <div
              className="aria-ambient-orb-c"
              style={{
                background: `radial-gradient(circle at center, ${colorWithAlpha(palette.primary, 0.16)} 0%, transparent 68%)`,
              }}
            />
          </div>
          <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)_auto] px-6 py-6 lg:px-10 2xl:px-14">
            <div className="aria-immersive-header flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="whitespace-nowrap text-sm text-white/55">{sourceLabel[activeTrack.source]} · {formatAudioDetail(activeTrack)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {BILIBILI_VIDEO_ENABLED && activeTrack.videoUrl && (
                  <Button
                    className="bg-white/10 text-white hover:bg-white/18"
                    size="icon"
                    aria-label="观看视频"
                    title="观看视频"
                    onClick={onToggleVideoMode}
                  >
                    <Video className="size-4" />
                  </Button>
                )}
                <Button className="bg-white text-neutral-950 hover:bg-white/90" size="icon" aria-label="关闭沉浸视图" onClick={onClose}>
                  <AriaIcon name="close" className="size-5" />
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-8 2xl:gap-12">
              <div className="flex min-w-0 items-center gap-4 lg:block">
                <div
                  className={cn(
                    "aria-cover-breathe size-20 shrink-0 origin-center overflow-hidden rounded-2xl lg:mx-auto lg:aspect-square lg:h-auto lg:w-full lg:max-w-[min(46vh,28rem)] lg:rounded-[2rem]",
                    playing
                      ? "scale-100 shadow-[0_24px_70px_rgba(0,0,0,0.44)] lg:shadow-[0_42px_140px_rgba(0,0,0,0.48)]"
                      : "scale-[0.93] shadow-[0_14px_38px_rgba(0,0,0,0.34)] lg:shadow-[0_22px_68px_rgba(0,0,0,0.36)]",
                  )}
                >
                  <CoverArt track={activeTrack} className="size-full" fit="cover" large />
                </div>
                <div className="min-w-0 lg:hidden">
                  <h1 className="truncate text-xl font-semibold leading-tight" title={activeTrack.title}>
                    <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
                  </h1>
                  <p className="mt-1 truncate text-sm text-white/60">
                    <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-white/35">{activeTrack.album}</p>
                </div>
              </div>

              <div className="flex min-h-0 min-w-0 flex-col justify-center overflow-hidden lg:h-full lg:max-h-[min(66vh,40rem)]">
                <div className="hidden shrink-0 lg:block">
                  <h1 className="truncate text-3xl font-semibold leading-tight tracking-[-0.025em] 2xl:text-4xl" title={activeTrack.title}>
                    <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
                  </h1>
                  <p className="mt-3 truncate text-lg text-white/65">
                    <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                  </p>
                  <p className="mt-1 truncate text-sm text-white/35">{activeTrack.album}</p>
                </div>

                <div
                  className="aria-lyric-scroll aria-scroll-fade-y no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto pr-2 lg:mt-6"
                  onWheel={holdManualScroll}
                  onTouchStart={holdManualScroll}
                  onPointerDown={holdManualScroll}
                >
                  <div className="space-y-1.5 py-6">
                    {lyrics.map((line, index) => {
                      const active = index === activeLyricIndex;
                      const distance = activeLyricIndex >= 0 ? Math.abs(index - activeLyricIndex) : 0;
                      const depthStyle: CSSProperties | undefined = active
                        ? undefined
                        : !manualScrolling && activeLyricIndex >= 0
                          ? {
                              opacity: distance === 1 ? 0.56 : distance === 2 ? 0.34 : 0.22,
                            }
                          : undefined;
                      return (
                        <button
                          key={`${activeTrack.id}-immersive-${line.time}-${line.text}-${index}`}
                          ref={(node) => {
                            immersiveLineRefs.current[index] = node;
                          }}
                          style={depthStyle}
                          className={cn(
                            "aria-lyric-line grid w-full grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-3 py-2 text-left",
                            active ? "is-active bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/80",
                          )}
                          onClick={() => {
                            manualScrollUntilRef.current = 0;
                            setManualScrolling(false);
                            onSeek(getLyricStartTime(line));
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setLyricMenu({
                              x: event.clientX,
                              y: event.clientY,
                              line,
                              lines: lyrics,
                              mode: lyricDisplayMode,
                            });
                          }}
                        >
                          <span className={cn("pt-1 text-xs font-medium tabular-nums", active ? "text-white/55" : "text-white/30")}>
                            {line.time}
                          </span>
                          <span className={cn("min-w-0 origin-left whitespace-pre-wrap break-words transition-[transform,font-size] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]", active ? "text-lg font-semibold leading-7 sm:text-xl sm:leading-8" : "text-sm leading-6")}>
                            <WordLyricText line={line} active={active} playing={playing} color="#ffffff" pendingColor="rgba(255,255,255,0.38)" />
                            {lyricDisplayMode === "bilingual" && line.translation && (
                              <span className={cn("mt-1 block text-xs font-medium leading-5", active ? "text-white/55" : "text-white/30")}>
                                {line.translation}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-auto mt-4 w-full max-w-6xl">
              <SpectrumCanvas
                analyserRef={analyserRef}
                playing={visualizerPlaying}
                active={visualizerActive}
                palette={palette}
                fallback={activeTrack.waveform}
                outputMode={visualizerMode}
                outputVolume={volume}
              />
              <PlaybackProgress
                palette={palette}
                durationSeconds={durationSeconds}
                activeTrack={activeTrack}
                onSeek={onSeek}
                label="沉浸播放进度"
                timeClassName="text-white/54"
              />
              <div className="aria-mv-dock mt-3">
                <PlayerTransportCluster
                  playing={playing}
                  liked={liked}
                  shuffleEnabled={shuffleEnabled}
                  repeatMode={repeatMode}
                  volume={volume}
                  palette={palette}
                  controlsAriaLabel="沉浸播放控制"
                  volumeAriaLabel="沉浸音量"
                  compact
                  onTogglePlay={onTogglePlay}
                  onToggleShuffle={onToggleShuffle}
                  onCycleRepeatMode={onCycleRepeatMode}
                  onPrevious={onPrevious}
                  onNext={onNext}
                  onToggleLike={onToggleLike}
                  onVolumeChange={onVolumeChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      <LyricContextMenu
        target={lyricMenu}
        tone="dark"
        onClose={() => setLyricMenu(null)}
        onCopied={onLyricCopied}
      />
    </motion.div>
  );
}

function PlaybackProgress({
  palette,
  durationSeconds,
  activeTrack,
  onSeek,
  label = "播放进度",
  compact = false,
  timeClassName = "text-neutral-500",
}: {
  palette: CoverPalette;
  durationSeconds: number;
  activeTrack: Track;
  onSeek: (time: number) => void;
  label?: string;
  compact?: boolean;
  timeClassName?: string;
}) {
  const currentTime = usePlaybackTime();
  const resolvedDuration = durationSeconds || parseDuration(activeTrack.duration);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ time: number; ratio: number } | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const draggingRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);

  useEffect(() => {
    draggingRef.current = false;
    scrubTimeRef.current = null;
    setScrubTime(null);
  }, [activeTrack.id]);

  const displayTime = scrubTime !== null ? scrubTime : currentTime;
  const maxSeconds = Math.max(1, resolvedDuration || 0);
  const clampedDisplayTime = Math.min(displayTime, resolvedDuration || displayTime || 0);
  const progressFraction = resolvedDuration ? Math.min(1, Math.max(0, displayTime / resolvedDuration)) : 0;

  const commitScrub = () => {
    const finalTime = scrubTimeRef.current;
    draggingRef.current = false;
    scrubTimeRef.current = null;
    setScrubTime(null);
    if (finalTime !== null) {
      onSeek(finalTime);
    }
  };

  const updateHoverFromPointer = (clientX: number, rect: DOMRect) => {
    if (!rect.width || !resolvedDuration) {
      setHoverPreview(null);
      return;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHoverPreview({ time: ratio * resolvedDuration, ratio });
  };

  const tooltipState =
    scrubTime !== null && resolvedDuration > 0
      ? { time: scrubTime, ratio: Math.min(1, Math.max(0, scrubTime / resolvedDuration)) }
      : hoverPreview;

  const rightTimeText = showRemaining && resolvedDuration > 0
    ? `-${formatDuration(Math.max(0, resolvedDuration - clampedDisplayTime))}`
    : formatDuration(resolvedDuration);

  const rangeElement = (
    <div className="relative flex min-w-0 flex-1 items-center">
      {tooltipState && (
        <div
          aria-hidden="true"
          className="aria-scrub-tooltip pointer-events-none absolute -top-8 z-20 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
          style={{ left: `${Math.min(96, Math.max(4, tooltipState.ratio * 100))}%` }}
        >
          {formatDuration(tooltipState.time)}
        </div>
      )}
      <input
        aria-label={label}
        type="range"
        min="0"
        max={maxSeconds}
        step="0.1"
        data-scrubbing={scrubTime !== null ? "true" : undefined}
        value={clampedDisplayTime}
        onPointerDown={(event) => {
          draggingRef.current = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic or non-capturable pointers safely ignore pointer capture.
          }
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width && resolvedDuration > 0) {
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            const next = ratio * resolvedDuration;
            scrubTimeRef.current = next;
            setScrubTime(next);
          }
        }}
        onPointerMove={(event) => {
          updateHoverFromPointer(event.clientX, event.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={() => {
          setHoverPreview(null);
        }}
        onPointerUp={commitScrub}
        onPointerCancel={commitScrub}
        onLostPointerCapture={commitScrub}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (draggingRef.current) {
            scrubTimeRef.current = next;
            setScrubTime(next);
          } else {
            onSeek(next);
          }
        }}
        className="player-range w-full"
        style={
          {
            "--range-color": palette.primary,
            "--range-value": progressFraction,
          } as CSSProperties
        }
      />
    </div>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <span className={cn("w-11 shrink-0 text-xs font-medium tabular-nums", timeClassName)}>
          {formatDuration(clampedDisplayTime)}
        </span>
        {rangeElement}
        <button
          type="button"
          onClick={() => setShowRemaining((prev) => !prev)}
          title="切换总时长 / 剩余时间"
          aria-label="切换总时长或剩余时间"
          className={cn("w-12 shrink-0 text-right text-xs font-medium tabular-nums transition-opacity hover:opacity-80", timeClassName)}
        >
          {rightTimeText}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {rangeElement}
      <div className={cn("mt-2 flex items-center justify-between text-xs font-medium tabular-nums", timeClassName)}>
        <span>{formatDuration(clampedDisplayTime)}</span>
        <button
          type="button"
          onClick={() => setShowRemaining((prev) => !prev)}
          title="切换总时长 / 剩余时间"
          aria-label="切换总时长或剩余时间"
          className="transition-opacity hover:opacity-80"
        >
          {rightTimeText}
        </button>
      </div>
    </div>
  );
}
