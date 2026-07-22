import { beforeEach, describe, expect, it } from "vitest";
import { clearCache, remember } from "./memoryCache";

describe("server memoryCache", () => {
  beforeEach(() => {
    clearCache();
  });

  it("reuses cached values until the ttl expires", async () => {
    let calls = 0;

    const first = await remember("same", 60_000, async () => {
      calls += 1;
      return "value";
    });
    const second = await remember("same", 60_000, async () => {
      calls += 1;
      return "other";
    });

    expect(first).toBe("value");
    expect(second).toBe("value");
    expect(calls).toBe(1);
  });

  it("coalesces concurrent requests for the same key", async () => {
    let calls = 0;
    let resolveValue: (value: string) => void = () => undefined;

    const first = remember(
      "pending",
      60_000,
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolveValue = resolve;
        }),
    );
    const second = remember("pending", 60_000, async () => {
      calls += 1;
      return "other";
    });

    resolveValue("done");

    await expect(Promise.all([first, second])).resolves.toEqual(["done", "done"]);
    expect(calls).toBe(1);
  });

  it("clears caches by prefix", async () => {
    await remember("netease:a", 60_000, async () => "a");
    await remember("local:b", 60_000, async () => "b");
    clearCache("netease:");

    const first = await remember("netease:a", 60_000, async () => "fresh");
    const second = await remember("local:b", 60_000, async () => "stale");

    expect(first).toBe("fresh");
    expect(second).toBe("b");
  });
});
