import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import {
  earliestActivityYear,
  localDateKey,
  pruneMaxEntriesForTests,
  readDailyActivity,
  recordDailyPlay,
  seedDailyActivityFromHistory,
  writeDailyActivity,
} from "@/lib/dailyActivity";

function storageStub() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("daily activity log", () => {
  it("keys days by local calendar date, not UTC", () => {
    const date = new Date(2026, 10, 21, 23, 30, 0); // 2026-11-21 23:30 local
    expect(localDateKey(date)).toBe("2026-11-21");
  });

  it("accumulates plays and seconds on the same day", () => {
    const day = new Date(2026, 10, 21, 9, 0, 0).getTime();
    let log = recordDailyPlay({}, day, 200);
    log = recordDailyPlay(log, day + 3_600_000, 180);
    expect(log["2026-11-21"]).toEqual({ plays: 2, seconds: 380 });
  });

  it("ignores invalid timestamps without mutating the log", () => {
    const log = { "2026-11-21": { plays: 3, seconds: 100 } };
    expect(recordDailyPlay(log, Number.NaN, 50)).toBe(log);
  });

  it("round-trips through localStorage and drops malformed entries", () => {
    const store = storageStub();
    store.set("aria-daily-activity", JSON.stringify({
      "2026-11-21": { plays: 2, seconds: 90 },
      "2026-11-22": { plays: 0, seconds: 90 },
      "not-a-date": { plays: 5, seconds: 10 },
    }));
    const log = readDailyActivity();
    expect(Object.keys(log)).toEqual(["2026-11-21"]);
    expect(log["2026-11-21"]).toEqual({ plays: 2, seconds: 90 });
  });

  it("seeds from legacy play history using latest timestamp and repeat count", () => {
    const history: PlayHistoryEntry[] = [
      { track: { id: "t1" } as PlayHistoryEntry["track"], playedAt: new Date(2026, 10, 20, 8, 0, 0).getTime(), count: 3 },
      { track: { id: "t2" } as PlayHistoryEntry["track"], playedAt: new Date(2026, 10, 20, 21, 0, 0).getTime(), count: 1 },
      { track: { id: "t3" } as PlayHistoryEntry["track"], playedAt: new Date(2025, 0, 2, 12, 0, 0).getTime(), count: 2 },
    ];
    const log = seedDailyActivityFromHistory(history);
    expect(log["2026-11-20"]).toEqual({ plays: 4, seconds: 0 });
    expect(log["2025-01-02"]).toEqual({ plays: 2, seconds: 0 });
  });

  it("reports the earliest activity year for year navigation bounds", () => {
    const log = {
      "2025-01-02": { plays: 2, seconds: 0 },
      "2026-11-20": { plays: 4, seconds: 0 },
    };
    expect(earliestActivityYear(log)).toBe(2025);
    expect(earliestActivityYear({})).toBeNull();
  });

  it("prunes the oldest days when the log grows past the retention cap", () => {
    const totalDays = 366 * 3 + 14 + 88; // 保留上限再加 88 天
    const log: Record<string, { plays: number; seconds: number }> = {};
    for (let index = 0; index < totalDays; index += 1) {
      const date = new Date(2020, 0, 1 + index);
      log[localDateKey(date)] = { plays: 1, seconds: 10 };
    }
    const store = storageStub();
    writeDailyActivity(log as never);
    const persisted = readDailyActivity();
    const keys = Object.keys(persisted).sort();
    expect(keys.length).toBeGreaterThan(1000);
    expect(keys.length).toBeLessThan(totalDays);
    // 最旧的日子被裁掉，最新的一天保留。
    expect(keys[0] > "2020-01-01").toBe(true);
    expect(keys[keys.length - 1]).toBe(localDateKey(new Date(2020, 0, totalDays)));
    expect(store.size).toBe(1);
  });

  it("recordDailyPlay keeps day entries independent across month boundaries", () => {
    const lastDay = new Date(2026, 9, 31, 22, 0, 0).getTime();
    const firstDay = new Date(2026, 10, 1, 1, 0, 0).getTime();
    const log = recordDailyPlay(recordDailyPlay({}, lastDay), firstDay);
    expect(log["2026-10-31"].plays).toBe(1);
    expect(log["2026-11-01"].plays).toBe(1);
  });
});

describe("pruneDailyActivity retention window", () => {
  it("keeps only the newest N days by key order", () => {
    const log: Record<string, { plays: number; seconds: number }> = {};
    for (let index = 0; index < 30; index += 1) {
      const date = new Date(2024, 0, 1 + index);
      log[localDateKey(date)] = { plays: index + 1, seconds: 0 };
    }
    const pruned = pruneMaxEntriesForTests(log, 10);
    const keys = Object.keys(pruned).sort();
    expect(keys).toHaveLength(10);
    expect(keys[0]).toBe("2024-01-21");
    expect(pruned["2024-01-30"].plays).toBe(30);
  });
});
