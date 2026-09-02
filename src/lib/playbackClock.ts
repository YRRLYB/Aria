import { useSyncExternalStore } from "react";

// Playback time lives outside React state on purpose: it ticks ~4x per second
// and every App-level state update re-renders the whole tree. Components that
// need the playhead subscribe here individually (progress rows, lyric
// highlight), so the rest of the app never re-renders during playback.
let currentTime = 0;
const listeners = new Set<() => void>();
const lastWrite = { at: 0, time: 0 };

function emit() {
  for (const listener of listeners) listener();
}

export function getPlaybackTime(): number {
  return currentTime;
}

export function subscribePlaybackTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Same throttle as the pre-store commitCurrentTime: at most ~3 renders/second.
export function commitPlaybackTime(seconds: number, force = false) {
  const safeTime = Math.max(0, Number(seconds) || 0);
  const now = performance.now();
  if (!force && Math.abs(safeTime - lastWrite.time) < 0.3 && now - lastWrite.at < 320) return;
  lastWrite.at = now;
  lastWrite.time = safeTime;
  currentTime = safeTime;
  emit();
}

export function resetPlaybackTime() {
  lastWrite.at = performance.now();
  lastWrite.time = 0;
  if (currentTime === 0) return;
  currentTime = 0;
  emit();
}

export function usePlaybackTime(): number {
  return useSyncExternalStore(subscribePlaybackTime, getPlaybackTime, getPlaybackTime);
}
