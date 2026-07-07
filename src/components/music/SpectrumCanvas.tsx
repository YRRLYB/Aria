import { useEffect, useRef } from "react";
import type { CoverPalette } from "@/lib/playerPresentation";
import { colorWithAlpha } from "@/lib/playerPresentation";

export function SpectrumCanvas({
  analyserRef,
  playing,
  active,
  palette,
  fallback,
}: {
  analyserRef: { current: AnalyserNode | null };
  playing: boolean;
  active: boolean;
  palette: CoverPalette;
  fallback: number[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsRef = useRef<number[]>(Array.from({ length: 42 }, () => 0.1));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active || !playing) return;

    let frame = 0;
    let frequencyData = new Uint8Array(0);
    let timeData = new Uint8Array(0);
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(1.75, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

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
          ? Math.pow(Math.min(1, spectralEnergy * 1.7 + timeEnergy * 0.3 + globalWave * 0.12), 0.88)
          : spectralEnergy;

        const phase = Math.sin(now / (210 + index * 3.2) + index * 0.42);
        const breathing = playing
          ? (phase + 1) * 0.032 + Math.abs(Math.sin(now / 320 + index * 0.42)) * 0.028
          : 0;
        const target = playing
          ? Math.min(1, Math.max(0.08, energy * 0.86 + globalWave * 0.24 + breathing))
          : Math.max(0.05, levelsRef.current[index] * 0.92);
        levelsRef.current[index] = levelsRef.current[index] * 0.72 + target * 0.28;

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
  }, [active, analyserRef, fallback, palette.primary, palette.secondary, playing]);

  return <canvas ref={canvasRef} className="block h-36 w-full sm:h-40 2xl:h-56" aria-hidden="true" />;
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
