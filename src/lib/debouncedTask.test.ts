import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedTask } from "./debouncedTask";

afterEach(() => vi.useRealTimers());

describe("debounced writes", () => {
  it("persists the latest value after rapid changes", () => {
    vi.useFakeTimers();
    let value = "first";
    const writes: string[] = [];
    const task = createDebouncedTask(() => writes.push(value), 300);
    task.schedule();
    vi.advanceTimersByTime(200);
    value = "last";
    task.schedule();
    vi.advanceTimersByTime(300);
    expect(writes).toEqual(["last"]);
  });

  it("flushes a pending update once when the page closes", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const task = createDebouncedTask(write, 300);
    task.schedule();
    task.flush();
    task.flush();
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
