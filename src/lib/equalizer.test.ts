import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEqualizerCustomPreset,
  defaultEqualizerSettings,
  equalizerBandsMatch,
  equalizerCurvePath,
  equalizerFrequencies,
  equalizerPresetBands,
  equalizerPresetExportPayload,
  equalizerPresetFileName,
  equalizerPresets,
  maxEqualizerCustomPresets,
  maxEqualizerGain,
  maxEqualizerPresetNameLength,
  parseEqualizerPresetImport,
  readCachedEqualizerSettings,
  sanitizeEqualizerBands,
  sanitizeEqualizerCustomPresets,
  writeCachedEqualizerSettings,
} from "./equalizer";

describe("equalizer settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always returns one gain per frequency and clamps to the supported range", () => {
    const bands = sanitizeEqualizerBands([20, -20, 3.14, "4", Number.NaN, null, 7]);
    expect(bands).toHaveLength(equalizerFrequencies.length);
    expect(bands[0]).toBe(maxEqualizerGain);
    expect(bands[1]).toBe(-maxEqualizerGain);
    expect(bands[2]).toBe(3.1);
    expect(bands[3]).toBe(4);
    expect(bands.slice(4)).toEqual([0, 0, 7, 0, 0, 0]);
  });

  it("keeps every preset within range and on the same band count", () => {
    for (const preset of equalizerPresets) {
      expect(preset.bands).toHaveLength(equalizerFrequencies.length);
      expect(preset.bands.every((gain) => Math.abs(gain) <= maxEqualizerGain)).toBe(true);
    }
    expect(equalizerPresetBands("night")).toEqual(equalizerPresets.find((preset) => preset.id === "night")?.bands);
    expect(defaultEqualizerSettings()).toMatchObject({ enabled: false, preset: "flat" });
  });

  it("draws a smooth cubic curve that follows the band gains", () => {
    const flat = equalizerCurvePath(equalizerPresetBands("flat"));
    const bass = equalizerCurvePath(equalizerPresetBands("bass"));
    expect(flat.startsWith("M ")).toBe(true);
    expect(flat).toContain(" C ");
    expect(bass).not.toBe(flat);
    expect(bass).toMatch(/^M [\d.]+ [\d.]+( C [\d.]+ [\d.]+, [\d.]+ [\d.]+, [\d.]+ [\d.]+)+$/);
  });

  it("round-trips through storage and survives malformed JSON", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    vi.stubGlobal("window", { localStorage: storage });

    const settings = { enabled: true, preset: "custom" as const, bands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
    expect(writeCachedEqualizerSettings(settings)).toBe(true);
    expect(readCachedEqualizerSettings()).toEqual(settings);

    values.set("aria-equalizer-settings-v1", "{broken");
    expect(readCachedEqualizerSettings()).toEqual(defaultEqualizerSettings());

    vi.stubGlobal("window", undefined);
    expect(writeCachedEqualizerSettings(settings)).toBe(false);
    expect(readCachedEqualizerSettings()).toEqual(defaultEqualizerSettings());
  });
});

describe("custom equalizer presets", () => {
  it("trims and clamps a newly saved preset", () => {
    const preset = createEqualizerCustomPreset(`  ${"很长的名字".repeat(10)}  `, [20, -3, 2.56], 1_700_000_000_000);
    expect(preset.name).toHaveLength(maxEqualizerPresetNameLength);
    expect(preset.bands).toHaveLength(equalizerFrequencies.length);
    expect(preset.bands[0]).toBe(maxEqualizerGain);
    expect(preset.bands[1]).toBe(-3);
    expect(preset.bands[2]).toBe(2.6);
    expect(preset.createdAt).toBe(1_700_000_000_000);
    expect(preset.id.startsWith("equalizer-preset:")).toBe(true);
    expect(createEqualizerCustomPreset("   ", []).name).toBe("我的预设");
  });

  it("sanitizes stored presets, drops junk and caps the list", () => {
    const raw = [
      { id: "keep", name: " 夜航 ", bands: [1, 2], createdAt: 42 },
      { id: "keep", name: "重复", bands: [] },
      { name: "", bands: [] },
      "nope",
      null,
      { name: "无 id 也能保留", bands: ["x", 99] },
    ];
    const presets = sanitizeEqualizerCustomPresets({ presets: raw });
    expect(presets.map((preset) => preset.name)).toEqual(["夜航", "重复", "无 id 也能保留"]);
    expect(presets[0]).toMatchObject({ id: "keep", createdAt: 42 });
    expect(presets[1].id).not.toBe("keep");
    expect(presets[2].bands[1]).toBe(maxEqualizerGain);
    expect(sanitizeEqualizerCustomPresets({})).toEqual([]);
    expect(sanitizeEqualizerCustomPresets("junk")).toEqual([]);

    const many = Array.from({ length: maxEqualizerCustomPresets + 8 }, (_, index) => ({
      name: `预设 ${index}`,
      bands: equalizerPresetBands("flat"),
    }));
    expect(sanitizeEqualizerCustomPresets(many)).toHaveLength(maxEqualizerCustomPresets);
  });

  it("exports a portable JSON file and imports it back", () => {
    const presets = [
      createEqualizerCustomPreset("清晨", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10),
      createEqualizerCustomPreset("深夜", [0, -1, -2, -3, -4, -5, -6, -7, -8, -9], 20),
    ];
    const payload = equalizerPresetExportPayload(presets);
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed).toMatchObject({ app: "Aria", kind: "equalizer-presets", version: 1 });
    expect((parsed.presets as unknown[]).length).toBe(2);
    expect(parsed.frequencies).toEqual([...equalizerFrequencies]);

    const imported = parseEqualizerPresetImport(payload);
    expect(imported.error).toBeNull();
    expect(imported.presets.map((preset) => preset.name)).toEqual(["清晨", "深夜"]);
    expect(equalizerBandsMatch(imported.presets[1].bands, presets[1].bands)).toBe(true);
    expect(equalizerPresetFileName(new Date(2026, 1, 3))).toBe("aria-equalizer-presets-20260203.json");
  });

  it("reports unreadable or empty preset files", () => {
    expect(parseEqualizerPresetImport("{oops").error).toContain("JSON");
    expect(parseEqualizerPresetImport({ hello: "world" }).error).toContain("预设列表");
    expect(parseEqualizerPresetImport({ presets: [] }).error).toContain("未导入");
    expect(parseEqualizerPresetImport([{ name: "无曲线的预设" }]).presets[0]).toMatchObject({ name: "无曲线的预设", bands: equalizerPresetBands("flat") });
    expect(parseEqualizerPresetImport([{ bands: [1, 2, 3] }]).presets).toEqual([]);
  });

  it("matches band curves within display precision", () => {
    const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(equalizerBandsMatch(base, base.map((gain) => gain + 0.04))).toBe(true);
    expect(equalizerBandsMatch(base, base.map((gain) => gain + 0.1))).toBe(false);
  });
});
