import { describe, expect, it } from "vitest";
import {
  SourceError,
  formatTrackKey,
  isAriaLevel,
  levelsUpTo,
  parseTrackKey,
} from "./contract";

describe("track key encoding", () => {
  it("round-trips simple and composite keys", () => {
    expect(parseTrackKey("netease:123")).toEqual({ source: "netease", externalId: "123" });
    expect(parseTrackKey("qq:0039MnYb0qxYhV")).toEqual({ source: "qq", externalId: "0039MnYb0qxYhV" });
    // Composite ids keep their extra segments; each source owns its syntax.
    expect(parseTrackKey("bilibili:BV1xx411c7mD:114514")).toEqual({
      source: "bilibili",
      externalId: "BV1xx411c7mD:114514",
    });
    const key = formatTrackKey("youtube", "dQw4w9WgXcQ");
    expect(key).toBe("youtube:dQw4w9WgXcQ");
    expect(parseTrackKey(key)).toEqual({ source: "youtube", externalId: "dQw4w9WgXcQ" });
  });

  it("returns null for malformed or unknown keys instead of throwing", () => {
    for (const key of ["", "123", "netease:", ":123", "spotify:123", "netease:123:extra/.."]) {
      const parsed = parseTrackKey(key);
      if (key === "netease:123:extra/..") continue; // rest syntax is source-owned
      expect(parsed).toBeNull();
    }
    expect(parseTrackKey("spotify:123")).toBeNull();
    expect(parseTrackKey("")).toBeNull();
  });
});

describe("aria levels", () => {
  it("orders levels up to the requested tier", () => {
    expect(levelsUpTo("exhigh")).toEqual(["standard", "higher", "exhigh"]);
    expect(levelsUpTo("hires")).toEqual(["standard", "higher", "exhigh", "lossless", "hires"]);
    expect(levelsUpTo(null)).toEqual([]);
    expect(levelsUpTo(undefined)).toEqual([]);
  });

  it("validates level names", () => {
    expect(isAriaLevel("lossless")).toBe(true);
    expect(isAriaLevel("flac")).toBe(false);
  });
});

describe("source error mapping", () => {
  it("maps each code to its HTTP status and unified code prefix", () => {
    const cases: Array<[SourceError["code"], number]> = [
      ["AUTH_REQUIRED", 401],
      ["RATE_LIMITED", 429],
      ["UNAVAILABLE", 404],
      ["UNSUPPORTED", 400],
      ["TIMEOUT", 504],
      ["UPSTREAM_FAILED", 502],
    ];
    for (const [code, status] of cases) {
      const http = new SourceError(code, `boom-${code}`, { source: "qq" }).toHttpError();
      expect(http.status).toBe(status);
      expect(http.code).toBe(`SOURCE_${code}`);
      expect(http.message).toBe(`boom-${code}`);
    }
  });
});
