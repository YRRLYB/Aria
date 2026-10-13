import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), update: vi.fn() }));
vi.mock("../lyrics", () => ({ resolveLyricLines: mocks.resolve }));
vi.mock("../store", () => ({ updateStore: mocks.update }));
import { bindLocalLyrics } from "./lyricBindingService";

let bindings: Record<string, string>;
const lyrics = [{ time: "00:01", text: "Fixture lyrics" }];
beforeEach(() => {
  vi.clearAllMocks(); bindings = {};
  mocks.resolve.mockResolvedValue(lyrics);
  mocks.update.mockImplementation(async (updater) => {
    const next = updater({ neteaseCookie: null, lyricBindings: bindings });
    bindings = next.lyricBindings; return next;
  });
});
describe("conditional lyric binding", () => {
  it("accepts explicit manual choices and conditional automatic binding", async () => {
    const automatic = await bindLocalLyrics("a", "netease:auto", null);
    expect(automatic.accepted).toBe(true);
    expect(bindings.a).toBe("netease:auto");
    const manual = await bindLocalLyrics("a", "netease:manual");
    expect(manual.lyrics).toEqual(lyrics);
    expect(bindings.a).toBe("netease:manual");
  });
  it("does not let a delayed automatic response overwrite a manual choice", async () => {
    let finish!: (value: typeof lyrics) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = bindLocalLyrics("a", "netease:auto", null);
    await bindLocalLyrics("a", "netease:manual");
    finish(lyrics);
    const result = await pending;
    expect(result.accepted).toBe(false);
    expect(result.lyrics).toEqual([]);
    expect(bindings.a).toBe("netease:manual");
  });
  it("does not restore a removed binding when a refresh finishes after undo", async () => {
    bindings.a = "netease:batch";
    let finish!: (value: typeof lyrics) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = bindLocalLyrics("a", "netease:batch", "netease:batch");
    delete bindings.a;
    finish(lyrics);
    expect((await pending).accepted).toBe(false);
    expect(bindings.a).toBeUndefined();
  });
});
