import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Clock3, Disc3, Headphones, Maximize2, Music2, Pause, Play, X } from "lucide-react";
import { CopyableTrackText, CoverArt } from "@/components/music/shared";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import { formatBitrate, parseDuration, qualityOptions } from "@/lib/playerPresentation";
import type { Track, ViewId } from "@/data/music";
import { cn } from "@/lib/utils";
// 根目录的 meow 线稿：用 CSS mask 上色，深浅主题切换时人物颜色会跟着变。
import meowArtwork from "../../../meow.png";

const DAY_MS = 86_400_000;

function startOfDay(value: Date | number = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function playedAtLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = startOfDay();
  const clock = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (timestamp >= today) return `今天 ${clock}`;
  if (timestamp >= today - DAY_MS) return `昨天 ${clock}`;
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function formatListeningTime(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

type HeatmapDay = {
  date: number;
  count: number;
  seconds: number;
  future: boolean;
};

type ListeningSnapshot = {
  today: PlayHistoryEntry[];
  week: PlayHistoryEntry[];
  todaySeconds: number;
  weekSeconds: number;
  activity: number[];
  activityGrid: HeatmapDay[];
  activityTotal: number;
};

const heatmapWeeks = 53;

function buildListeningSnapshot(history: PlayHistoryEntry[]): ListeningSnapshot {
  const todayStart = startOfDay();
  const weekStart = todayStart - 6 * DAY_MS;
  const today = history.filter((entry) => entry.playedAt >= todayStart).sort((a, b) => b.playedAt - a.playedAt);
  const week = history.filter((entry) => entry.playedAt >= weekStart).sort((a, b) => b.playedAt - a.playedAt);
  const activity = Array.from({ length: 6 }, () => 0);
  today.forEach((entry) => {
    const bucket = Math.max(0, Math.min(5, Math.floor(new Date(entry.playedAt).getHours() / 4)));
    activity[bucket] += 1;
  });
  const duration = (entries: PlayHistoryEntry[]) => entries.reduce((total, entry) => total + parseDuration(entry.track.duration), 0);

  // A GitHub-style contribution grid: 26 full weeks ending on this week's
  // Saturday, with Sunday as the first row.
  const weekday = new Date(todayStart).getDay();
  const gridEnd = todayStart + (6 - weekday) * DAY_MS;
  const gridStart = gridEnd - (heatmapWeeks * 7 - 1) * DAY_MS;
  const buckets = new Map<number, { count: number; seconds: number }>();
  let activityTotal = 0;
  for (const entry of history) {
    const day = startOfDay(entry.playedAt);
    if (day < gridStart || day > gridEnd) continue;
    const bucket = buckets.get(day) ?? { count: 0, seconds: 0 };
    bucket.count += 1;
    bucket.seconds += parseDuration(entry.track.duration);
    buckets.set(day, bucket);
    activityTotal += 1;
  }
  const activityGrid = Array.from({ length: heatmapWeeks * 7 }, (_, index) => {
    const date = gridStart + index * DAY_MS;
    const bucket = buckets.get(date);
    return {
      date,
      count: bucket?.count ?? 0,
      seconds: bucket?.seconds ?? 0,
      future: date > todayStart,
    } satisfies HeatmapDay;
  });

  return { today, week, todaySeconds: duration(today), weekSeconds: duration(week), activity, activityGrid, activityTotal };
}

function heatmapLevel(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function ListeningHeatmapDialog({ snapshot, onClose }: { snapshot: ListeningSnapshot; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<{ x: number; left: number } | null>(null);
  const weeks = useMemo(() => {
    const columns: HeatmapDay[][] = [];
    for (let index = 0; index < snapshot.activityGrid.length; index += 7) {
      columns.push(snapshot.activityGrid.slice(index, index + 7));
    }
    return columns;
  }, [snapshot.activityGrid]);
  const monthLabels = useMemo(
    () =>
      weeks.map((days, index) => {
        const first = new Date(days[0]?.date ?? Date.now());
        if (index === 0) return `${first.getMonth() + 1}月`;
        const previous = new Date(weeks[index - 1]?.[0]?.date ?? Date.now());
        return first.getMonth() !== previous.getMonth() ? `${first.getMonth() + 1}月` : "";
      }),
    [weeks],
  );
  const start = new Date(snapshot.activityGrid[0]?.date ?? Date.now());
  const end = new Date(snapshot.activityGrid[snapshot.activityGrid.length - 1]?.date ?? Date.now());
  const endDrag = (element: HTMLDivElement, pointerId: number) => {
    dragRef.current = null;
    try {
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (touch cancel); nothing else to do.
    }
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="full-heatmap-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-start justify-end border-0 bg-black/30 p-4 pt-20 backdrop-blur-sm backdrop:bg-transparent sm:pt-24 sm:pr-8"
    >
      <section className="w-full max-w-[860px] rounded-[1.75rem] border border-white/70 bg-[#faf9fd] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-400">Activity</span>
            <h2 id="full-heatmap-title" className="mt-1 text-2xl font-semibold text-neutral-900">全年聆听活动</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {start.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} — {end.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} · {snapshot.activityTotal} 次播放
            </p>
          </div>
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900"
            aria-label="关闭全年聆听活动"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          className="no-scrollbar mt-5 cursor-grab touch-pan-y select-none overflow-x-auto pb-1 active:cursor-grabbing"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            dragRef.current = { x: event.clientX, left: event.currentTarget.scrollLeft };
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic/expired pointers can reject capture; dragging still
              // works while the pointer stays over the grid.
            }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
          }}
          onPointerUp={(event) => endDrag(event.currentTarget, event.pointerId)}
          onPointerCancel={(event) => endDrag(event.currentTarget, event.pointerId)}
        >
          <div className="w-max">
            <div className="mb-1 flex gap-1 pl-[22px]">
              {monthLabels.map((label, index) => (
                <span key={`${label}-${index}`} className="w-3 text-[8px] font-medium text-neutral-400">{label}</span>
              ))}
            </div>
            <div className="flex gap-1">
              <div className="grid grid-rows-7 gap-1 pr-1 text-[8px] text-neutral-400">
                {["日", "一", "二", "三", "四", "五", "六"].map((label, index) => (
                  <span key={label} className="flex h-3 items-center justify-end">{index % 2 === 1 ? label : ""}</span>
                ))}
              </div>
              <div className="grid grid-flow-col grid-rows-7 gap-1" aria-label="全年聆听活动">
                {snapshot.activityGrid.map((day) => {
                  const level = heatmapLevel(day.count);
                  return (
                    <span
                      key={day.date}
                      title={`${new Date(day.date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} · ${day.count} 次播放 · ${formatListeningTime(day.seconds)}`}
                      className={cn(
                        "size-3 rounded-[3px]",
                        day.future && "opacity-25",
                        level === 0 && "bg-neutral-200/65",
                        level === 1 && "bg-emerald-200/90",
                        level === 2 && "bg-emerald-300",
                        level === 3 && "bg-emerald-500",
                        level === 4 && "bg-emerald-700",
                      )}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200/70 pt-3 text-[10px] text-neutral-400">
          <span>按住拖动查看全年 · 12 个月</span>
          <span className="flex items-center gap-1">
            少
            <i className="size-2.5 rounded-[2px] bg-neutral-200/65" />
            <i className="size-2.5 rounded-[2px] bg-emerald-200/90" />
            <i className="size-2.5 rounded-[2px] bg-emerald-300" />
            <i className="size-2.5 rounded-[2px] bg-emerald-500" />
            <i className="size-2.5 rounded-[2px] bg-emerald-700" />
            多
          </span>
        </div>
      </section>
    </dialog>
  );
}

function TodayListening({ snapshot, onOpenHeatmap }: { snapshot: ListeningSnapshot; onOpenHeatmap: () => void }) {
  const latest = snapshot.today[0];
  const maxActivity = Math.max(1, ...snapshot.activity);
  const labels = ["00", "04", "08", "12", "16", "20"];
  return (
    <aside className="home-today" aria-labelledby="home-today-title">
      <div className="home-today-heading">
        <div><span className="home-eyebrow">LISTENING LOG</span><h2 id="home-today-title">今日聆听</h2></div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="home-heatmap-expand"
            aria-label="查看全年聆听活动"
            title="查看全年聆听活动"
            onClick={onOpenHeatmap}
          >
            <Maximize2 aria-hidden="true" />
          </button>
          <span className="home-today-icon" aria-hidden="true"><Headphones /></span>
        </div>
      </div>
      <div className="home-today-primary">
        <div><strong>{snapshot.today.length}</strong><span>首记录</span></div>
        <div><strong>{formatListeningTime(snapshot.todaySeconds)}</strong><span>记录时长</span></div>
      </div>
      <div className="home-today-period"><span><CalendarDays aria-hidden="true" /> 本周</span><strong>{snapshot.week.length} 首 · {formatListeningTime(snapshot.weekSeconds)}</strong></div>
      <div className="home-today-activity">
        <div className="home-today-activity-heading"><span>聆听分布</span><span>{latest ? `最近 ${playedAtLabel(latest.playedAt)}` : "等待第一首歌"}</span></div>
        <div className="home-activity-bars" aria-label="今天的聆听时间分布">
          {snapshot.activity.map((value, index) => (
            <span key={labels[index]} className="home-activity-bar-wrap">
              <span
                className="home-activity-bar"
                style={{ height: `${Math.max(value ? 18 : 7, (value / maxActivity) * 100)}%` }}
                title={`${labels[index]} 点时段 · ${value} 首`}
              />
            </span>
          ))}
        </div>
        <div className="home-activity-labels" aria-hidden="true">
          {labels.map((label) => <span key={label}>{label}</span>)}
        </div>
      </div>
      <p className="home-today-note"><Clock3 aria-hidden="true" />{latest ? "按最近播放记录估算，重复播放会合并到歌曲记录。" : "播放一首歌后，这里会留下今天的聆听轨迹。"}</p>
      <div className="home-character" aria-hidden="true">
        <span
          className="home-character-art"
          style={{
            WebkitMaskImage: `url("${meowArtwork}")`,
            maskImage: `url("${meowArtwork}")`,
          }}
        />
      </div>
    </aside>
  );
}

export function HomeSurface({
  activeTrack,
  playHistory,
  playing,
  onTogglePlay,
  onPickTrack,
  onOpenPlayer,
  onNavigate,
}: {
  activeTrack: Track;
  playHistory: PlayHistoryEntry[];
  playing: boolean;
  onTogglePlay: () => void;
  onPickTrack: (id: string) => void;
  onOpenPlayer: () => void;
  onNavigate: (id: ViewId) => void;
}) {
  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    return [...playHistory].sort((a, b) => b.playedAt - a.playedAt).filter(({ track }) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    }).slice(0, 6);
  }, [playHistory]);
  const snapshot = useMemo(() => buildListeningSnapshot(playHistory), [playHistory]);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "GOOD MORNING" : hour < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const hasTrack = activeTrack.id !== "idle";
  const qualityLabel = qualityOptions.find((option) => option.value === activeTrack.currentLevel)?.label ?? activeTrack.quality;
  const bitrateLabel = formatBitrate(activeTrack.bitrate, false) ?? "码率 —";

  return (
    <div className="home-dashboard">
      <div className="home-ambient" aria-hidden="true" />
      <div className="home-content">
        <div className="home-primary-layout">
          <div className="home-main-column">
            <section className="home-hero" aria-label="音乐从这里开始">
              <div className="home-hero-copy">
                <p className="home-greeting"><span className="home-greeting-mark" />{greeting}</p>
                <h1 className="home-hero-title">音乐从这里开始。</h1>
                <p className="home-hero-subtitle">愿今天的你，也能被喜欢的旋律温柔以待。</p>
                <p className="home-hero-caption">YOUR LISTENING SPACE</p>
              </div>
              <div className="home-song-card">
                <div className="home-song-poster" aria-hidden="true">{hasTrack ? <CoverArt track={activeTrack} className="size-full" /> : <Music2 />}</div>
                <div className="home-song-poster-shade" aria-hidden="true" />
                <div className="home-song-row">
                  <button className="home-song-info" onClick={hasTrack ? onOpenPlayer : () => onNavigate("local")} aria-label={hasTrack ? "打开正在播放" : "打开本地音乐"}>
                    <span className="home-song-meta"><strong>{hasTrack ? <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText> : "挑一首喜欢的歌"}</strong><span>{hasTrack ? <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText> : "让音乐陪你一会儿"}</span></span>
                  </button>
                  <button className="home-song-play" onClick={hasTrack ? onTogglePlay : () => onNavigate("local")} aria-label={hasTrack ? (playing ? "暂停播放" : "继续播放") : "打开本地音乐"}>{playing && hasTrack ? <Pause className="fill-current" /> : <Play className="fill-current" />}</button>
                </div>
                {hasTrack && <div className="home-song-footer" aria-label="音质与音频码率"><span className="home-song-quality">{qualityLabel}</span><span className="home-song-bitrate">{bitrateLabel}</span></div>}
              </div>
            </section>
            <section className="home-section home-recent" aria-labelledby="home-recent-title">
              <div className="home-section-heading"><div className="home-section-title-block"><h2 id="home-recent-title">最近播放<span className="home-heading-english">Listening journal</span></h2></div><button className="home-more" onClick={() => onNavigate("history")}>全部记录 <ArrowRight aria-hidden="true" /></button></div>
              {recentTracks.length ? <div className="home-recent-list">{recentTracks.map(({ track, playedAt }, index) => <button key={track.id} className="home-recent-track" onClick={() => onPickTrack(track.id)} aria-label={`播放 ${track.title}`}><span className="home-recent-index">{String(index + 1).padStart(2, "0")}</span><span className="home-recent-art"><CoverArt track={track} className="size-full rounded-[inherit]" /></span><span className="home-recent-meta"><strong className="home-recent-title"><CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText></strong></span><span className="home-recent-artist"><CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText></span><time className="home-recent-date" dateTime={new Date(playedAt).toISOString()}>{playedAtLabel(playedAt)}</time><span className="home-card-play"><Play className="fill-current" aria-hidden="true" /></span></button>)}</div> : <div className="home-recent-empty"><span className="home-empty-disc"><Disc3 aria-hidden="true" /></span><span><strong>下一首歌，就是故事的开始</strong><small>开始听一首歌，这里会记住你喜欢的声音。</small></span><button onClick={() => onNavigate("local")}>开始聆听 <ArrowRight aria-hidden="true" /></button></div>}
            </section>
          </div>
          <TodayListening snapshot={snapshot} onOpenHeatmap={() => setHeatmapOpen(true)} />
        </div>
      </div>
      {heatmapOpen && <ListeningHeatmapDialog snapshot={snapshot} onClose={() => setHeatmapOpen(false)} />}
    </div>
  );
}
