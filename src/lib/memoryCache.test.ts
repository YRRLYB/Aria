import { describe, expect, it } from "vitest";
import { takeUnseen, trimMapCache, trimRecordCache, trimStringSet } from "./memoryCache";

describe("memoryCache", () => {
  it("only marks items selected for a bounded warmup batch", () => {
    const seen = new Set<string>();
    expect(takeUnseen(["a", "b", "c", "c"], seen, (id) => id, 2)).toEqual(["a", "b"]);
    expect([...seen]).toEqual(["a", "b"]);
    expect(takeUnseen(["a", "b", "c", "c"], seen, (id) => id, 2)).toEqual(["c"]);
    expect(takeUnseen(["d"], seen, (id) => id, 0)).toEqual([]);
    expect(seen.has("d")).toBe(false);
  });

  it("bounds long-lived retry maps while keeping recent entries", () => {
    const cache = new Map([["a", 1], ["b", 2], ["c", 3]]);
    trimMapCache(cache, 2);
    expect([...cache.keys()]).toEqual(["b", "c"]);
    trimMapCache(cache, 0);
    expect(cache.size).toBe(0);
  });
  it("trims a set in place and keeps the newest entries", () => {
    const ref = { current: new Set(["a", "b", "c", "d"]) };

    trimStringSet(ref, 2);

    expect([...ref.current]).toEqual(["c", "d"]);
  });

  it("returns the same record when no trim is needed", () => {
    const cache = { a: 1, b: 2 };

    expect(trimRecordCache(cache, 3)).toBe(cache);
  });

  it("trims record caches by insertion order", () => {
    const cache = { a: 1, b: 2, c: 3, d: 4 };

    expect(trimRecordCache(cache, 2)).toEqual({ c: 3, d: 4 });
  });
});
