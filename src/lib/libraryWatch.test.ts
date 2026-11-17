import { describe, expect, it, vi } from "vitest";
import type { ApiLibraryIndex, ApiLibraryWatchState } from "./api";
import { createLibraryWatchPoller, sameLibraryWatchState } from "./libraryWatch";

const state: ApiLibraryWatchState = { enabled: true, scanningRoots: [], lastScanAt: 123, lastError: null };
const library: ApiLibraryIndex = { roots: [], tracks: [], updatedAt: null };

describe("library watcher", () => {
  it("retries the same scan after a failed library read", async () => {
    const getLibrary = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(library);
    const onLibrary = vi.fn();
    const poller = createLibraryWatchPoller({ getState: vi.fn().mockResolvedValue(state), getLibrary, onState: vi.fn(), onLibrary });
    await poller.poll();
    expect(onLibrary).not.toHaveBeenCalled();
    await poller.poll();
    expect(onLibrary).toHaveBeenCalledWith(library);
    await poller.poll();
    expect(getLibrary).toHaveBeenCalledTimes(2);
    poller.dispose();
  });

  it("does not overlap polls and aborts the pending request on disposal", async () => {
    let finish!: (value: ApiLibraryWatchState) => void;
    let signal: AbortSignal | undefined;
    const getState = vi.fn((requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise<ApiLibraryWatchState>((resolve) => { finish = resolve; });
    });
    const onState = vi.fn();
    const poller = createLibraryWatchPoller({ getState, getLibrary: vi.fn().mockResolvedValue(library), onState, onLibrary: vi.fn() });
    const first = poller.poll();
    await poller.poll();
    expect(getState).toHaveBeenCalledTimes(1);
    poller.dispose();
    expect(signal?.aborted).toBe(true);
    finish(state);
    await first;
    expect(onState).not.toHaveBeenCalled();
  });

  it("treats equivalent watch states as unchanged", () => {
    expect(sameLibraryWatchState(state, { ...state, scanningRoots: [] })).toBe(true);
    expect(sameLibraryWatchState(state, { ...state, lastScanAt: 124 })).toBe(false);
    expect(sameLibraryWatchState(state, { ...state, scanningRoots: ["music"] })).toBe(false);
  });
});
