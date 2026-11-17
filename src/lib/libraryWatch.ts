import type { ApiLibraryIndex, ApiLibraryWatchState } from "@/lib/api";

export function sameLibraryWatchState(left: ApiLibraryWatchState | null, right: ApiLibraryWatchState) {
  return Boolean(left && left.enabled === right.enabled && left.lastScanAt === right.lastScanAt && left.lastError === right.lastError &&
    left.scanningRoots.length === right.scanningRoots.length && left.scanningRoots.every((root, index) => root === right.scanningRoots[index]));
}

export function createLibraryWatchPoller(options: {
  getState: (signal: AbortSignal) => Promise<ApiLibraryWatchState>;
  getLibrary: (signal: AbortSignal) => Promise<ApiLibraryIndex>;
  onState: (state: ApiLibraryWatchState) => void;
  onLibrary: (library: ApiLibraryIndex) => void;
  timeoutMs?: number;
}) {
  let lastAppliedScan: number | null = null;
  let inFlight = false;
  let disposed = false;
  let controller: AbortController | null = null;

  return {
    async poll() {
      if (disposed || inFlight) return;
      inFlight = true;
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), options.timeoutMs ?? 30_000);
      try {
        const state = await options.getState(request.signal);
        if (disposed || request.signal.aborted) return;
        options.onState(state);
        if (!state.lastScanAt || state.lastScanAt === lastAppliedScan) return;
        const library = await options.getLibrary(request.signal);
        if (disposed || request.signal.aborted) return;
        options.onLibrary(library);
        // A failed library fetch must not consume this scan; retry next time.
        lastAppliedScan = state.lastScanAt;
      } catch {
        // Backend startup and transient network failures are retried next poll.
      } finally {
        clearTimeout(timeout);
        if (controller === request) controller = null;
        inFlight = false;
      }
    },
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}
