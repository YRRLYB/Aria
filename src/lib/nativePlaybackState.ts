import type { NativeAudioState } from "./audioTypes";
import { commitPlaybackTime } from "./playbackClock";

// The Chromium audio element is an optional, silent analyser copy during
// native playback. Its seekability must never gate the authoritative clock.
export function syncNativePlaybackClock(state: NativeAudioState, analyserAudio: Pick<HTMLAudioElement, "currentTime"> | null) {
  if (!Number.isFinite(state.position)) return;
  const position = Math.max(0, state.position);
  commitPlaybackTime(position, ["loaded", "advanced", "seek", "ended"].includes(state.kind ?? ""));
  if (!analyserAudio) return;
  try {
    if (Math.abs(analyserAudio.currentTime - position) >= 0.45) analyserAudio.currentTime = position;
  } catch {
    // Metadata/seekable ranges may lag the native decoder after a drag. The
    // next progress event can retry the analyser without freezing the UI.
  }
}

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
