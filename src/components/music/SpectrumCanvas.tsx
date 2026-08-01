import { useEffect, useRef } from "react";
import type { AudioOutputMode, CoverPalette } from "@/lib/playerPresentation";
import { colorWithAlpha } from "@/lib/playerPresentation";
import { getSpectrumEngine } from "@/lib/spectrumEngine";

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
  const engineRef = useRef<ReturnType<typeof getSpectrumEngine> | null>(null);
  const lastPaintAtRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active) {
      return;
    }

    let frame = 0;
    const draw = () => {
      const prepared = prepareCanvas(canvas);
      if (!prepared) return;
      const now = performance.now();
      if (now - lastPaintAtRef.current < 33) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastPaintAtRef.current = now;

      const engine = getSpectrumEngine(analyserRef.current);
      engineRef.current = engine;
      const snapshot = engine.read({
        analyser: analyserRef.current,
        fallback,
        now,
        outputMode,
        outputVolume,
        playing,
      });

      renderSpectrum(prepared, snapshot.levels, snapshot.peaks, palette, snapshot.live);
      if (playing || snapshot.signal > 0.018) {
        frame = window.requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, analyserRef, fallback, outputMode, outputVolume, palette.primary, palette.secondary, playing]);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-32 w-full sm:h-36 2xl:h-48 ${active ? "opacity-100" : "opacity-0"}`}
      aria-hidden="true"
    />
  );
}

type PreparedCanvas = {
  context: CanvasRenderingContext2D;
  dpr: number;
  height: number;
  width: number;
};

function renderSpectrum(
  { context, dpr, height, width }: PreparedCanvas,
  levels: Float32Array,
  peaks: Float32Array,
  palette: CoverPalette,
  live: boolean,
) {
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";

  const bandCount = levels.length;
  const gap = Math.max(2.2 * dpr, Math.min(5.5 * dpr, width / 180));
  const barWidth = Math.max(2.8 * dpr, (width - gap * (bandCount - 1)) / bandCount);
  const baseline = height * 0.82;
  const maxBarHeight = height * 0.7;
  const radius = Math.min(barWidth / 2, 6 * dpr);

  const baselineGradient = context.createLinearGradient(0, 0, width, 0);
  baselineGradient.addColorStop(0, "rgba(255,255,255,0)");
  baselineGradient.addColorStop(0.16, colorWithAlpha(palette.primary, live ? 0.16 : 0.06));
  baselineGradient.addColorStop(0.5, colorWithAlpha(palette.secondary, live ? 0.18 : 0.07));
  baselineGradient.addColorStop(0.84, colorWithAlpha(palette.primary, live ? 0.16 : 0.06));
  baselineGradient.addColorStop(1, "rgba(255,255,255,0)");
  context.strokeStyle = baselineGradient;
  context.lineWidth = 1 * dpr;
  context.beginPath();
  context.moveTo(0, baseline + 1.5 * dpr);
  context.lineTo(width, baseline + 1.5 * dpr);
  context.stroke();

  for (let index = 0; index < bandCount; index += 1) {
    const x = index * (barWidth + gap);
    const level = Math.max(0, levels[index]);
    const heightRatio = Math.pow(level, 0.84);
    const barHeight = Math.max(2.2 * dpr, heightRatio * maxBarHeight);
    const tone = bandTone(palette, index / Math.max(1, bandCount - 1), level, live);
    context.fillStyle = colorWithAlpha(tone, live ? 0.82 : 0.58);
    roundedRect(context, x, baseline - barHeight, barWidth, barHeight, radius);
    context.fill();
    context.fillStyle = colorWithAlpha(blendHex(tone, "#ffffff", live ? 0.16 : 0.08), live ? 0.38 : 0.22);
    roundedRect(context, x + barWidth * 0.12, baseline - barHeight * 0.76, barWidth * 0.76, barHeight * 0.76, radius * 0.82);
    context.fill();
  }

  context.fillStyle = colorWithAlpha(palette.secondary, live ? 0.85 : 0.34);
  for (let index = 0; index < bandCount; index += 1) {
    const peak = peaks[index];
    if (peak < 0.055) continue;
    const x = index * (barWidth + gap) + barWidth / 2;
    const y = baseline - Math.max(3 * dpr, Math.pow(peak, 0.92) * maxBarHeight) - 4 * dpr;
    context.beginPath();
    context.arc(x, y, Math.min(2.15 * dpr, barWidth / 2), 0, Math.PI * 2);
    context.fill();
  }
}

function prepareCanvas(canvas: HTMLCanvasElement): PreparedCanvas | null {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return null;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { context, dpr, height, width };
}

function bandTone(palette: CoverPalette, ratio: number, level: number, live: boolean) {
  const toned = blendHex(palette.primary, palette.secondary, clamp(ratio * 0.78 + level * 0.28, 0, 1));
  return live ? toned : blendHex(toned, "#cfd6df", 0.15);
}

function blendHex(left: string, right: string, ratio: number) {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  const weight = clamp(ratio, 0, 1);
  const red = Math.round(leftRgb.r + (rightRgb.r - leftRgb.r) * weight);
  const green = Math.round(leftRgb.g + (rightRgb.g - leftRgb.g) * weight);
  const blue = Math.round(leftRgb.b + (rightRgb.b - leftRgb.b) * weight);
  return rgbToHex(red, green, blue);
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  if (normalized.length === 3) {
    const [r, g, b] = normalized.split("");
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    };
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
