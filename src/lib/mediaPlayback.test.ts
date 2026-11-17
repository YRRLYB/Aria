import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuardedAdvance, requestMediaPlayback } from "./mediaPlayback";

afterEach(() => vi.useRealTimers());

describe("media playback requests", () => {
  it("does not stop a new track when an earlier play request rejects", async () => {
    let reject!: (error: Error) => void;
    const failure = vi.fn();
    const cancel = requestMediaPlayback({ play: () => new Promise<void>((_, fail) => { reject = fail; }) }, failure);
    cancel();
    reject(new Error("superseded"));
    await Promise.resolve();
    expect(failure).not.toHaveBeenCalled();
  });

  it("ignores an interrupted play but reports a real current failure", async () => {
    const failure = vi.fn();
    requestMediaPlayback({ play: () => Promise.reject(Object.assign(new Error("interrupted"), { name: "AbortError" })) }, failure);
    await Promise.resolve();
    expect(failure).not.toHaveBeenCalled();
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    requestMediaPlayback({ play: () => Promise.reject(denied) }, failure);
    await Promise.resolve();
    expect(failure).toHaveBeenCalledWith(denied);
  });

  it("does not skip a replacement track or a paused player after a delayed error", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    let current = { trackId: "a", playing: true, advance };
    const scheduler = createGuardedAdvance(() => current);
    scheduler.schedule("a");
    current = { ...current, trackId: "b" };
    vi.advanceTimersByTime(650);
    expect(advance).not.toHaveBeenCalled();
    scheduler.schedule("b");
    current = { ...current, playing: false };
    vi.advanceTimersByTime(650);
    expect(advance).not.toHaveBeenCalled();
    current = { ...current, playing: true };
    scheduler.schedule("b");
    vi.advanceTimersByTime(650);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});
