import type { NativeAudioState } from "./audioTypes";
import { commitPlaybackTime } from "./playbackClock";

// The Chromium audio element is an optional, silent analyser copy during
// native playback. Its seekability must never gate the authoritative clock.
const ANALYSER_PLAYING_LOOKAHEAD_SEC = 0.04;
const ANALYSER_HARD_SEEK_DRIFT_SEC = 0.18;
const ANALYSER_MICRO_SYNC_DRIFT_SEC = 0.035;

export function syncNativePlaybackClock(
  state: NativeAudioState,
  analyserAudio: (Pick<HTMLAudioElement, "currentTime"> & Partial<Pick<HTMLAudioElement, "playbackRate" | "paused">>) | null,
) {
  if (!Number.isFinite(state.position)) return;
  const position = Math.max(0, state.position);
  commitPlaybackTime(position, ["loaded", "advanced", "seek", "ended"].includes(state.kind ?? ""));
  if (!analyserAudio) return;
  try {
    const target = !state.paused && state.kind === "progress"
      ? position + ANALYSER_PLAYING_LOOKAHEAD_SEC
      : position;
    const drift = target - analyserAudio.currentTime;
    if (!Number.isFinite(drift) || Math.abs(drift) >= ANALYSER_HARD_SEEK_DRIFT_SEC) {
      analyserAudio.currentTime = target;
      if (typeof analyserAudio.playbackRate === "number" && analyserAudio.playbackRate !== 1) {
        analyserAudio.playbackRate = 1;
      }
      return;
    }
    if (typeof analyserAudio.playbackRate === "number") {
      if (!state.paused && analyserAudio.paused !== true && Math.abs(drift) >= ANALYSER_MICRO_SYNC_DRIFT_SEC) {
        analyserAudio.playbackRate = drift > 0 ? 1.06 : 0.94;
      } else if (analyserAudio.playbackRate !== 1) {
        analyserAudio.playbackRate = 1;
      }
    }
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
