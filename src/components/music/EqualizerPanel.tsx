import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Plus, RotateCcw, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  equalizerBandsMatch,
  equalizerCurvePath,
  equalizerFrequencies,
  equalizerPresetExportPayload,
  equalizerPresetFileName,
  equalizerPresets,
  maxEqualizerGain,
  parseEqualizerPresetImport,
  type EqualizerCustomPreset,
  type EqualizerPresetId,
} from "@/lib/equalizer";
import { cn } from "@/lib/utils";

const frequencyLabels = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const graphWidth = 720;
const graphHeight = 180;

function clampGain(value: number) {
  return Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(value * 2) / 2));
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
  const [savingOpen, setSavingOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const dragRef = useRef<{ startBands: number[]; anchor: number; selected: number[]; rect: DOMRect } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // The curve follows the target bands with a light spring. Keeping the
  // interpolation in a ref-driven rAF loop avoids framer-motion trying to
  // interpolate the SVG `d` string, which it cannot do reliably.
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
        const acceleration = (target - current) * 220 - velocity * 26;
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
  const activePresetLabel = activeCustom?.name ?? activeBuiltin?.label ?? "自定义";

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

  function beginDrag(index: number, event: React.PointerEvent<HTMLElement>) {
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
      rect: event.currentTarget.getBoundingClientRect(),
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const ratio = 1 - Math.max(0, Math.min(1, (event.clientY - drag.rect.top) / drag.rect.height));
    const targetGain = clampGain((ratio * 2 - 1) * maxEqualizerGain);
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
    setNotice({ tone: "info", text: "已保存当前频段为自定义预设。" });
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

  const curvePath = equalizerCurvePath(displayBands, graphWidth, graphHeight);

  return (
    <div className="relative">
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Equalizer</p>
          <h3 className="mt-1 flex items-center gap-2 text-base font-semibold">
            声音塑形
            <span className="rounded-full bg-neutral-950/[0.045] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">10 band</span>
          </h3>
          <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500">
            拖动频段调整增益；按住 Shift（或 Cmd / Ctrl）点选多个频段后，可一起拖动。更改实时生效，且只保存在这台电脑。
          </p>
          {error && <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn(enabled ? "bg-neutral-950 text-white" : "bg-white/80 text-neutral-500")}>{enabled ? "已启用" : "旁路"}</Badge>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="切换均衡器"
            className={cn("flex h-8 w-14 items-center rounded-full p-1 transition", enabled ? "bg-neutral-950" : "bg-neutral-200")}
            onClick={() => onEnabledChange(!enabled)}
          >
            <span className={cn("size-6 rounded-full bg-white shadow-sm transition", enabled && "translate-x-6")} />
          </button>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-2">
        {equalizerPresets.map((item) => {
          const active = preset === item.id && (!activeBuiltin || activeBuiltin.id === item.id);
          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.96 }}
              className={cn(
                "aria-eq-chip relative rounded-full px-3.5 py-2 text-xs font-semibold transition",
                active ? "text-white" : "bg-white/70 text-neutral-500 hover:bg-white hover:text-neutral-950",
              )}
              title={item.description}
              onClick={() => applyPreset(item.id, item.bands)}
            >
              {active && <motion.span layoutId="aria-eq-preset" className="aria-eq-chip-active absolute inset-0 rounded-full bg-neutral-950 shadow-[0_10px_24px_rgba(23,23,23,0.16)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative z-10">{item.label}</span>
            </motion.button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw />
            复位
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEnabledChange(!enabled)}>
            {enabled ? "旁路" : "启用"}
          </Button>
        </div>
      </div>

      <div className={cn("aria-eq-plot relative mt-4 rounded-[1.15rem] border border-white/70 p-3 shadow-inner transition", !enabled && "opacity-65")}>
        <div className="flex gap-1 px-1">
          {equalizerFrequencies.map((frequency, index) => {
            const gain = Math.round(bands[index] ?? 0);
            const isActive = activeBand === index;
            const isSelected = selectedBands.includes(index);
            return (
              <span
                key={`gain-${frequency}`}
                className={cn("flex h-4 flex-1 items-center justify-center text-[10px] font-semibold tabular-nums transition", isActive || isSelected ? "text-neutral-950" : "text-neutral-400")}
              >
                {gain > 0 ? `+${gain}` : gain}
              </span>
            );
          })}
        </div>

        <div className="relative mt-1 h-44">
          <svg viewBox={`0 0 ${graphWidth} ${graphHeight}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <defs>
              <linearGradient id="aria-eq-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#8680b4" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#8680b4" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="aria-eq-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#5e8ab8" />
                <stop offset="50%" stopColor="#8680b4" />
                <stop offset="100%" stopColor="#c6796d" />
              </linearGradient>
            </defs>
            {[-12, -6, 0, 6, 12].map((gain) => {
              const y = graphHeight * (1 - (gain + maxEqualizerGain) / (maxEqualizerGain * 2));
              return (
                <g key={gain}>
                  <line x1={0} x2={graphWidth} y1={y} y2={y} stroke={gain === 0 ? "var(--eq-grid-major)" : "var(--eq-grid)"} strokeWidth="1" />
                  <text x={8} y={Math.min(graphHeight - 2, Math.max(10, y - 4))} fontSize="9" fill="var(--eq-label)" fontWeight="600">
                    {gain > 0 ? `+${gain}` : gain}
                  </text>
                </g>
              );
            })}
            <motion.path
              d={`${curvePath} L ${graphWidth} ${graphHeight} L 0 ${graphHeight} Z`}
              fill="url(#aria-eq-fill)"
              animate={{ opacity: enabled ? 1 : 0.35 }}
              transition={{ duration: 0.35 }}
            />
            <path
              d={curvePath}
              fill="none"
              stroke="url(#aria-eq-line)"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ opacity: enabled ? 1 : 0.45, transition: "opacity 350ms ease" }}
            />
          </svg>

          <div className="absolute inset-0 flex items-stretch justify-between gap-1">
            {equalizerFrequencies.map((frequency, index) => {
              const gain = bands[index] ?? 0;
              const ratio = (gain + maxEqualizerGain) / (maxEqualizerGain * 2);
              const isActive = activeBand === index;
              const isSelected = selectedBands.includes(index);
              return (
                <div key={frequency} className="flex min-w-0 flex-1 flex-col items-center">
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`${frequencyLabels[index]} 赫兹`}
                    aria-valuemin={-maxEqualizerGain}
                    aria-valuemax={maxEqualizerGain}
                    aria-valuenow={gain}
                    aria-valuetext={`${gain} 分贝${isSelected ? "，已选中" : ""}`}
                    className="group relative w-full flex-1 cursor-ns-resize touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                    onPointerDown={(event) => beginDrag(index, event)}
                    onPointerMove={(event) => {
                      if (dragRef.current) moveDrag(event);
                    }}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" || event.key === "ArrowRight") {
                        event.preventDefault();
                        nudge(index, 1);
                      } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        nudge(index, -1);
                      } else if (event.key === "Home") {
                        event.preventDefault();
                        const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
                        commit(bands.map((value, bandIndex) => (group.includes(bandIndex) ? 0 : value)));
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedBands((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
                      }
                    }}
                  >
                    <span className={cn("aria-eq-track absolute inset-x-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full transition-colors", isSelected && "aria-eq-track-selected")} />
                    <span className="absolute inset-x-1/2 top-1/2 h-px w-2.5 -translate-x-1/2 bg-neutral-950/15" />
                    <motion.span
                      className={cn(
                        "aria-eq-handle absolute left-1/2 size-4 -translate-x-1/2 rounded-full border bg-white shadow-[0_4px_12px_rgba(47,55,76,0.22)] transition-colors",
                        isSelected ? "border-violet-500 ring-4 ring-violet-500/15" : "border-white/80 group-hover:border-violet-300",
                      )}
                      style={{ bottom: `calc(${Math.max(0, Math.min(1, ratio)) * 100}% - 0.5rem)` }}
                      animate={{ scale: isActive || isSelected ? 1.15 : 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 28 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-1 flex gap-1 px-1">
          {equalizerFrequencies.map((frequency, index) => {
            const isSelected = selectedBands.includes(index);
            return (
              <span key={`freq-${frequency}`} className={cn("flex-1 text-center text-[10px] font-medium transition-colors", isSelected ? "text-violet-600" : "text-neutral-400")}>{frequencyLabels[index]}</span>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-neutral-400">
          <span className="flex items-center gap-1"><SlidersHorizontal className="size-3" /> 拖动频段，Shift/Ctrl 多选联动</span>
          <span className="flex items-center gap-2">
            <span>当前：{activePresetLabel}</span>
            <span>−12 dB / +12 dB</span>
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">我的预设</p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setSavingOpen((open) => !open); setNotice(null); }}>
              <Plus />
              保存当前
            </Button>
            <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
              <Upload />
              导入
            </Button>
            <Button variant="ghost" size="sm" onClick={exportPresets}>
              <Download />
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
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2 rounded-[0.9rem] border border-white/70 bg-white/76 p-2">
            <input
              autoFocus
              value={presetName}
              maxLength={24}
              placeholder="给这组频段起个名字"
              className="h-8 min-w-0 flex-1 rounded-lg border border-neutral-200/70 bg-white/90 px-2.5 text-xs outline-none focus:border-violet-300"
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
          <p className="mt-2 text-xs text-neutral-400">还没有自定义预设。调好频段后点击“保存当前”，也可以导入他人分享的预设文件。</p>
        )}

        {notice && (
          <p role="status" aria-live="polite" className={cn("mt-2 text-xs", notice.tone === "error" ? "text-rose-500" : "text-emerald-600")}>
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
          <button type="button" aria-label="关闭均衡器" className="absolute inset-0 bg-neutral-950/25 backdrop-blur-[2px]" onClick={onClose} />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="均衡器"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="aria-eq-sheet relative max-h-[90vh] w-full max-w-[min(780px,calc(100vw-1rem))] overflow-y-auto rounded-t-[1.75rem] border border-white/70 p-5 shadow-[0_30px_80px_rgba(47,55,76,0.28)] sm:rounded-[1.75rem]"
          >
            <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-[radial-gradient(circle,rgba(134,128,180,0.2),transparent_68%)]" />
            <div className="relative mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">Playback · EQ</p>
                <h2 className="mt-1 text-xl font-semibold">均衡器</h2>
              </div>
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
