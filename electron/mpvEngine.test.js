import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

// The argument assertions describe the shipped Windows configuration (WASAPI,
// aria.exe, named pipes). The engine captures process.platform into module
// constants at require time, so pin it before loading and restore right after;
// vitest runs this file in its own worker either way.
const hostPlatform = process.platform;
Object.defineProperty(process, "platform", { value: "win32" });
const {
  buildIpcPipePath,
  buildMpvArguments,
  MpvAudioEngine,
  NATIVE_AUDIO_CLIENT_NAME,
  NATIVE_AUDIO_PROCESS_NAME,
} = require("./mpvEngine.cjs");
Object.defineProperty(process, "platform", { value: hostPlatform });

describe("native mpv output", () => {
  it("enables and removes only Aria's loudness filter", async () => {
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: vi.fn() });
    engine.command = vi.fn().mockResolvedValue([]);
    await engine.setNormalization(true);
    expect(engine.command).toHaveBeenCalledWith("af", "add", expect.stringContaining("@aria-normalization:lavfi=[dynaudnorm="));
    expect(engine.state.normalizationEnabled).toBe(true);
    engine.command.mockClear().mockResolvedValue([{ label: "equalizer" }, { label: "aria-normalization" }]);
    await engine.setNormalization(true);
    expect(engine.command).not.toHaveBeenCalledWith("af", "add", expect.anything());
    await engine.setNormalization(false);
    expect(engine.command).toHaveBeenCalledWith("af", "remove", "@aria-normalization");
    expect(engine.state.normalizationEnabled).toBe(false);
  });

  it("surfaces filter errors without claiming normalization is active", async () => {
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: vi.fn() });
    engine.command = vi.fn().mockImplementation((command) => command === "af" ? Promise.reject(new Error("unsupported")) : Promise.resolve([]));
    await expect(engine.setNormalization(true)).rejects.toThrow("unsupported");
    expect(engine.state.normalizationEnabled).toBe(false);
  });
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

  it("omits media-session flags when the resolved mpv build does not support them", () => {
    // Community macOS builds (for example the Intel Sonoma build) reject
    // unknown options and exit before creating the IPC socket. The engine
    // probes --list-options and must only pass what exists.
    const args = buildMpvArguments("\\\\.\\pipe\\aria-options-test", false, new Set(["audio-client-name"]));

    expect(args).toContain("--audio-client-name=Aria");
    expect(args).toContain("--input-media-keys=no");
    expect(args).not.toContain("--media-controls=no");
    expect(args).not.toContain("--audio-set-media-role=yes");
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

  it("publishes the latest seek when command acknowledgements arrive out of order", async () => {
    const events = [];
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: (event) => events.push(event) });
    engine.ensureProcess = vi.fn().mockResolvedValue(undefined);
    engine.state.active = true;
    engine.state.trackId = "one";
    const acknowledgements = [];
    engine.command = () => new Promise((resolve) => acknowledgements.push(resolve));
    const first = engine.seek(25);
    await Promise.resolve();
    const latest = engine.seek(90);
    await Promise.resolve();
    engine.handleMessage({ event: "property-change", name: "time-pos", data: 4 });
    acknowledgements[1]();
    expect(await latest).toMatchObject({ kind: "seek", position: 90 });
    acknowledgements[0]();
    expect((await first).kind).toBe("superseded");
    expect(events.filter((event) => event.kind === "seek").map((event) => event.position)).toEqual([90]);
    engine.handleMessage({ event: "property-change", name: "time-pos", data: null });
    expect(engine.state.position).toBe(90);
    engine.handleMessage({ event: "property-change", name: "time-pos", data: 90.5 });
    expect(events.at(-1)).toMatchObject({ kind: "progress", position: 90.5 });
  });

  it("does not apply a seek acknowledgement to a replacement track", async () => {
    const events = [];
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: (event) => events.push(event) });
    engine.ensureProcess = vi.fn().mockResolvedValue(undefined);
    let finish;
    engine.command = () => new Promise((resolve) => { finish = resolve; });
    const seeking = engine.seek(40);
    await Promise.resolve();
    engine.loadToken += 1;
    engine.state.trackId = "replacement";
    engine.state.position = 0;
    finish();
    expect((await seeking).kind).toBe("superseded");
    expect(engine.state.position).toBe(0);
    expect(events.filter((event) => event.kind === "seek")).toHaveLength(0);
  });

  it("ignores stale outgoing time-pos ticks while loading a replacement track and starts at 0 on file-loaded", () => {
    const events = [];
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: (event) => events.push(event) });
    engine.setPaused = vi.fn().mockResolvedValue(undefined);
    engine.state.active = false;
    engine.state.trackId = "youtube:dQw4w9WgXcQ";
    engine.state.position = 0;

    engine.handleMessage({ event: "property-change", name: "time-pos", data: 52.4 });
    engine.handleMessage({ event: "property-change", name: "duration", data: 240 });
    expect(engine.state.position).toBe(0);
    expect(engine.state.duration).toBe(0);
    expect(events.filter((event) => event.kind === "progress" && event.position > 0)).toHaveLength(0);

    engine.handleMessage({ event: "file-loaded" });
    expect(events.at(-1)).toMatchObject({ kind: "loaded", active: true, trackId: "youtube:dQw4w9WgXcQ", position: 0 });
  });

  it("clamps micro-speed updates, deduplicates unchanged rates, and resets speed on performLoad", async () => {
    const engine = new MpvAudioEngine({ app: { isPackaged: false }, writeLog: vi.fn(), sendEvent: vi.fn() });
    engine.ensureProcess = vi.fn().mockResolvedValue(undefined);
    engine.command = vi.fn().mockResolvedValue([]);

    // Inactive engine updates target state without sending IPC.
    await engine.setSpeed(1.02);
    expect(engine.state.speed).toBe(1.02);
    expect(engine.command).not.toHaveBeenCalled();

    // Active engine sends clamped IPC set_property speed and ignores sub-0.001 deltas.
    engine.state.active = true;
    engine.process = { killed: false };
    engine.socket = { destroyed: false };
    await engine.setSpeed(3.5);
    expect(engine.state.speed).toBe(2);
    expect(engine.command).toHaveBeenCalledWith("set_property", "speed", 2);

    engine.command.mockClear();
    await engine.setSpeed(2.0002);
    expect(engine.command).not.toHaveBeenCalled();

    await engine.setSpeed(0.1);
    expect(engine.state.speed).toBe(0.5);
    expect(engine.command).toHaveBeenCalledWith("set_property", "speed", 0.5);

    engine.applyOutputSettings = vi.fn().mockResolvedValue(undefined);
    await engine.performLoad(
      {
        trackId: "trk-reset",
        url: "https://cdn.example/song.flac",
        position: 0,
        paused: false,
        volume: 1,
      },
      engine.loadToken,
    );
    expect(engine.state.speed).toBe(1);
    expect(engine.command).toHaveBeenCalledWith("set_property", "speed", 1);
  });

  it("uses CoreAudio arguments and short Unix IPC socket paths on macOS", () => {
    const darwinSock = buildIpcPipePath("darwin", 4321, 1730000000000);
    expect(darwinSock).toMatch(/^\/tmp\/aria-mpv-4321-[a-z0-9]+\.sock$/);
    expect(darwinSock.length).toBeLessThan(104);

    const darwinArgsDefault = buildMpvArguments(darwinSock, false, new Set(["audio-client-name"]), "darwin");
    expect(darwinArgsDefault).toContain("--ao=coreaudio");
    expect(darwinArgsDefault).not.toContain("--audio-exclusive=yes");
    expect(darwinArgsDefault).not.toContain("--audio-exclusive=no");

    const darwinArgsExclusive = buildMpvArguments(
      darwinSock,
      true,
      new Set(["audio-client-name", "audio-exclusive", "media-controls"]),
      "darwin",
    );
    expect(darwinArgsExclusive).toContain("--ao=coreaudio");
    expect(darwinArgsExclusive).toContain("--audio-exclusive=yes");
    expect(darwinArgsExclusive).toContain("--media-controls=no");
  });
});
