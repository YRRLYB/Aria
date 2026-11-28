import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ClipboardPaste,
  Download,
  FileText,
  GitCompare,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  analyzeCompiledEqualizerResponse,
  compileEqualizerChain,
  computeCompiledEqualizerResponse,
  computeSingleBandResponse,
  computeSingleCompiledFilterResponse,
  defaultEqualizerProfile,
  equalizer31Frequencies,
  equalizerAcousticZones,
  equalizerBandsMatch,
  equalizerBodePaths,
  equalizerFilterQ,
  equalizerFrequencies,
  equalizerPeqPresets,
  equalizerPresetExportPayloadV2,
  equalizerPresetFileName,
  equalizerPresets,
  equalizerReferenceSampleRate,
  exportEqualizerToApoText,
  freqToLogNorm,
  maxEqualizerGain,
  maxEqualizerPeqBands,
  maxEqualizerPreampDb,
  minEqualizerPreampDb,
  parseEqualizerApoText,
  parseEqualizerPresetImport,
  resampleBands10To31,
  sanitizeEqualizer31Bands,
  sanitizePeqFilters,
  sanitizePreampDb,
  type EqualizerCustomPreset,
  type EqualizerMode,
  type EqualizerPresetId,
  type EqualizerProfile,
  type ParametricFilterBand,
  type ParametricFilterType,
} from "@/lib/equalizer";
import { cn } from "@/lib/utils";

const frequencyLabels = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const frequency31Labels = [
  "20", "25", "31.5", "40", "50", "63", "80", "100", "125", "160",
  "200", "250", "315", "400", "500", "630", "800", "1k", "1.25k", "1.6k",
  "2k", "2.5k", "3.15k", "4k", "5k", "6.3k", "8k", "10k", "12.5k", "16k", "20k",
];
const graphWidth = 760;
const graphHeight = 196;
const graphPadX = 22;
const graphPadY = 14;

function clampGain(value: number) {
  return Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(value * 2) / 2));
}

function formatDb(value: number, withUnit = false) {
  const rounded = Math.round(value * 10) / 10;
  const body = rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
  return withUnit ? `${body} dB` : body;
}

function formatFreq(hz: number) {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${Math.round(hz)}`;
}

function formatBalanceLabel(balance: number) {
  const pct = Math.round(balance * 100);
  if (Math.abs(pct) <= 1) return "居中";
  return pct < 0 ? `L ${Math.abs(pct)}%` : `R ${pct}%`;
}

export type EqualizerPanelProps = {
  enabled: boolean;
  bands: number[];
  preset: EqualizerPresetId;
  error?: string | null;
  customPresets: EqualizerCustomPreset[];
  profile?: EqualizerProfile;
  channelBalance?: number;
  monoAudio?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onBandsChange: (bands: number[]) => void;
  onPresetChange: (preset: EqualizerPresetId) => void;
  onProfileChange?: (profile: EqualizerProfile) => void;
  onChannelBalanceChange?: (balance: number) => void;
  onMonoAudioChange?: (mono: boolean) => void;
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
  profile: externalProfile,
  channelBalance = 0,
  monoAudio = false,
  onEnabledChange,
  onBandsChange,
  onPresetChange,
  onProfileChange,
  onChannelBalanceChange,
  onMonoAudioChange,
  onSavePreset,
  onDeletePreset,
  onImportPresets,
}: EqualizerPanelProps) {
  const [internalProfile, setInternalProfile] = useState<EqualizerProfile>(defaultEqualizerProfile);
  const profile = externalProfile ?? internalProfile;
  const setProfile = (updater: EqualizerProfile | ((prev: EqualizerProfile) => EqualizerProfile)) => {
    const next = typeof updater === "function" ? updater(profile) : updater;
    if (onProfileChange) onProfileChange(next);
    else setInternalProfile(next);
  };

  const [selectedBands, setSelectedBands] = useState<number[]>([]);
  const [activeBand, setActiveBand] = useState<number | null>(null);
  const [hoveredBand, setHoveredBand] = useState<number | null>(null);
  const [activePeqIndex, setActivePeqIndex] = useState<number | null>(null);
  const [hoveredPeqIndex, setHoveredPeqIndex] = useState<number | null>(null);
  const [savingOpen, setSavingOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [apoPasteText, setApoPasteText] = useState("");
  const [apoPasteName, setApoPasteName] = useState("");
  const [presetName, setPresetName] = useState("");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const drag10Ref = useRef<{
    startBands: number[];
    anchor: number;
    selected: number[];
    rect: DOMRect;
    rangeDb: number;
  } | null>(null);
  const drag31Ref = useRef<{
    rect: DOMRect;
    rangeDb: number;
  } | null>(null);
  const dragPeqRef = useRef<{
    index: number;
    rect: DOMRect;
    rangeDb: number;
  } | null>(null);
  const bodeContainerRef = useRef<HTMLDivElement | null>(null);
  const strip31Ref = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Smooth spring animation for 10-band curve; 31-band & PEQ evaluate directly for 0-latency precision.
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

  const compiledChain = useMemo(
    () => compileEqualizerChain({ enabled, preset, bands }, profile),
    [bands, enabled, preset, profile],
  );
  const displayChain = useMemo(
    () =>
      profile.mode === "iso10"
        ? compileEqualizerChain({ enabled, preset, bands: displayBands }, profile)
        : compiledChain,
    [compiledChain, displayBands, enabled, preset, profile],
  );

  const responsePoints = useMemo(
    () => computeCompiledEqualizerResponse(displayChain, 180),
    [displayChain],
  );
  const bodePaths = useMemo(
    () => equalizerBodePaths(responsePoints, graphWidth, graphHeight, graphPadX, graphPadY),
    [responsePoints],
  );

  const inspectedBand = profile.mode === "iso10" ? (activeBand ?? hoveredBand) : null;
  const inspectedPeq = profile.mode === "peq" ? (activePeqIndex ?? hoveredPeqIndex) : null;
  const ghostBandPath = useMemo(() => {
    if (profile.mode === "iso10" && inspectedBand !== null) {
      const gain = displayBands[inspectedBand] ?? 0;
      if (Math.abs(gain) < 0.05) return "";
      return equalizerBodePaths(
        computeSingleBandResponse(inspectedBand, gain, 128),
        graphWidth,
        graphHeight,
        graphPadX,
        graphPadY,
      ).linePath;
    }
    if (profile.mode === "peq" && inspectedPeq !== null) {
      const band = profile.peqFilters[inspectedPeq];
      if (!band || !band.enabled || Math.abs(band.gain) < 0.05) return "";
      return equalizerBodePaths(
        computeSingleCompiledFilterResponse({ type: band.type, freq: band.freq, gain: band.gain, q: band.q }, 128),
        graphWidth,
        graphHeight,
        graphPadX,
        graphPadY,
      ).linePath;
    }
    return "";
  }, [displayBands, inspectedBand, inspectedPeq, profile.mode, profile.peqFilters]);

  const telemetry = useMemo(
    () => analyzeCompiledEqualizerResponse(compiledChain, enabled),
    [compiledChain, enabled],
  );

  const activeBuiltin10 = equalizerPresets.find((item) => equalizerBandsMatch(item.bands, bands));
  const activeCustom = customPresets.find((item) => {
    const itemMode = item.mode ?? "iso10";
    if (itemMode !== profile.mode) return false;
    if (itemMode === "iso10") return equalizerBandsMatch(item.bands, bands);
    if (itemMode === "iso31") {
      const b31 = item.bands31 ?? [];
      return b31.length === 31 && b31.every((g, i) => Math.abs(g - (profile.bands31[i] ?? 0)) < 0.08);
    }
    return false;
  });

  function commit10(next: number[]) {
    onBandsChange(next.map(clampGain));
    onPresetChange("custom");
    setNotice(null);
  }

  function applyPreset10(id: EqualizerPresetId, nextBands: number[]) {
    onPresetChange(id);
    onBandsChange(nextBands.slice());
    setNotice(null);
  }

  function applyPeqPreset(item: (typeof equalizerPeqPresets)[number]) {
    const nextFilters: ParametricFilterBand[] = item.filters.map((filter, idx) => ({
      ...filter,
      id: `peq-preset-${item.id}-${idx}`,
    }));
    setProfile({
      ...profile,
      mode: "peq",
      preampDb: item.preampDb,
      peqFilters: nextFilters,
    });
    if (!enabled) onEnabledChange(true);
    setNotice(null);
  }

  function loadCustomPreset(item: EqualizerCustomPreset) {
    const targetMode: EqualizerMode = item.mode ?? "iso10";
    const nextPreamp =
      typeof item.preampDb === "number" ? sanitizePreampDb(item.preampDb) : profile.preampDb;
    if (targetMode === "iso31") {
      setProfile({
        ...profile,
        mode: "iso31",
        preampDb: nextPreamp,
        bands31: sanitizeEqualizer31Bands(item.bands31 ?? resampleBands10To31(item.bands)),
      });
    } else if (targetMode === "peq") {
      const nextPeq = sanitizePeqFilters(item.peqFilters);
      setProfile({
        ...profile,
        mode: "peq",
        preampDb: nextPreamp,
        peqFilters: nextPeq.length ? nextPeq : profile.peqFilters,
      });
    } else {
      setProfile({
        ...profile,
        mode: "iso10",
        preampDb: typeof item.preampDb === "number" ? sanitizePreampDb(item.preampDb) : 0,
      });
      applyPreset10("custom", item.bands);
    }
    if (!enabled) onEnabledChange(true);
    setNotice({
      tone: "info",
      text: `已载入预设「${item.name}」（Preamp ${formatDb(typeof item.preampDb === "number" ? item.preampDb : 0, true)}）。`,
    });
  }

  function beginDrag10(
    index: number,
    event: React.PointerEvent<Element>,
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
    drag10Ref.current = {
      anchor: index,
      startBands: bands.slice(),
      selected: nextSelected,
      rect: containerRect ?? event.currentTarget.getBoundingClientRect(),
      rangeDb,
    };
  }

  function moveDrag10(event: React.PointerEvent<Element>) {
    const drag = drag10Ref.current;
    if (!drag) return;
    const ratio = 1 - Math.max(0, Math.min(1, (event.clientY - drag.rect.top) / drag.rect.height));
    const targetGain = clampGain((ratio * 2 - 1) * drag.rangeDb);
    const delta = targetGain - (drag.startBands[drag.anchor] ?? 0);
    commit10(drag.startBands.map((gain, index) => (drag.selected.includes(index) ? gain + delta : gain)));
  }

  function endDrag10(event: React.PointerEvent<Element>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag10Ref.current = null;
    setActiveBand(null);
  }

  function update31FromPointer(clientX: number, clientY: number) {
    const drag = drag31Ref.current;
    if (!drag || !drag.rect.width || !drag.rect.height) return;
    const xRatio = Math.max(0, Math.min(0.9999, (clientX - drag.rect.left) / drag.rect.width));
    const bandIndex = Math.min(30, Math.max(0, Math.floor(xRatio * 31)));
    const yRatio = 1 - Math.max(0, Math.min(1, (clientY - drag.rect.top) / drag.rect.height));
    const targetGain = clampGain((yRatio * 2 - 1) * drag.rangeDb);
    setActiveBand(bandIndex);
    setProfile((prev) => {
      const next31 = prev.bands31.slice();
      next31[bandIndex] = targetGain;
      return { ...prev, bands31: next31 };
    });
  }

  function updatePeqFromCanvasPointer(clientX: number, clientY: number) {
    const drag = dragPeqRef.current;
    if (!drag || !drag.rect.width || !drag.rect.height) return;
    const padXFrac = graphPadX / graphWidth;
    const innerFrac = (graphWidth - graphPadX * 2) / graphWidth;
    const rawX = (clientX - drag.rect.left) / drag.rect.width;
    const normX = Math.max(0, Math.min(1, (rawX - padXFrac) / innerFrac));
    const freq = Math.round(20 * 10 ** (normX * Math.log10(20_000 / 20)));
    const padYFrac = graphPadY / graphHeight;
    const innerYFrac = (graphHeight - graphPadY * 2) / graphHeight;
    const rawY = (clientY - drag.rect.top) / drag.rect.height;
    const yNorm = 1 - Math.max(0, Math.min(1, (rawY - padYFrac) / innerYFrac));
    const gain = clampGain((yNorm * 2 - 1) * drag.rangeDb);
    setProfile((prev) => ({
      ...prev,
      peqFilters: prev.peqFilters.map((item, idx) => (idx === drag.index ? { ...item, freq, gain } : item)),
    }));
  }

  function resetCurrentMode() {
    setSelectedBands([]);
    if (profile.mode === "iso31") {
      setProfile({ ...profile, preampDb: 0, bands31: equalizer31Frequencies.map(() => 0) });
    } else if (profile.mode === "peq") {
      setProfile({
        ...profile,
        preampDb: 0,
        peqFilters: profile.peqFilters.map((item) => ({ ...item, gain: 0 })),
      });
    } else {
      setProfile({ ...profile, preampDb: 0 });
      applyPreset10("flat", equalizerPresets[0].bands);
    }
    setNotice(null);
  }

  function saveCurrentPreset() {
    const saved = onSavePreset(presetName);
    if (!saved) {
      setNotice({ tone: "error", text: "保存失败：预设名称不能为空，且最多保存 30 个预设。" });
      return;
    }
    setPresetName("");
    setSavingOpen(false);
    setNotice({ tone: "info", text: "已保存当前声学曲线为自定义预设。" });
  }

  function exportJsonPresets() {
    if (!customPresets.length) {
      setNotice({ tone: "error", text: "还没有可导出的自定义预设，请先点“保存当前”。" });
      return;
    }
    const blob = new Blob([equalizerPresetExportPayloadV2(customPresets)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = equalizerPresetFileName();
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "info", text: `已导出 ${customPresets.length} 个预设（JSON v2）。` });
  }

  function exportApoTxt() {
    const label = activeBuiltin10?.label ?? activeCustom?.name ?? `Aria-${profile.mode.toUpperCase()}`;
    const content = exportEqualizerToApoText(label, compiledChain);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aria-eq-${profile.mode}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "info", text: "已导出标准 Equalizer APO（.txt）配置。" });
  }

  async function importPresetFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const { presets: imported, error: parseError } = parseEqualizerPresetImport(text);
      if (parseError) {
        setNotice({ tone: "error", text: parseError });
        return;
      }
      const baseName = file.name.replace(/\.(json|txt)$/i, "").slice(0, 24);
      const renamed = imported.map((item, idx) =>
        item.name === "APO 导入曲线" && baseName
          ? { ...item, name: idx === 0 ? baseName : `${baseName}-${idx + 1}` }
          : item,
      );
      onImportPresets(renamed);
      if (renamed.length === 1) loadCustomPreset(renamed[0]);
      setNotice({ tone: "info", text: `已导入 ${renamed.length} 个预设配置。` });
    } catch {
      setNotice({ tone: "error", text: "读取预设文件失败，请重试。" });
    }
  }

  function importApoFromPaste() {
    const result = parseEqualizerApoText(apoPasteText, apoPasteName.trim() || "APO 粘贴曲线");
    if ("error" in result) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    onImportPresets([result.preset]);
    loadCustomPreset(result.preset);
    setApoPasteText("");
    setApoPasteName("");
    setPasteOpen(false);
  }

  function updatePeqBand(index: number, patch: Partial<ParametricFilterBand>) {
    setProfile((prev) => ({
      ...prev,
      peqFilters: prev.peqFilters.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    }));
  }

  function addPeqBand() {
    if (profile.peqFilters.length >= maxEqualizerPeqBands) return;
    const defaultFreqs = [60, 120, 250, 500, 1000, 2000, 3500, 5000, 8000, 12000, 15000, 18000];
    const nextFreq = defaultFreqs[profile.peqFilters.length % defaultFreqs.length];
    setProfile((prev) => ({
      ...prev,
      peqFilters: [
        ...prev.peqFilters,
        {
          id: `peq-user-${Date.now().toString(36)}`,
          enabled: true,
          type: "peaking",
          freq: nextFreq,
          gain: 0,
          q: 1.4,
        },
      ],
    }));
  }

  function removePeqBand(index: number) {
    if (profile.peqFilters.length <= 1) return;
    setProfile((prev) => ({
      ...prev,
      peqFilters: prev.peqFilters.filter((_, idx) => idx !== index),
    }));
  }

  const innerPlotWidth = graphWidth - graphPadX * 2;
  const innerPlotHeight = graphHeight - graphPadY * 2;
  const dbCeil = maxEqualizerGain + 2;

  return (
    <div className="aria-eq-console relative space-y-4">
      {/* Studio Mode & Bypass Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="aria-segment inline-flex rounded-full p-0.5" role="tablist" aria-label="均衡器模式">
            {([
              { id: "iso10", label: "10段 ISO" },
              { id: "iso31", label: "31段 1/3倍频" },
              { id: "peq", label: "参数 PEQ" },
            ] as const).map((tab) => {
              const active = profile.mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setProfile({ ...profile, mode: tab.id });
                    setNotice(null);
                  }}
                  className={cn(
                    "relative rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150",
                    active ? "text-neutral-950 dark:text-white" : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="aria-eq-mode-pill"
                      aria-hidden="true"
                      className="aria-segment-item is-active absolute inset-0 rounded-full shadow-sm"
                      transition={{ type: "spring", stiffness: 460, damping: 36 }}
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <span className="aria-eq-spec-pill hidden rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] tabular-nums sm:inline-flex">
            {profile.mode === "iso31"
              ? `1/3 Oct · Q=4.32 · ${compiledChain.filters.length} Active`
              : profile.mode === "peq"
                ? `Parametric · ${profile.peqFilters.filter((b) => b.enabled).length} Nodes · fs=${equalizerReferenceSampleRate / 1000} kHz`
                : `IIR Biquad Peaking · Q=${equalizerFilterQ.toFixed(1)} · fs=${equalizerReferenceSampleRate / 1000} kHz`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={enabled}
            onClick={() => onEnabledChange(!enabled)}
            title="一键切换 EQ 启用 / 旁路（A/B 盲听对比）"
            className={cn(
              "aria-eq-ab-btn inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96]",
              enabled ? "is-active" : undefined,
            )}
          >
            <GitCompare className="size-3.5" />
            <span>{enabled ? "A · 处理激活" : "B · 旁路直通"}</span>
          </button>

          <Button variant="ghost" size="sm" onClick={resetCurrentMode} title="归零当前模式频段">
            <RotateCcw className="size-3.5" />
            归零
          </Button>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="切换均衡器"
            className={cn(
              "flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-150",
              enabled ? "bg-violet-600" : "bg-neutral-300 dark:bg-white/15",
            )}
            onClick={() => onEnabledChange(!enabled)}
          >
            <span
              className={cn(
                "size-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                enabled && "translate-x-5",
              )}
            />
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}

      {/* Logarithmic Bode Magnitude Plot */}
      <div className={cn("aria-eq-plot relative rounded-[1.3rem] border p-3.5 transition-opacity duration-200", !enabled && "opacity-65")}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-60">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {equalizerAcousticZones.map((zone) => (
              <span key={zone.label} className="whitespace-nowrap">
                {zone.label} <span className="opacity-70">{zone.range}</span>
              </span>
            ))}
          </div>
          <span className="flex items-center gap-1.5 font-medium normal-case tracking-normal tabular-nums opacity-85">
            <Activity className="size-3" />
            {telemetry.tonalSignature} · 峰值 {formatDb(telemetry.peakBoostDb, true)}
          </span>
        </div>

        <div ref={bodeContainerRef} className="relative h-44 w-full select-none sm:h-48">
          <svg
            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
            aria-hidden="true"
            onPointerMove={(event) => {
              if (drag10Ref.current) moveDrag10(event);
              else if (dragPeqRef.current) updatePeqFromCanvasPointer(event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              if (drag10Ref.current) endDrag10(event);
              if (dragPeqRef.current) {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                dragPeqRef.current = null;
                setActivePeqIndex(null);
              }
            }}
          >
            <defs>
              <linearGradient id="aria-eq-pos-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--aria-accent, #8b5cf6)" stopOpacity="0.34" />
                <stop offset="100%" stopColor="var(--aria-accent, #8b5cf6)" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="aria-eq-neg-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.02" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.24" />
              </linearGradient>
              <linearGradient id="aria-eq-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="50%" stopColor="var(--aria-accent, #7c3aed)" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>

            {[-12, -6, 0, 6, 12].map((db) => {
              const y = graphPadY + innerPlotHeight * (0.5 - db / (dbCeil * 2));
              const isZero = db === 0;
              return (
                <g key={db}>
                  <line
                    x1={graphPadX}
                    y1={y}
                    x2={graphWidth - graphPadX}
                    y2={y}
                    stroke={isZero ? "var(--eq-grid-major)" : "var(--eq-grid)"}
                    strokeWidth={isZero ? 1.25 : 1}
                    strokeDasharray={isZero ? "4 4" : undefined}
                  />
                  <text
                    x={graphPadX - 4}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9.5"
                    fill="var(--eq-label)"
                    className="tabular-nums"
                  >
                    {db > 0 ? `+${db}` : db}
                  </text>
                </g>
              );
            })}

            {equalizerFrequencies.map((freq, index) => {
              const x = graphPadX + freqToLogNorm(freq) * innerPlotWidth;
              return (
                <g key={freq}>
                  <line
                    x1={x}
                    y1={graphPadY}
                    x2={x}
                    y2={graphHeight - graphPadY}
                    stroke="var(--eq-grid)"
                    strokeWidth={1}
                  />
                  <text
                    x={x}
                    y={graphHeight - 1}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill="var(--eq-label)"
                    className="tabular-nums"
                  >
                    {frequencyLabels[index]}
                  </text>
                </g>
              );
            })}

            <motion.path
              d={bodePaths.positiveAreaPath}
              fill="url(#aria-eq-pos-fill)"
              animate={{ opacity: enabled ? 1 : 0.3 }}
              transition={{ duration: 0.22 }}
            />
            <motion.path
              d={bodePaths.negativeAreaPath}
              fill="url(#aria-eq-neg-fill)"
              animate={{ opacity: enabled ? 1 : 0.3 }}
              transition={{ duration: 0.22 }}
            />

            {ghostBandPath && (
              <path
                d={ghostBandPath}
                fill="none"
                stroke="var(--aria-accent, #8b5cf6)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeOpacity="0.6"
              />
            )}

            <path
              d={bodePaths.linePath}
              fill="none"
              stroke="url(#aria-eq-stroke)"
              strokeWidth={enabled ? 2.6 : 1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={enabled ? 1 : 0.45}
            />

            {/* Interactive handles on canvas for ISO 10 */}
            {profile.mode === "iso10" &&
              equalizerFrequencies.map((freq, index) => {
                const gain = displayBands[index] ?? 0;
                const x = graphPadX + freqToLogNorm(freq) * innerPlotWidth;
                const y = graphPadY + innerPlotHeight * (0.5 - gain / (dbCeil * 2));
                const isSelected = selectedBands.includes(index);
                const isActive = activeBand === index || hoveredBand === index;
                return (
                  <g
                    key={freq}
                    className="cursor-ns-resize"
                    onPointerEnter={() => setHoveredBand(index)}
                    onPointerLeave={() => setHoveredBand((current) => (current === index ? null : current))}
                    onPointerDown={(event) => {
                      const rect = bodeContainerRef.current?.getBoundingClientRect();
                      if (rect) beginDrag10(index, event, rect, dbCeil);
                    }}
                    onDoubleClick={() => {
                      const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
                      commit10(bands.map((value, bandIndex) => (group.includes(bandIndex) ? 0 : value)));
                    }}
                  >
                    <circle cx={x} cy={y} r={14} fill="transparent" />
                    {(isSelected || isActive) && (
                      <circle cx={x} cy={y} r={9} fill="var(--aria-accent, #8b5cf6)" fillOpacity="0.18" />
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={isActive ? 5.5 : 4.3}
                      fill={isSelected || isActive ? "var(--aria-accent, #8b5cf6)" : "var(--surface)"}
                      stroke={isSelected || isActive ? "#ffffff" : "var(--aria-accent, #7c3aed)"}
                      strokeWidth={2}
                    />
                  </g>
                );
              })}

            {/* Interactive handles on canvas for Parametric PEQ */}
            {profile.mode === "peq" &&
              profile.peqFilters.map((band, index) => {
                const x = graphPadX + freqToLogNorm(band.freq) * innerPlotWidth;
                const y = graphPadY + innerPlotHeight * (0.5 - (band.gain + profile.preampDb) / (dbCeil * 2));
                const isActive = activePeqIndex === index || hoveredPeqIndex === index;
                return (
                  <g
                    key={band.id}
                    className={band.enabled ? "cursor-move" : "cursor-pointer opacity-45"}
                    onPointerEnter={() => setHoveredPeqIndex(index)}
                    onPointerLeave={() => setHoveredPeqIndex((current) => (current === index ? null : current))}
                    onPointerDown={(event) => {
                      const rect = bodeContainerRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setActivePeqIndex(index);
                      dragPeqRef.current = { index, rect, rangeDb: dbCeil };
                    }}
                    onWheel={(event) => {
                      event.preventDefault();
                      const delta = event.deltaY < 0 ? 0.15 : -0.15;
                      const nextQ = Math.max(0.2, Math.min(16, Math.round((band.q + delta) * 100) / 100));
                      updatePeqBand(index, { q: nextQ });
                    }}
                  >
                    <circle cx={x} cy={y} r={14} fill="transparent" />
                    {isActive && (
                      <circle cx={x} cy={y} r={10} fill="var(--aria-accent, #8b5cf6)" fillOpacity="0.2" />
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={isActive ? 6.2 : 5}
                      fill={isActive ? "var(--aria-accent, #8b5cf6)" : "var(--surface)"}
                      stroke={isActive ? "#ffffff" : "var(--aria-accent, #7c3aed)"}
                      strokeWidth={2}
                    />
                    <text
                      x={x}
                      y={y - 9}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="700"
                      fill="var(--text-primary)"
                    >
                      {index + 1}
                    </text>
                  </g>
                );
              })}
          </svg>
        </div>

        {/* Slim Preamp & Anti-Clip Headroom Strip */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-2.5 text-xs">
          <div className="flex min-w-[200px] flex-1 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setProfile({ ...profile, preampDb: 0 })}
              title="点击重置前置增益为 0.0 dB"
              className="shrink-0 font-semibold opacity-75 hover:opacity-100"
            >
              前级 Preamp
            </button>
            <input
              type="range"
              aria-label="前置增益 Preamp"
              min={minEqualizerPreampDb}
              max={maxEqualizerPreampDb}
              step="0.5"
              value={profile.preampDb}
              onChange={(event) => setProfile({ ...profile, preampDb: sanitizePreampDb(Number(event.target.value)) })}
              className="aria-range min-w-[90px] flex-1"
              style={{
                ["--range-color" as string]: "var(--aria-accent, #8b5cf6)",
                ["--range-value" as string]:
                  (profile.preampDb - minEqualizerPreampDb) / (maxEqualizerPreampDb - minEqualizerPreampDb),
              }}
            />
            <span className="w-16 shrink-0 text-right font-semibold tabular-nums">
              {formatDb(profile.preampDb, true)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums",
                telemetry.headroomStatus === "clipRisk"
                  ? "bg-rose-500/12 text-rose-500"
                  : telemetry.headroomStatus === "caution"
                    ? "bg-amber-500/12 text-amber-600 dark:text-amber-300"
                    : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
              )}
            >
              {telemetry.headroomStatus === "clipRisk" ? (
                <ShieldAlert className="size-3" />
              ) : (
                <ShieldCheck className="size-3" />
              )}
              {telemetry.headroomStatus === "clipRisk"
                ? "防削波余量 · 风险"
                : telemetry.headroomStatus === "caution"
                  ? "防削波余量 · 紧凑"
                  : "防削波余量 · 充裕"}
            </span>

            {telemetry.recommendedPreampDb < 0 && Math.abs(profile.preampDb - telemetry.recommendedPreampDb) > 0.25 && (
              <button
                type="button"
                onClick={() =>
                  setProfile({ ...profile, preampDb: sanitizePreampDb(telemetry.recommendedPreampDb) })
                }
                className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600 transition hover:bg-violet-500/18 dark:text-violet-300"
              >
                <Sparkles className="size-3" />
                一键安全归一化 ({formatDb(telemetry.recommendedPreampDb, true)})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mode Specific Controls */}
      {profile.mode === "iso10" && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-10 sm:gap-1.5">
            {equalizerFrequencies.map((frequency, index) => {
              const gain = bands[index] ?? 0;
              const topPercent = 50 - (gain / maxEqualizerGain) * 50;
              const isSelected = selectedBands.includes(index);
              const isActive = activeBand === index;
              return (
                <div key={frequency} className="flex flex-col items-center gap-1.5">
                  <span className={cn("text-[11px] font-semibold tabular-nums transition-colors", gain !== 0 ? "text-[var(--text-primary)]" : "opacity-50")}>
                    {formatDb(gain)}
                  </span>
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`${frequency} 赫兹增益`}
                    aria-valuemin={-maxEqualizerGain}
                    aria-valuemax={maxEqualizerGain}
                    aria-valuenow={gain}
                    className="group relative h-24 w-full cursor-ns-resize touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                    onPointerEnter={() => setHoveredBand(index)}
                    onPointerLeave={() => setHoveredBand((current) => (current === index ? null : current))}
                    onPointerDown={(event) => beginDrag10(index, event)}
                    onPointerMove={(event) => {
                      if (drag10Ref.current) moveDrag10(event);
                    }}
                    onPointerUp={endDrag10}
                    onPointerCancel={endDrag10}
                    onDoubleClick={() => {
                      const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
                      commit10(bands.map((value, bandIndex) => (group.includes(bandIndex) ? 0 : value)));
                    }}
                    onWheel={(event) => {
                      event.preventDefault();
                      const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
                      const step = event.deltaY < 0 ? 0.5 : -0.5;
                      commit10(bands.map((g, bandIndex) => (group.includes(bandIndex) ? g + step : g)));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
                        commit10(bands.map((g, bandIndex) => (group.includes(bandIndex) ? g + 0.5 : g)));
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        const group = selectedBands.includes(index) && selectedBands.length > 1 ? selectedBands : [index];
                        commit10(bands.map((g, bandIndex) => (group.includes(bandIndex) ? g - 0.5 : g)));
                      } else if (event.key === "0" || event.key === "Backspace") {
                        event.preventDefault();
                        commit10(bands.map((value, bandIndex) => (bandIndex === index ? 0 : value)));
                      }
                    }}
                  >
                    <span className={cn("aria-eq-track absolute inset-y-0 left-1/2 w-[5px] -translate-x-1/2 rounded-full transition-colors", isSelected && "aria-eq-track-selected")} />
                    <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 bg-neutral-400/35" />
                    <span
                      className="aria-eq-fader-fill absolute left-1/2 w-[5px] -translate-x-1/2 rounded-full"
                      style={{
                        top: `${Math.min(50, topPercent)}%`,
                        height: `${Math.abs(50 - topPercent)}%`,
                        opacity: enabled ? 1 : 0.4,
                      }}
                    />
                    <motion.span
                      className={cn(
                        "aria-eq-handle absolute left-1/2 h-2.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-colors",
                        isSelected ? "border-violet-500 ring-4 ring-violet-500/15" : "border-white",
                        isActive ? "bg-violet-600" : "bg-white",
                      )}
                      animate={{ top: `${topPercent}%`, scale: isActive ? 1.18 : 1 }}
                      transition={{ type: "spring", stiffness: 520, damping: 36 }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold tracking-tight opacity-65 tabular-nums">{frequencyLabels[index]}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {equalizerPresets.map((item) => {
              const active = Boolean(activeBuiltin10 && activeBuiltin10.id === item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "aria-eq-chip relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-[transform,color,background-color] duration-150 active:scale-[0.96]",
                    active ? "text-white" : "bg-white/70 text-neutral-600 hover:bg-white hover:text-neutral-950",
                  )}
                  title={item.description}
                  onClick={() => applyPreset10(item.id, item.bands)}
                >
                  {active && (
                    <motion.span
                      layoutId="aria-eq-preset"
                      className="aria-eq-chip-active absolute inset-0 rounded-full bg-neutral-950 shadow-[0_8px_20px_rgba(23,23,23,0.16)]"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                  <span className={cn("relative z-10 text-[10px] font-medium tracking-[0.06em]", active ? "text-white/75" : "opacity-50")}>
                    {item.targetTag}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {profile.mode === "iso31" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="opacity-65">按住鼠标横向扫掠即可连续绘制 1/3 倍频程声学曲线 · 右键或双击单柱归零</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setProfile({ ...profile, bands31: resampleBands10To31(bands) })}
            >
              从 10 段曲线平滑映射
            </Button>
          </div>
          <div
            ref={strip31Ref}
            className="grid h-28 touch-none select-none grid-cols-[repeat(31,minmax(0,1fr))] gap-[3px] rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/45 p-2"
            onPointerDown={(event) => {
              const rect = strip31Ref.current?.getBoundingClientRect();
              if (!rect) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag31Ref.current = { rect, rangeDb: maxEqualizerGain };
              update31FromPointer(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (drag31Ref.current) update31FromPointer(event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              drag31Ref.current = null;
              setActiveBand(null);
            }}
            onPointerCancel={() => {
              drag31Ref.current = null;
              setActiveBand(null);
            }}
          >
            {equalizer31Frequencies.map((freq, index) => {
              const gain = profile.bands31[index] ?? 0;
              const topPercent = 50 - (gain / maxEqualizerGain) * 50;
              const isActive = activeBand === index;
              return (
                <div
                  key={freq}
                  title={`${frequency31Labels[index]} Hz: ${formatDb(gain, true)}`}
                  onDoubleClick={() => {
                    setProfile((prev) => {
                      const next = prev.bands31.slice();
                      next[index] = 0;
                      return { ...prev, bands31: next };
                    });
                  }}
                  className="relative flex h-full cursor-crosshair flex-col items-center justify-center"
                >
                  <span className="aria-eq-track absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full" />
                  <span className="absolute left-0 right-0 top-1/2 h-px bg-neutral-400/30" />
                  <span
                    className="aria-eq-fader-fill absolute left-1/2 w-[4px] -translate-x-1/2 rounded-full"
                    style={{
                      top: `${Math.min(50, topPercent)}%`,
                      height: `${Math.abs(50 - topPercent)}%`,
                      opacity: enabled ? 1 : 0.4,
                    }}
                  />
                  <span
                    className={cn(
                      "aria-eq-handle absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border",
                      isActive ? "scale-125 border-violet-500 bg-violet-500" : "border-white bg-white",
                    )}
                    style={{ top: `${topPercent}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between px-1 text-[10px] font-medium opacity-55 tabular-nums">
            <span>20 Hz</span>
            <span>63 Hz</span>
            <span>200 Hz</span>
            <span>630 Hz</span>
            <span>2 kHz</span>
            <span>6.3 kHz</span>
            <span>20 kHz</span>
          </div>
        </div>
      )}

      {profile.mode === "peq" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {equalizerPeqPresets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.description}
                  onClick={() => applyPeqPreset(item)}
                  className="aria-eq-chip rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-neutral-700 transition-[transform,background-color] duration-150 hover:bg-white active:scale-[0.96]"
                >
                  {item.label} <span className="ml-1 text-[10px] opacity-55">{item.targetTag}</span>
                </button>
              ))}
            </div>
            <Button
              variant="glass"
              size="sm"
              disabled={profile.peqFilters.length >= maxEqualizerPeqBands}
              onClick={addPeqBand}
            >
              <Plus className="size-3.5" />
              添加频点 ({profile.peqFilters.length}/{maxEqualizerPeqBands})
            </Button>
          </div>

          <div className="no-scrollbar max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {profile.peqFilters.map((band, index) => (
              <div
                key={band.id}
                onMouseEnter={() => setHoveredPeqIndex(index)}
                onMouseLeave={() => setHoveredPeqIndex((current) => (current === index ? null : current))}
                className={cn(
                  "grid grid-cols-[auto_4.5rem_1fr_5.5rem_4.5rem_auto] items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)]/75 px-2.5 py-1.5 text-xs",
                  !band.enabled && "opacity-50",
                )}
              >
                <button
                  type="button"
                  aria-label={`切换频点 ${index + 1}`}
                  onClick={() => updatePeqBand(index, { enabled: !band.enabled })}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-bold transition",
                    band.enabled ? "bg-violet-600 text-white" : "bg-neutral-200 text-neutral-500 dark:bg-white/10",
                  )}
                >
                  {index + 1}
                </button>

                <select
                  aria-label={`频点 ${index + 1} 滤波器类型`}
                  value={band.type}
                  onChange={(event) => updatePeqBand(index, { type: event.target.value as ParametricFilterType })}
                  className="rounded-lg border border-[var(--line)] bg-transparent px-1.5 py-1 text-[11px] font-semibold outline-none"
                >
                  <option value="peaking">PK 峰值</option>
                  <option value="lowshelf">LSC 低架</option>
                  <option value="highshelf">HSC 高架</option>
                </select>

                <div className="flex items-center gap-2">
                  <span className="w-11 shrink-0 font-semibold tabular-nums">{formatFreq(band.freq)}Hz</span>
                  <input
                    type="range"
                    aria-label={`频点 ${index + 1} 频率`}
                    min={Math.log10(20)}
                    max={Math.log10(20_000)}
                    step="0.01"
                    value={Math.log10(Math.max(20, band.freq))}
                    onChange={(event) => updatePeqBand(index, { freq: Math.round(10 ** Number(event.target.value)) })}
                    className="aria-range min-w-0 flex-1"
                    style={{
                      ["--range-color" as string]: "var(--aria-accent, #8b5cf6)",
                      ["--range-value" as string]: freqToLogNorm(band.freq),
                    }}
                  />
                </div>

                <label className="flex items-center gap-1 tabular-nums">
                  <span className="opacity-55">G</span>
                  <input
                    type="number"
                    aria-label={`频点 ${index + 1} 增益`}
                    min={-maxEqualizerGain}
                    max={maxEqualizerGain}
                    step="0.1"
                    value={band.gain}
                    onChange={(event) => updatePeqBand(index, { gain: clampGain(Number(event.target.value) || 0) })}
                    className="w-14 rounded-md border border-[var(--line)] bg-transparent px-1.5 py-0.5 text-right font-semibold outline-none"
                  />
                </label>

                <label className="flex items-center gap-1 tabular-nums">
                  <span className="opacity-55">Q</span>
                  <input
                    type="number"
                    aria-label={`频点 ${index + 1} Q值`}
                    min={0.2}
                    max={16}
                    step="0.1"
                    value={band.q}
                    onChange={(event) => {
                      const raw = Number(event.target.value);
                      if (Number.isFinite(raw)) {
                        updatePeqBand(index, { q: Math.max(0.2, Math.min(16, Math.round(raw * 100) / 100)) });
                      }
                    }}
                    className="w-12 rounded-md border border-[var(--line)] bg-transparent px-1 py-0.5 text-right font-semibold outline-none"
                  />
                </label>

                <button
                  type="button"
                  disabled={profile.peqFilters.length <= 1}
                  aria-label={`移除频点 ${index + 1}`}
                  onClick={() => removePeqBand(index)}
                  className="rounded-full p-1 text-neutral-400 transition hover:bg-rose-500/12 hover:text-rose-500 disabled:opacity-30"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Channel Strip: Stereo Balance & Mono Fold-Down */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)]/70 px-3.5 py-2.5 text-xs">
        <div className="flex min-w-[210px] flex-1 items-center gap-2.5">
          <button
            type="button"
            onClick={() => onChannelBalanceChange?.(0)}
            title="点击恢复声道平衡居中"
            className="flex shrink-0 items-center gap-1.5 font-semibold opacity-75 hover:opacity-100"
          >
            <SlidersHorizontal className="size-3.5" />
            声道平衡
          </button>
          <input
            type="range"
            aria-label="左右声道平衡"
            min="-1"
            max="1"
            step="0.02"
            value={channelBalance}
            onDoubleClick={() => onChannelBalanceChange?.(0)}
            onChange={(event) => onChannelBalanceChange?.(Number(event.target.value))}
            className="aria-range min-w-[90px] flex-1"
            style={{
              ["--range-color" as string]: "var(--aria-accent, #8b5cf6)",
              ["--range-value" as string]: (channelBalance + 1) / 2,
            }}
          />
          <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
            {formatBalanceLabel(channelBalance)}
          </span>
        </div>

        <label className="flex cursor-pointer items-center gap-2 font-semibold">
          <span className="opacity-75">单声道合并 (Mono)</span>
          <button
            type="button"
            role="switch"
            aria-checked={monoAudio}
            aria-label="切换单声道合并"
            onClick={() => onMonoAudioChange?.(!monoAudio)}
            className={cn(
              "flex h-6 w-10 items-center rounded-full p-0.5 transition-colors duration-150",
              monoAudio ? "bg-violet-600" : "bg-neutral-300 dark:bg-white/15",
            )}
          >
            <span
              className={cn(
                "size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                monoAudio && "translate-x-4",
              )}
            />
          </button>
        </label>
      </div>

      {/* Custom Presets & Multi-Format Import / Export (JSON + Equalizer APO / AutoEQ) */}
      <div className="border-t border-[var(--line)] pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-55">我的声学预设 & APO / AutoEQ</p>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setSavingOpen((open) => !open); setPasteOpen(false); setNotice(null); }}>
              <Plus className="size-3.5" />
              保存当前
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setPasteOpen((open) => !open); setSavingOpen(false); setNotice(null); }}>
              <ClipboardPaste className="size-3.5" />
              粘贴 APO
            </Button>
            <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
              <Upload className="size-3.5" />
              导入文件
            </Button>
            <Button variant="ghost" size="sm" onClick={exportApoTxt} title="导出当前曲线为 Equalizer APO / AutoEQ .txt">
              <FileText className="size-3.5" />
              导出 APO
            </Button>
            <Button variant="ghost" size="sm" onClick={exportJsonPresets}>
              <Download className="size-3.5" />
              导出 JSON
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              className="hidden"
              onChange={(event) => {
                void importPresetFile(event.target.files?.[0]);
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
              placeholder="给这组曲线起个名字（保留当前模式与前级增益）"
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

        {pasteOpen && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 space-y-2 rounded-[0.9rem] border border-[var(--line)] bg-[var(--surface)] p-3">
            <input
              value={apoPasteName}
              maxLength={24}
              placeholder="预设名称（可选，如：AirPods Pro 2 AutoEQ）"
              className="h-8 w-full rounded-lg border border-neutral-200/70 bg-white/90 px-2.5 text-xs outline-none focus:border-violet-300 dark:border-white/10 dark:bg-white/5 dark:text-white"
              onChange={(event) => setApoPasteName(event.target.value)}
            />
            <textarea
              rows={4}
              value={apoPasteText}
              placeholder={"粘贴 Squiglink / AutoEQ / Equalizer APO 配置，例如：\nPreamp: -4.2 dB\nFilter 1: ON LSC Fc 105 Hz Gain 4.2 dB Q 0.71\nFilter 2: ON PK Fc 3100 Hz Gain 2.8 dB Q 1.80"}
              className="w-full rounded-lg border border-neutral-200/70 bg-white/90 p-2.5 font-mono text-[11px] outline-none focus:border-violet-300 dark:border-white/10 dark:bg-white/5 dark:text-white"
              onChange={(event) => setApoPasteText(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>取消</Button>
              <Button size="sm" onClick={importApoFromPaste} disabled={!apoPasteText.trim()}>解析并应用</Button>
            </div>
          </motion.div>
        )}

        {customPresets.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {customPresets.map((item) => {
              const active = activeCustom?.id === item.id;
              const modeTag = item.mode === "iso31" ? "31段" : item.mode === "peq" ? "PEQ" : "10段";
              return (
                <div
                  key={item.id}
                  className={cn(
                    "aria-eq-chip group flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-xs font-medium transition",
                    active ? "aria-eq-chip-on border-violet-300 bg-violet-50 text-violet-700" : "border-white/70 bg-white/70 text-neutral-600 hover:bg-white",
                  )}
                >
                  <button type="button" className="flex max-w-48 items-center gap-1.5 truncate" title="载入这个预设" onClick={() => loadCustomPreset(item)}>
                    <span className="truncate">{item.name}</span>
                    <span className="rounded bg-black/5 px-1 py-0.2 text-[10px] opacity-65 dark:bg-white/10">{modeTag}</span>
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
          <p className="mt-2 text-xs opacity-55">支持保存多模式自定义预设，也可直接导入或粘贴 AutoEQ / Squiglink / Equalizer APO (.txt) 与 JSON。</p>
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
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="aria-eq-sheet no-scrollbar relative max-h-[90vh] w-full max-w-[min(900px,calc(100vw-1rem))] overflow-y-auto rounded-t-[1.75rem] border border-white/70 p-5 shadow-[0_30px_80px_rgba(47,55,76,0.28)] sm:rounded-[1.75rem] sm:p-6"
          >
            <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.18),transparent_68%)]" />
            <div className="relative mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight">声学均衡器</h2>
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
