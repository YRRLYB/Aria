import { useMemo } from "react";
import { ArrowRight, CalendarDays, Clock3, Disc3, Headphones, Music2, Pause, Play } from "lucide-react";
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

const heatmapWeeks = 26;

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

function ListeningHeatmap({ snapshot }: { snapshot: ListeningSnapshot }) {
  const gridStart = snapshot.activityGrid[0]?.date ?? Date.now();
  const startLabel = new Date(gridStart).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  return (
    <section className="mt-4 rounded-[1rem] border border-white/60 bg-white/42 p-3" aria-labelledby="home-heatmap-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-400">Activity</span>
          <h2 id="home-heatmap-title" className="mt-0.5 text-sm font-semibold">聆听活动</h2>
        </div>
        <span className="text-[10px] text-neutral-400">{snapshot.activityTotal} 次播放</span>
      </div>
      <div className="mt-2 overflow-x-auto pb-0.5">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-[2px]" aria-label="最近 26 周聆听活动">
          {snapshot.activityGrid.map((day) => {
            const level = heatmapLevel(day.count);
            return (
              <span
                key={day.date}
                title={`${new Date(day.date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} · ${day.count} 次播放 · ${formatListeningTime(day.seconds)}`}
                className={cn(
                  "size-[7px] rounded-[2px]",
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
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-neutral-400">
        <span>{startLabel} 起 · 最近 26 周</span>
        <span className="flex items-center gap-0.5">
          少
          <i className="size-2 rounded-[2px] bg-neutral-200/65" />
          <i className="size-2 rounded-[2px] bg-emerald-200/90" />
          <i className="size-2 rounded-[2px] bg-emerald-300" />
          <i className="size-2 rounded-[2px] bg-emerald-500" />
          <i className="size-2 rounded-[2px] bg-emerald-700" />
          多
        </span>
      </div>
    </section>
  );
}

function TodayListening({ snapshot }: { snapshot: ListeningSnapshot }) {
  const latest = snapshot.today[0];
  return (
    <aside className="home-today" aria-labelledby="home-today-title">
      <div className="home-today-heading">
        <div><span className="home-eyebrow">LISTENING LOG</span><h2 id="home-today-title">今日聆听</h2></div>
        <span className="home-today-icon" aria-hidden="true"><Headphones /></span>
      </div>
      <div className="home-today-primary">
        <div><strong>{snapshot.today.length}</strong><span>首记录</span></div>
        <div><strong>{formatListeningTime(snapshot.todaySeconds)}</strong><span>记录时长</span></div>
      </div>
      <div className="home-today-period"><span><CalendarDays aria-hidden="true" /> 本周</span><strong>{snapshot.week.length} 首 · {formatListeningTime(snapshot.weekSeconds)}</strong></div>
      <p className="home-today-note"><Clock3 aria-hidden="true" />{latest ? "按最近播放记录估算，重复播放会合并到歌曲记录。" : "播放一首歌后，这里会留下今天的聆听轨迹。"}</p>
      <ListeningHeatmap snapshot={snapshot} />
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
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "GOOD MORNING" : hour < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const hasTrack = activeTrack.id !== "idle";
  const qualityLabel = qualityOptions.find((option) => option.value === activeTrack.currentLevel)?.label ?? activeTrack.quality;
  const bitrateLabel = formatBitrate(activeTrack.bitrate, false) ?? "码率 —";

  return (
    <div className="home-dashboard">
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
          <TodayListening snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}
