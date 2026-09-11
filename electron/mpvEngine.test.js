import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildMpvArguments,
  MpvAudioEngine,
  NATIVE_AUDIO_CLIENT_NAME,
  NATIVE_AUDIO_PROCESS_NAME,
} = require("./mpvEngine.cjs");

describe("native mpv output", () => {
  it("keeps the WASAPI session identified as Aria", () => {
    const args = buildMpvArguments("\\\\.\\pipe\\aria-test");

    expect(args).toContain(`--audio-client-name=${NATIVE_AUDIO_CLIENT_NAME}`);
    expect(args).toContain(`--title=${NATIVE_AUDIO_CLIENT_NAME}`);
    expect(args).toContain(`--force-media-title=${NATIVE_AUDIO_CLIENT_NAME}`);
    expect(args).toContain("--ao=wasapi");
    expect(args).toContain("--media-controls=no");
    expect(args).toContain("--input-media-keys=no");
    expect(args).toContain("--audio-exclusive=no");
    expect(NATIVE_AUDIO_PROCESS_NAME).toBe(`${NATIVE_AUDIO_CLIENT_NAME}.exe`);
  });

  it("starts a fresh exclusive WASAPI session when requested", () => {
    const args = buildMpvArguments("\\\\.\\pipe\\aria-exclusive-test", true);

    expect(args).toContain("--audio-exclusive=yes");
    expect(args).not.toContain("--audio-exclusive=no");
  });

  it("keeps shared and exclusive output flags mutually exclusive", () => {
    const shared = buildMpvArguments("\\\\.\\pipe\\aria-shared-test", false);
    const exclusive = buildMpvArguments("\\\\.\\pipe\\aria-exclusive-test-2", true);

    expect(shared).toContain("--audio-exclusive=no");
    expect(exclusive).toContain("--audio-exclusive=yes");
    expect(shared).not.toContain("--audio-exclusive=yes");
    expect(exclusive).not.toContain("--audio-exclusive=no");
  });

  it("uses the same executable basename OOPZ selects for app loopback", () => {
    expect(NATIVE_AUDIO_PROCESS_NAME.toLowerCase()).toBe("aria.exe");
  });

  it("releases the decoder when native playback is stopped", async () => {
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: vi.fn() });
    const kill = vi.fn();
    engine.process = { kill, killed: false };
    engine.command = vi.fn().mockResolvedValue(undefined);
    engine.state.active = true;
    engine.state.ready = true;
    const state = await engine.stop();
    expect(kill).toHaveBeenCalledOnce();
    expect(engine.process).toBeNull();
    expect(state.active).toBe(false);
    expect(state.ready).toBe(false);
  });

  it("does not stop a replacement load after an older stop finishes", async () => {
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: vi.fn() });
    let finish;
    const kill = vi.fn();
    engine.process = { kill, killed: false };
    engine.command = () => new Promise((resolve) => { finish = resolve; });
    const stopped = engine.stop();
    engine.loadToken += 1;
    engine.state.active = true;
    finish();
    expect((await stopped).kind).toBe("superseded");
    expect(kill).not.toHaveBeenCalled();
    expect(engine.state.active).toBe(true);
  });

  it("keeps the latest pause intent when older acknowledgements arrive late", async () => {
    const events = [];
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: (event) => events.push(event) });
    engine.ensureProcess = vi.fn().mockResolvedValue(undefined);
    const acknowledgements = [];
    engine.command = () => new Promise((resolve) => acknowledgements.push(resolve));
    const paused = engine.setPaused(true);
    await Promise.resolve();
    const playing = engine.setPaused(false);
    await Promise.resolve();
    acknowledgements[1]();
    await playing;
    acknowledgements[0]();
    expect((await paused).kind).toBe("superseded");
    expect(engine.state.paused).toBe(false);
    expect(engine.pendingPause).toBe(false);
    expect(events.filter((event) => event.kind === "pause").map((event) => event.paused)).toEqual([false]);
  });

  it("distinguishes an automatic advance from a later manual or paused load", () => {
    const events = [];
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: (event) => events.push(event) });
    engine.setPaused = vi.fn().mockResolvedValue(undefined);
    engine.pendingAutoAdvance = { trackId: "two", url: "two.flac" };
    engine.handleMessage({ event: "file-loaded" });
    expect(events.at(-1)).toMatchObject({ kind: "advanced", trackId: "two", gaplessGeneration: 1 });
    engine.state.trackId = "one";
    engine.handleMessage({ event: "file-loaded" });
    expect(events.at(-1)).toMatchObject({ kind: "loaded", trackId: "one", gaplessGeneration: 1 });
  });
});
