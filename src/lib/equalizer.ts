export const equalizerFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const equalizerFilterQ = 1.1;
export const equalizerReferenceSampleRate = 48_000;

export const equalizerAcousticZones = [
  { label: "SUB", range: "20–60", fromHz: 20, toHz: 60 },
  { label: "BASS", range: "60–250", fromHz: 60, toHz: 250 },
  { label: "LOW-M", range: "250–500", fromHz: 250, toHz: 500 },
  { label: "MID", range: "500–2k", fromHz: 500, toHz: 2000 },
  { label: "PRES", range: "2k–6k", fromHz: 2000, toHz: 6000 },
  { label: "AIR", range: "6k–20k", fromHz: 6000, toHz: 20000 },
] as const;

export type EqualizerPresetId =
  | "flat"
  | "harman"
  | "studio"
  | "vocal"
  | "warm"
  | "classical"
  | "bass"
  | "night"
  | "pop"
  | "rock"
  | "custom";

export type EqualizerSettings = {
  enabled: boolean;
  preset: EqualizerPresetId;
  bands: number[];
};

export const equalizerPresets: Array<{
  id: EqualizerPresetId;
  label: string;
  targetTag: string;
  description: string;
  bands: number[];
}> = [
  {
    id: "flat",
    label: "参考平直",
    targetTag: "REF 0 dB",
    description: "零染色参考级直通曲线，保持母带原始相位与动态",
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: "harman",
    label: "哈曼目标",
    targetTag: "IE-2019",
    description: "依据 Harman 目标曲线调校：Sub-Bass 轻微支撑 + 3kHz 耳廓增益",
    bands: [3, 2.5, 1.5, -0.5, -1, 0, 1.5, 2.5, 2, 1],
  },
  {
    id: "studio",
    label: "Studio 监听",
    targetTag: "NEUTRAL",
    description: "微收 125–250Hz 驻波浑浊，提升 2–4kHz 瞬态解析",
    bands: [0, 0, -1, -1.5, 0, 0.5, 1.5, 2, 1, 0],
  },
  {
    id: "vocal",
    label: "人声明晰",
    targetTag: "VOCAL",
    description: "收敛极低频并适度抬升 1–4kHz 唇齿质感与人声结像",
    bands: [-2, -1.5, -0.5, 1, 2.5, 3.5, 3, 1.5, 0, -1],
  },
  {
    id: "warm",
    label: "温暖胆机",
    targetTag: "TUBE-A",
    description: "丰润中低频谐波厚度并温和滚降齿音区，久听不累",
    bands: [1.5, 2.5, 2, 1.5, 0.5, -0.5, -1, -1.5, -2.5, -3],
  },
  {
    id: "classical",
    label: "古典厅堂",
    targetTag: "CONCERT",
    description: "自然拓展 8–16kHz 堂音空气感与大提琴下潜体量",
    bands: [2.5, 2, 0.5, 0, -0.5, 0, 1, 2, 3.5, 4],
  },
  {
    id: "bass",
    label: "深潜低频",
    targetTag: "SUB+",
    description: "聚焦 31–62Hz 极低频冲击力，避免掩蔽中频人声",
    bands: [5.5, 4.5, 2.5, 0.5, -0.5, 0, 0, 0.5, 1, 0.5],
  },
  {
    id: "night",
    label: "深夜耐听",
    targetTag: "F-M LOW",
    description: "依据等响曲线（Fletcher-Munson）在低音量下保留饱满基频并柔化高频",
    bands: [3, 2, 1, 0, 0, -0.5, -1.5, -2.5, -3.5, -4.5],
  },
];

const LEGACY_PRESET_BANDS: Record<string, number[]> = {
  pop: [-1, 0, 1, 3, 4, 3, 1, -1, -2, -2],
  rock: [4, 3, 2, 0, -1, 1, 3, 4, 3, 2],
};

const equalizerStorageKey = "aria-equalizer-settings-v1";
export const maxEqualizerGain = 12;

export function sanitizeEqualizerBands(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  return equalizerFrequencies.map((_, index) => {
    const gain = Number(source[index]);
    if (!Number.isFinite(gain)) return 0;
    return Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(gain * 10) / 10));
  });
}

export function equalizerPresetBands(id: EqualizerPresetId) {
  return equalizerPresets.find((preset) => preset.id === id)?.bands
    ?? LEGACY_PRESET_BANDS[id]
    ?? equalizerPresets[0].bands;
}

export function defaultEqualizerSettings(): EqualizerSettings {
  return { enabled: false, preset: "flat", bands: [...equalizerPresets[0].bands] };
}

export function readCachedEqualizerSettings(): EqualizerSettings {
  try {
    const raw = window.localStorage.getItem(equalizerStorageKey);
    if (!raw) return defaultEqualizerSettings();
    const parsed = JSON.parse(raw) as Partial<EqualizerSettings>;
    const preset =
      equalizerPresets.some((item) => item.id === parsed.preset) ||
      (typeof parsed.preset === "string" && parsed.preset in LEGACY_PRESET_BANDS) ||
      parsed.preset === "custom"
        ? (parsed.preset as EqualizerPresetId)
        : "flat";
    return {
      enabled: Boolean(parsed.enabled),
      preset,
      bands: sanitizeEqualizerBands(parsed.bands),
    };
  } catch {
    return defaultEqualizerSettings();
  }
}

export function writeCachedEqualizerSettings(settings: EqualizerSettings) {
  try {
    window.localStorage.setItem(equalizerStorageKey, JSON.stringify({
      enabled: Boolean(settings.enabled),
      preset: settings.preset,
      bands: sanitizeEqualizerBands(settings.bands),
    }));
    return true;
  } catch {
    return false;
  }
}

export type EqualizerCustomPreset = {
  id: string;
  name: string;
  bands: number[];
  createdAt: number;
};

const equalizerPresetsStorageKey = "aria-equalizer-presets-v1";
export const maxEqualizerCustomPresets = 30;
export const maxEqualizerPresetNameLength = 24;

function createPresetId(now: number) {
  return `equalizer-preset:${now.toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function createEqualizerCustomPreset(name: string, bands: number[], now = Date.now()): EqualizerCustomPreset {
  const trimmed = name.trim().slice(0, maxEqualizerPresetNameLength) || "我的预设";
  return { id: createPresetId(now), name: trimmed, bands: sanitizeEqualizerBands(bands), createdAt: now };
}

export function sanitizeEqualizerCustomPresets(value: unknown): EqualizerCustomPreset[] {
  const source = Array.isArray(value) ? value : Array.isArray((value as { presets?: unknown })?.presets) ? (value as { presets: unknown[] }).presets : [];
  const seen = new Set<string>();
  const presets: EqualizerCustomPreset[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<EqualizerCustomPreset>;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, maxEqualizerPresetNameLength) : "";
    if (!name) continue;
    const createdAt = Number(record.createdAt);
    const id = typeof record.id === "string" && record.id.trim() && !seen.has(record.id.trim())
      ? record.id.trim()
      : createPresetId(Number.isFinite(createdAt) ? createdAt : Date.now());
    if (seen.has(id)) continue;
    seen.add(id);
    presets.push({
      id,
      name,
      bands: sanitizeEqualizerBands(record.bands),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    });
    if (presets.length >= maxEqualizerCustomPresets) break;
  }
  return presets;
}

export function readCachedEqualizerPresets(): EqualizerCustomPreset[] {
  try {
    const raw = window.localStorage.getItem(equalizerPresetsStorageKey);
    if (!raw) return [];
    return sanitizeEqualizerCustomPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeCachedEqualizerPresets(presets: EqualizerCustomPreset[]) {
  try {
    window.localStorage.setItem(equalizerPresetsStorageKey, JSON.stringify(sanitizeEqualizerCustomPresets(presets)));
    return true;
  } catch {
    return false;
  }
}

export function equalizerPresetFileName(now = new Date()) {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `aria-equalizer-presets-${stamp}.json`;
}

export function equalizerPresetExportPayload(presets: EqualizerCustomPreset[]) {
  return JSON.stringify({
    app: "Aria",
    kind: "equalizer-presets",
    version: 1,
    exportedAt: new Date().toISOString(),
    frequencies: [...equalizerFrequencies],
    presets: sanitizeEqualizerCustomPresets(presets).map(({ name, bands }) => ({ name, bands })),
  }, null, 2);
}

export function parseEqualizerPresetImport(raw: unknown): { presets: EqualizerCustomPreset[]; error: string | null } {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { presets: [], error: "文件不是有效的 JSON，请选择 Aria 导出的均衡器预设文件。" };
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { presets?: unknown }).presets)
      ? (parsed as { presets: unknown[] }).presets
      : parsed && typeof parsed === "object" && "bands" in parsed
        ? [parsed]
        : null;
  if (!list) {
    return { presets: [], error: "没有在文件中找到均衡器预设列表。" };
  }
  const presets = sanitizeEqualizerCustomPresets(list);
  if (!presets.length) {
    return { presets: [], error: "预设内容为空或格式不正确，未导入任何预设。" };
  }
  return { presets, error: null };
}

export function equalizerBandsMatch(a: number[], b: number[]) {
  const left = sanitizeEqualizerBands(a);
  const right = sanitizeEqualizerBands(b);
  return left.every((gain, index) => Math.abs(gain - right[index]) < 0.05);
}

/** Smooth cubic curve for compatibility with legacy callers/tests. */
export function equalizerCurvePath(bands: number[], width = 720, height = 180) {
  const values = sanitizeEqualizerBands(bands);
  const points = values.map((gain, index) => ({
    x: (width * (index + 0.5)) / Math.max(1, values.length),
    y: height * (1 - (gain + maxEqualizerGain) / (maxEqualizerGain * 2)),
  }));
  if (!points.length) return "";
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midpoint = (previous.x + current.x) / 2;
    path += ` C ${midpoint.toFixed(1)} ${previous.y.toFixed(1)}, ${midpoint.toFixed(1)} ${current.y.toFixed(1)}, ${current.x.toFixed(1)} ${current.y.toFixed(1)}`;
  }
  return path;
}

export type EqualizerResponsePoint = {
  freqHz: number;
  normX: number;
  db: number;
};

export function freqToLogNorm(freqHz: number, minHz = 20, maxHz = 20_000): number {
  const safeFreq = Math.max(minHz, Math.min(maxHz, freqHz));
  return Math.log10(safeFreq / minHz) / Math.log10(maxHz / minHz);
}

/**
 * RBJ Audio EQ Cookbook 二阶 Peaking EQ 传递函数幅频响应 H(e^{jw})（单位 dB）。
 * 与 WebAudio BiquadFilterNode(type="peaking", Q=1.1) 保持一致的数学模型。
 */
export function computePeakingMagnitudeDb(
  freqHz: number,
  centerHz: number,
  gainDb: number,
  q = equalizerFilterQ,
  sampleRate = equalizerReferenceSampleRate,
): number {
  if (!Number.isFinite(gainDb) || Math.abs(gainDb) < 1e-4) return 0;
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const A = 10 ** (gainDb / 40);
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / A;

  const w = (2 * Math.PI * freqHz) / sampleRate;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w);
  const sin2W = Math.sin(2 * w);

  const numRe = b0 + b1 * cosW + b2 * cos2W;
  const numIm = -b1 * sinW - b2 * sin2W;
  const denRe = a0 + a1 * cosW + a2 * cos2W;
  const denIm = -a1 * sinW - a2 * sin2W;

  const magSquared = (numRe * numRe + numIm * numIm) / Math.max(1e-18, denRe * denRe + denIm * denIm);
  return 10 * Math.log10(Math.max(1e-12, magSquared));
}

export function computeEqualizerFrequencyResponse(
  bands: number[],
  pointCount = 160,
  minHz = 20,
  maxHz = 20_000,
): EqualizerResponsePoint[] {
  const safeBands = equalizerFrequencies.map((_, index) => Number(bands[index]) || 0);
  const count = Math.max(16, pointCount);
  const logRatio = Math.log10(maxHz / minHz);
  return Array.from({ length: count }, (_, index) => {
    const normX = index / (count - 1);
    const freqHz = minHz * 10 ** (normX * logRatio);
    let db = 0;
    for (let bandIndex = 0; bandIndex < equalizerFrequencies.length; bandIndex += 1) {
      db += computePeakingMagnitudeDb(freqHz, equalizerFrequencies[bandIndex], safeBands[bandIndex]);
    }
    return { freqHz, normX, db };
  });
}

export function computeSingleBandResponse(
  bandIndex: number,
  gainDb: number,
  pointCount = 128,
  minHz = 20,
  maxHz = 20_000,
): EqualizerResponsePoint[] {
  const centerHz = equalizerFrequencies[bandIndex] ?? 1000;
  const count = Math.max(16, pointCount);
  const logRatio = Math.log10(maxHz / minHz);
  return Array.from({ length: count }, (_, index) => {
    const normX = index / (count - 1);
    const freqHz = minHz * 10 ** (normX * logRatio);
    return {
      freqHz,
      normX,
      db: computePeakingMagnitudeDb(freqHz, centerHz, gainDb),
    };
  });
}

export function equalizerBodePaths(
  points: EqualizerResponsePoint[],
  width = 720,
  height = 196,
  padX = 0,
  padY = 10,
) {
  const innerWidth = Math.max(1, width - padX * 2);
  const innerHeight = Math.max(1, height - padY * 2);
  const zeroY = padY + innerHeight * 0.5;
  const dbRange = maxEqualizerGain + 2; // ±14 dB plot ceiling so summed +12 dB peaks never clip visually
  const mapPoint = (point: EqualizerResponsePoint) => {
    const clampedDb = Math.max(-dbRange, Math.min(dbRange, point.db));
    const x = padX + point.normX * innerWidth;
    const y = padY + innerHeight * (0.5 - clampedDb / (dbRange * 2));
    return { x, y };
  };
  if (!points.length) {
    return { linePath: "", positiveAreaPath: "", negativeAreaPath: "", zeroY, mapPoint };
  }

  const coords = points.map(mapPoint);
  const linePath = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
    .join(" ");

  const positiveAreaPath = [
    `M ${coords[0].x.toFixed(2)} ${zeroY.toFixed(2)}`,
    ...coords.map((coord) => `L ${coord.x.toFixed(2)} ${Math.min(zeroY, coord.y).toFixed(2)}`),
    `L ${coords[coords.length - 1].x.toFixed(2)} ${zeroY.toFixed(2)} Z`,
  ].join(" ");

  const negativeAreaPath = [
    `M ${coords[0].x.toFixed(2)} ${zeroY.toFixed(2)}`,
    ...coords.map((coord) => `L ${coord.x.toFixed(2)} ${Math.max(zeroY, coord.y).toFixed(2)}`),
    `L ${coords[coords.length - 1].x.toFixed(2)} ${zeroY.toFixed(2)} Z`,
  ].join(" ");

  return { linePath, positiveAreaPath, negativeAreaPath, zeroY, mapPoint };
}

export type EqualizerTelemetry = {
  peakBoostDb: number;
  peakCutDb: number;
  recommendedPreampDb: number;
  headroomStatus: "safe" | "caution" | "clipRisk";
  tonalSignature: string;
};

export function analyzeEqualizerResponse(bands: number[], enabled = true): EqualizerTelemetry {
  const safe = sanitizeEqualizerBands(bands);
  const response = computeEqualizerFrequencyResponse(safe, 128);
  let peakBoostDb = 0;
  let peakCutDb = 0;
  for (const point of response) {
    if (point.db > peakBoostDb) peakBoostDb = point.db;
    if (point.db < peakCutDb) peakCutDb = point.db;
  }
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const peakBoost = round1(peakBoostDb);
  const peakCut = round1(peakCutDb);
  const recommendedPreampDb = peakBoost > 0.2 ? -peakBoost : 0;
  const headroomStatus =
    peakBoost >= 6 ? "clipRisk" : peakBoost >= 2.5 ? "caution" : "safe";

  let tonalSignature = "旁路直通";
  if (enabled) {
    const lowAvg = (safe[0] + safe[1] + safe[2]) / 3;
    const midAvg = (safe[3] + safe[4] + safe[5] + safe[6]) / 4;
    const highAvg = (safe[7] + safe[8] + safe[9]) / 3;
    const maxAbs = Math.max(...safe.map((v) => Math.abs(v)));
    if (maxAbs < 0.3) tonalSignature = "参考平直 · 0 dB";
    else if (lowAvg >= 1.5 && highAvg >= 1.2 && midAvg <= 0.2) tonalSignature = "哈曼 / V-Shape";
    else if (lowAvg >= 2 && lowAvg > midAvg + 1.5) tonalSignature = "低频下潜主导";
    else if (midAvg >= 1.5 && midAvg >= lowAvg + 1) tonalSignature = "中频人声前置";
    else if (highAvg >= 1.5 && highAvg > lowAvg + 0.8) tonalSignature = "空气感与泛音增强";
    else if (lowAvg >= 1 && highAvg <= -1.5) tonalSignature = "温暖模拟滚降";
    else tonalSignature = "自定义声学塑形";
  }

  return {
    peakBoostDb: peakBoost,
    peakCutDb: peakCut,
    recommendedPreampDb,
    headroomStatus,
    tonalSignature,
  };
}
