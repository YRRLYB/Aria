// A slow RMS controller: do not turn silence or background noise into music.
// Keep the user volume downstream so changing it cannot trigger compensation.
export function desiredLoudnessGain(rms) {
  return rms < 0.003 ? 1 : Math.min(4, Math.max(0.25, 0.12 / rms));
}

export class LoudnessController {
  constructor(rate) {
    this.rate = rate;
    this.power = 0;
    this.gain = 1;
    this.limiter = 1;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length || !output?.length) return;
    const frames = output[0].length;
    let power = 0;
    let peak = 0;
    for (const channel of input) {
      for (let i = 0; i < frames; i += 1) {
        const value = channel[i] || 0;
        power += value * value;
        peak = Math.max(peak, Math.abs(value));
      }
    }
    const seconds = frames / this.rate;
    this.power += (power / (frames * input.length) - this.power) * (1 - Math.exp(-seconds / 1.5));
    const target = desiredLoudnessGain(Math.sqrt(this.power));
    this.gain += (target - this.gain) * (1 - Math.exp(-seconds / (target < this.gain ? 0.35 : 2)));
    const peakLimit = peak > 0 ? Math.min(1, 0.95 / (peak * this.gain)) : 1;
    this.limiter = peakLimit < this.limiter ? peakLimit : this.limiter + (peakLimit - this.limiter) * (1 - Math.exp(-seconds / 0.15));
    const gain = this.gain * this.limiter;
    for (let c = 0; c < output.length; c += 1) {
      const source = input[Math.min(c, input.length - 1)];
      for (let i = 0; i < frames; i += 1) output[c][i] = (source[i] || 0) * gain;
    }
  }
}

if (typeof registerProcessor === "function") {
  class AriaLoudnessProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.controller = new LoudnessController(sampleRate);
      this.port.onmessage = () => { this.controller = new LoudnessController(sampleRate); };
    }

    process(inputs, outputs) {
      this.controller.process(inputs, outputs);
      return true;
    }
  }
  registerProcessor("aria-loudness", AriaLoudnessProcessor);
}
