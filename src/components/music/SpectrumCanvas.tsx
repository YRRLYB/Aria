import { useEffect, useRef } from "react";
import type { AudioOutputMode, CoverPalette } from "@/lib/playerPresentation";
import { colorWithAlpha } from "@/lib/playerPresentation";

const spectrumProfile = {
  floor: 0.045,
  ceiling: 0.94,
  power: 0.86,
  smoothing: 0.28,
  release: 0.68,
  breathing: 0.018,
};

export function SpectrumCanvas({
  analyserRef,
  playing,
  active,
  palette,
  fallback,
  outputMode,
  outputVolume,
}: {
  analyserRef: { current: AnalyserNode | null };
  playing: boolean;
  active: boolean;
  palette: CoverPalette;
  fallback: number[];
  outputMode: AudioOutputMode;
  outputVolume: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsRef = useRef<number[]>(Array.from({ length: 42 }, () => 0.1));
  const autoGainRef = useRef(1.25);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active || !playing) {
      clearCanvas(canvas);
      levelsRef.current = levelsRef.current.map(() => 0);
      return;
    }

    let frame = 0;
    let frequencyData = new Uint8Array(0);
    let timeData = new Uint8Array(0);
    const draw = () => {
      const prepared = prepareCanvas(canvas);
      if (!prepared) return;
      const { context, dpr, height, width } = prepared;

      const analyser = analyserRef.current;
      if (analyser) {
        if (frequencyData.length !== analyser.frequencyBinCount) {
          frequencyData = new Uint8Array(analyser.frequencyBinCount);
        }
        if (timeData.length !== analyser.fftSize) {
          timeData = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteFrequencyData(frequencyData);
        analyser.getByteTimeDomainData(timeData);
      }

      const barCount = levelsRef.current.length;
      const now = performance.now();
      const globalWave = analyser
        ? timeData.reduce((sum, value) => sum + Math.abs(value - 128), 0) / timeData.length / 48
        : 0;
      const loudness = analyser ? getFrameLoudness(frequencyData, timeData) : 0;
      const targetAutoGain = loudness > 0.01 ? Math.min(3.8, Math.max(0.82, 0.38 / loudness)) : 1.25;
      autoGainRef.current = autoGainRef.current * 0.95 + targetAutoGain * 0.05;
      const audibleScale = outputMode === "system" ? 1 : Math.max(0.08, Math.min(1.05, outputVolume / 100));

      context.clearRect(0, 0, width, height);
      const gap = 6 * dpr;
      const barWidth = Math.max(2 * dpr, (width - gap * (barCount - 1)) / barCount);
      const baseline = height * 0.82;
      const maxBarHeight = height * 0.58;
      const barGradient = context.createLinearGradient(0, baseline - maxBarHeight, 0, baseline);
      barGradient.addColorStop(0, colorWithAlpha(palette.secondary, 0.9));
      barGradient.addColorStop(0.75, colorWithAlpha(palette.primary, 0.82));
      barGradient.addColorStop(1, colorWithAlpha(palette.primary, 0.56));

      context.strokeStyle = colorWithAlpha(palette.primary, 0.2);
      context.lineWidth = 1 * dpr;
      context.beginPath();
      context.moveTo(0, baseline + 0.5 * dpr);
      context.lineTo(width, baseline + 0.5 * dpr);
      context.stroke();

      for (let index = 0; index < barCount; index += 1) {
        const logStart = Math.floor(Math.pow(index / barCount, 1.18) * frequencyData.length * 0.82);
        const logEnd = Math.max(
          logStart + 1,
          Math.floor(Math.pow((index + 1) / barCount, 1.18) * frequencyData.length * 0.82),
        );
        const foldedBand = Math.max(1, Math.floor(frequencyData.length * 0.42));
        const foldedIndex = frequencyData.length
          ? (index * 3 + Math.floor(index / 4)) % foldedBand
          : 0;
        const linearIndex = Math.min(
          frequencyData.length - 1,
          Math.floor((index / Math.max(1, barCount - 1)) * (frequencyData.length - 1)),
        );
        const mirrorIndex = Math.max(0, frequencyData.length - 1 - linearIndex);
        let bandEnergy = 0;
        for (let cursor = logStart; cursor < logEnd; cursor += 1) {
          bandEnergy += frequencyData[cursor] ?? 0;
        }
        const timeIndex = timeData.length ? Math.floor((index / barCount) * timeData.length) : 0;
        const timeEnergy = timeData.length ? Math.abs((timeData[timeIndex] ?? 128) - 128) / 96 : 0;
        const spectralEnergy = analyser
          ? (bandEnergy / (logEnd - logStart) +
              (frequencyData[linearIndex] ?? 0) * 0.28 +
              (frequencyData[mirrorIndex] ?? 0) * 0.08 +
              (frequencyData[foldedIndex] ?? 0) * 0.36 +
              (frequencyData[Math.max(1, foldedIndex - 1)] ?? 0) * 0.16) /
            (255 * 1.6)
          : (fallback[index % fallback.length] ?? 18) / 100;
        const energy = analyser
          ? Math.pow(
              Math.min(
                spectrumProfile.ceiling,
                (spectralEnergy * 0.84 + timeEnergy * 0.34 + globalWave * 0.16) * autoGainRef.current * audibleScale,
              ),
              spectrumProfile.power,
            )
          : spectralEnergy;

        const phase = Math.sin(now / (210 + index * 3.2) + index * 0.42);
        const breathing = playing
          ? (phase + 1) * spectrumProfile.breathing +
            Math.abs(Math.sin(now / 320 + index * 0.42)) * spectrumProfile.breathing * 0.7
          : 0;
        const target = playing
          ? Math.min(spectrumProfile.ceiling, Math.max(spectrumProfile.floor, energy + breathing))
          : Math.max(0, levelsRef.current[index] * spectrumProfile.release);
        levelsRef.current[index] =
          levelsRef.current[index] * (1 - spectrumProfile.smoothing) + target * spectrumProfile.smoothing;

        const x = index * (barWidth + gap);
        const barHeight = Math.max(3 * dpr, levelsRef.current[index] * maxBarHeight);
        const radius = Math.min(barWidth / 2, 10 * dpr);

        context.fillStyle = barGradient;
        roundedRect(context, x, baseline - barHeight, barWidth, barHeight, radius);
        context.fill();
      }

      frame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, analyserRef, fallback, outputMode, outputVolume, palette.primary, palette.secondary, playing]);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-36 w-full transition-opacity duration-300 sm:h-40 2xl:h-56 ${active && playing ? "opacity-100" : "opacity-0"}`}
      aria-hidden="true"
    />
  );
}

function getFrameLoudness(frequencyData: Uint8Array, timeData: Uint8Array) {
  if (!frequencyData.length || !timeData.length) return 0;

  let weightedFrequency = 0;
  let weight = 0;
  let peak = 0;
  const usableBins = Math.max(1, Math.floor(frequencyData.length * 0.78));
  for (let index = 1; index < usableBins; index += 1) {
    const bin = (frequencyData[index] ?? 0) / 255;
    const binWeight = 1 + Math.max(0, 1 - index / usableBins) * 0.8;
    weightedFrequency += bin * binWeight;
    weight += binWeight;
    peak = Math.max(peak, bin);
  }

  let squareSum = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const centered = ((timeData[index] ?? 128) - 128) / 128;
    squareSum += centered * centered;
  }

  const frequencyMean = weightedFrequency / Math.max(1, weight);
  const rms = Math.sqrt(squareSum / timeData.length);
  return frequencyMean * 0.68 + peak * 0.18 + rms * 1.15;
}

function prepareCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.75, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { context, dpr, height, width };
}

function clearCanvas(canvas: HTMLCanvasElement) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  prepared.context.clearRect(0, 0, prepared.width, prepared.height);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}
