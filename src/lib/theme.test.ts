import { describe, expect, it, vi } from "vitest";
import {
  applyThemeToDocument,
  ariaThemeOptions,
  readCachedTheme,
  resolveTheme,
  sanitizeTheme,
  systemPrefersDark,
  writeCachedTheme,
} from "./theme";

describe("aria theme", () => {
  it("only accepts the three supported preferences", () => {
    expect(sanitizeTheme("dark")).toBe("dark");
    expect(sanitizeTheme("light")).toBe("light");
    expect(sanitizeTheme("system")).toBe("system");
    expect(sanitizeTheme("neon")).toBe("system");
    expect(sanitizeTheme(null)).toBe("system");
    expect(ariaThemeOptions.map((option) => option.value)).toEqual(["light", "dark", "system"]);
  });

  it("resolves the system preference and keeps explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("round-trips through storage and survives malformed values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    expect(readCachedTheme(storage)).toBe("system");
    expect(writeCachedTheme("dark", storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith("aria-theme-v1", "dark");
    expect(readCachedTheme(storage)).toBe("dark");

    expect(writeCachedTheme("dark", { setItem: () => { throw new Error("quota"); } })).toBe(false);
    expect(readCachedTheme({ getItem: () => { throw new Error("denied"); } })).toBe("system");
  });

  it("reads the OS preference and applies the resolved class to a root element", () => {
    expect(systemPrefersDark({ matchMedia: () => ({ matches: true }) as MediaQueryList })).toBe(true);
    expect(systemPrefersDark({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe(false);

    const classes = new Set<string>();
    const root = {
      classList: { toggle: (name: string, force?: boolean) => { if (force) classes.add(name); else classes.delete(name); } },
      dataset: {} as Record<string, string>,
      style: {} as CSSStyleDeclaration,
    } as unknown as HTMLElement;
    expect(applyThemeToDocument("dark", false, root)).toBe("dark");
    expect(classes.has("dark")).toBe(true);
    expect(applyThemeToDocument("system", false, root)).toBe("light");
    expect(classes.has("dark")).toBe(false);
    expect(root.dataset.theme).toBe("light");
  });
});
