import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Download,
  GitCompare,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  analyzeEqualizerResponse,
  computeEqualizerFrequencyResponse,
  computeSingleBandResponse,
  equalizerAcousticZones,
  equalizerBandsMatch,
  equalizerBodePaths,
  equalizerFilterQ,
  equalizerFrequencies,
  equalizerPresetExportPayload,
  equalizerPresetFileName,
  equalizerPresets,
  equalizerReferenceSampleRate,
  freqToLogNorm,
  maxEqualizerGain,
  parseEqualizerPresetImport,
  type EqualizerCustomPreset,
  type EqualizerPresetId,
} from "@/lib/equalizer";
import { cn } from "@/lib/utils";

const frequencyLabels = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const graphWidth = 720;
const graphHeight = 192;
const graphPadX = 20;
const graphPadY = 12;

function clampGain(value: number) {
  return Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(value * 2) / 2));
}

function formatDb(value: number, withUnit = false) {
  const rounded = Math.round(value * 10) / 10;
  const body = rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
  return withUnit ? `${body} dB` : body;
}

export type EqualizerPanelProps = {
  enabled: boolean;
  bands: number[];
  preset: EqualizerPresetId;
  error?: string | null;
  customPresets: EqualizerCustomPreset[];
  onEnabledChange: (enabled: boolean) => void;
  onBandsChange: (bands: number[]) => void;
  onPresetChange: (preset: EqualizerPresetId) => void;
  onSavePreset: (name: string) => boolean;
  onDeletePreset: (id: string) => void;
  onImportPresets: (presets: EqualizerCustomPreset[]) => void;
};

export function EqualizerPanel({
  enabled,
  bands,
  preset,
  error,
  customPresets,
  onEnabledChange,
  onBandsChange,
  onPresetChange,
  onSavePreset,
  onDeletePreset,
  onImportPresets,
}: EqualizerPanelProps) {
  const [selectedBands, setSelectedBands] = useState<number[]>([]);
  const [activeBand, setActiveBand] = useState<number | null>(null);
  const [hoveredBand, setHoveredBand] = useState<number | null>(null);
  const [savingOpen, setSavingOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const dragRef = useRef<{
    startBands: number[];
    anchor: number;
    selected: number[];
    rect: DOMRect;
    rangeDb: number;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Smooth spring interpolation for the acoustic response trace across preset switches.
  const [displayBands, setDisplayBands] = useState<number[]>(() => bands.slice());
  const displayBandsRef = useRef(displayBands);
  const bandVelocitiesRef = useRef<number[]>(bands.map(() => 0));
  const targetBandsRef = useRef(bands);
  targetBandsRef.current = bands;
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      let moving = false;
      const next = targetBandsRef.current.map((target, index) => {
        const current = displayBandsRef.current[index] ?? 0;
        const velocity = bandVelocitiesRef.current[index] ?? 0;
        const acceleration = (target - current) * 240 - velocity * 28;
        const nextVelocity = velocity + acceleration * dt;
        const nextValue = current + nextVelocity * dt;
        bandVelocitiesRef.current[index] = nextVelocity;
        if (Math.abs(nextValue - target) < 0.01 && Math.abs(nextVelocity) < 0.01) return target;
        moving = true;
        return nextValue;
      });
      displayBandsRef.current = next;
      setDisplayBands(next);
      if (moving) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [bands]);

  const activeBuiltin = equalizerPresets.find((item) => equalizerBandsMatch(item.bands, bands));
  const activeCustom = customPresets.find((item) => equalizerBandsMatch(item.bands, bands));
  const activePresetLabel = activeCustom?.name ?? activeBuiltin?.label ?? "自定义塑形";

  const responsePoints = useMemo(
    () => computeEqualizerFrequencyResponse(displayBands, 160),
    [displayBands],
  );
  const bodePaths = useMemo(
    () => equalizerBodePaths(responsePoints, graphWidth, graphHeight, graphPadX, graphPadY),
    [responsePoints],
  );

  const inspectedBand = activeBand ?? hoveredBand;
  const ghostBandPath = useMemo(() => {
    if (inspectedBand === null) return "";
    const gain = displayBands[inspectedBand] ?? 0;
    if (Math.abs(gain) < 0.05) return "";
    const pts = computeSingleBandResponse(inspectedBand, gain, 128);
    return equalizerBodePaths(pts, graphWidth, graphHeight, graphPadX, graphPadY).linePath;
  }, [displayBands, inspectedBand]);

  const telemetry = useMemo(
    () => analyzeEqualizerResponse(bands, enabled),
    [bands, enabled],
  );

  function commit(next: number[]) {
    onBandsChange(next.map(clampGain));
    onPresetChange("custom");
    setNotice(null);
  }

  function applyPreset(id: EqualizerPresetId, nextBands: number[]) {
    onPresetChange(id);
    onBandsChange(nextBands.slice());
    setNotice(null);
  }

  function beginDrag(
    index: number,
    event: React.PointerEvent<HTMLElement>,
    containerRect?: DOMRect,
    rangeDb = maxEqualizerGain,
  ) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    let nextSelected: number[];
    if (additive) {
      nextSelected = selectedBands.includes(index)
        ? selectedBands.filter((item) => item !== index)
        : [...selectedBands, index];
    } else {
      nextSelected = selectedBands.length > 1 && selectedBands.includes(index) ? selectedBands : [index];
    }
    if (!nextSelected.length) nextSelected = [index];
    setSelectedBands(nextSelected);
    setActiveBand(index);
    setNotice(null);
    dragRef.current = {
      anchor: index,
      startBands: bands.slice(),
      selected: nextSelected,
      rect: containerRect ?? event.currentTarget.getBoundingClientRect(),
      rangeDb,
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const ratio = 1 - Math.max(0, Math.min(1, (event.clientY - drag.rect.top) / drag.rect.height));
    const targetGain = clampGain((ratio * 2 - 1) * drag.rangeDb);
    const delta = targetGain - (drag.startBands[drag.anchor] ?? 0);
    commit(drag.startBands.map((gain, index) => (drag.selected.includes(index) ? gain + delta : gain)));
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setActiveBand(null);
  }

  function zeroBand(index: number) {
    const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
    commit(bands.map((value, bandIndex) => (group.includes(bandIndex) ? 0 : value)));
  }

  function nudge(index: number, step: number) {
    const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
    commit(bands.map((gain, bandIndex) => (group.includes(bandIndex) ? gain + step : gain)));
  }

  function reset() {
    setSelectedBands([]);
    applyPreset("flat", equalizerPresets[0].bands);
  }

  function saveCurrentPreset() {
    const saved = onSavePreset(presetName);
    if (!saved) {
      setNotice({ tone: "error", text: "保存失败：预设名称不能为空，且最多保存 30 个预设。" });
      return;
    }
    setPresetName("");
    setSavingOpen(false);
    setNotice({ tone: "info", text: "已保存当前曲线为自定义预设。" });
  }

  function exportPresets() {
    if (!customPresets.length) {
      setNotice({ tone: "error", text: "还没有可导出的自定义预设。" });
      return;
    }
    const blob = new Blob([equalizerPresetExportPayload(customPresets)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = equalizerPresetFileName();
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "info", text: `已导出 ${customPresets.length} 个预设。` });
  }

  async function importPresets(file: File | undefined) {
    if (!file) return;
    try {
      const { presets: imported, error: parseError } = parseEqualizerPresetImport(await file.text());
      if (parseError) {
        setNotice({ tone: "error", text: parseError });
        return;
      }
      onImportPresets(imported);
      setNotice({ tone: "info", text: `已导入 ${imported.length} 个预设。` });
    } catch {
      setNotice({ tone: "error", text: "读取预设文件失败，请重试。" });
    }
  }

  const bodeContainerRef = useRef<HTMLDivElement | null>(null);
  const innerPlotWidth = graphWidth - graphPadX * 2;
  const innerPlotHeight = graphHeight - graphPadY * 2;
  const dbCeil = maxEqualizerGain + 2;

  return (
    <div className="aria-eq-console relative">
      {/* Header & Master Bypass / A-B Compare */}
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">声学均衡控制台</h3>
            <span className="aria-eq-spec-pill rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.12em] tabular-nums">
              IIR Biquad Peaking · Q={equalizerFilterQ.toFixed(2)} · fs={equalizerReferenceSampleRate / 1000} kHz
            </span>
          </div>
          {error && <p role="alert" className="mt-1 text-xs text-rose-500">{error}</p>}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={enabled}
            onClick={() => onEnabledChange(!enabled)}
            title="一键切换 EQ 启用 / 旁路（A/B 盲听对比）"
            className={cn(
              "aria-eq-ab-btn inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              enabled ? "is-active" : undefined,
            )}
          >
            <GitCompare className="size-3.5" />
            <span>{enabled ? "A · 处理激活" : "B · 旁路直通"}</span>
          </button>

          <Button variant="ghost" size="sm" onClick={reset} title="将所有频段归零 (Flat)">
            <RotateCcw className="size-3.5" />
            归零
          </Button>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="切换均衡器"
            className={cn("flex h-7 w-12 items-center rounded-full p-0.5 transition", enabled ? "bg-violet-600" : "bg-neutral-300 dark:bg-white/15")}
            onClick={() => onEnabledChange(!enabled)}
          >
            <span className={cn("size-6 rounded-full bg-white shadow-sm transition", enabled && "translate-x-5")} />
          </button>
        </div>
      </div>

      {/* Scientific Telemetry Strip */}
      <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="aria-eq-metric rounded-xl px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-60">峰值增益</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatDb(telemetry.peakBoostDb, true)}</p>
        </div>
        <div className="aria-eq-metric rounded-xl px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-60">最深衰减</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatDb(telemetry.peakCutDb, true)}</p>
        </div>
        <div className={cn("aria-eq-metric rounded-xl px-3 py-2", `is-${telemetry.headroomStatus}`)}>
          <p className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] opacity-75">
            <span>防削波余量</span>
            {telemetry.headroomStatus === "clipRisk" ? (
              <ShieldAlert className="size-3 text-rose-500" />
            ) : (
              <ShieldCheck className="size-3 text-emerald-500" />
            )}
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {telemetry.recommendedPreampDb === 0 ? "0.0 dB · 充裕" : `${formatDb(telemetry.recommendedPreampDb)} dB 建议`}
          </p>
        </div>
        <div className="aria-eq-metric rounded-xl px-3 py-2">
          <p className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] opacity-60">
            <span>声学特征</span>
            <Activity className="size-3 opacity-70" />
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold">{telemetry.tonalSignature}</p>
        </div>
      </div>

      {/* Logarithmic Bode Magnitude Plot */}
      <div className={cn("aria-eq-plot relative mt-3.5 rounded-[1.2rem] border p-3.5 transition", !enabled && "opacity-65")}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-55">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {equalizerAcousticZones.map((zone) => (
              <span key={zone.label} className="whitespace-nowrap">
                {zone.label} <span className="opacity-70">{zone.range}</span>
              </span>
            ))}
          </div>
          <span className="tabular-nums">
            {inspectedBand !== null
              ? `${frequencyLabels[inspectedBand]} Hz · ${formatDb(bands[inspectedBand] ?? 0, true)}`
              : `曲线：${activePresetLabel}`}
          </span>
        </div>

        <div
          ref={bodeContainerRef}
          className="relative h-44 select-none"
        >
          <svg
            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id="aria-eq-pos-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="aria-eq-neg-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.02" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.24" />
              </linearGradient>
              <linearGradient id="aria-eq-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>

            {/* Horizontal dB grid */}
            {[-12, -6, 0, 6, 12].map((gain) => {
              const y = graphPadY + innerPlotHeight * (0.5 - gain / (dbCeil * 2));
              return (
                <g key={`db-${gain}`}>
                  <line
                    x1={graphPadX}
                    x2={graphWidth - graphPadX}
                    y1={y}
                    y2={y}
                    stroke={gain === 0 ? "var(--eq-grid-major)" : "var(--eq-grid)"}
                    strokeWidth={gain === 0 ? "1.25" : "1"}
                    strokeDasharray={gain === 0 ? undefined : "3 4"}
                  />
                  <text
                    x={2}
                    y={y + 3}
                    fontSize="9"
                    fill="var(--eq-label)"
                    fontWeight="600"
                  >
                    {gain > 0 ? `+${gain}` : gain}
                  </text>
                </g>
              );
            })}

            {/* Logarithmic frequency vertical lines */}
            {equalizerFrequencies.map((frequency, index) => {
              const x = graphPadX + freqToLogNorm(frequency) * innerPlotWidth;
              return (
                <line
                  key={`grid-f-${frequency}`}
                  x1={x}
                  x2={x}
                  y1={graphPadY}
                  y2={graphHeight - graphPadY}
                  stroke={hoveredBand === index || activeBand === index ? "var(--eq-grid-major)" : "var(--eq-grid)"}
                  strokeWidth="1"
                  opacity={hoveredBand === index || activeBand === index ? 0.9 : 0.65}
                />
              );
            })}

            {/* Ghost single-band biquad bell curve when hovering/dragging */}
            {ghostBandPath && (
              <path
                d={ghostBandPath}
                fill="none"
                stroke="#a78bfa"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.72"
              />
            )}

            <motion.path
              d={bodePaths.positiveAreaPath}
              fill="url(#aria-eq-pos-fill)"
              animate={{ opacity: enabled ? 1 : 0.3 }}
              transition={{ duration: 0.25 }}
            />
            <motion.path
              d={bodePaths.negativeAreaPath}
              fill="url(#aria-eq-neg-fill)"
              animate={{ opacity: enabled ? 1 : 0.3 }}
              transition={{ duration: 0.25 }}
            />
            <path
              d={bodePaths.linePath}
              fill="none"
              stroke="url(#aria-eq-line)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ opacity: enabled ? 1 : 0.45, transition: "opacity 250ms ease" }}
            />
          </svg>

          {/* Draggable logarithmic center-frequency control nodes */}
          {equalizerFrequencies.map((frequency, index) => {
            const xPct = ((graphPadX + freqToLogNorm(frequency) * innerPlotWidth) / graphWidth) * 100;
            const gain = bands[index] ?? 0;
            const clampedGain = Math.max(-dbCeil, Math.min(dbCeil, gain));
            const yPx = graphPadY + innerPlotHeight * (0.5 - clampedGain / (dbCeil * 2));
            const topPct = (yPx / graphHeight) * 100;
            const isSelected = selectedBands.includes(index);
            const isHighlighted = activeBand === index || hoveredBand === index || isSelected;
            return (
              <button
                key={`bode-node-${frequency}`}
                type="button"
                aria-label={`频响节点 ${frequencyLabels[index]} Hz (${formatDb(gain, true)})`}
                title={`${frequencyLabels[index]} Hz · ${formatDb(gain, true)}（双击归零）`}
                onPointerEnter={() => setHoveredBand(index)}
                onPointerLeave={() => setHoveredBand((current) => (current === index ? null : current))}
                onPointerDown={(event) => {
                  const rect = bodeContainerRef.current?.getBoundingClientRect();
                  if (rect) beginDrag(index, event, rect, dbCeil);
                }}
                onPointerMove={(event) => {
                  if (dragRef.current) moveDrag(event);
                }}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={() => zeroBand(index)}
                style={{ left: `${xPct}%`, top: `${topPct}%` }}
                className={cn(
                  "aria-eq-handle absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none rounded-full border-2 shadow-sm transition-transform",
                  isHighlighted ? "scale-125 border-violet-500 ring-4 ring-violet-500/20" : "hover:scale-115",
                )}
              />
            );
          })}
        </div>

        {/* Precision 10-Band Vertical Fader Console */}
        <div className="mt-3 grid grid-cols-10 gap-1 border-t border-[var(--line)] pt-3">
          {equalizerFrequencies.map((frequency, index) => {
            const gain = bands[index] ?? 0;
            const norm = gain / maxEqualizerGain; // -1 .. +1
            const isActive = activeBand === index || hoveredBand === index;
            const isSelected = selectedBands.includes(index);
            return (
              <div
                key={`fader-${frequency}`}
                className="flex min-w-0 flex-col items-center gap-1.5"
                onPointerEnter={() => setHoveredBand(index)}
                onPointerLeave={() => setHoveredBand((current) => (current === index ? null : current))}
              >
                <span
                  className={cn(
                    "text-[11px] font-semibold tabular-nums transition-colors",
                    Math.abs(gain) >= 0.1 ? "text-[var(--accent)]" : "opacity-45",
                    isActive && "opacity-100",
                  )}
                >
                  {formatDb(gain)}
                </span>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`${frequencyLabels[index]} 赫兹`}
                  aria-valuemin={-maxEqualizerGain}
                  aria-valuemax={maxEqualizerGain}
                  aria-valuenow={gain}
                  aria-valuetext={`${gain} 分贝${isSelected ? "，已选中" : ""}`}
                  className="group relative h-24 w-full cursor-ns-resize touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                  onPointerDown={(event) => beginDrag(index, event)}
                  onPointerMove={(event) => {
                    if (dragRef.current) moveDrag(event);
                  }}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={() => zeroBand(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
                      event.preventDefault();
                      nudge(index, 0.5);
                    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      nudge(index, -0.5);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      zeroBand(index);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedBands((current) =>
                        current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
                      );
                    }
                  }}
                >
                  <span
                    className={cn(
                      "aria-eq-track absolute inset-x-1/2 top-1 bottom-1 w-1.5 -translate-x-1/2 rounded-full transition-colors",
                      isSelected && "aria-eq-track-selected",
                    )}
                  />
                  {/* Zero-dB center tick */}
                  <span className="absolute inset-x-1/2 top-1/2 h-px w-3 -translate-x-1/2 bg-neutral-500/35" />
                  {/* Active bipolar fill from center 0 dB */}
                  {Math.abs(norm) > 0.01 && (
                    <span
                      className="aria-eq-fader-fill absolute inset-x-1/2 w-1.5 -translate-x-1/2 rounded-full"
                      style={
                        norm >= 0
                          ? { bottom: "50%", height: `${Math.min(48, norm * 48)}%` }
                          : { top: "50%", height: `${Math.min(48, Math.abs(norm) * 48)}%` }
                      }
                    />
                  )}
                  <motion.span
                    className={cn(
                      "aria-eq-handle absolute left-1/2 h-2.5 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border shadow-sm transition-colors",
                      isSelected
                        ? "border-violet-500 ring-4 ring-violet-500/15"
                        : "border-white/80 group-hover:border-violet-400",
                    )}
                    style={{ bottom: `${Math.max(4, Math.min(96, ((gain + maxEqualizerGain) / (maxEqualizerGain * 2)) * 100))}%` }}
                    animate={{ scale: isActive || isSelected ? 1.12 : 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 30 }}
                  />
                </div>

                <span
                  className={cn(
                    "text-[11px] font-semibold tabular-nums transition-colors",
                    isSelected ? "text-[var(--accent)]" : "opacity-55",
                  )}
                >
                  {frequencyLabels[index]}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] tracking-[0.06em] opacity-55">
          <span className="flex items-center gap-1">
            <SlidersHorizontal className="size-3" /> 拖动节点或推子 · 双击单段归零 · Shift/Ctrl 多选联调
          </span>
          <span className="tabular-nums">±12.0 dB · 0.5 dB 步进</span>
        </div>
      </div>

      {/* Scientific Reference Target Presets */}
      <div className="mt-3.5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-55">目标响应曲线</p>
        <div className="flex flex-wrap gap-1.5">
          {equalizerPresets.map((item) => {
            const active = preset === item.id && (!activeBuiltin || activeBuiltin.id === item.id);
            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={{ scale: 0.96 }}
                className={cn(
                  "aria-eq-chip relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  active ? "text-white" : "bg-white/70 text-neutral-600 hover:bg-white hover:text-neutral-950",
                )}
                title={item.description}
                onClick={() => applyPreset(item.id, item.bands)}
              >
                {active && (
                  <motion.span
                    layoutId="aria-eq-preset"
                    className="aria-eq-chip-active absolute inset-0 rounded-full bg-neutral-950 shadow-[0_8px_20px_rgba(23,23,23,0.16)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10">{item.label}</span>
                <span className={cn("relative z-10 text-[11px] font-medium tracking-[0.08em]", active ? "text-white/75" : "opacity-50")}>
                  {item.targetTag}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Custom Presets & Portable Import / Export */}
      <div className="mt-3.5 border-t border-[var(--line)] pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-55">我的声学预设</p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setSavingOpen((open) => !open); setNotice(null); }}>
              <Plus className="size-3.5" />
              保存当前
            </Button>
            <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
              <Upload className="size-3.5" />
              导入
            </Button>
            <Button variant="ghost" size="sm" onClick={exportPresets}>
              <Download className="size-3.5" />
              导出
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                void importPresets(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </div>

        {savingOpen && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2 rounded-[0.9rem] border border-[var(--line)] bg-[var(--surface)] p-2">
            <input
              autoFocus
              value={presetName}
              maxLength={24}
              placeholder="给这组频段起个名字"
              className="h-8 min-w-0 flex-1 rounded-lg border border-neutral-200/70 bg-white/90 px-2.5 text-xs outline-none focus:border-violet-300 dark:border-white/10 dark:bg-white/5 dark:text-white"
              onChange={(event) => setPresetName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveCurrentPreset();
                if (event.key === "Escape") setSavingOpen(false);
              }}
            />
            <Button size="sm" onClick={saveCurrentPreset}>保存</Button>
          </motion.div>
        )}

        {customPresets.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {customPresets.map((item) => {
              const active = activeCustom?.id === item.id;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "aria-eq-chip group flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-xs font-medium transition",
                    active ? "aria-eq-chip-on border-violet-300 bg-violet-50 text-violet-700" : "border-white/70 bg-white/70 text-neutral-600 hover:bg-white",
                  )}
                >
                  <button type="button" className="max-w-40 truncate" title="载入这个预设" onClick={() => applyPreset("custom", item.bands)}>
                    {item.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除预设 ${item.name}`}
                    className="rounded-full p-1 text-neutral-400 transition hover:bg-rose-50 hover:text-rose-500"
                    onClick={() => onDeletePreset(item.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-xs opacity-55">还没有自定义预设。调好曲线后点击“保存当前”，也可导出或导入 JSON 曲线配置。</p>
        )}

        {notice && (
          <p role="status" aria-live="polite" className={cn("mt-2 text-xs", notice.tone === "error" ? "text-rose-500" : "text-emerald-500")}>
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}

export function EqualizerDialog({
  open,
  onClose,
  ...panelProps
}: EqualizerPanelProps & { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button type="button" aria-label="关闭均衡器" className="absolute inset-0 bg-neutral-950/30 backdrop-blur-[3px]" onClick={onClose} />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="均衡器"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="aria-eq-sheet no-scrollbar relative max-h-[90vh] w-full max-w-[min(840px,calc(100vw-1rem))] overflow-y-auto rounded-t-[1.75rem] border border-white/70 p-5 shadow-[0_30px_80px_rgba(47,55,76,0.28)] sm:rounded-[1.75rem] sm:p-6"
          >
            <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.22),transparent_68%)]" />
            <div className="relative mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight">均衡器</h2>
              <Button variant="ghost" size="icon" aria-label="关闭均衡器" onClick={onClose}>
                <X />
              </Button>
            </div>
            <EqualizerPanel {...panelProps} />
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
