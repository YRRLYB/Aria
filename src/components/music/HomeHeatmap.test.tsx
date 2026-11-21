import { describe, expect, it } from "vitest";
import { tracks } from "@/data/music";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import type { DailyActivityLog } from "@/lib/dailyActivity";
import { buildMonthSlice, buildYearHeatmap } from "./HomeDashboard";

function dayKey(year: number, monthIndex: number, day: number) {
  const date = new Date(year, monthIndex, day, 12, 0, 0);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("年度声迹 heatmap builders", () => {
  it("covers exactly Jan 1 to Dec 31 with week-aligned padding cells", () => {
    const log: DailyActivityLog = {
      [dayKey(2026, 0, 1)]: { plays: 2, seconds: 300 },
      [dayKey(2026, 10, 21)]: { plays: 5, seconds: 1200 },
      [dayKey(2026, 11, 31)]: { plays: 1, seconds: 240 },
    };
    const { days, total } = buildYearHeatmap(2026, log, [], new Date(2026, 10, 21, 12).getTime());

    const inYear = days.filter((day) => !day.outside);
    expect(inYear).toHaveLength(365); // 2026 不是闰年
    expect(inYear[0].key).toBe("2026-01-01");
    expect(inYear.at(-1)?.key).toBe("2026-12-31");
    expect(days.length % 7).toBe(0); // 周列对齐
    expect(total).toBe(8);

    const newYearDay = days.find((day) => day.key === "2026-01-01");
    expect(newYearDay?.count).toBe(2);
    expect(newYearDay?.seconds).toBe(300);
    expect(newYearDay?.outside).toBe(false);

    // 首列从 1 月 1 日之前最近的周日开始补位。
    expect(days[0].key).toBe("2025-12-28"); // 2026-01-01 是周四
    expect(days[0].outside).toBe(true);
    // 末列补位到 12 月 31 日之后最近的周六。
    expect(days.at(-1)?.key).toBe("2027-01-02");
    expect(days.at(-1)?.outside).toBe(true);
  });

  it("marks days after today as future and keeps them dimmed", () => {
    const log: DailyActivityLog = { [dayKey(2026, 5, 15)]: { plays: 1, seconds: 100 } };
    const { days } = buildYearHeatmap(2026, log, [], new Date(2026, 5, 15, 9).getTime());
    const futureDay = days.find((day) => day.key === "2026-06-16");
    const today = days.find((day) => day.key === "2026-06-15");
    expect(today?.future).toBe(false);
    expect(futureDay?.future).toBe(true);
  });

  it("supports leap years with 366 in-year cells", () => {
    const { days } = buildYearHeatmap(2024, {}, [], new Date(2024, 0, 1).getTime());
    expect(days.filter((day) => !day.outside)).toHaveLength(366);
    expect(days.some((day) => day.key === "2024-02-29" && !day.outside)).toBe(true);
  });

  it("falls back to legacy play history when the daily log is empty", () => {
    const history: PlayHistoryEntry[] = [
      { track: tracks[0], playedAt: new Date(2026, 2, 3, 10, 0, 0).getTime(), count: 4 },
    ];
    const { days, total } = buildYearHeatmap(2026, {}, history, new Date(2026, 10, 21).getTime());
    const day = days.find((entry) => entry.key === "2026-03-03");
    // 旧历史按条目计数（次数只作为尽力回填的依据）。
    expect(day?.count).toBe(1);
    expect(total).toBe(1);
  });

  it("prefers the daily log and ignores legacy history for that year", () => {
    const history: PlayHistoryEntry[] = [
      { track: tracks[0], playedAt: new Date(2026, 2, 3, 10, 0, 0).getTime(), count: 4 },
    ];
    const log: DailyActivityLog = { [dayKey(2026, 2, 3)]: { plays: 9, seconds: 60 } };
    const { days, total } = buildYearHeatmap(2026, log, history, new Date(2026, 10, 21).getTime());
    const day = days.find((entry) => entry.key === "2026-03-03");
    expect(day?.count).toBe(9);
    expect(total).toBe(9);
  });

  it("slices the current month with whole-week padding for the home preview", () => {
    const log: DailyActivityLog = {
      [dayKey(2026, 10, 1)]: { plays: 2, seconds: 0 },
      [dayKey(2026, 10, 21)]: { plays: 3, seconds: 0 },
      [dayKey(2026, 9, 31)]: { plays: 7, seconds: 0 }, // 上个月，不该计入
    };
    const { days } = buildYearHeatmap(2026, log, [], new Date(2026, 10, 21, 12).getTime());
    const month = buildMonthSlice(days, new Date(2026, 10, 21, 12).getTime());
    expect(month).not.toBeNull();
    // 2026-11-01 是周一：首列包含 10 月最后一个周日。
    expect(month?.days[0].key).toBe("2026-11-01");
    expect(month?.columns).toBe(5); // 11 月跨 5 个完整周列
    expect(month?.total).toBe(5);
    const inMonth = month?.days.filter((day) => !day.outside) ?? [];
    expect(inMonth.at(-1)?.key).toBe("2026-11-30");
    // 首尾补位格（邻月）渲染为空格。
    expect(month?.days.some((day) => day.outside)).toBe(true);
  });

  it("handles December previews that spill into the next year", () => {
    const { days } = buildYearHeatmap(2026, {}, [], new Date(2026, 11, 24, 12).getTime());
    const month = buildMonthSlice(days, new Date(2026, 11, 24, 12).getTime());
    expect(month?.days.at(-1)?.key).toBe("2027-01-02"); // 2027-01-02 是周六
    expect(month?.days.at(-1)?.outside).toBe(true);
    expect(month?.columns).toBeGreaterThanOrEqual(5);
  });

  it("slices a two-month range across October and November for the compact preview", () => {
    const log: DailyActivityLog = {
      [dayKey(2026, 8, 30)]: { plays: 4, seconds: 0 }, // 9 月，不计入 10–11 月
      [dayKey(2026, 9, 12)]: { plays: 2, seconds: 0 },
      [dayKey(2026, 10, 21)]: { plays: 3, seconds: 0 },
    };
    const now = new Date(2026, 10, 21, 12).getTime();
    const { days } = buildYearHeatmap(2026, log, [], now);
    const slice = buildMonthSlice(days, now, 2);
    expect(slice).not.toBeNull();
    expect(slice?.startMonth).toBe(9);
    expect(slice?.endMonth).toBe(10);
    expect(slice?.label).toBe("10–11月");
    expect(slice?.total).toBe(5);
    expect(slice?.columns).toBe(10);
    const inSlice = slice?.days.filter((day) => !day.outside) ?? [];
    expect(inSlice[0]?.key).toBe("2026-10-01");
    expect(inSlice.at(-1)?.key).toBe("2026-11-30");
  });
});
