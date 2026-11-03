export const equalizerFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export type EqualizerPresetId = "flat" | "pop" | "rock" | "vocal" | "bass" | "night" | "custom";

export type EqualizerSettings = {
  enabled: boolean;
  preset: EqualizerPresetId;
  bands: number[];
};

export const equalizerPresets: Array<{ id: EqualizerPresetId; label: string; description: string; bands: number[] }> = [
  { id: "flat", label: "平直", description: "不改变原始声音", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "pop", label: "流行", description: "明亮人声与轻快节奏", bands: [-1, 0, 1, 3, 4, 3, 1, -1, -2, -2] },
  { id: "rock", label: "摇滚", description: "厚实低频与吉他存在感", bands: [4, 3, 2, 0, -1, 1, 3, 4, 3, 2] },
  { id: "vocal", label: "人声", description: "突出中频与咬字细节", bands: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2] },
  { id: "bass", label: "低音", description: "更深的低频与下潜", bands: [6, 5, 3, 1, 0, 0, -1, -1, 0, 0] },
  { id: "night", label: "深夜", description: "柔和耐听，降低高频刺激", bands: [2, 1, 1, 0, 0, -1, -2, -3, -4, -5] },
];

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
  return equalizerPresets.find((preset) => preset.id === id)?.bands ?? equalizerPresets[0].bands;
}

export function defaultEqualizerSettings(): EqualizerSettings {
  return { enabled: false, preset: "flat", bands: [...equalizerPresets[0].bands] };
}

export function readCachedEqualizerSettings(): EqualizerSettings {
  try {
    const raw = window.localStorage.getItem(equalizerStorageKey);
    if (!raw) return defaultEqualizerSettings();
    const parsed = JSON.parse(raw) as Partial<EqualizerSettings>;
    const preset = equalizerPresets.some((item) => item.id === parsed.preset) || parsed.preset === "custom"
      ? parsed.preset as EqualizerPresetId
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

/** Smooth cubic curve for the animated response graph.
 *  Points sit at the centre of each band column so the curve, the grid and the
 *  draggable handles all share one coordinate system. */
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
