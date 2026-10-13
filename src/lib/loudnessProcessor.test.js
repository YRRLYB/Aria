import { describe, expect, it } from "vitest";
import { desiredLoudnessGain, LoudnessController } from "./loudnessProcessor.js";

describe("loudness normalization", () => {
  it("leaves silence and noise alone and bounds compensation", () => {
    expect(desiredLoudnessGain(0)).toBe(1);
    expect(desiredLoudnessGain(0.002)).toBe(1);
    expect(desiredLoudnessGain(0.01)).toBe(4);
    expect(desiredLoudnessGain(1)).toBe(0.25);
  });

  it("converges different song levels without altering stereo balance", () => {
    const measure = (level) => {
      const controller = new LoudnessController(48000);
      const left = new Float32Array(128).fill(level);
      const right = new Float32Array(128).fill(level / 2);
      const output = [new Float32Array(128), new Float32Array(128)];
      for (let block = 0; block < 5000; block += 1) controller.process([[left, right]], [output]);
      expect(output[0][0] / output[1][0]).toBeCloseTo(2);
      return Math.hypot(output[0][0], output[1][0]) / Math.SQRT2;
    };
    expect(measure(0.05)).toBeCloseTo(measure(0.5), 2);
  });

  it("limits a loud transient after quiet audio without clipping", () => {
    const controller = new LoudnessController(48000);
    const quiet = new Float32Array(128).fill(0.03);
    const output = [new Float32Array(128)];
    for (let block = 0; block < 3000; block += 1) controller.process([[quiet]], [output]);
    controller.process([[new Float32Array(128).fill(1)]], [output]);
    expect(Math.max(...output[0])).toBeLessThanOrEqual(0.950001);
    controller.process([[new Float32Array(128)]], [output]);
    expect(output[0].every((value) => value === 0)).toBe(true);
  });
});
