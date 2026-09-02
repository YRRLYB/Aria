export const spectrumBandCount = 64;

export type SpectrumSnapshot = {
  levels: Float32Array;
  peaks: Float32Array;
  rms: number;
  peak: number;
  signal: number;
  live: boolean;
};

export type SpectrumEngineOptions = {
  analyser: AnalyserNode | null;
  fallback: number[];
  playing: boolean;
  outputVolume: number;
  outputMode: "system" | "shared" | "exclusive";
  now: number;
};

const minHz = 32;
const maxVisualHz = 18000;
const minRenderableLevel = 0.018;
const noiseGate = 0.008;

export function configureSpectrumAnalyser(analyser: AnalyserNode) {
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.18;
  analyser.minDecibels = -100;
  analyser.maxDecibels = -8;
}

export class RealtimeSpectrumEngine {
  private readonly levels = new Float32Array(spectrumBandCount);
  private readonly peaks = new Float32Array(spectrumBandCount);
  private readonly noiseFloor = new Float32Array(spectrumBandCount);
  private readonly targetBands = new Float32Array(spectrumBandCount);
  // Per-band shaping depends only on the band index; precomputing it removes
  // three transcendental evaluations per band from every animation frame.
  private readonly bandVoiceLift = new Float32Array(spectrumBandCount);
  private readonly bandHighLift = new Float32Array(spectrumBandCount);
  private readonly bandLowTrim = new Float32Array(spectrumBandCount);
  private frequencyData = new Float32Array(0);
  private timeData = new Float32Array(0);
  private autoGain = 1.35;
  private lastNow = 0;
  private silentFrames = 0;

  constructor() {
    this.noiseFloor.fill(0.012);
    for (let index = 0; index < spectrumBandCount; index += 1) {
      const position = index / Math.max(1, spectrumBandCount - 1);
      this.bandVoiceLift[index] = 1 + Math.exp(-Math.pow((position - 0.42) / 0.22, 2)) * 0.2;
      this.bandHighLift[index] = 1 + Math.max(0, position - 0.68) * 0.52;
      this.bandLowTrim[index] = position < 0.1 ? 0.84 + position * 1.6 : 1;
    }
  }

  reset() {
    this.levels.fill(0);
    this.peaks.fill(0);
    this.noiseFloor.fill(0.012);
    this.autoGain = 1.35;
    this.lastNow = 0;
    this.silentFrames = 0;
  }

  read(options: SpectrumEngineOptions): SpectrumSnapshot {
    const now = options.now;
    const deltaMs = this.lastNow > 0 ? Math.min(80, Math.max(8, now - this.lastNow)) : 16.7;
    this.lastNow = now;

    if (!options.playing) {
      this.decay(deltaMs, false);
      return this.snapshot(0, 0, false);
    }

    const analyser = options.analyser;
    if (!analyser) {
      this.mixWarmupFallback(options.fallback, now, deltaMs);
      return this.snapshot(0, 0, true);
    }

    this.ensureBuffers(analyser);
    analyser.getFloatFrequencyData(this.frequencyData);
    analyser.getFloatTimeDomainData(this.timeData);

    const dynamics = readDynamics(this.timeData);
    const frequencyEnergy = this.mapFrequencyBands(analyser, options);
    const live = dynamics.rms > 0.0018 || dynamics.peak > 0.006 || frequencyEnergy.signal > noiseGate;

    if (!live) {
      this.silentFrames += 1;
      this.decay(deltaMs, true);
      if (this.silentFrames < 72) {
        this.mixWarmupFallback(options.fallback, now, deltaMs);
      }
      return this.snapshot(dynamics.rms, dynamics.peak, false);
    }

    this.silentFrames = 0;
    const loudness = Math.max(0.012, dynamics.rms * 1.8 + frequencyEnergy.signal * 0.86 + dynamics.peak * 0.18);
    const targetGain = clamp(0.44 / loudness, 0.78, 4.2);
    this.autoGain += (targetGain - this.autoGain) * 0.026;

    const visualVolume = Math.pow(clamp(options.outputVolume / 100, 0, 1), 0.72);
    const outputScale = 0.18 + visualVolume * 0.82;
    const modeCompensation = options.outputMode === "system" ? 0.98 : 1.04;
    const attack = 1 - Math.pow(0.26, deltaMs / 16.7);
    const release = 1 - Math.pow(0.78, deltaMs / 16.7);
    const peakRelease = 0.18 * (deltaMs / 16.7);

    for (let index = 0; index < spectrumBandCount; index += 1) {
      const voiceLift = this.bandVoiceLift[index];
      const highLift = this.bandHighLift[index];
      const lowTrim = this.bandLowTrim[index];
      const target = clamp(
        Math.pow(frequencyEnergy.bands[index] * this.autoGain * outputScale * modeCompensation * voiceLift * highLift * lowTrim, 0.78),
        0,
        0.98,
      );
      const coefficient = target > this.levels[index] ? attack : release;
      this.levels[index] += (target - this.levels[index]) * coefficient;
      if (target > this.peaks[index]) {
        this.peaks[index] = target;
      } else {
        this.peaks[index] = Math.max(this.levels[index], this.peaks[index] - peakRelease);
      }
    }

    return this.snapshot(dynamics.rms, dynamics.peak, true);
  }

  private ensureBuffers(analyser: AnalyserNode) {
    if (this.frequencyData.length !== analyser.frequencyBinCount) {
      this.frequencyData = new Float32Array(analyser.frequencyBinCount);
    }
    if (this.timeData.length !== analyser.fftSize) {
      this.timeData = new Float32Array(analyser.fftSize);
    }
  }

  private mapFrequencyBands(analyser: AnalyserNode, options: SpectrumEngineOptions) {
    const bands = this.targetBands;
    bands.fill(0);
    const sampleRate = analyser.context.sampleRate || 44100;
    const binHz = sampleRate / analyser.fftSize;
    const maxHz = Math.min(maxVisualHz, sampleRate / 2);
    const minDb = analyser.minDecibels;
    const maxDb = analyser.maxDecibels;
    let signal = 0;

    for (let band = 0; band < spectrumBandCount; band += 1) {
      const startHz = logInterpolate(minHz, maxHz, band / spectrumBandCount);
      const endHz = logInterpolate(minHz, maxHz, (band + 1) / spectrumBandCount);
      const startBin = Math.max(1, Math.floor(startHz / binHz));
      const endBin = Math.min(this.frequencyData.length - 1, Math.max(startBin + 1, Math.ceil(endHz / binHz)));
      let weighted = 0;
      let weight = 0;
      let bandPeak = 0;

      for (let bin = startBin; bin <= endBin; bin += 1) {
        const frequency = bin * binHz;
        const normalizedDb = clamp((this.frequencyData[bin] - minDb) / Math.max(1, maxDb - minDb), 0, 1);
        const perceptual = Math.pow(normalizedDb, 1.52);
        const binWeight = frequencyWeight(frequency);
        weighted += perceptual * binWeight;
        weight += binWeight;
        bandPeak = Math.max(bandPeak, perceptual);
      }

      const raw = weight > 0 ? weighted / weight : 0;
      const noise = this.noiseFloor[band];
      this.noiseFloor[band] += (Math.min(raw, noise) - noise) * 0.006;
      const cleaned = Math.max(0, raw - noise * 0.72);
      bands[band] = clamp(cleaned * 0.98 + bandPeak * 0.2, 0, 1);
      signal += bands[band];
    }

    return {
      bands,
      signal: signal / spectrumBandCount,
    };
  }

  private mixWarmupFallback(fallback: number[], now: number, deltaMs: number) {
    const attack = 1 - Math.pow(0.72, deltaMs / 16.7);
    for (let index = 0; index < spectrumBandCount; index += 1) {
      const floor = getFallbackFloor(fallback, index, now) * 1.8;
      this.levels[index] += (floor - this.levels[index]) * attack;
      this.peaks[index] = Math.max(this.peaks[index] * 0.98, this.levels[index]);
    }
  }

  private decay(deltaMs: number, keepFloor: boolean) {
    const release = 1 - Math.pow(0.72, deltaMs / 16.7);
    const peakRelease = 0.24 * (deltaMs / 16.7);
    for (let index = 0; index < spectrumBandCount; index += 1) {
      const target = keepFloor ? minRenderableLevel : 0;
      this.levels[index] += (target - this.levels[index]) * release;
      this.peaks[index] = Math.max(this.levels[index], this.peaks[index] - peakRelease);
    }
  }

  private snapshot(rms: number, peak: number, live: boolean): SpectrumSnapshot {
    let signal = 0;
    for (let index = 0; index < this.levels.length; index += 1) {
      signal += this.levels[index];
    }
    return {
      levels: this.levels,
      peaks: this.peaks,
      rms,
      peak,
      signal: signal / this.levels.length,
      live,
    };
  }
}

function readDynamics(timeData: Float32Array) {
  if (!timeData.length) return { rms: 0, peak: 0 };
  let squareSum = 0;
  let peak = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const sample = timeData[index] || 0;
    squareSum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    rms: Math.sqrt(squareSum / timeData.length),
    peak,
  };
}

function getFallbackFloor(fallback: number[], band: number, now: number) {
  const source = fallback.length ? fallback[band % fallback.length] ?? 34 : 34 + ((band * 17) % 38);
  const slowPhase = Math.sin(now / 620 + band * 0.37) * 0.5 + 0.5;
  const fastPhase = Math.sin(now / 190 + band * 0.91) * 0.5 + 0.5;
  const shaped = Math.pow(clamp(source / 100, 0.08, 0.95), 0.82);
  return clamp(shaped * 0.11 + slowPhase * 0.04 + fastPhase * 0.018, 0.035, 0.18);
}

// The player surface is mounted and unmounted while the audio graph keeps
// running. Reusing the engine preserves its smoothed levels across navigation
// and prevents a visible reset when the player page is opened again.
const analyserEngines = new WeakMap<AnalyserNode, RealtimeSpectrumEngine>();
const fallbackEngine = new RealtimeSpectrumEngine();

export function getSpectrumEngine(analyser: AnalyserNode | null) {
  if (!analyser) return fallbackEngine;

  const existing = analyserEngines.get(analyser);
  if (existing) return existing;

  const engine = new RealtimeSpectrumEngine();
  analyserEngines.set(analyser, engine);
  return engine;
}

function frequencyWeight(frequency: number) {
  const bass = frequency < 140 ? 0.92 : 1;
  const presence = frequency > 1400 && frequency < 5200 ? 1.15 : 1;
  const air = frequency > 9000 ? 1.24 : 1;
  return bass * presence * air;
}

function logInterpolate(start: number, end: number, ratio: number) {
  return start * Math.pow(end / start, ratio);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
