import { useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { CopyableTrackText, CoverArt, EmptyState } from "@/components/music/shared";
import type { Track } from "@/data/music";
import { usePlaybackTime } from "@/lib/playbackClock";
import {
  colorWithAlpha,
  formatAudioDetail,
  getActiveLyricIndex,
  parseDuration,
  type CoverPalette,
} from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
export function QueueList({
  tracks,
  activeTrackId,
  onPickTrack,
}: {
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string) => void;
}) {
  const displayTracks = useMemo(() => {
    const firstTracks = tracks.slice(0, 48);
    if (firstTracks.some((track) => track.id === activeTrackId)) return firstTracks;
    const activeTrack = tracks.find((track) => track.id === activeTrackId);
    return activeTrack ? [activeTrack, ...firstTracks.slice(0, 47)] : firstTracks;
  }, [activeTrackId, tracks]);
  const hiddenCount = Math.max(0, tracks.length - displayTracks.length);

  return (
    <div className="no-scrollbar relative mt-4 flex-1 space-y-2 overflow-y-auto">
      {displayTracks.map((track) => (
        <button
          key={track.id}
          className={cn(
            "flex w-full items-center gap-3 rounded-3xl p-2 text-left transition hover:bg-white/65",
            activeTrackId === track.id && "bg-white shadow-sm",
          )}
          onClick={() => onPickTrack(track.id)}
        >
          <CoverArt track={track} className="size-14 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
            </p>
            <p className="truncate text-xs text-neutral-500">
              <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
            </p>
          </div>
          <Badge className="shrink-0">{formatAudioDetail(track)}</Badge>
        </button>
      ))}
      {hiddenCount > 0 && (
        <div className="rounded-2xl bg-white/45 px-3 py-2 text-center text-xs text-neutral-500">
          还有 {hiddenCount} 首，使用搜索快速定位
        </div>
      )}
      {!tracks.length && <EmptyState text="暂无队列，先扫描本地目录或同步网易云。" />}
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
  tracks,
  activeTrackId,
  onPickTrack,
  onSeek,
}: {
  mode: "lyrics" | "queue";
  onModeChange: (mode: "lyrics" | "queue") => void;
  track: Track;
  palette: CoverPalette;
  lyricDisplayMode: "original" | "bilingual";
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string) => void;
  onSeek: (time: number) => void;
}) {
  return (
    <aside className="glass hidden min-h-0 flex-col rounded-[1.5rem] p-4 lg:flex">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">
            {mode === "lyrics" ? "Lyrics" : "Queue"}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{mode === "lyrics" ? "同步歌词" : "下一首"}</h2>
        </div>
        <div className="flex rounded-full bg-white/60 p-1 shadow-sm">
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
          onSeek={onSeek}
        />
      ) : (
        <QueueList tracks={tracks} activeTrackId={activeTrackId} onPickTrack={onPickTrack} />
      )}
    </aside>
  );
}

function SidebarLyrics({
  track,
  palette,
  lyricDisplayMode,
  onSeek,
}: {
  track: Track;
  palette: CoverPalette;
  lyricDisplayMode: "original" | "bilingual";
  onSeek: (time: number) => void;
}) {
  const currentTime = usePlaybackTime();
  const activeLyricIndex = getActiveLyricIndex(track.lyrics, currentTime);
  const lines = track.lyrics;
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
    <div className="relative mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] bg-white p-4 shadow-sm">
      <div className="relative z-10 mb-3 min-w-0">
        <p className="truncate text-sm font-semibold">
          <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
        </p>
        <p className="truncate text-xs text-neutral-500">
          <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
        </p>
      </div>
      <div
        className="no-scrollbar relative z-10 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
        onWheel={holdManualScroll}
        onTouchStart={holdManualScroll}
        onPointerDown={holdManualScroll}
      >
        <div className="h-12 shrink-0" />
        {track.lyrics.map((line, index) => {
          const active = index === activeLyricIndex;
          return (
            <button
              key={`${track.id}-${line.time}-${line.text}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node;
              }}
              className={cn(
                "grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-3 py-2 text-left text-neutral-500 transition hover:bg-neutral-950/[0.04]",
                active && "text-neutral-950 shadow-sm",
              )}
              style={active ? { backgroundColor: `${palette.primary}18` } : undefined}
              onClick={() => {
                manualScrollUntilRef.current = 0;
                onSeek(parseDuration(line.time));
              }}
            >
              <span className="text-sm font-medium text-neutral-400">{line.time}</span>
              <span className={cn("min-w-0 whitespace-pre-wrap break-words leading-7", active ? "text-2xl font-semibold" : "text-base")}>
                {line.text}
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
      </div>
    </div>
  );
}

