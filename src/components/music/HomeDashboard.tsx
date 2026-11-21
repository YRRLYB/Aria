import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Disc3, Maximize2, Music2, Play, X } from "lucide-react";
import { AriaIcon } from "@/components/icons/aria";
import { CopyableTrackText, CoverArt } from "@/components/music/shared";
import { SourceLogo } from "@/components/music/SourceLogos";
import { earliestActivityYear, localDateKey, type DailyActivityLog } from "@/lib/dailyActivity";
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
  /** 本地零点时间戳，仅用于 React key 与标题展示。 */
  date: number;
  /** 本地日期键 YYYY-MM-DD，聚合与切片都按它对齐（DST 安全）。 */
  key: string;
  count: number;
  seconds: number;
  future: boolean;
  /** 不属于当前展示范围（往年前后的补位格 / 月切片里邻月的补位格），渲染为空格。 */
  outside: boolean;
};

type ListeningSnapshot = {
  today: PlayHistoryEntry[];
  week: PlayHistoryEntry[];
  todaySeconds: number;
  weekSeconds: number;
  activity: number[];
};

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

  return { today, week, todaySeconds: duration(today), weekSeconds: duration(week), activity };
}

/**
 * 构建某一年的 GitHub 风格聆听热力图：严格覆盖 1 月 1 日 — 12 月 31 日。
 * 网格从「1 月 1 日之前最近的周日」开始、到「12 月 31 日之后最近的周六」结束，
 * 首尾不满一周的部分用空白补位格（outside）填充，保证周列对齐。
 * 数据优先取每日聆听日志（dailyActivity）；日志为空时回退旧「最近播放」历史，
 * 这样升级当天也不会整年空白。
 */
export function buildYearHeatmap(
  year: number,
  dailyActivity: DailyActivityLog,
  history: PlayHistoryEntry[] = [],
  now: number = Date.now(),
): { days: HeatmapDay[]; total: number } {
  const todayStart = startOfDay(now);
  const logKeys = Object.keys(dailyActivity).filter((key) => key.startsWith(`${year}-`));
  const useLog = logKeys.length > 0;

  const buckets = new Map<string, { count: number; seconds: number }>();
  if (useLog) {
    for (const key of logKeys) {
      const entry = dailyActivity[key];
      buckets.set(key, { count: Math.max(1, entry.plays), seconds: Math.max(0, entry.seconds) });
    }
  } else {
    for (const entry of history) {
      if (!Number.isFinite(entry.playedAt) || entry.playedAt <= 0) continue;
      const date = new Date(entry.playedAt);
      if (date.getFullYear() !== year) continue;
      const key = localDateKey(date);
      const bucket = buckets.get(key) ?? { count: 0, seconds: 0 };
      bucket.count += 1;
      bucket.seconds += parseDuration(entry.track.duration);
      buckets.set(key, bucket);
    }
  }

  const firstDay = new Date(year, 0, 1);
  const lastDay = new Date(year, 11, 31);
  const gridStart = new Date(year, 0, 1 - firstDay.getDay());
  const gridEnd = new Date(year, 11, 31 + (6 - lastDay.getDay()));

  const days: HeatmapDay[] = [];
  let total = 0;
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const key = localDateKey(cursor);
    const outside = cursor.getFullYear() !== year;
    const bucket = buckets.get(key);
    const count = outside ? 0 : bucket?.count ?? 0;
    if (!outside && bucket) total += bucket.count;
    days.push({
      date: cursor.getTime(),
      key,
      count,
      seconds: outside ? 0 : bucket?.seconds ?? 0,
      future: !outside && cursor.getTime() > todayStart,
      outside,
    });
    // 按日历日 +1，DST 切换不会把格子错位到别的日期。
    cursor.setDate(cursor.getDate() + 1);
  }
  return { days, total };
}

type HeatmapPreviewSlice = {
  days: HeatmapDay[];
  total: number;
  columns: number;
  month: number;
  startMonth: number;
  endMonth: number;
  label: string;
};

/** 从年网格里切出当前 1~2 个月份（含首尾整周对齐的补位格），用于首页未展开时的预览。 */
export function buildMonthSlice(
  yearDays: HeatmapDay[],
  now: number = Date.now(),
  monthCount: 1 | 2 = 1,
): HeatmapPreviewSlice | null {
  const today = new Date(now);
  const year = today.getFullYear();
  const currentMonth = today.getMonth();
  const startMonth = monthCount === 2 ? (currentMonth >= 1 ? currentMonth - 1 : 0) : currentMonth;
  const endMonth = monthCount === 2 ? (currentMonth >= 1 ? currentMonth : 1) : currentMonth;
  const prefixes: string[] = [];
  for (let m = startMonth; m <= endMonth; m += 1) {
    prefixes.push(`${year}-${String(m + 1).padStart(2, "0")}-`);
  }
  const inSlice = (day: HeatmapDay) => !day.outside && prefixes.some((prefix) => day.key.startsWith(prefix));
  const firstIndex = yearDays.findIndex(inSlice);
  if (firstIndex < 0) return null;
  let lastIndex = firstIndex;
  for (let index = firstIndex; index < yearDays.length; index += 1) {
    if (inSlice(yearDays[index])) lastIndex = index;
  }
  const firstWeekStart = firstIndex - (firstIndex % 7);
  const lastWeekEnd = lastIndex - (lastIndex % 7) + 6;
  const days = yearDays.slice(firstWeekStart, lastWeekEnd + 1).map((day) => ({
    ...day,
    outside: !inSlice(day),
  }));
  let total = 0;
  for (const day of days) {
    if (!day.outside) total += day.count;
  }
  const label = startMonth === endMonth ? `${endMonth + 1}月` : `${startMonth + 1}–${endMonth + 1}月`;
  return { days, total, columns: days.length / 7, month: endMonth, startMonth, endMonth, label };
}

/** 拿不到每日日志时用「最近播放」历史兜底估算最早年份（年份切换下限）。 */
function earliestHistoryYear(history: PlayHistoryEntry[]): number | null {
  let earliest: number | null = null;
  for (const entry of history) {
    if (!Number.isFinite(entry.playedAt) || entry.playedAt <= 0) continue;
    const year = new Date(entry.playedAt).getFullYear();
    if (earliest === null || year < earliest) earliest = year;
  }
  return earliest;
}

function heatmapLevel(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function ListeningHeatmapGrid({
  days,
  columns,
  ariaLabel,
  compact = false,
}: {
  days: HeatmapDay[];
  columns: number;
  ariaLabel: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn("home-heatmap-grid", compact && "is-compact")}
      // 紧凑预览与整年网格统一按卡片宽度等分铺满，避免近两月切片左右留出大块空白。
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-label={ariaLabel}
    >
      {days.map((day) => {
        const level = heatmapLevel(day.count);
        return (
          <span
            key={day.key}
            data-level={level}
            data-future={day.future ? "true" : undefined}
            data-outside={day.outside ? "true" : undefined}
            title={day.outside ? undefined : `${new Date(day.date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} · ${day.count} 次播放 · ${formatListeningTime(day.seconds)}`}
            className="home-heatmap-cell"
          />
        );
      })}
    </div>
  );
}

function ListeningHeatmapPreview({
  month,
  onOpenHeatmap,
}: {
  month: HeatmapPreviewSlice | null;
  onOpenHeatmap: () => void;
}) {
  const isTwoMonths = month ? month.startMonth !== month.endMonth : true;
  const compactDays = useMemo(
    () => (month ? month.days.filter((day) => !day.outside) : []),
    [month],
  );
  const compactColumns = Math.max(14, Math.ceil(compactDays.length / 4));
  return (
    <button
      type="button"
      className="home-heatmap-card"
      onClick={onOpenHeatmap}
      aria-label="展开年度声迹"
      title="点击查看年度聆听声迹"
    >
      <div className="home-heatmap-card-header">
        <span className="home-heatmap-card-title">年度声迹</span>
        <span className="home-heatmap-card-cue">
          {month ? `${month.label} · 放大` : "近期 · 放大"}
          <Maximize2 aria-hidden="true" />
        </span>
      </div>
      {compactDays.length > 0 ? (
        <ListeningHeatmapGrid
          days={compactDays}
          columns={compactColumns}
          ariaLabel={`近期聆听声迹（${month?.label ?? "近期"}）`}
          compact
        />
      ) : null}
      <div className="home-heatmap-card-footer" aria-hidden="true">
        <span>{isTwoMonths ? `近两月 ${month?.total ?? 0} 次播放` : `本月 ${month?.total ?? 0} 次播放`}</span>
        <span className="home-heatmap-legend">
          少
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className="home-heatmap-cell" data-level={level} />
          ))}
          多
        </span>
      </div>
    </button>
  );
}

function ListeningHeatmapDialog({
  dailyActivity,
  history,
  onClose,
}: {
  dailyActivity: DailyActivityLog;
  history: PlayHistoryEntry[];
  onClose: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const minYear = useMemo(() => {
    const fromLog = earliestActivityYear(dailyActivity);
    const fromHistory = earliestHistoryYear(history);
    if (fromLog === null && fromHistory === null) return currentYear;
    if (fromLog === null) return Math.min(fromHistory ?? currentYear, currentYear);
    if (fromHistory === null) return Math.min(fromLog, currentYear);
    return Math.min(fromLog, fromHistory, currentYear);
  }, [dailyActivity, history, currentYear]);
  const { days, total } = useMemo(
    () => buildYearHeatmap(year, dailyActivity, history),
    [year, dailyActivity, history],
  );
  const weeks = useMemo(() => {
    const columns: HeatmapDay[][] = [];
    for (let index = 0; index < days.length; index += 7) {
      columns.push(days.slice(index, index + 7));
    }
    return columns;
  }, [days]);
  const monthLabels = useMemo(
    () =>
      weeks.map((daysInWeek, index) => {
        const firstInYear = daysInWeek.find((day) => !day.outside);
        const first = new Date(firstInYear?.date ?? daysInWeek[0]?.date ?? Date.now());
        const label = `${first.getMonth() + 1}月`;
        if (index === 0) return label;
        const previousWeek = weeks[index - 1] ?? [];
        const previousInYear = previousWeek.find((day) => !day.outside);
        const previous = new Date(previousInYear?.date ?? previousWeek[0]?.date ?? Date.now());
        return first.getMonth() !== previous.getMonth() ? label : "";
      }),
    [weeks],
  );
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
      className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/30 p-4 backdrop-blur-sm backdrop:bg-transparent sm:p-8"
    >
      <section className="home-heatmap-dialog-panel w-full max-w-[980px] overflow-hidden rounded-[1.75rem] border border-white/70 bg-[#faf9fd] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="full-heatmap-title" className="flex items-center gap-2 text-2xl font-semibold text-neutral-900">
              年度聆听声迹
              <span className="home-heatmap-year-nav">
                <button
                  type="button"
                  aria-label="上一年"
                  disabled={year <= minYear}
                  onClick={() => setYear((current) => Math.max(minYear, current - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="tabular-nums">{year}</span>
                <button
                  type="button"
                  aria-label="下一年"
                  disabled={year >= currentYear}
                  onClick={() => setYear((current) => Math.min(currentYear, current + 1))}
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </span>
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {year}年1月1日 — {year}年12月31日 · {total > 0 ? `${total} 次播放` : "这一年还没有聆听记录"}
            </p>
          </div>
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900"
            aria-label="关闭年度声迹"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-5 overflow-hidden">
          <div
            className="home-heatmap-months mb-1.5 grid gap-[3px] pl-6"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
          >
            {monthLabels.map((label, index) => (
              <span key={`${label}-${index}`} className="truncate text-[11px] font-medium text-neutral-400">{label}</span>
            ))}
          </div>
          <div className="flex items-stretch gap-1.5">
            <div className="grid shrink-0 grid-rows-7 gap-[3px] pr-1 text-[11px] text-neutral-400">
              {["日", "一", "二", "三", "四", "五", "六"].map((label, index) => (
                <span key={label} className="flex items-center justify-end">{index % 2 === 1 ? label : ""}</span>
              ))}
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <ListeningHeatmapGrid
                days={days}
                columns={weeks.length}
                ariaLabel={`${year}年度聆听声迹`}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200/70 pt-3 text-[11px] text-neutral-400">
          <span>1月1日 — 12月31日 · 共 {weeks.length} 周 · 点击空白处关闭</span>
          <span className="home-heatmap-legend">
            少
            {[0, 1, 2, 3, 4].map((level) => (
              <i key={level} className="home-heatmap-cell" data-level={level} />
            ))}
            多
          </span>
        </div>
      </section>
    </dialog>
  );
}

function TodayListening({ snapshot, month, onOpenHeatmap }: { snapshot: ListeningSnapshot; month: HeatmapPreviewSlice | null; onOpenHeatmap: () => void }) {
  const latest = snapshot.today[0];
  const maxActivity = Math.max(1, ...snapshot.activity);
  const labels = ["00", "04", "08", "12", "16", "20"];
  return (
    <aside className="home-today" aria-labelledby="home-today-title">
      <div className="home-today-heading">
        <div><span className="home-eyebrow">LISTENING LOG</span><h2 id="home-today-title">今日聆听</h2></div>
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
      <ListeningHeatmapPreview month={month} onOpenHeatmap={onOpenHeatmap} />
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
  dailyActivity,
  playing,
  onTogglePlay,
  onPickTrack,
  onOpenPlayer,
  onNavigate,
}: {
  activeTrack: Track;
  playHistory: PlayHistoryEntry[];
  dailyActivity: DailyActivityLog;
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
  // 首页卡片不点开时展示近期两个月的声迹。
  const month = useMemo(() => {
    const now = Date.now();
    return buildMonthSlice(buildYearHeatmap(new Date(now).getFullYear(), dailyActivity, playHistory, now).days, now, 2);
  }, [dailyActivity, playHistory]);
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
                    <span className="home-song-meta"><strong>{hasTrack ? <CopyableTrackText track={activeTrack} field="title" marquee={false}>{activeTrack.title}</CopyableTrackText> : "挑一首喜欢的歌"}</strong><span>{hasTrack ? <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText> : "让音乐陪你一会儿"}</span></span>
                  </button>
                  <button className="home-song-play" onClick={hasTrack ? onTogglePlay : () => onNavigate("local")} aria-label={hasTrack ? (playing ? "暂停播放" : "继续播放") : "打开本地音乐"}>{playing && hasTrack ? <AriaIcon name="playing" className="size-5" /> : <AriaIcon name="play" className="size-5" />}</button>
                </div>
                {hasTrack && <div className="home-song-footer" aria-label="音质与音频码率"><span className="home-song-quality">{qualityLabel}</span><span className="home-song-bitrate">{bitrateLabel}</span></div>}
              </div>
            </section>
            <section className="home-section home-recent" aria-labelledby="home-recent-title">
              <div className="home-section-heading"><div className="home-section-title-block"><h2 id="home-recent-title">最近播放<span className="home-heading-english">Listening journal</span></h2></div><button className="home-more" onClick={() => onNavigate("history")}>全部记录 <ArrowRight aria-hidden="true" /></button></div>
              {recentTracks.length ? <div className="home-recent-list">{recentTracks.map(({ track, playedAt }, index) => <button key={track.id} className="home-recent-track" onClick={() => onPickTrack(track.id)} aria-label={`播放 ${track.title}`}><span className="home-recent-index">{String(index + 1).padStart(2, "0")}</span><span className="home-recent-art"><CoverArt track={track} className="size-full rounded-[inherit]" /></span><span className="home-recent-meta"><strong className="home-recent-title flex items-center gap-1.5"><span className="min-w-0 truncate"><CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText></span><SourceLogo source={track.source} className="size-3.5 shrink-0" /></strong></span><span className="home-recent-artist"><CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText></span><time className="home-recent-date" dateTime={new Date(playedAt).toISOString()}>{playedAtLabel(playedAt)}</time><span className="home-card-play"><Play className="fill-current" aria-hidden="true" /></span></button>)}</div> : <div className="home-recent-empty"><span className="home-empty-disc"><Disc3 aria-hidden="true" /></span><span><strong>下一首歌，就是故事的开始</strong><small>开始听一首歌，这里会记住你喜欢的声音。</small></span><button onClick={() => onNavigate("local")}>开始聆听 <ArrowRight aria-hidden="true" /></button></div>}
            </section>
          </div>
          <TodayListening snapshot={snapshot} month={month} onOpenHeatmap={() => setHeatmapOpen(true)} />
        </div>
      </div>
      {heatmapOpen && <ListeningHeatmapDialog dailyActivity={dailyActivity} history={playHistory} onClose={() => setHeatmapOpen(false)} />}
    </div>
  );
}
