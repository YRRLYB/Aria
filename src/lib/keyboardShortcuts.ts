export type ShortcutCommand = "toggle" | "previous" | "next" | "show";
export type KeyboardShortcuts = Record<ShortcutCommand, string>;

export const shortcutDefinitions: Array<{ command: ShortcutCommand; label: string; description: string }> = [
  { command: "toggle", label: "播放 / 暂停", description: "无论 Aria 是否在前台都可切换播放状态。" },
  { command: "previous", label: "上一首", description: "返回当前队列中的上一首歌曲。" },
  { command: "next", label: "下一首", description: "跳到当前队列中的下一首歌曲。" },
  { command: "show", label: "唤出 Aria", description: "从后台托管状态恢复主窗口。" },
];

export const defaultKeyboardShortcuts: KeyboardShortcuts = {
  toggle: "Control+Alt+Space",
  previous: "Control+Alt+Left",
  next: "Control+Alt+Right",
  show: "Control+Alt+A",
};

const storageKey = "aria-keyboard-shortcuts";
const modifierOrder = ["Control", "Alt", "Shift", "Super"] as const;
const modifierKeys = new Set(["Control", "Alt", "Shift", "Meta"]);

export function readKeyboardShortcuts(): KeyboardShortcuts {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { ...defaultKeyboardShortcuts };
    const stored = JSON.parse(raw) as Partial<Record<ShortcutCommand, unknown>>;
    return shortcutDefinitions.reduce<KeyboardShortcuts>((result, definition) => {
      result[definition.command] = normalizeShortcut(stored[definition.command]) ?? defaultKeyboardShortcuts[definition.command];
      return result;
    }, {} as KeyboardShortcuts);
  } catch {
    return { ...defaultKeyboardShortcuts };
  }
}

export function writeKeyboardShortcuts(shortcuts: KeyboardShortcuts) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(shortcuts));
  } catch {
    // Shortcut settings are non-critical and should never block playback.
  }
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent) {
  if (event.isComposing || modifierKeys.has(event.key)) return null;

  const key = normalizeKey(event);
  if (!key) return null;
  const modifiers = modifierOrder.filter((modifier) => {
    if (modifier === "Control") return event.ctrlKey;
    if (modifier === "Alt") return event.altKey;
    if (modifier === "Shift") return event.shiftKey;
    return event.metaKey;
  });

  // A global shortcut without a modifier would steal ordinary typing system-wide.
  if (!modifiers.length) return null;
  return [...modifiers, key].join("+");
}

export function formatShortcut(shortcut: string) {
  return shortcut
    .replace(/Control/g, "Ctrl")
    .replace(/Alt/g, "Alt")
    .replace(/Shift/g, "Shift")
    .replace(/Super/g, "Win")
    .replace(/Left/g, "Left")
    .replace(/Right/g, "Right")
    .replace(/Space/g, "Space")
    .replace(/\+/g, " + ");
}

export function shortcutsConflict(shortcuts: KeyboardShortcuts, command: ShortcutCommand, candidate: string) {
  return shortcutDefinitions.some(
    (definition) => definition.command !== command && shortcuts[definition.command].toLowerCase() === candidate.toLowerCase(),
  );
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  return shortcutFromKeyboardEvent(event)?.toLowerCase() === shortcut.toLowerCase();
}

function normalizeShortcut(value: unknown) {
  if (typeof value !== "string") return null;
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.at(-1);
  if (!key) return null;

  const modifiers = modifierOrder.filter((modifier) => parts.some((part) => part.toLowerCase() === modifier.toLowerCase()));
  if (!modifiers.length) return null;
  return [...modifiers, key].join("+");
}

function normalizeKey(event: KeyboardEvent) {
  if (event.code === "Space") return "Space";
  if (event.key === "ArrowLeft") return "Left";
  if (event.key === "ArrowRight") return "Right";
  if (event.key === "ArrowUp") return "Up";
  if (event.key === "ArrowDown") return "Down";
  if (/^F\d{1,2}$/i.test(event.key)) return event.key.toUpperCase();
  if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
  if (event.key === "MediaPlayPause") return "MediaPlayPause";
  if (event.key === "MediaTrackNext") return "MediaNextTrack";
  if (event.key === "MediaTrackPrevious") return "MediaPreviousTrack";
  return null;
}
