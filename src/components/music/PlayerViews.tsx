import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { motion } from "framer-motion";
import {
  Copy,
  Heart,
  ImagePlus,
  Maximize2,
  Pause,
  Play,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SpectrumCanvas } from "@/components/music/SpectrumCanvas";
import { CopyableTrackText, CoverArt } from "@/components/music/shared";
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
import { cn } from "@/lib/utils";
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
  onReplaceLocalArtwork,
  liked,
  onToggleLike,
  volume,
  onVolumeChange,
  qualityLevel,
  onQualityLevelChange,
  hifiEnabled,
  exclusiveMode,
  currentTime,
  durationSeconds,
  analyserRef,
  visualizerMode,
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
  onReplaceLocalArtwork: (trackId: string, file: File) => Promise<void>;
  liked: boolean;
  onToggleLike: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  hifiEnabled: boolean;
  exclusiveMode: boolean;
  currentTime: number;
  durationSeconds: number;
  analyserRef: { current: AnalyserNode | null };
  visualizerMode: AudioOutputMode;
  onSeek: (time: number) => void;
}) {
  const themePrimary = colorWithAlpha(palette.primary, 0.34);
  const themeSecondary = colorWithAlpha(palette.secondary, 0.24);
  const themeSoft = colorWithAlpha(palette.primary, 0.12);
  const resolvedQualityLevel = activeTrack.currentLevel ?? qualityLevel;
  const resolvedDuration = durationSeconds || parseDuration(activeTrack.duration);
  const progressPercent = resolvedDuration ? Math.min(100, Math.max(0, (currentTime / resolvedDuration) * 100)) : 0;
  const [artworkMenuPosition, setArtworkMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const artworkFileInputRef = useRef<HTMLInputElement | null>(null);
  const canReplaceArtwork = activeTrack.source === "local";

  useEffect(() => {
    setArtworkMenuPosition(null);
  }, [activeTrack.id]);

  useEffect(() => {
    if (!artworkMenuPosition) return;
    const closeMenu = () => setArtworkMenuPosition(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [artworkMenuPosition]);

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

  return (
    <div
      className="relative h-full min-h-[620px] overflow-hidden rounded-[1.5rem] border border-white/55 shadow-[0_22px_70px_rgba(47,55,76,0.12)] 2xl:min-h-[calc(100vh-7.5rem)]"
      style={{
        ["--track-accent" as string]: palette.primary,
        background: `linear-gradient(135deg, ${themePrimary}, rgba(255,255,255,0.26) 42%, ${themeSecondary})`,
      }}
    >
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
      <div className="relative grid h-full min-h-[620px] lg:grid-cols-[minmax(360px,0.9fr)_minmax(460px,1.1fr)] 2xl:grid-cols-[minmax(520px,0.95fr)_minmax(680px,1.05fr)]">
        <div
          className="relative min-h-[420px] overflow-hidden bg-neutral-950"
          style={{
            background: `linear-gradient(145deg, ${palette.primary}30, ${palette.secondary}18, rgba(255,255,255,0.48))`,
          }}
        >
          <div
            className="absolute inset-0 opacity-18 blur-3xl scale-110"
            style={{ background: activeTrack.cover }}
          />
          <motion.div
            key={`artwork-${activeTrack.id}`}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.42 }}
            className="absolute inset-0"
          >
            <CoverArt
              track={activeTrack}
              className="size-full"
              fit="cover"
              large
              onArtworkContextMenu={openArtworkMenu}
            />
          </motion.div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/6 via-transparent to-black/10" />
        </div>

        <div
          className="flex min-h-0 flex-col justify-between p-5 sm:p-8 2xl:p-10"
          style={{ background: `linear-gradient(160deg, rgba(255,255,255,0.36), ${themeSoft} 48%, ${themeSecondary})` }}
        >
          <div className="min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{sourceLabel[activeTrack.source]}</Badge>
              <Badge>{formatAudioDetail(activeTrack, resolvedQualityLevel)}</Badge>
              <Badge>{activeTrack.duration}</Badge>
              {hifiEnabled && <Badge>HiFi</Badge>}
              {exclusiveMode && <Badge>直通</Badge>}
              <Button variant="glass" size="sm" onClick={onOpenImmersive}>
                <Maximize2 />
                沉浸
              </Button>
            </div>
            <h1 className="mt-6 line-clamp-3 max-w-[min(100%,42rem)] overflow-hidden break-words text-[clamp(2rem,4vw,4.3rem)] font-semibold leading-[1.03] text-neutral-950 [overflow-wrap:anywhere]">
              <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
            </h1>
            <p className="mt-3 truncate text-xl text-neutral-500">
              <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
            </p>
            <p className="mt-1 text-sm text-neutral-400">{activeTrack.album}</p>
          </div>

          <div className="mt-4">
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
              <div className="mt-3">
              <input
                aria-label="播放进度"
                type="range"
                min="0"
                max={Math.max(1, durationSeconds || 0)}
                value={Math.min(currentTime, durationSeconds || currentTime || 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="player-range w-full"
                style={
                  {
                    "--range-color": palette.primary,
                    "--range-value": `${progressPercent}%`,
                  } as CSSProperties
                }
              />
              <div className="mt-2 flex items-center justify-between text-xs font-medium text-neutral-500">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(durationSeconds || parseDuration(activeTrack.duration))}</span>
              </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 rounded-full bg-white/78 p-2 shadow-[0_14px_42px_rgba(47,55,76,0.12)]">
                  <Button
                    variant={shuffleEnabled ? "default" : "ghost"}
                    size="icon"
                    aria-label="随机播放"
                    onClick={onToggleShuffle}
                  >
                    <Shuffle />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="上一首" onClick={onPrevious}>
                    <SkipBack />
                  </Button>
                  <Button size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
                    {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="下一首" onClick={onNext}>
                    <SkipForward />
                  </Button>
                  <Button
                    className="relative rounded-full"
                    variant={repeatMode === "one" ? "default" : "ghost"}
                    size="icon"
                    aria-label="循环播放"
                    onClick={onCycleRepeatMode}
                  >
                    <Repeat2 />
                    {repeatMode === "one" && <span className="absolute right-1 top-1 text-[10px] font-semibold">1</span>}
                  </Button>
                  <Button
                    variant={liked ? "default" : "ghost"}
                    size="icon"
                    aria-label={liked ? "取消喜欢" : "喜欢"}
                    onClick={onToggleLike}
                  >
                    <Heart className={cn(liked && "fill-current")} />
                  </Button>
                </div>
                <div className="flex min-w-0 items-center gap-3 rounded-full bg-white/78 px-4 py-3 shadow-[0_14px_42px_rgba(47,55,76,0.1)]">
                  <Volume2 className="size-4 text-neutral-500" />
                  <input
                    aria-label="音量"
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(event) => onVolumeChange(Number(event.target.value))}
                    className="player-range w-36"
                    style={
                      {
                        "--range-color": palette.primary,
                        "--range-value": `${volume}%`,
                      } as CSSProperties
                    }
                  />
                  <span className="w-8 text-right text-xs font-medium text-neutral-500">{volume}</span>
                </div>
              </div>
            </div>

            <div
              className="mt-3 rounded-[1.25rem] border border-white/35 p-3 shadow-sm"
              style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.28), ${colorWithAlpha(palette.secondary, 0.1)})` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Quality</p>
                <div className="flex items-center gap-2">
                  {hifiEnabled && <Badge>HiFi 优先</Badge>}
                  <div className="flex flex-wrap gap-1 rounded-full bg-white/60 p-1">
                  {qualityOptions.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
                        resolvedQualityLevel === option.value && "bg-neutral-950 text-white shadow-sm",
                        (activeTrack.source !== "netease" || !activeTrack.availableLevels?.includes(option.value)) && "opacity-45",
                      )}
                      disabled={activeTrack.source !== "netease" || !activeTrack.availableLevels?.includes(option.value)}
                      onClick={() => onQualityLevelChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
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
  currentTime,
  durationSeconds,
  analyserRef,
  visualizerMode,
  volume,
  visualizerActive,
  onClose,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
}: {
  activeTrack: Track;
  palette: CoverPalette;
  playing: boolean;
  visualizerPlaying: boolean;
  currentTime: number;
  durationSeconds: number;
  analyserRef: { current: AnalyserNode | null };
  visualizerMode: AudioOutputMode;
  volume: number;
  visualizerActive: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
}) {
  const resolvedDuration = durationSeconds || parseDuration(activeTrack.duration);
  const progressPercent = resolvedDuration ? Math.min(100, Math.max(0, (currentTime / resolvedDuration) * 100)) : 0;
  const lyricLines = activeTrack.lyrics.length ? activeTrack.lyrics : [{ time: "00:00", text: "暂无歌词" }];
  const activeLyricIndex = getActiveLyricIndex(lyricLines, currentTime);
  const immersiveLyricLines = lyricLines.slice(Math.max(0, activeLyricIndex - 2), Math.min(lyricLines.length, activeLyricIndex + 5));

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-hidden bg-neutral-950 text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 24% 28%, ${colorWithAlpha(palette.primary, 0.24)} 0, transparent 34%), radial-gradient(circle at 78% 72%, ${colorWithAlpha(palette.secondary, 0.18)} 0, transparent 30%), linear-gradient(110deg, rgba(0,0,0,0.86), ${colorWithAlpha(palette.primary, 0.36)} 48%, rgba(0,0,0,0.8))`,
        }}
      />

      <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] px-8 py-6 2xl:px-14">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/48">Immersive</p>
            <p className="mt-1 text-sm text-white/62">{sourceLabel[activeTrack.source]} · {formatAudioDetail(activeTrack)}</p>
          </div>
          <Button className="bg-white text-neutral-950 hover:bg-white/90" size="icon" aria-label="关闭沉浸视图" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="grid min-h-0 items-center gap-8 lg:grid-cols-[minmax(360px,0.86fr)_minmax(0,1.14fr)]">
          <motion.div
            key={activeTrack.id}
            className="mx-auto aspect-square w-[min(68vh,560px)] overflow-hidden rounded-[2rem] shadow-[0_42px_140px_rgba(0,0,0,0.46)]"
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.38 }}
          >
            <CoverArt track={activeTrack} className="size-full" fit="cover" large />
          </motion.div>

          <div className="min-w-0 overflow-hidden">
            <h1 className="line-clamp-3 max-w-[min(100%,58rem)] overflow-hidden break-words text-[clamp(2.25rem,5.2vw,6.2rem)] font-semibold leading-[0.98] tracking-normal [overflow-wrap:anywhere]">
              <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
            </h1>
            <p className="mt-5 truncate text-2xl text-white/68">
              <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
            </p>
            <p className="mt-2 truncate text-lg text-white/42">{activeTrack.album}</p>
            <div className="no-scrollbar mt-8 max-h-[34vh] max-w-5xl overflow-y-auto pr-2">
              <div className="space-y-2">
                {immersiveLyricLines.map((line, index) => {
                  const originalIndex = Math.max(0, activeLyricIndex - 2) + index;
                  const active = originalIndex === activeLyricIndex;
                  return (
                    <motion.button
                      key={`${activeTrack.id}-immersive-${line.time}-${line.text}-${originalIndex}`}
                      className={cn(
                        "grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-4 rounded-3xl px-4 py-3 text-left transition",
                        active ? "bg-white/12 text-white" : "text-white/48 hover:bg-white/8 hover:text-white/72",
                      )}
                      initial={false}
                      animate={{ opacity: active ? 1 : 0.68, y: active ? 0 : 2 }}
                      onClick={() => onSeek(parseDuration(line.time))}
                    >
                      <span className={cn("pt-1 text-sm font-medium", active ? "text-white/70" : "text-white/34")}>
                        {line.time}
                      </span>
                      <span className={cn("whitespace-pre-wrap break-words leading-relaxed", active ? "text-4xl font-semibold" : "text-xl")}>
                        {line.text || "♪"}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl">
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
            style={
              {
                "--range-color": "#ffffff",
                "--range-value": `${progressPercent}%`,
              } as CSSProperties
            }
          />
          <div className="mt-2 flex items-center justify-between text-xs font-medium text-white/54">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(resolvedDuration)}</span>
          </div>
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button className="bg-white/12 text-white hover:bg-white/18" size="icon" aria-label="上一首" onClick={onPrevious}>
              <SkipBack />
            </Button>
            <Button className="bg-white text-neutral-950 hover:bg-white/90" size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
              {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
            </Button>
            <Button className="bg-white/12 text-white hover:bg-white/18" size="icon" aria-label="下一首" onClick={onNext}>
              <SkipForward />
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}


