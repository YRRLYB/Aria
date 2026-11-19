import { describe, expect, it } from "vitest";
import type { NativeAudioState } from "./audioTypes";
import { nativePlaybackStateChanged, syncNativePlaybackClock } from "./nativePlaybackState";
import { getPlaybackTime, resetPlaybackTime } from "./playbackClock";

const state: NativeAudioState = {
  supported: true, ready: true, active: true, trackId: "one", url: "one.flac",
  position: 0, duration: 180, paused: false, volume: 50, exclusive: false,
  deviceId: "auto", bitrate: 1000000, kind: "progress", gaplessGeneration: 0,
};

describe("native playback presentation", () => {
  it("does not re-render the app for a full song of time and VBR ticks", () => {
    for (let position = 0; position < 180; position += 0.1) {
      expect(nativePlaybackStateChanged(state, { ...state, position, bitrate: position * 1000 })).toBe(false);
    }
  });
  it("publishes track, device, pause, duration and lifecycle transitions immediately", () => {
    for (const change of [
      { trackId: "two" }, { paused: true }, { active: false }, { ready: false },
      { exclusive: true }, { deviceId: "usb" }, { duration: 240 },
      { gaplessGeneration: 1 }, { kind: "loaded" }, { kind: "seek" }, { kind: "ended" },
    ]) expect(nativePlaybackStateChanged(state, { ...state, ...change })).toBe(true);
    expect(nativePlaybackStateChanged(null, state)).toBe(true);
  });
  it("keeps progress and lyrics ticking when the silent analyser cannot seek", () => {
    resetPlaybackTime();
    const analyser = {
      get currentTime() { return 0; },
      set currentTime(_position: number) { throw new DOMException("No seekable metadata", "InvalidStateError"); },
    };
    expect(() => syncNativePlaybackClock({ ...state, position: 75, kind: "seek" }, analyser)).not.toThrow();
    expect(getPlaybackTime()).toBe(75);
    syncNativePlaybackClock({ ...state, position: 75.5 }, analyser);
    expect(getPlaybackTime()).toBe(75.5);
    syncNativePlaybackClock({ ...state, position: 76 }, null);
    expect(getPlaybackTime()).toBe(76);
  });

  it("tightly phase-locks the bypass analyser to native progress ticks", () => {
    resetPlaybackTime();
    const analyser = {
      currentTime: 10,
      playbackRate: 1,
      paused: false,
    };

    // Within 0.035s of target (10 + 0.04 lookahead = 10.04): holds 1.0x speed.
    syncNativePlaybackClock({ ...state, position: 9.97, kind: "progress" }, analyser);
    expect(analyser.currentTime).toBe(10);
    expect(analyser.playbackRate).toBe(1);

    // Moderate drift (0.035s..0.18s): micro-nudges playbackRate instead of audible seek jitter.
    syncNativePlaybackClock({ ...state, position: 10.08, kind: "progress" }, analyser);
    expect(analyser.currentTime).toBe(10);
    expect(analyser.playbackRate).toBe(1.06);

    syncNativePlaybackClock({ ...state, position: 9.9, kind: "progress" }, analyser);
    expect(analyser.currentTime).toBe(10);
    expect(analyser.playbackRate).toBe(0.94);

    // Larger drift (>= 0.18s): hard-seeks to target and resets playbackRate to 1.
    syncNativePlaybackClock({ ...state, position: 10.5, kind: "progress" }, analyser);
    expect(analyser.currentTime).toBeCloseTo(10.54, 4);
    expect(analyser.playbackRate).toBe(1);
  });
});
