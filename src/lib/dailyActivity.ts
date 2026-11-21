import type { PlayHistoryEntry } from "@/lib/playHistory";

/**
 * 每日聆听活动日志：按「本地日期 YYYY-MM-DD」聚合当天的播放次数与估算秒数。
 *
 * 「最近播放」历史按曲目去重、最多保留 80 条且重复播放会刷新时间戳，
 * 撑不起 1 月 1 日 — 12 月 31 日的年度声迹；这里用一份极小的按天日志
 * （一年 365 个键）补齐热力图与年度统计所需的数据。
 */
export type DailyActivityEntry = {
  plays: number;
  seconds: number;
};

export type DailyActivityLog = Record<string, DailyActivityEntry>;

const dailyActivityCacheKey = "aria-daily-activity";
/** 最多保留 3 个完整年份的按天记录，避免无限增长。 */
const maxDailyActivityEntries = 366 * 3 + 14;

export function localDateKey(value: Date | number = new Date()): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateKey(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return Number.NaN;
  return new Date(year, month - 1, day).getTime();
}

function sanitizeEntry(raw: unknown): DailyActivityEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Partial<DailyActivityEntry>;
  const plays = Math.round(Number(entry.plays));
  const seconds = Math.round(Number(entry.seconds));
  if (!Number.isFinite(plays) || plays <= 0) return null;
  return {
    plays,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
  };
}

export function readDailyActivity(): DailyActivityLog {
  try {
    const raw = window.localStorage.getItem(dailyActivityCacheKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const log: DailyActivityLog = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const entry = sanitizeEntry(value);
      if (entry) log[key] = entry;
    }
    return pruneDailyActivity(log);
  } catch {
    return {};
  }
}

export function writeDailyActivity(log: DailyActivityLog) {
  try {
    window.localStorage.setItem(dailyActivityCacheKey, JSON.stringify(pruneDailyActivity(log)));
  } catch {
    // 统计日志永远不该阻塞播放。
  }
}

function pruneDailyActivity(log: DailyActivityLog): DailyActivityLog {
  const keys = Object.keys(log);
  if (keys.length <= maxDailyActivityEntries) return log;
  const sortedKeys = keys.sort();
  const dropUntil = sortedKeys[sortedKeys.length - maxDailyActivityEntries];
  const pruned: DailyActivityLog = {};
  for (const key of sortedKeys) {
    if (key >= dropUntil) pruned[key] = log[key];
  }
  return pruned;
}

export function recordDailyPlay(
  log: DailyActivityLog,
  playedAt: number = Date.now(),
  seconds = 0,
): DailyActivityLog {
  if (!Number.isFinite(playedAt) || playedAt <= 0) return log;
  const key = localDateKey(playedAt);
  const existing = log[key] ?? { plays: 0, seconds: 0 };
  return {
    ...log,
    [key]: {
      plays: existing.plays + 1,
      seconds: existing.seconds + Math.max(0, Math.round(seconds)),
    },
  };
}

/**
 * 首次升级（日志为空）时用旧的「最近播放」历史尽力回填：
 * 每条记录用其最新时间戳与累计次数折算，保证老用户升级后热力图不至于全空。
 */
export function seedDailyActivityFromHistory(history: PlayHistoryEntry[]): DailyActivityLog {
  const log: DailyActivityLog = {};
  for (const entry of history) {
    if (!Number.isFinite(entry.playedAt) || entry.playedAt <= 0) continue;
    const plays = Math.max(1, entry.count || 1);
    const key = localDateKey(entry.playedAt);
    const existing = log[key] ?? { plays: 0, seconds: 0 };
    log[key] = {
      plays: existing.plays + plays,
      seconds: existing.seconds,
    };
  }
  return log;
}

/** 返回日志里出现过的最早年份（用于年度声迹的年份切换下限）。 */
export function earliestActivityYear(log: DailyActivityLog): number | null {
  let earliest: number | null = null;
  for (const key of Object.keys(log)) {
    const time = parseDateKey(key);
    if (!Number.isFinite(time)) continue;
    const year = new Date(time).getFullYear();
    if (earliest === null || year < earliest) earliest = year;
  }
  return earliest;
}

/** 测试辅助：按保留条数裁剪最旧的若干天。 */
export function pruneMaxEntriesForTests(log: DailyActivityLog, maxEntries: number): DailyActivityLog {
  const keys = Object.keys(log).sort();
  if (keys.length <= maxEntries) return log;
  const pruned: DailyActivityLog = {};
  for (const key of keys.slice(-maxEntries)) {
    pruned[key] = log[key];
  }
  return pruned;
}
