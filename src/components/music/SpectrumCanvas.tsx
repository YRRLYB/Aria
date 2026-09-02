import { useEffect, useRef } from "react";
import type { AudioOutputMode, CoverPalette } from "@/lib/playerPresentation";
import { colorWithAlpha } from "@/lib/playerPresentation";
import { getSpectrumEngine } from "@/lib/spectrumEngine";

type SpectrumInputs = {
  analyserRef: { current: AnalyserNode | null };
  fallback: number[];
  outputMode: AudioOutputMode;
  outputVolume: number;
  palette: CoverPalette;
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
  const lastPaintAtRef = useRef(0);
  // Latest inputs are kept in a ref so the animation loop keeps running across
  // palette/track changes instead of being torn down and restarted every time.
  const inputsRef = useRef<SpectrumInputs>({ analyserRef, fallback, outputMode, outputVolume, palette });
  inputsRef.current = { analyserRef, fallback, outputMode, outputVolume, palette };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    let frame = 0;
    let scheduled = false;
    let prepared: PreparedCanvas | null = null;
    const renderCacheRef: { current: SpectrumRenderCache | null } = { current: null };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      frame = window.requestAnimationFrame(() => {
        scheduled = false;
        draw();
      });
    };

    const draw = () => {
      const inputs = inputsRef.current;
      const now = performance.now();
      if (now - lastPaintAtRef.current < 33) {
        schedule();
        return;
      }
      lastPaintAtRef.current = now;
      if (!prepared) prepared = syncCanvas(canvas);
      if (!prepared) {
        schedule();
        return;
      }

      const engine = getSpectrumEngine(inputs.analyserRef.current);
      const snapshot = engine.read({
        analyser: inputs.analyserRef.current,
        fallback: inputs.fallback,
        now,
        outputMode: inputs.outputMode,
        outputVolume: inputs.outputVolume,
        playing,
      });

      renderSpectrum(prepared, snapshot.levels, snapshot.peaks, inputs.palette, snapshot.live, renderCacheRef);
      if (playing || snapshot.signal > 0.018) {
        schedule();
      }
    };

    prepared = syncCanvas(canvas);
    const observer = new ResizeObserver(() => {
      prepared = syncCanvas(canvas);
      renderCacheRef.current = null;
      schedule();
    });
    observer.observe(canvas);

    draw();
    return () => {
      observer.disconnect();
      if (scheduled || frame) window.cancelAnimationFrame(frame);
      scheduled = false;
    };
  }, [active, playing]);

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

// Colors and the baseline gradient are expensive to rebuild every frame
// (~130 hex parses + a gradient allocation), so they are precomputed per
// palette/live/width combination and looked up while painting.
type SpectrumRenderCache = {
  key: string;
  baselineGradient: CanvasGradient;
  barStyles: string[];
  highlightStyles: string[];
  peakStyle: string;
};

const toneSteps = 48;

function buildRenderCache(
  context: CanvasRenderingContext2D,
  width: number,
  palette: CoverPalette,
  live: boolean,
): SpectrumRenderCache {
  const barStyles: string[] = [];
  const highlightStyles: string[] = [];
  for (let index = 0; index <= toneSteps; index += 1) {
    const tone = blendHex(palette.primary, palette.secondary, index / toneSteps);
    const settled = live ? tone : blendHex(tone, "#cfd6df", 0.15);
    barStyles.push(colorWithAlpha(settled, live ? 0.82 : 0.58));
    highlightStyles.push(
      colorWithAlpha(blendHex(settled, "#ffffff", live ? 0.16 : 0.08), live ? 0.38 : 0.22),
    );
  }

  const baselineGradient = context.createLinearGradient(0, 0, width, 0);
  baselineGradient.addColorStop(0, "rgba(255,255,255,0)");
  baselineGradient.addColorStop(0.16, colorWithAlpha(palette.primary, live ? 0.16 : 0.06));
  baselineGradient.addColorStop(0.5, colorWithAlpha(palette.secondary, live ? 0.18 : 0.07));
  baselineGradient.addColorStop(0.84, colorWithAlpha(palette.primary, live ? 0.16 : 0.06));
  baselineGradient.addColorStop(1, "rgba(255,255,255,0)");

  return {
    key: `${width}|${palette.primary}|${palette.secondary}|${live ? 1 : 0}`,
    baselineGradient,
    barStyles,
    highlightStyles,
    peakStyle: colorWithAlpha(palette.secondary, live ? 0.85 : 0.34),
  };
}

function renderSpectrum(
  { context, dpr, height, width }: PreparedCanvas,
  levels: Float32Array,
  peaks: Float32Array,
  palette: CoverPalette,
  live: boolean,
  renderCacheRef: { current: SpectrumRenderCache | null },
) {
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";

  const cacheKey = `${width}|${palette.primary}|${palette.secondary}|${live ? 1 : 0}`;
  if (!renderCacheRef.current || renderCacheRef.current.key !== cacheKey) {
    renderCacheRef.current = buildRenderCache(context, width, palette, live);
  }
  const cache = renderCacheRef.current;

  const bandCount = levels.length;
  const gap = Math.max(2.2 * dpr, Math.min(5.5 * dpr, width / 180));
  const barWidth = Math.max(2.8 * dpr, (width - gap * (bandCount - 1)) / bandCount);
  const baseline = height * 0.82;
  const maxBarHeight = height * 0.7;
  const radius = Math.min(barWidth / 2, 6 * dpr);

  context.strokeStyle = cache.baselineGradient;
  context.lineWidth = 1 * dpr;
  context.beginPath();
  context.moveTo(0, baseline + 1.5 * dpr);
  context.lineTo(width, baseline + 1.5 * dpr);
  context.stroke();

  // Bars sharing a quantized tone slot accumulate into one Path2D and fill in
  // a single draw call, replacing ~130 per-frame path builds + fills with a
  // handful. Peak dots share one path/fill as well. The inner highlight layer
  // is skipped for near-empty bars where it would be invisible anyway.
  const barPaths: Array<Path2D | null> = [];
  const highlightPaths: Array<Path2D | null> = [];
  const peakPath = new Path2D();
  const minHighlightHeight = 6 * dpr;
  const peakRadius = Math.min(2.15 * dpr, barWidth / 2);

  for (let index = 0; index < bandCount; index += 1) {
    const x = index * (barWidth + gap);
    const level = Math.max(0, levels[index]);
    const heightRatio = Math.pow(level, 0.84);
    const barHeight = Math.max(2.2 * dpr, heightRatio * maxBarHeight);
    const toneIndex = Math.round(clamp(index / Math.max(1, bandCount - 1) * 0.78 + level * 0.28, 0, 1) * toneSteps);
    (barPaths[toneIndex] ??= new Path2D()).roundRect(x, baseline - barHeight, barWidth, barHeight, radius);
    if (barHeight > minHighlightHeight) {
      (highlightPaths[toneIndex] ??= new Path2D()).roundRect(
        x + barWidth * 0.12,
        baseline - barHeight * 0.76,
        barWidth * 0.76,
        barHeight * 0.76,
        radius * 0.82,
      );
    }

    const peak = peaks[index];
    if (peak >= 0.055) {
      const y = baseline - Math.max(3 * dpr, Math.pow(peak, 0.92) * maxBarHeight) - 4 * dpr;
      peakPath.moveTo(x + barWidth / 2 + peakRadius, y);
      peakPath.arc(x + barWidth / 2, y, peakRadius, 0, Math.PI * 2);
    }
  }

  for (let toneIndex = 0; toneIndex < barPaths.length; toneIndex += 1) {
    const barPath = barPaths[toneIndex];
    if (!barPath) continue;
    context.fillStyle = cache.barStyles[toneIndex];
    context.fill(barPath);
    const highlightPath = highlightPaths[toneIndex];
    if (highlightPath) {
      context.fillStyle = cache.highlightStyles[toneIndex];
      context.fill(highlightPath);
    }
  }

  context.fillStyle = cache.peakStyle;
  context.fill(peakPath);
}

function syncCanvas(canvas: HTMLCanvasElement): PreparedCanvas | null {
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
