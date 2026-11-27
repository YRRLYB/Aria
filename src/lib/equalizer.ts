export const equalizerFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const equalizerFilterQ = 1.1;
export const equalizerReferenceSampleRate = 48_000;

export const equalizer31Frequencies = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
] as const;
export const equalizer31FilterQ = 4.32;
export const maxEqualizerPeqBands = 12;
export const minEqualizerPreampDb = -18;
export const maxEqualizerPreampDb = 6;

export type EqualizerMode = "iso10" | "iso31" | "peq";
export type ParametricFilterType = "peaking" | "lowshelf" | "highshelf";

export type ParametricFilterBand = {
  id: string;
  enabled: boolean;
  type: ParametricFilterType;
  freq: number;
  gain: number;
  q: number;
};

export type CompiledEqualizerFilter = {
  type: ParametricFilterType;
  freq: number;
  gain: number;
  q: number;
};

export type CompiledEqualizerChain = {
  preampDb: number;
  filters: CompiledEqualizerFilter[];
};

export type EqualizerProfile = {
  mode: EqualizerMode;
  preampDb: number;
  bands31: number[];
  peqFilters: ParametricFilterBand[];
};

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
  mode?: EqualizerMode;
  preampDb?: number;
  bands31?: number[];
  peqFilters?: ParametricFilterBand[];
};

const equalizerPresetsStorageKey = "aria-equalizer-presets-v1";
const equalizerProfileStorageKey = "aria-equalizer-profile-v2";
export const maxEqualizerCustomPresets = 30;
export const maxEqualizerPresetNameLength = 24;

export const equalizerPeqPresets: Array<{
  id: string;
  label: string;
  targetTag: string;
  description: string;
  preampDb: number;
  filters: Omit<ParametricFilterBand, "id">[];
}> = [
  {
    id: "peq-harman-ie",
    label: "Harman IE 2019",
    targetTag: "IN-EAR",
    description: "标准入耳哈曼参考曲线：低频低架支撑 + 3kHz 耳廓共振自然补偿",
    preampDb: -4.2,
    filters: [
      { enabled: true, type: "lowshelf", freq: 105, gain: 4.2, q: 0.71 },
      { enabled: true, type: "peaking", freq: 210, gain: -1.4, q: 1.2 },
      { enabled: true, type: "peaking", freq: 1600, gain: 1.5, q: 1.4 },
      { enabled: true, type: "peaking", freq: 3100, gain: 2.8, q: 1.8 },
      { enabled: true, type: "highshelf", freq: 9500, gain: -1.0, q: 0.71 },
    ],
  },
  {
    id: "peq-harman-oe",
    label: "Harman OE 2018",
    targetTag: "OVER-EAR",
    description: "头戴式大耳哈曼曲线：消除中低频箱声，保留饱满极低频与高频空气感",
    preampDb: -3.5,
    filters: [
      { enabled: true, type: "lowshelf", freq: 95, gain: 3.5, q: 0.71 },
      { enabled: true, type: "peaking", freq: 250, gain: -1.8, q: 1.1 },
      { enabled: true, type: "peaking", freq: 2800, gain: 2.4, q: 1.5 },
      { enabled: true, type: "highshelf", freq: 8500, gain: 1.2, q: 0.75 },
    ],
  },
  {
    id: "peq-diffuse-field",
    label: "扩散场参考",
    targetTag: "DIFFUSE",
    description: "监听级扩散场平直响应，收敛肥厚低频以突出混音微细节",
    preampDb: -2.5,
    filters: [
      { enabled: true, type: "lowshelf", freq: 85, gain: -1.8, q: 0.71 },
      { enabled: true, type: "peaking", freq: 320, gain: -1.2, q: 1.0 },
      { enabled: true, type: "peaking", freq: 2400, gain: 2.0, q: 1.3 },
      { enabled: true, type: "highshelf", freq: 10000, gain: 1.5, q: 0.71 },
    ],
  },
  {
    id: "peq-warm-studio",
    label: "温暖模拟",
    targetTag: "ANALOG",
    description: "温和低频铺垫搭配 6kHz 齿音柔化，适合长时间高音量聆听",
    preampDb: -2.4,
    filters: [
      { enabled: true, type: "lowshelf", freq: 110, gain: 2.4, q: 0.65 },
      { enabled: true, type: "peaking", freq: 400, gain: 0.8, q: 0.9 },
      { enabled: true, type: "peaking", freq: 6200, gain: -2.4, q: 2.2 },
      { enabled: true, type: "highshelf", freq: 11000, gain: -1.8, q: 0.7 },
    ],
  },
  {
    id: "peq-vocal-air",
    label: "人声空气感",
    targetTag: "AIR+",
    description: "精准提亮女声/器乐泛音区，同时干净收敛底噪般的极低频驻波",
    preampDb: -3.2,
    filters: [
      { enabled: true, type: "lowshelf", freq: 75, gain: -1.5, q: 0.75 },
      { enabled: true, type: "peaking", freq: 1850, gain: 2.2, q: 1.3 },
      { enabled: true, type: "peaking", freq: 3800, gain: 2.6, q: 1.7 },
      { enabled: true, type: "highshelf", freq: 12000, gain: 2.8, q: 0.7 },
    ],
  },
];

export function sanitizePreampDb(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(minEqualizerPreampDb, Math.min(maxEqualizerPreampDb, Math.round(num * 10) / 10));
}

export function sanitizeEqualizer31Bands(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  return equalizer31Frequencies.map((_, index) => {
    const gain = Number(source[index]);
    if (!Number.isFinite(gain)) return 0;
    return Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(gain * 10) / 10));
  });
}

export function resampleBands10To31(bands10: number[]): number[] {
  const safe10 = sanitizeEqualizerBands(bands10);
  const log10 = equalizerFrequencies.map((freq) => Math.log10(freq));
  return equalizer31Frequencies.map((freq31) => {
    const targetLog = Math.log10(freq31);
    if (targetLog <= log10[0]) return safe10[0];
    if (targetLog >= log10[log10.length - 1]) return safe10[safe10.length - 1];
    for (let i = 0; i < log10.length - 1; i += 1) {
      if (targetLog >= log10[i] && targetLog <= log10[i + 1]) {
        const t = (targetLog - log10[i]) / Math.max(1e-6, log10[i + 1] - log10[i]);
        return Math.round((safe10[i] + (safe10[i + 1] - safe10[i]) * t) * 10) / 10;
      }
    }
    return 0;
  });
}

function createPeqFilterId(index: number) {
  return `peq:${index}:${Math.random().toString(36).slice(2, 7)}`;
}

export function sanitizePeqFilters(value: unknown): ParametricFilterBand[] {
  if (!Array.isArray(value)) return [];
  const out: ParametricFilterBand[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<ParametricFilterBand>;
    const type: ParametricFilterType =
      raw.type === "lowshelf" || raw.type === "highshelf" || raw.type === "peaking"
        ? raw.type
        : "peaking";
    const freqNum = Number(raw.freq);
    const gainNum = Number(raw.gain);
    const qNum = Number(raw.q);
    const freq = Number.isFinite(freqNum) ? Math.max(20, Math.min(20_000, Math.round(freqNum))) : 1000;
    const gain = Number.isFinite(gainNum)
      ? Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(gainNum * 10) / 10))
      : 0;
    const q = Number.isFinite(qNum) ? Math.max(0.2, Math.min(16, Math.round(qNum * 100) / 100)) : 1.0;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : createPeqFilterId(index);
    out.push({
      id,
      enabled: raw.enabled !== false,
      type,
      freq,
      gain,
      q,
    });
    if (out.length >= maxEqualizerPeqBands) break;
  }
  return out;
}

export function defaultPeqFilters(): ParametricFilterBand[] {
  return equalizerPeqPresets[0].filters.map((filter, index) => ({
    ...filter,
    id: `peq-init-${index}`,
  }));
}

export function defaultEqualizerProfile(): EqualizerProfile {
  return {
    mode: "iso10",
    preampDb: 0,
    bands31: equalizer31Frequencies.map(() => 0),
    peqFilters: defaultPeqFilters(),
  };
}

export function readCachedEqualizerProfile(): EqualizerProfile {
  const fallback = defaultEqualizerProfile();
  try {
    const raw = window.localStorage.getItem(equalizerProfileStorageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<EqualizerProfile>;
    const mode: EqualizerMode =
      parsed.mode === "iso31" || parsed.mode === "peq" || parsed.mode === "iso10"
        ? parsed.mode
        : "iso10";
    const peqFilters = sanitizePeqFilters(parsed.peqFilters);
    return {
      mode,
      preampDb: sanitizePreampDb(parsed.preampDb),
      bands31: Array.isArray(parsed.bands31) ? sanitizeEqualizer31Bands(parsed.bands31) : fallback.bands31,
      peqFilters: peqFilters.length ? peqFilters : fallback.peqFilters,
    };
  } catch {
    return fallback;
  }
}

export function writeCachedEqualizerProfile(profile: EqualizerProfile) {
  try {
    window.localStorage.setItem(equalizerProfileStorageKey, JSON.stringify({
      mode: profile.mode,
      preampDb: sanitizePreampDb(profile.preampDb),
      bands31: sanitizeEqualizer31Bands(profile.bands31),
      peqFilters: sanitizePeqFilters(profile.peqFilters),
    }));
    return true;
  } catch {
    return false;
  }
}

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
    const peqFilters = sanitizePeqFilters(record.peqFilters);
    const mode: EqualizerMode | undefined =
      record.mode === "iso10" || record.mode === "iso31" || record.mode === "peq"
        ? record.mode
        : undefined;
    presets.push({
      id,
      name,
      bands: sanitizeEqualizerBands(record.bands),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      ...(mode ? { mode } : {}),
      ...(typeof record.preampDb === "number" && Number.isFinite(record.preampDb)
        ? { preampDb: sanitizePreampDb(record.preampDb) }
        : {}),
      ...(Array.isArray(record.bands31) ? { bands31: sanitizeEqualizer31Bands(record.bands31) } : {}),
      ...(peqFilters.length ? { peqFilters } : {}),
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

export function equalizerPresetExportPayloadV2(presets: EqualizerCustomPreset[]) {
  return JSON.stringify({
    app: "Aria",
    kind: "equalizer-presets",
    version: 2,
    exportedAt: new Date().toISOString(),
    frequencies: [...equalizerFrequencies],
    frequencies31: [...equalizer31Frequencies],
    presets: sanitizeEqualizerCustomPresets(presets).map(({ name, bands, mode, preampDb, bands31, peqFilters }) => ({
      name,
      bands,
      ...(mode ? { mode } : {}),
      ...(typeof preampDb === "number" ? { preampDb } : {}),
      ...(bands31 ? { bands31 } : {}),
      ...(peqFilters ? { peqFilters } : {}),
    })),
  }, null, 2);
}

export function parseEqualizerApoText(
  text: string,
  fallbackName = "APO 导入曲线",
): { preset: EqualizerCustomPreset; detectedFormat: "apo-peq" | "apo-graphic" } | { error: string } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!lines.length) {
    return { error: "没有在文本中检测到 Equalizer APO 滤波器配置。" };
  }

  let preampDb = 0;
  const peqFilters: ParametricFilterBand[] = [];
  let graphicPairs: Array<{ freq: number; gain: number }> = [];

  for (const line of lines) {
    const preampMatch = line.match(/^Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
    if (preampMatch) {
      preampDb = sanitizePreampDb(Number(preampMatch[1]));
      continue;
    }

    const graphicMatch = line.match(/^GraphicEQ:\s*(.+)$/i);
    if (graphicMatch) {
      const pairs = graphicMatch[1]
        .split(";")
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
          const parts = chunk.split(/\s+/);
          return { freq: Number(parts[0]), gain: Number(parts[1]) };
        })
        .filter((pair) => Number.isFinite(pair.freq) && Number.isFinite(pair.gain));
      if (pairs.length) graphicPairs = pairs;
      continue;
    }

    const filterMatch = line.match(
      /^Filter(?:\s+\d+)?:\s*(ON|OFF)\s+(PK|LSCQ?|LS|HSCQ?|HS)\s+Fc\s+(\d+(?:\.\d+)?)\s*Hz\s+Gain\s+([+-]?\d+(?:\.\d+)?)\s*dB(?:\s+Q\s+(\d+(?:\.\d+)?))?/i,
    );
    if (filterMatch) {
      const [, state, rawType, rawFreq, rawGain, rawQ] = filterMatch;
      const upper = rawType.toUpperCase();
      const type: ParametricFilterType = upper.startsWith("LS")
        ? "lowshelf"
        : upper.startsWith("HS")
          ? "highshelf"
          : "peaking";
      const freq = Math.max(20, Math.min(20_000, Math.round(Number(rawFreq))));
      const gain = Math.max(-maxEqualizerGain, Math.min(maxEqualizerGain, Math.round(Number(rawGain) * 10) / 10));
      const q = rawQ ? Math.max(0.2, Math.min(16, Math.round(Number(rawQ) * 100) / 100)) : 0.71;
      peqFilters.push({
        id: createPeqFilterId(peqFilters.length),
        enabled: state.toUpperCase() === "ON",
        type,
        freq,
        gain,
        q,
      });
    }
  }

  if (peqFilters.length) {
    const trimmed = peqFilters.slice(0, maxEqualizerPeqBands);
    return {
      detectedFormat: "apo-peq",
      preset: {
        ...createEqualizerCustomPreset(fallbackName, equalizerPresets[0].bands),
        mode: "peq",
        preampDb,
        peqFilters: trimmed,
      },
    };
  }

  if (graphicPairs.length) {
    const sorted = [...graphicPairs].sort((a, b) => a.freq - b.freq);
    const interpolateAt = (targetFreq: number) => {
      if (targetFreq <= sorted[0].freq) return sorted[0].gain;
      if (targetFreq >= sorted[sorted.length - 1].freq) return sorted[sorted.length - 1].gain;
      const logTarget = Math.log10(targetFreq);
      for (let i = 0; i < sorted.length - 1; i += 1) {
        if (targetFreq >= sorted[i].freq && targetFreq <= sorted[i + 1].freq) {
          const l0 = Math.log10(sorted[i].freq);
          const l1 = Math.log10(sorted[i + 1].freq);
          const t = (logTarget - l0) / Math.max(1e-6, l1 - l0);
          return sorted[i].gain + (sorted[i + 1].gain - sorted[i].gain) * t;
        }
      }
      return 0;
    };
    const bands31 = sanitizeEqualizer31Bands(equalizer31Frequencies.map((f) => interpolateAt(f)));
    const bands10 = sanitizeEqualizerBands(equalizerFrequencies.map((f) => interpolateAt(f)));
    return {
      detectedFormat: "apo-graphic",
      preset: {
        ...createEqualizerCustomPreset(fallbackName, bands10),
        mode: "iso31",
        preampDb,
        bands31,
      },
    };
  }

  return { error: "未识别到 Equalizer APO（Filter / GraphicEQ）有效条目。" };
}

export function exportEqualizerToApoText(name: string, chain: CompiledEqualizerChain): string {
  const lines = [
    `# Aria Scientific Equalizer Export — ${name}`,
    `Preamp: ${sanitizePreampDb(chain.preampDb).toFixed(1)} dB`,
  ];
  chain.filters.forEach((filter, index) => {
    const code = filter.type === "lowshelf" ? "LSC" : filter.type === "highshelf" ? "HSC" : "PK";
    lines.push(
      `Filter ${index + 1}: ON ${code} Fc ${Math.round(filter.freq)} Hz Gain ${filter.gain.toFixed(1)} dB Q ${filter.q.toFixed(2)}`,
    );
  });
  return lines.join("\n");
}

export function parseEqualizerPresetImport(raw: unknown): { presets: EqualizerCustomPreset[]; error: string | null } {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const looksLikeApo = !trimmed.startsWith("{") && !trimmed.startsWith("[") && /(?:^|\n)\s*(?:Preamp:|Filter(?:\s+\d+)?:|GraphicEQ:)/i.test(trimmed);
    if (looksLikeApo) {
      const apo = parseEqualizerApoText(trimmed);
      if ("error" in apo) return { presets: [], error: apo.error };
      return { presets: [apo.preset], error: null };
    }
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { presets: [], error: "文件不是有效的 JSON 或 Equalizer APO 文本。" };
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

function evalBiquadMagnitudeDb(
  freqHz: number,
  sampleRate: number,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): number {
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

export function computeLowShelfMagnitudeDb(
  freqHz: number,
  centerHz: number,
  gainDb: number,
  q = 0.71,
  sampleRate = equalizerReferenceSampleRate,
): number {
  if (!Number.isFinite(gainDb) || Math.abs(gainDb) < 1e-4) return 0;
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const A = 10 ** (gainDb / 40);
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Math.max(0.2, q));
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
  const b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha);
  const a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosW0);
  const a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha;
  return evalBiquadMagnitudeDb(freqHz, sampleRate, b0, b1, b2, a0, a1, a2);
}

export function computeHighShelfMagnitudeDb(
  freqHz: number,
  centerHz: number,
  gainDb: number,
  q = 0.71,
  sampleRate = equalizerReferenceSampleRate,
): number {
  if (!Number.isFinite(gainDb) || Math.abs(gainDb) < 1e-4) return 0;
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const A = 10 ** (gainDb / 40);
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Math.max(0.2, q));
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
  const b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);
  const a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosW0);
  const a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;
  return evalBiquadMagnitudeDb(freqHz, sampleRate, b0, b1, b2, a0, a1, a2);
}

export function computeFilterMagnitudeDb(
  freqHz: number,
  filter: CompiledEqualizerFilter,
  sampleRate = equalizerReferenceSampleRate,
): number {
  if (filter.type === "lowshelf") {
    return computeLowShelfMagnitudeDb(freqHz, filter.freq, filter.gain, filter.q, sampleRate);
  }
  if (filter.type === "highshelf") {
    return computeHighShelfMagnitudeDb(freqHz, filter.freq, filter.gain, filter.q, sampleRate);
  }
  return computePeakingMagnitudeDb(freqHz, filter.freq, filter.gain, filter.q, sampleRate);
}

export function compileEqualizerChain(
  settings: EqualizerSettings,
  profile: EqualizerProfile,
): CompiledEqualizerChain {
  const preampDb = sanitizePreampDb(profile.preampDb);
  if (profile.mode === "iso31") {
    const bands = sanitizeEqualizer31Bands(profile.bands31);
    const filters: CompiledEqualizerFilter[] = [];
    bands.forEach((gain, index) => {
      if (Math.abs(gain) > 0.04) {
        filters.push({
          type: "peaking",
          freq: equalizer31Frequencies[index],
          gain,
          q: equalizer31FilterQ,
        });
      }
    });
    return { preampDb, filters };
  }
  if (profile.mode === "peq") {
    const filters: CompiledEqualizerFilter[] = sanitizePeqFilters(profile.peqFilters)
      .filter((band) => band.enabled && Math.abs(band.gain) > 0.04)
      .map(({ type, freq, gain, q }) => ({ type, freq, gain, q }));
    return { preampDb, filters };
  }
  const bands10 = sanitizeEqualizerBands(settings.bands);
  const filters: CompiledEqualizerFilter[] = [];
  bands10.forEach((gain, index) => {
    if (Math.abs(gain) > 0.04) {
      filters.push({
        type: "peaking",
        freq: equalizerFrequencies[index],
        gain,
        q: equalizerFilterQ,
      });
    }
  });
  return { preampDb, filters };
}

export function computeCompiledEqualizerResponse(
  chain: CompiledEqualizerChain,
  pointCount = 180,
  minHz = 20,
  maxHz = 20_000,
): EqualizerResponsePoint[] {
  const count = Math.max(16, pointCount);
  const logRatio = Math.log10(maxHz / minHz);
  const preamp = sanitizePreampDb(chain.preampDb);
  return Array.from({ length: count }, (_, index) => {
    const normX = index / (count - 1);
    const freqHz = minHz * 10 ** (normX * logRatio);
    let db = preamp;
    for (let i = 0; i < chain.filters.length; i += 1) {
      db += computeFilterMagnitudeDb(freqHz, chain.filters[i]);
    }
    return { freqHz, normX, db };
  });
}

export function computeSingleCompiledFilterResponse(
  filter: CompiledEqualizerFilter,
  pointCount = 128,
  minHz = 20,
  maxHz = 20_000,
): EqualizerResponsePoint[] {
  const count = Math.max(16, pointCount);
  const logRatio = Math.log10(maxHz / minHz);
  return Array.from({ length: count }, (_, index) => {
    const normX = index / (count - 1);
    const freqHz = minHz * 10 ** (normX * logRatio);
    return {
      freqHz,
      normX,
      db: computeFilterMagnitudeDb(freqHz, filter),
    };
  });
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

export function analyzeCompiledEqualizerResponse(
  chain: CompiledEqualizerChain,
  enabled = true,
): EqualizerTelemetry {
  const response = computeCompiledEqualizerResponse(chain, 128);
  let peakBoostDb = 0;
  let peakCutDb = 0;
  let lowSum = 0;
  let lowN = 0;
  let midSum = 0;
  let midN = 0;
  let highSum = 0;
  let highN = 0;

  for (const point of response) {
    if (point.db > peakBoostDb) peakBoostDb = point.db;
    if (point.db < peakCutDb) peakCutDb = point.db;
    if (point.freqHz < 220) {
      lowSum += point.db;
      lowN += 1;
    } else if (point.freqHz < 2400) {
      midSum += point.db;
      midN += 1;
    } else {
      highSum += point.db;
      highN += 1;
    }
  }

  const round1 = (value: number) => Math.round(value * 10) / 10;
  const peakBoost = round1(peakBoostDb);
  const peakCut = round1(peakCutDb);
  // Recommended preamp relative to 0 dBFS peak without current preamp bias
  const rawResponse = computeCompiledEqualizerResponse({ preampDb: 0, filters: chain.filters }, 128);
  let rawPeak = 0;
  for (const pt of rawResponse) {
    if (pt.db > rawPeak) rawPeak = pt.db;
  }
  const recommendedPreampDb = rawPeak > 0.2 ? -round1(rawPeak) : 0;
  const headroomStatus =
    peakBoost >= 4 ? "clipRisk" : peakBoost >= 1.2 ? "caution" : "safe";

  let tonalSignature = "旁路直通";
  if (enabled) {
    const lowAvg = lowN ? lowSum / lowN : 0;
    const midAvg = midN ? midSum / midN : 0;
    const highAvg = highN ? highSum / highN : 0;
    if (!chain.filters.length && Math.abs(chain.preampDb) < 0.2) tonalSignature = "参考平直 · 0 dB";
    else if (lowAvg - midAvg >= 1.2 && highAvg - midAvg >= 1.0) tonalSignature = "哈曼 / V-Shape";
    else if (lowAvg >= midAvg + 1.5) tonalSignature = "低频下潜主导";
    else if (midAvg >= lowAvg + 1.0 && midAvg >= highAvg + 0.5) tonalSignature = "中频人声前置";
    else if (highAvg >= lowAvg + 0.8) tonalSignature = "空气感与泛音增强";
    else if (lowAvg >= highAvg + 1.8) tonalSignature = "温暖模拟滚降";
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
