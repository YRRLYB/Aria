import type { NativeAudioState } from "./audioTypes";

// Time is consumed through playbackClock; bitrate is not displayed from this
// snapshot. Avoid waking the entire component tree for either continuous tick.
export function nativePlaybackStateChanged(previous: NativeAudioState | null, next: NativeAudioState): boolean {
  if (!previous || next.kind !== "progress") return true;
  return previous.supported !== next.supported || previous.ready !== next.ready ||
    previous.active !== next.active || previous.trackId !== next.trackId ||
    previous.url !== next.url || previous.duration !== next.duration ||
    previous.paused !== next.paused || previous.volume !== next.volume ||
    previous.exclusive !== next.exclusive || previous.deviceId !== next.deviceId ||
    previous.gaplessGeneration !== next.gaplessGeneration;
}
