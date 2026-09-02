import { describe, expect, it } from "vitest";
import { defaultKeyboardShortcuts, formatShortcut, shortcutsConflict } from "./keyboardShortcuts";

describe("keyboardShortcuts", () => {
  it("formats Electron accelerators for the settings UI", () => {
    expect(formatShortcut("Control+Alt+Space")).toBe("Ctrl + Alt + Space");
    expect(formatShortcut("Super+Shift+Right")).toBe("Win + Shift + Right");
  });

  it("prevents two commands from claiming the same accelerator", () => {
    expect(shortcutsConflict(defaultKeyboardShortcuts, "next", "Control+Alt+Space")).toBe(true);
    expect(shortcutsConflict(defaultKeyboardShortcuts, "next", "Control+Shift+N")).toBe(false);
  });
});
