import { describe, expect, it } from "vitest";
import { trimRecordCache, trimStringSet } from "./memoryCache";

describe("memoryCache", () => {
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
