import { describe, expect, it } from "vitest";
import { calculateVirtualRange } from "./virtualRows";

describe("virtualRows", () => {
  it("returns an empty range for empty lists", () => {
    expect(calculateVirtualRange({ count: 0, rowHeight: 64, scrollTop: 0, viewportHeight: 400 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      totalHeight: 0,
    });
  });

  it("keeps visible rows with overscan", () => {
    expect(
      calculateVirtualRange({
        count: 100,
        rowHeight: 50,
        scrollTop: 500,
        viewportHeight: 200,
        overscan: 2,
      }),
    ).toEqual({
      startIndex: 8,
      endIndex: 16,
      totalHeight: 5000,
    });
  });

  it("clamps ranges to list boundaries", () => {
    expect(
      calculateVirtualRange({
        count: 10,
        rowHeight: 40,
        scrollTop: 360,
        viewportHeight: 400,
        overscan: 4,
      }),
    ).toEqual({
      startIndex: 5,
      endIndex: 10,
      totalHeight: 400,
    });
  });
});
