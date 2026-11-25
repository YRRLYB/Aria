import { describe, expect, it } from "vitest";
import {
  defaultKeyboardShortcuts,
  formatShortcut,
  readKeyboardShortcuts,
  shortcutDefinitions,
  shortcutsConflict,
} from "./keyboardShortcuts";

describe("keyboardShortcuts", () => {
  it("formats Electron accelerators for the settings UI", () => {
    expect(formatShortcut("Control+Alt+Space")).toBe("Ctrl + Alt + Space");
    expect(formatShortcut("Super+Shift+Right")).toBe("Win + Shift + Right");
    expect(formatShortcut("Control+Alt+Space", true)).toBe("⌃ + ⌥ + Space");
    expect(formatShortcut("CommandOrControl+Shift+Right", true)).toBe("⌘ + ⇧ + →");
  });

  it("prevents two commands from claiming the same accelerator", () => {
    expect(shortcutsConflict(defaultKeyboardShortcuts, "next", "Control+Alt+Space")).toBe(true);
    expect(shortcutsConflict(defaultKeyboardShortcuts, "next", "Control+Shift+N")).toBe(false);
  });

  it("exposes all 10 global shortcut definitions with unique defaults", () => {
    expect(shortcutDefinitions.map((item) => item.command)).toEqual([
      "toggle",
      "previous",
      "next",
      "volumeUp",
      "volumeDown",
      "mute",
      "like",
      "mode",
      "equalizer",
      "show",
    ]);

    const accelerators = Object.values(defaultKeyboardShortcuts);
    expect(accelerators).toHaveLength(10);
    expect(new Set(accelerators.map((item) => item.toLowerCase())).size).toBe(10);
    for (const def of shortcutDefinitions) {
      expect(shortcutsConflict(defaultKeyboardShortcuts, def.command, defaultKeyboardShortcuts[def.command])).toBe(false);
    }
  });

  it("hydrates missing commands with defaults when migrating legacy 4-key localStorage JSON", () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    const legacyPayload = JSON.stringify({
      toggle: "Control+Shift+Space",
      previous: "Control+Alt+Left",
      next: "Control+Alt+Right",
      show: "Control+Shift+A",
    });
    (globalThis as { window: unknown }).window = {
      localStorage: {
        getItem: () => legacyPayload,
        setItem: () => undefined,
      },
    };
    try {
      const migrated = readKeyboardShortcuts();
      expect(migrated.toggle).toBe("Control+Shift+Space");
      expect(migrated.show).toBe("Control+Shift+A");
      expect(migrated.volumeUp).toBe(defaultKeyboardShortcuts.volumeUp);
      expect(migrated.volumeDown).toBe(defaultKeyboardShortcuts.volumeDown);
      expect(migrated.mute).toBe(defaultKeyboardShortcuts.mute);
      expect(migrated.like).toBe(defaultKeyboardShortcuts.like);
      expect(migrated.mode).toBe(defaultKeyboardShortcuts.mode);
      expect(migrated.equalizer).toBe(defaultKeyboardShortcuts.equalizer);
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previousWindow;
      }
    }
  });
});
