import { describe, expect, it } from "vitest";
import {
  MIN_VOLUME_DB,
  clampUiVolume,
  uiVolumeToDb,
  uiVolumeToLinearGain,
  uiVolumeToMpvVolume,
  uiVolumeToSpectrumScale,
} from "./audioVolume";

describe("audioVolume", () => {
  it("maps boundaries and clamps invalid inputs", () => {
    expect(clampUiVolume(Number.NaN)).toBe(0);
    expect(clampUiVolume(-10)).toBe(0);
    expect(clampUiVolume(140)).toBe(100);

    expect(uiVolumeToLinearGain(0)).toBe(0);
    expect(uiVolumeToLinearGain(100)).toBe(1);
    expect(uiVolumeToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(uiVolumeToDb(100)).toBe(0);
    expect(uiVolumeToMpvVolume(0)).toBe(0);
    expect(uiVolumeToMpvVolume(100)).toBe(100);
    expect(uiVolumeToSpectrumScale(0)).toBe(0);
    expect(uiVolumeToSpectrumScale(100)).toBeCloseTo(1, 6);
  });

  it("maintains equal constant dB increments per slider step from 1 to 100", () => {
    const expectedStepDb = Math.abs(MIN_VOLUME_DB) / 100;
    let previousGain = uiVolumeToLinearGain(1);
    expect(previousGain).toBeGreaterThan(0.005);

    for (let v = 2; v <= 100; v += 1) {
      const currentGain = uiVolumeToLinearGain(v);
      expect(currentGain).toBeGreaterThan(previousGain);
      const stepDb = 20 * Math.log10(currentGain / previousGain);
      expect(stepDb).toBeCloseTo(expectedStepDb, 6);
      previousGain = currentGain;
    }

    const lowStepDb = 20 * Math.log10(uiVolumeToLinearGain(2) / uiVolumeToLinearGain(1));
    const highStepDb = 20 * Math.log10(uiVolumeToLinearGain(100) / uiVolumeToLinearGain(99));
    expect(lowStepDb).toBeCloseTo(highStepDb, 6);
  });

  it("inverts mpv cubic scaling so native and WebAudio gain match across 0..100", () => {
    for (let v = 0; v <= 100; v += 1) {
      const mpvVol = uiVolumeToMpvVolume(v);
      const mpvAmplitude = (mpvVol / 100) ** 3;
      expect(mpvAmplitude).toBeCloseTo(uiVolumeToLinearGain(v), 5);
    }
  });
});
