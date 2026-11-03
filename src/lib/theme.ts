export type AriaTheme = "light" | "dark" | "system";

export const ariaThemeOptions: Array<{
  value: AriaTheme;
  label: string;
  description: string;
}> = [
  { value: "light", label: "浅色", description: "始终使用明亮的白天界面。" },
  { value: "dark", label: "深色", description: "始终使用低光的夜间界面。" },
  { value: "system", label: "跟随系统", description: "随系统的外观设置自动切换。" },
];

const ariaThemeStorageKey = "aria-theme-v1";
const ariaThemeValues: readonly AriaTheme[] = ["light", "dark", "system"];

function storageOrNull(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function rootElement(element?: HTMLElement | null): HTMLElement | null {
  if (element) return element;
  return typeof document === "undefined" ? null : document.documentElement;
}

/** Invalid or missing preferences fall back to the system setting. */
export function sanitizeTheme(value: unknown): AriaTheme {
  return typeof value === "string" && (ariaThemeValues as readonly string[]).includes(value)
    ? (value as AriaTheme)
    : "system";
}

export function readCachedTheme(storage?: Storage | null): AriaTheme {
  const target = storageOrNull(storage);
  if (!target) return "system";
  try {
    return sanitizeTheme(target.getItem(ariaThemeStorageKey));
  } catch {
    return "system";
  }
}

/** Persists the preference and reports whether the write worked. */
export function writeCachedTheme(theme: AriaTheme, storage?: Storage | null): boolean {
  const target = storageOrNull(storage);
  if (!target) return false;
  try {
    target.setItem(ariaThemeStorageKey, theme);
    return true;
  } catch {
    return false;
  }
}

export function resolveTheme(theme: AriaTheme, prefersDark: boolean): "light" | "dark" {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

export function systemPrefersDark(win?: Pick<Window, "matchMedia">): boolean {
  const target = win ?? (typeof window === "undefined" ? undefined : window);
  if (!target?.matchMedia) return false;
  try {
    return target.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** Applies the resolved theme on <html> and returns the concrete theme. */
export function applyThemeToDocument(
  theme: AriaTheme,
  prefersDark: boolean,
  root?: HTMLElement | null,
): "light" | "dark" {
  const resolved = resolveTheme(theme, prefersDark);
  const target = rootElement(root);
  if (target) {
    target.classList.toggle("dark", resolved === "dark");
    target.dataset.theme = resolved;
    target.style.colorScheme = resolved;
  }
  return resolved;
}

export function currentAppliedTheme(root?: HTMLElement | null): "light" | "dark" {
  return rootElement(root)?.classList.contains("dark") ? "dark" : "light";
}
