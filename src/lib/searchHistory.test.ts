import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_HISTORY,
  readSearchHistory,
  recordSearchHistory,
  removeSearchHistoryItem,
  sanitizeSearchHistory,
  writeSearchHistory,
} from "./searchHistory";

describe("searchHistory", () => {
  it("deduplicates case-insensitively and promotes recent queries to the top", () => {
    let items: string[] = [];
    items = recordSearchHistory(items, "坂本龙一");
    items = recordSearchHistory(items, "Radiohead");
    items = recordSearchHistory(items, "  radiohead  ");
    expect(items).toEqual(["radiohead", "坂本龙一"]);
  });

  it("ignores empty or whitespace-only queries and caps history size", () => {
    let items = recordSearchHistory(["a", "b"], "   ");
    expect(items).toEqual(["a", "b"]);

    for (let i = 1; i <= 12; i += 1) {
      items = recordSearchHistory(items, `query-${i}`);
    }
    expect(items).toHaveLength(MAX_SEARCH_HISTORY);
    expect(items[0]).toBe("query-12");
  });

  it("removes items and safely reads/writes storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const next = removeSearchHistoryItem(["Alpha", "Beta", "Gamma"], "beta");
    expect(next).toEqual(["Alpha", "Gamma"]);
    expect(writeSearchHistory(next, storage)).toBe(true);
    expect(readSearchHistory(storage)).toEqual(["Alpha", "Gamma"]);
    expect(sanitizeSearchHistory(["", 42, "  Solo  ", "solo"])).toEqual(["Solo"]);
  });
});
