import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ListEnd, Trash2 } from "lucide-react";
import { AriaIcon } from "@/components/icons/aria";
import { CopyableTrackText, CoverArt, EmptyState } from "@/components/music/shared";
import { SourceLogo } from "@/components/music/SourceLogos";
import type { Track } from "@/data/music";
import { BILIBILI_LYRICS_ENABLED } from "@/lib/features";
import { normalizeBilingualLyrics } from "@/lib/lyricNormalize";
import { getPlaybackTime, subscribePlaybackTime } from "@/lib/playbackClock";
import {
  colorWithAlpha,
  formatAudioDetail,
  getActiveLyricIndex,
  type CoverPalette,
} from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
import { WordLyricText } from "./WordLyricText";
import { getLyricStartTime } from "@/lib/lyricTiming";
export function QueueList({
  tracks,
  activeTrackId,
  playing = false,
  onPickTrack,
  onPlayNext,
  onRemove,
  onMove,
}: {
  tracks: Track[];
  activeTrackId: string;
  playing?: boolean;
  onPickTrack: (id: string) => void;
  onPlayNext?: (id: string) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, direction: "up" | "down") => void;
}) {
  const displayTracks = useMemo(() => {
    const firstTracks = tracks.slice(0, 24);
    if (firstTracks.some((track) => track.id === activeTrackId)) return firstTracks;
    const activeTrack = tracks.find((track) => track.id === activeTrackId);
    return activeTrack ? [activeTrack, ...firstTracks.slice(0, 23)] : firstTracks;
  }, [activeTrackId, tracks]);
  const hiddenCount = Math.max(0, tracks.length - displayTracks.length);

  return (
    <div className="no-scrollbar relative mt-4 flex-1 space-y-2 overflow-y-auto">
      {displayTracks.map((track) => (
        <div
          key={track.id}
          className={cn(
            "group relative flex w-full items-center rounded-2xl p-2 text-left transition hover:bg-white/65",
            activeTrackId === track.id && "bg-white/75",
          )}
        >
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onPickTrack(track.id)}>
            <CoverArt track={track} className="size-14 rounded-2xl" />
            <div className="min-w-0 flex-1">
              {/* Actions float above the row instead of reserving ~130px of
                  transparent width, so song names can use the full sidebar. */}
              <p className="min-w-0 truncate text-sm font-semibold leading-5" title={track.title}>
                <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
              </p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                <SourceLogo source={track.source} className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">
                  <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                </span>
                <span className="shrink-0 whitespace-nowrap text-neutral-400" title={formatAudioDetail(track)}>· {formatAudioDetail(track)}</span>
              </p>
            </div>
            {activeTrackId === track.id && playing && (
              <AriaIcon name="playing" className="mr-1.5 size-4 shrink-0 text-[var(--accent)]" />
            )}
          </button>
          <div className="pointer-events-none absolute right-2 top-1/2 z-10 flex max-w-[calc(100%-1rem)] -translate-y-1/2 flex-wrap items-center justify-end gap-0.5 rounded-full bg-white/95 p-0.5 opacity-0 shadow-md ring-1 ring-black/5 transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
            {onPlayNext && track.id !== activeTrackId && (
              <button
                type="button"
                className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white hover:text-neutral-950"
                title="下一首播放"
                aria-label={`下一首播放：${track.title}`}
                onClick={() => onPlayNext(track.id)}
              >
                <ListEnd className="size-3.5" />
              </button>
            )}
            {onMove && track.id !== activeTrackId && (
              <>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white hover:text-neutral-950"
                  title="上移"
                  aria-label={`上移：${track.title}`}
                  onClick={() => onMove(track.id, "up")}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white hover:text-neutral-950"
                  title="下移"
                  aria-label={`下移：${track.title}`}
                  onClick={() => onMove(track.id, "down")}
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </>
            )}
            {onRemove && track.id !== activeTrackId && (
              <button
                type="button"
                className="rounded-full p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                title="移出队列"
                aria-label={`移出队列：${track.title}`}
                onClick={() => onRemove(track.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="rounded-2xl bg-white/45 px-3 py-2 text-center text-xs text-neutral-500">
          还有 {hiddenCount} 首，使用搜索快速定位
        </div>
      )}
      {!tracks.length && <EmptyState text="暂无队列，先扫描本地目录或登录在线音源。" />}
      <div className="pointer-events-none sticky bottom-0 h-10 bg-gradient-to-t from-white/70 to-transparent" />
    </div>
  );
}

export function PlayerSidePanel({
  mode,
  onModeChange,
  track,
  palette,
  lyricDisplayMode,
  playing = false,
  tracks,
  activeTrackId,
  onPickTrack,
  onSeek,
  onPlayNext,
  onRemove,
  onMove,
}: {
  mode: "lyrics" | "queue";
  onModeChange: (mode: "lyrics" | "queue") => void;
  track: Track;
  palette: CoverPalette;
  lyricDisplayMode: "original" | "bilingual";
  playing?: boolean;
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string) => void;
  onSeek: (time: number) => void;
  onPlayNext?: (id: string) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <aside className="glass hidden min-h-0 min-w-0 flex-col rounded-[1.5rem] p-4 lg:flex">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-950/6 pb-3">
        <h2 className="text-base font-semibold tracking-tight">{mode === "lyrics" ? (track.lyrics.some((line) => line.words?.length) ? "逐字歌词" : "同步歌词") : "下一首"}</h2>
        <div className="flex rounded-full bg-neutral-950/[0.045] p-0.5">
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
              mode === "lyrics" && "bg-neutral-950 text-white",
            )}
            onClick={() => onModeChange("lyrics")}
          >
            歌词
          </button>
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
              mode === "queue" && "bg-neutral-950 text-white",
            )}
            onClick={() => onModeChange("queue")}
          >
            下一首
          </button>
        </div>
      </div>

      {mode === "lyrics" ? (
        <SidebarLyrics
          track={track}
          palette={palette}
          lyricDisplayMode={lyricDisplayMode}
          playing={playing}
          onSeek={onSeek}
        />
      ) : (
        <QueueList
          tracks={tracks}
          activeTrackId={activeTrackId}
          playing={playing}
          onPickTrack={onPickTrack}
          onPlayNext={onPlayNext}
          onRemove={onRemove}
          onMove={onMove}
        />
      )}
    </aside>
  );
}

function SidebarLyrics({
  track,
  palette,
  lyricDisplayMode,
  playing,
  onSeek,
}: {
  track: Track;
  palette: CoverPalette;
  lyricDisplayMode: "original" | "bilingual";
  playing: boolean;
  onSeek: (time: number) => void;
}) {
  const bilibiliLyricsOff = track.source === "bilibili" && !BILIBILI_LYRICS_ENABLED;
  const lines = useMemo(
    () => (bilibiliLyricsOff ? [] : normalizeBilingualLyrics(track.lyrics)),
    [bilibiliLyricsOff, track.lyrics],
  );
  const activeLyricIndex = useSyncExternalStore(
    subscribePlaybackTime,
    () => getActiveLyricIndex(lines, getPlaybackTime()),
    () => getActiveLyricIndex(lines, getPlaybackTime()),
  );
  const showPlaceholderLyrics = !(track.source === "bilibili" && (!BILIBILI_LYRICS_ENABLED || track.lyricStatus !== "linked"));
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const manualScrollUntilRef = useRef(0);

  useEffect(() => {
    if (Date.now() < manualScrollUntilRef.current) return;
    lineRefs.current[activeLyricIndex]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLyricIndex, track.id]);

  const holdManualScroll = () => {
    manualScrollUntilRef.current = Date.now() + 3500;
  };

  return (
    <div className="relative mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative z-10 mb-2.5 min-w-0 px-1">
        <p className="min-w-0 truncate text-sm font-semibold leading-5" title={track.title}>
          <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
        </p>
        <p className="truncate text-xs text-neutral-500" title={track.artist}>
          <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
        </p>
      </div>
      {bilibiliLyricsOff ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 text-center">
          <p className="text-sm font-medium text-neutral-500">B站曲目默认不加载歌词</p>
          <p className="mt-1.5 text-xs text-neutral-400">可点击右上角「下一首」查看待播队列，或点左上角摄像机开启实时视频。</p>
        </div>
      ) : (
        <div
          className="aria-lyric-scroll no-scrollbar relative z-10 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
          onWheel={holdManualScroll}
          onTouchStart={holdManualScroll}
          onPointerDown={holdManualScroll}
        >
          <div className="h-14 shrink-0" />
          {showPlaceholderLyrics && lines.map((line, index) => {
            const active = index === activeLyricIndex;
            const distance = activeLyricIndex >= 0 ? Math.abs(index - activeLyricIndex) : 0;
            const depthStyle: CSSProperties | undefined = active
              ? { backgroundColor: `${palette.primary}18` }
              : activeLyricIndex >= 0
                ? { opacity: distance === 1 ? 0.72 : distance === 2 ? 0.48 : 0.28 }
                : undefined;
            return (
              <button
                key={`${track.id}-${line.time}-${line.text}-${index}`}
                ref={(node) => {
                  lineRefs.current[index] = node;
                }}
                className={cn(
                  "aria-lyric-line grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-3 py-2 text-left text-neutral-500 hover:bg-neutral-950/[0.04]",
                  active && "is-active text-neutral-950 shadow-sm",
                )}
                style={depthStyle}
                onClick={() => {
                  manualScrollUntilRef.current = 0;
                  onSeek(getLyricStartTime(line));
                }}
              >
                <span className="pt-0.5 text-xs font-medium tabular-nums text-neutral-400">{line.time}</span>
                <span className={cn("min-w-0 whitespace-pre-wrap break-words leading-7 transition-all duration-200", active ? "text-2xl font-semibold" : "text-base")}>
                  <WordLyricText line={line} active={active} playing={playing} color={palette.primary} />
                  {lyricDisplayMode === "bilingual" && line.translation && (
                    <span className={cn("mt-1 block text-sm font-medium leading-6", active ? "text-neutral-600" : "text-neutral-400")}>
                      {line.translation}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {!lines.length && <p className="text-center text-sm text-neutral-500">歌词同步中</p>}
          <div className="h-14 shrink-0" />
        </div>
      )}
    </div>
  );
}

