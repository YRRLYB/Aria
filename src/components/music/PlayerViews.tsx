import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { motion } from "framer-motion";
import { lazy, Suspense } from "react";
import {
  AudioLines,
  Copy,
  BookOpen,
  ImagePlus,
  Languages,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
  Pause,
  Play,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AriaIcon, ariaVolumeIcon } from "@/components/icons/aria";
import { AddToPlaylistButton } from "./PlaylistActions";
import { WordLyricText } from "./WordLyricText";
import { getLyricStartTime } from "@/lib/lyricTiming";
import { SpectrumCanvas } from "@/components/music/SpectrumCanvas";
import { CopyableTrackText, CoverArt } from "@/components/music/shared";
import { VideoStage } from "@/components/music/VideoStage";
import type { VideoControl } from "@/hooks/useVideoPlayback";
import type { Track } from "@/data/music";
import { copyArtworkToClipboard } from "@/lib/clipboard";
import {
  colorWithAlpha,
  formatAudioDetail,
  formatDuration,
  getActiveLyricIndex,
  parseDuration,
  qualityOptions,
  type AudioOutputMode,
  type CoverPalette,
  type QualityLevel,
} from "@/lib/playerPresentation";
import { sourceLabel } from "@/lib/trackLabels";
import { usePlaybackTime } from "@/lib/playbackClock";
import { cn } from "@/lib/utils";
const SongEncyclopediaDialog = lazy(() => import("./SongEncyclopediaDialog"));
function VideoPlaybackChrome({
  activeTrack,
  playing,
  volume,
  onVolumeChange,
  videoActive,
  videoControlRef,
  videoUrl,
  videoQualities,
  videoQualityId,
  onVideoQualityChange,
  onVideoDuration,
  onVideoEnded,
  onVideoError,
  onSeek,
  durationSeconds,
  shuffleEnabled,
  repeatMode,
  onTogglePlay,
  onToggleShuffle,
  onCycleRepeatMode,
  onNext,
  onPrevious,
  liked,
  onToggleLike,
}: {
  activeTrack: Track;
  playing: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  videoActive: boolean;
  videoControlRef: { current: VideoControl | null };
  videoUrl?: string;
  videoQualities: Array<{ id: number; label: string }>;
  videoQualityId: number | null;
  onVideoQualityChange?: (qn: number | null) => void;
  onVideoDuration: (seconds: number) => void;
  onVideoEnded: () => void;
  onVideoError: (message: string) => void;
  onSeek: (time: number) => void;
  durationSeconds: number;
  shuffleEnabled: boolean;
  repeatMode: "all" | "one";
  onTogglePlay: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onNext: () => void;
  onPrevious: () => void;
  liked: boolean;
  onToggleLike: () => void;
}) {
  const currentTime = usePlaybackTime();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const duration = durationSeconds > 0 ? durationSeconds : parseDuration(activeTrack.duration);
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      // Browsers can reject fullscreen when the click is no longer a user gesture.
    }
  }

  return (
    <div className="flex w-full min-h-0 flex-col">
      <div
        ref={stageRef}
        data-taskbar-anchor="player-cover"
        className="group relative mx-auto aspect-video w-full overflow-hidden rounded-[1.4rem] bg-black shadow-[0_24px_70px_rgba(16,18,28,0.28)]"
        style={{ maxWidth: "calc((100dvh - 19rem) * 16 / 9)" }}
      >
        <VideoStage
          track={activeTrack}
          src={videoUrl}
          active={videoActive}
          playing={playing}
          volume={volume}
          controlRef={videoControlRef}
          onDuration={onVideoDuration}
          onEnded={onVideoEnded}
          onError={onVideoError}
          className="size-full"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur">
            B站
          </span>
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur">
            {activeTrack.videoQuality ?? "视频"}
          </span>
        </div>
        {videoQualities.length > 0 && onVideoQualityChange && (
          <select
            aria-label="视频画质"
            value={videoQualityId ?? ""}
            onChange={(event) => onVideoQualityChange(event.target.value ? Number(event.target.value) : null)}
            className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white outline-none backdrop-blur"
          >
            <option value="">自动</option>
            {videoQualities.map((quality) => (
              <option key={quality.id} value={quality.id}>{quality.label}</option>
            ))}
          </select>
        )}
        {!playing && (
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center bg-black/10 text-white transition hover:bg-black/20"
            aria-label="播放视频"
            onClick={onTogglePlay}
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-white/20 backdrop-blur transition hover:scale-105 hover:bg-white/30">
              <Play className="ml-1 size-7 fill-current" />
            </span>
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-black/45 px-3 py-2 text-white backdrop-blur-md">
            <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full transition hover:bg-white/15" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
              {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
            </button>
            <span className="shrink-0 text-[11px] tabular-nums text-white/80">
              {currentTime > 0 ? formatDuration(currentTime) : "0:00"} / {formatDuration(duration)}
            </span>
            <input
              aria-label="视频进度"
              type="range"
              min="0"
              max={duration > 0 ? duration : 1}
              step="0.1"
              value={Math.min(currentTime, duration || currentTime)}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="player-range min-w-24 flex-1"
              style={
                {
                  "--range-color": "#ffffff",
                  "--range-value": progress,
                } as CSSProperties
              }
            />
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-full transition hover:bg-white/15"
              aria-label={volume > 0 ? "静音" : "取消静音"}
              onClick={() => onVolumeChange(volume > 0 ? 0 : 72)}
            >
              <AriaIcon name={ariaVolumeIcon(volume, false)} className="size-4" />
            </button>
            <input
              aria-label="视频音量"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="player-range hidden w-20 sm:block"
              style={
                {
                  "--range-color": "#ffffff",
                  "--range-value": Math.min(1, Math.max(0, volume / 100)),
                } as CSSProperties
              }
            />
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-full transition hover:bg-white/15"
              aria-label={fullscreen ? "退出全屏" : "全屏"}
              title={fullscreen ? "退出全屏" : "全屏"}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-neutral-700">
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
          className="player-play-button text-white"
          size="iconLg"
          aria-label={playing ? "暂停" : "播放"}
          title={playing ? "暂停" : "播放"}
          onClick={onTogglePlay}
        >
          {playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
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
    </div>
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
  videoMode,
  onToggleVideoMode,
  videoUrlOverride,
  videoQualities = [],
  videoQualityId = null,
  onVideoQualityChange,
  videoActive,
  videoControlRef,
  onVideoDuration,
  onVideoEnded,
  onVideoError,
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
  videoMode: boolean;
  onToggleVideoMode: () => void;
  videoUrlOverride?: string;
  videoQualities?: Array<{ id: number; label: string }>;
  videoQualityId?: number | null;
  onVideoQualityChange?: (qn: number | null) => void;
  videoActive: boolean;
  videoControlRef: { current: VideoControl | null };
  onVideoDuration: (seconds: number) => void;
  onVideoEnded: () => void;
  onVideoError: (message: string) => void;
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
  onSeek: (time: number) => void;
}) {
  const themePrimary = colorWithAlpha(palette.primary, 0.34);
  const themeSecondary = colorWithAlpha(palette.secondary, 0.24);
  const themeSoft = colorWithAlpha(palette.primary, 0.12);
  const resolvedQualityLevel = activeTrack.currentLevel ?? qualityLevel;
  const availableLevels = activeTrack.availableLevels ?? [];
  const qualitySwitchableSource = activeTrack.source === "netease" || activeTrack.source === "qq" || activeTrack.source === "bilibili";
  const hasKnownQualityLevels = qualitySwitchableSource && availableLevels.length > 0;
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

  if (videoMode && activeTrack.videoUrl) {
    return (
      <div
        className="player-surface relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-white/55 p-5 shadow-[0_22px_70px_rgba(47,55,76,0.12)] sm:p-6"
        style={{
          ["--track-accent" as string]: palette.primary,
          minHeight: 0,
          background: `linear-gradient(135deg, ${themePrimary}, var(--player-sheen) 42%, ${themeSecondary})`,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background: `radial-gradient(circle at 24% 18%, ${palette.primary}38, transparent 24rem), radial-gradient(circle at 82% 82%, ${palette.secondary}28, transparent 18rem)`,
          }}
        />
        <div className="relative flex h-full min-h-0 flex-col">
          <header className="flex flex-wrap items-center gap-3">
            <CoverArt track={activeTrack} className="size-14 shrink-0 rounded-[0.9rem]" fit="cover" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                {sourceLabel[activeTrack.source]} · 视频播放
              </p>
              <h1 className="mt-1 truncate text-xl font-semibold text-neutral-950" title={activeTrack.title}>
                <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
              </h1>
              <p className="mt-1 truncate text-sm text-neutral-500">
                <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                <span className="text-neutral-400"> · {activeTrack.album}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="glass"
                size="icon"
                title="切回封面与高音质音频模式"
                aria-label="切回封面与高音质音频模式"
                onClick={onToggleVideoMode}
              >
                <Video />
              </Button>
              <Button variant="glass" size="sm" title="打开沉浸视图" onClick={onOpenImmersive}>
                <Maximize2 />
                沉浸
              </Button>
            </div>
          </header>

          <div className="mt-4 flex min-h-0 flex-1 items-start justify-center">
            <VideoPlaybackChrome
              activeTrack={activeTrack}
              playing={playing}
              volume={volume}
              onVolumeChange={onVolumeChange}
              videoActive={videoActive}
              videoControlRef={videoControlRef}
              videoUrl={videoUrlOverride}
              videoQualities={videoQualities}
              videoQualityId={videoQualityId}
              onVideoQualityChange={onVideoQualityChange}
              onVideoDuration={onVideoDuration}
              onVideoEnded={onVideoEnded}
              onVideoError={onVideoError}
              onSeek={onSeek}
              durationSeconds={durationSeconds}
              shuffleEnabled={shuffleEnabled}
              repeatMode={repeatMode}
              onTogglePlay={onTogglePlay}
              onToggleShuffle={onToggleShuffle}
              onCycleRepeatMode={onCycleRepeatMode}
              onNext={onNext}
              onPrevious={onPrevious}
              liked={liked}
              onToggleLike={onToggleLike}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="player-surface relative grid overflow-hidden rounded-[1.5rem] border border-white/55 shadow-[0_22px_70px_rgba(47,55,76,0.12)]"
      style={{
        ["--track-accent" as string]: palette.primary,
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
      <div className="relative grid min-h-[620px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div
          className="relative min-h-[420px] overflow-hidden bg-neutral-950"
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
            ) : videoMode && activeTrack.videoUrl ? (
              <VideoStage
                track={activeTrack}
                active={videoActive}
                playing={playing}
                volume={volume}
                controlRef={videoControlRef}
                onDuration={onVideoDuration}
                onEnded={onVideoEnded}
                onError={onVideoError}
                className="size-full"
              />
            ) : (
              <CoverArt
                track={activeTrack}
                className="size-full"
                fit="cover"
                large
                onArtworkContextMenu={openArtworkMenu}
              />
            )}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/6 via-transparent to-black/10" />
        </div>

        <div
          className="player-detail-panel flex min-h-0 min-w-0 flex-col justify-between p-5 sm:p-8 2xl:p-10"
          style={{ background: `linear-gradient(160deg, var(--player-panel-sheen), ${themeSoft} 48%, ${themeSecondary})` }}
        >
          <div className="min-w-0 shrink-0">
            <div className="flex items-start gap-3">
              <div className="min-w-0 py-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">{sourceLabel[activeTrack.source]} · {exclusiveMode ? "直通播放" : "正在播放"}</p>
                <p className="mt-1 text-xs font-medium leading-5 text-neutral-600">{formatAudioDetail(activeTrack)} <span className="text-neutral-400">· {activeTrack.duration}</span></p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {activeTrack.source === "netease" && /^\d{1,20}$/.test(activeTrack.providerId ?? activeTrack.id.replace(/^netease:/, "")) && <Button variant="glass" size="icon" aria-label="歌曲百科" title="歌曲百科与制作人员" onClick={() => setEncyclopediaOpen(true)}><BookOpen /></Button>}
                <AddToPlaylistButton track={activeTrack} />
                <div className="relative">
                  <Button
                    variant="glass"
                    size="icon"
                    aria-label="歌曲选项"
                    aria-expanded={songOptionsOpen}
                    title="歌曲选项"
                    onClick={() => setSongOptionsOpen((open) => !open)}
                  >
                    <SlidersHorizontal />
                  </Button>
                  {songOptionsOpen && (
                    <div
                      className="absolute right-0 top-full z-30 mt-2 w-56 rounded-[1.1rem] border border-white/80 bg-white/92 p-3 shadow-[0_16px_42px_rgba(23,23,23,0.14)] backdrop-blur-2xl"
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Languages className="size-4 text-neutral-500" />
                        歌曲选项
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">歌词显示</p>
                      <div className="mt-3 grid grid-cols-2 rounded-xl bg-neutral-950/[0.05] p-1">
                        <button
                          className={cn(
                            "rounded-lg px-2 py-2 text-xs font-semibold transition",
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
                            "rounded-lg px-2 py-2 text-xs font-semibold transition",
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
                  )}
                </div>
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
                {activeTrack.videoUrl && (
                  <Button
                    variant="glass"
                    size="sm"
                    title={videoMode ? "切回封面与音频模式" : "观看视频（使用系统混音）"}
                    aria-label={videoMode ? "切回封面与音频模式" : "观看视频"}
                    aria-pressed={videoMode}
                    className={cn("size-8 px-0", videoMode && "text-violet-700")}
                    onClick={onToggleVideoMode}
                  >
                    <Video />
                  </Button>
                )}
                <Button variant="glass" size="sm" title="打开沉浸视图" onClick={onOpenImmersive}>
                  <Maximize2 />
                  沉浸
                </Button>
              </div>
            </div>
            {activeTrack.id === "idle" ? (
              <div className="mt-6 rounded-[1.25rem] border border-white/70 bg-white/55 p-5 shadow-sm">
                <h1 className="text-3xl font-semibold text-neutral-950">暂无播放</h1>
                <p className="mt-2 text-sm text-neutral-500">从本地音乐、网易云或 QQ 音乐选择一首歌开始。</p>
              </div>
            ) : (
              <>
                <h1 className="player-track-title mt-6 font-semibold text-neutral-950" title={activeTrack.title}>
                  <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
                </h1>
                <p className="mt-3 truncate text-xl text-neutral-500">
                  <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                </p>
                <p className="mt-1 truncate text-sm text-neutral-400" title={activeTrack.album}>{activeTrack.album}</p>
              </>
            )}
          </div>

          <div className="mt-4 shrink-0">
            <div className="px-1">
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
              />
            </div>

            <div className="mt-4">
              <div className="player-control-stack">
                <div className="player-controls" role="group" aria-label="播放控制">
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
                    className="player-play-button text-white"
                    size="iconLg"
                    aria-label={playing ? "暂停" : "播放"}
                    title={playing ? "暂停" : "播放"}
                    onClick={onTogglePlay}
                  >
                    <AriaIcon name={playing ? "pause" : "play"} className="size-6" />
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
                <div className="player-volume">
                  <AriaIcon name={ariaVolumeIcon(volume, false)} className="player-volume-icon size-5" />
                  <input
                    aria-label="音量"
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
                  <span className="player-volume-value text-xs font-medium leading-none text-neutral-500">{volume}</span>
                </div>
              </div>
            </div>

            <div
              className="player-quality mt-3 rounded-[1.25rem] border border-white/35 p-3 shadow-sm"
              style={{ background: `linear-gradient(135deg, var(--player-quality-sheen, rgba(255,255,255,0.28)), ${colorWithAlpha(palette.secondary, 0.1)})` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Quality</p>
                <div className="flex items-center gap-2">
                  {hifiEnabled && <Badge>HiFi 优先</Badge>}
                  <div className="player-quality-group flex flex-wrap gap-1 rounded-full bg-white/60 p-1">
                  {qualityOptions.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        "player-quality-option rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
                        resolvedQualityLevel === option.value && "is-active bg-neutral-950 text-white shadow-sm",
                        !qualitySwitchableSource || (hasKnownQualityLevels && option.value !== "standard" && !availableLevels.includes(option.value)) ? "opacity-45" : undefined,
                      )}
                      disabled={!qualitySwitchableSource || (hasKnownQualityLevels && option.value !== "standard" && !availableLevels.includes(option.value))}
                      onClick={() => onQualityLevelChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
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
      </div>
    </div>
  );
}

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
  visualizerActive,
  onClose,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  videoMode,
  onToggleVideoMode,
  videoControlRef,
  videoUrlOverride,
  videoQualities = [],
  videoQualityId = null,
  onVideoQualityChange,
  onVideoDuration,
  onVideoEnded,
  onVideoError,
  videoActive,
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
  visualizerActive: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  videoMode: boolean;
  onToggleVideoMode: () => void;
  videoControlRef: { current: VideoControl | null };
  videoUrlOverride?: string;
  videoQualities?: Array<{ id: number; label: string }>;
  videoQualityId?: number | null;
  onVideoQualityChange?: (qn: number | null) => void;
  onVideoDuration: (seconds: number) => void;
  onVideoEnded: () => void;
  onVideoError: (message: string) => void;
  videoActive: boolean;
}) {
  const currentTime = usePlaybackTime();
  const resolvedDuration = durationSeconds || parseDuration(activeTrack.duration);
  const progressFraction = resolvedDuration ? Math.min(1, Math.max(0, currentTime / resolvedDuration)) : 0;
  const lyrics = activeTrack.lyrics.length ? activeTrack.lyrics : [{ time: "00:00", text: "暂无歌词" }];
  const activeLyricIndex = getActiveLyricIndex(lyrics, currentTime);
  const visibleLyrics = lyrics.slice(Math.max(0, activeLyricIndex - 2), Math.min(lyrics.length, activeLyricIndex + 6));
  const videoActiveMode = videoMode && Boolean(activeTrack.videoUrl);
  const timeLabel = currentTime > 0 ? formatDuration(currentTime) : "0:00";

  return (
    <motion.div
      className="aria-immersive fixed inset-0 z-[80] overflow-hidden bg-[#07080c] text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
    >
      {videoActiveMode ? (
        <div className="relative h-full w-full bg-black">
          <VideoStage
            track={activeTrack}
            src={videoUrlOverride}
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

          <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-4 p-5 sm:p-7">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">Now playing · Video</p>
              <h1 className="mt-2 max-w-[62vw] truncate text-2xl font-semibold" title={activeTrack.title}>
                {activeTrack.title}
              </h1>
              <p className="mt-1 truncate text-sm text-white/55">{activeTrack.artist} · {activeTrack.album}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {videoQualities.length > 0 && onVideoQualityChange && (
                <select
                  aria-label="视频画质"
                  value={videoQualityId ?? ""}
                  onChange={(event) => onVideoQualityChange(event.target.value ? Number(event.target.value) : null)}
                  className="rounded-full border border-white/20 bg-black/50 px-3 py-1.5 text-xs font-medium text-white outline-none backdrop-blur"
                >
                  <option value="">自动</option>
                  {videoQualities.map((quality) => (
                    <option key={quality.id} value={quality.id}>{quality.label}</option>
                  ))}
                </select>
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

          <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-5xl rounded-[1.5rem] border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
              <input
                aria-label="视频进度"
                type="range"
                min="0"
                max={Math.max(1, resolvedDuration || 0)}
                value={Math.min(currentTime, resolvedDuration || currentTime || 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="player-range w-full"
                style={{ "--range-color": "#ffffff", "--range-value": progressFraction } as CSSProperties}
              />
              <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-white/50">
                <span>{timeLabel}</span>
                <span>{formatDuration(resolvedDuration)}</span>
              </div>
              <div className="mt-3 flex items-center justify-center gap-4">
                <Button className="bg-white/10 text-white hover:bg-white/18" size="icon" aria-label="上一首" onClick={onPrevious}>
                  <AriaIcon name="prev" className="size-5" />
                </Button>
                <Button className="bg-white text-neutral-950 hover:bg-white/90" size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
                  {playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
                </Button>
                <Button className="bg-white/10 text-white hover:bg-white/18" size="icon" aria-label="下一首" onClick={onNext}>
                  <AriaIcon name="next" className="size-5" />
                </Button>
                <div className="ml-4 hidden items-center gap-2 sm:flex">
                  <AriaIcon name={ariaVolumeIcon(volume, false)} className="size-4 text-white/60" />
                  <input
                    aria-label="沉浸音量"
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(event) => onVolumeChange(Number(event.target.value))}
                    className="player-range w-24"
                    style={{ "--range-color": "#ffffff", "--range-value": Math.min(1, Math.max(0, volume / 100)) } as CSSProperties}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative h-full w-full">
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 24% 24%, ${colorWithAlpha(palette.primary, 0.34)} 0, transparent 36%), radial-gradient(circle at 80% 76%, ${colorWithAlpha(palette.secondary, 0.24)} 0, transparent 34%), linear-gradient(125deg, #080910, #10131d 48%, #07080c)`,
            }}
          />
          <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)_auto] px-6 py-6 lg:px-10 2xl:px-14">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/40">Immersive</p>
                <p className="mt-1 truncate text-sm text-white/55">{sourceLabel[activeTrack.source]} · {formatAudioDetail(activeTrack)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activeTrack.videoUrl && (
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
                <div className="size-20 shrink-0 overflow-hidden rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,0.4)] lg:mx-auto lg:aspect-square lg:h-auto lg:w-full lg:max-w-[min(46vh,28rem)] lg:rounded-[2rem] lg:shadow-[0_42px_140px_rgba(0,0,0,0.46)]">
                  <CoverArt track={activeTrack} className="size-full" fit="cover" large />
                </div>
                <div className="min-w-0 lg:hidden">
                  <h1 className="line-clamp-2 text-xl font-semibold leading-tight" title={activeTrack.title}>
                    <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
                  </h1>
                  <p className="mt-1 truncate text-sm text-white/60">
                    <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-white/35">{activeTrack.album}</p>
                </div>
              </div>

              <div className="flex min-h-0 min-w-0 flex-col justify-center overflow-hidden">
                <div className="hidden shrink-0 lg:block">
                  <h1 className="line-clamp-2 text-3xl font-semibold leading-tight 2xl:text-4xl" title={activeTrack.title}>
                    <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
                  </h1>
                  <p className="mt-3 truncate text-lg text-white/65">
                    <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
                  </p>
                  <p className="mt-1 truncate text-sm text-white/35">{activeTrack.album}</p>
                </div>

                <div className="no-scrollbar mt-2 min-h-0 overflow-y-auto pr-2 lg:mt-6">
                  <div className="space-y-1.5">
                    {visibleLyrics.map((line, index) => {
                      const originalIndex = Math.max(0, activeLyricIndex - 2) + index;
                      const active = originalIndex === activeLyricIndex;
                      return (
                        <button
                          key={`${activeTrack.id}-immersive-${line.time}-${line.text}-${originalIndex}`}
                          className={cn(
                            "grid w-full grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-3 py-2 text-left transition",
                            active ? "bg-white/10 text-white" : "text-white/42 hover:bg-white/5 hover:text-white/70",
                          )}
                          onClick={() => onSeek(getLyricStartTime(line))}
                        >
                          <span className={cn("pt-1 text-xs font-medium tabular-nums", active ? "text-white/55" : "text-white/30")}>
                            {line.time}
                          </span>
                          <span className={cn("min-w-0 whitespace-pre-wrap break-words", active ? "text-lg font-semibold leading-7 sm:text-xl sm:leading-8" : "text-sm leading-6")}>
                            <WordLyricText line={line} active={active} currentTime={currentTime} playing={playing} color="#ffffff" pendingColor="rgba(255,255,255,0.38)" />
                            {line.translation && (
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
              <input
                aria-label="沉浸播放进度"
                type="range"
                min="0"
                max={Math.max(1, resolvedDuration || 0)}
                value={Math.min(currentTime, resolvedDuration || currentTime || 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="player-range mt-3 w-full"
                style={{ "--range-color": "#ffffff", "--range-value": progressFraction } as CSSProperties}
              />
              <div className="mt-2 flex items-center justify-between text-xs font-medium text-white/54">
                <span>{timeLabel}</span>
                <span>{formatDuration(resolvedDuration)}</span>
              </div>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button className="bg-white/10 text-white hover:bg-white/18" size="icon" aria-label="上一首" onClick={onPrevious}>
                  <AriaIcon name="prev" className="size-5" />
                </Button>
                <Button className="bg-white text-neutral-950 hover:bg-white/90" size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
                  {playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
                </Button>
                <Button className="bg-white/10 text-white hover:bg-white/18" size="icon" aria-label="下一首" onClick={onNext}>
                  <AriaIcon name="next" className="size-5" />
                </Button>
                <div className="ml-4 hidden items-center gap-2 sm:flex">
                  <AriaIcon name={ariaVolumeIcon(volume, false)} className="size-4 text-white/55" />
                  <input
                    aria-label="沉浸音量"
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(event) => onVolumeChange(Number(event.target.value))}
                    className="player-range w-24"
                    style={{ "--range-color": "#ffffff", "--range-value": Math.min(1, Math.max(0, volume / 100)) } as CSSProperties}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function PlaybackProgress({
  palette,
  durationSeconds,
  activeTrack,
  onSeek,
}: {
  palette: CoverPalette;
  durationSeconds: number;
  activeTrack: Track;
  onSeek: (time: number) => void;
}) {
  const currentTime = usePlaybackTime();
  const resolvedDuration = durationSeconds || parseDuration(activeTrack.duration);
  const progressFraction = resolvedDuration ? Math.min(1, Math.max(0, currentTime / resolvedDuration)) : 0;

  return (
    <div className="mt-3">
      <input
        aria-label="播放进度"
        type="range"
        min="0"
        max={Math.max(1, resolvedDuration || 0)}
        value={Math.min(currentTime, resolvedDuration || currentTime || 0)}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="player-range w-full"
        style={
          {
            "--range-color": palette.primary,
            "--range-value": progressFraction,
          } as CSSProperties
        }
      />
      <div className="mt-2 flex items-center justify-between text-xs font-medium text-neutral-500">
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(resolvedDuration)}</span>
      </div>
    </div>
  );
}
