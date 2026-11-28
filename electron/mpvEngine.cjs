const { execFile, execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { CdAudioRipper } = require("./cdAudioRipper.cjs");
const { inspectMachO } = require("./macBinary.cjs");

// OOPZ's Windows application-loopback API selects a process by executable
// name (for example, `Aria.exe`).  The branded filename lets the native
// decoder stay in WASAPI while remaining part of the app selected for share.
const NATIVE_AUDIO_CLIENT_NAME = "Aria";
const DEFAULT_PLATFORM = process.platform;
const IS_WINDOWS = DEFAULT_PLATFORM === "win32";
const IS_MAC = DEFAULT_PLATFORM === "darwin";
// Windows uses the branded .exe so application loopback can select Aria; the
// other platforms ship (or expect) an `mpv` binary next to it.
const NATIVE_AUDIO_PROCESS_NAME = IS_WINDOWS ? `${NATIVE_AUDIO_CLIENT_NAME}.exe` : "mpv";
const NATIVE_AUDIO_EXECUTABLE = IS_WINDOWS ? "mpv.exe" : "mpv";
const NATIVE_AUDIO_OUTPUT = IS_MAC ? "coreaudio" : IS_WINDOWS ? "wasapi" : "pipewire,pulse,alsa";
const EQUALIZER_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function sanitizeEqualizerBands(value) {
  const source = Array.isArray(value) ? value : [];
  return EQUALIZER_FREQUENCIES.map((_, index) => {
    const gain = Number(source[index]);
    if (!Number.isFinite(gain)) return 0;
    return Math.max(-12, Math.min(12, Math.round(gain * 10) / 10));
  });
}

function sanitizeEqualizerChain(chain, fallbackBands) {
  if (chain && typeof chain === "object" && Array.isArray(chain.filters)) {
    const rawPreamp = Number(chain.preampDb);
    const preampDb = Number.isFinite(rawPreamp) ? Math.max(-18, Math.min(6, Math.round(rawPreamp * 10) / 10)) : 0;
    const filters = [];
    for (const item of chain.filters) {
      if (!item || typeof item !== "object") continue;
      const type = item.type === "lowshelf" || item.type === "highshelf" || item.type === "peaking" ? item.type : "peaking";
      const rawFreq = Number(item.freq);
      const rawGain = Number(item.gain);
      const rawQ = Number(item.q);
      const freq = Number.isFinite(rawFreq) ? Math.max(20, Math.min(20000, Math.round(rawFreq))) : 1000;
      const gain = Number.isFinite(rawGain) ? Math.max(-12, Math.min(12, Math.round(rawGain * 10) / 10)) : 0;
      const q = Number.isFinite(rawQ) ? Math.max(0.2, Math.min(16, Math.round(rawQ * 100) / 100)) : 1.1;
      if (Math.abs(gain) > 0.04) {
        filters.push({ type, freq, gain, q });
      }
      if (filters.length >= 32) break;
    }
    return { preampDb, filters };
  }
  const bands = sanitizeEqualizerBands(fallbackBands);
  return {
    preampDb: 0,
    filters: bands
      .map((gain, index) => ({ type: "peaking", freq: EQUALIZER_FREQUENCIES[index], gain, q: 1.1 }))
      .filter((item) => Math.abs(item.gain) > 0.04),
  };
}

function buildEqualizerFilter(bands) {
  return bands
    .map((gain, index) => `equalizer=f=${EQUALIZER_FREQUENCIES[index]}:width_type=q:width=1.1:g=${gain}`)
    .join(",");
}

function buildEqualizerFilterFromChain(chain) {
  const parts = [];
  if (Math.abs(chain.preampDb) > 0.05) {
    parts.push(`volume=${chain.preampDb.toFixed(2)}dB`);
  }
  for (const filter of chain.filters) {
    if (filter.type === "lowshelf") {
      parts.push(`lowshelf=f=${filter.freq}:width_type=q:width=${filter.q}:g=${filter.gain}`);
    } else if (filter.type === "highshelf") {
      parts.push(`highshelf=f=${filter.freq}:width_type=q:width=${filter.q}:g=${filter.gain}`);
    } else {
      parts.push(`equalizer=f=${filter.freq}:width_type=q:width=${filter.q}:g=${filter.gain}`);
    }
  }
  return parts.join(",");
}

function buildChannelMixFilter(balance, mono) {
  const clampedBalance = Number.isFinite(Number(balance)) ? Math.max(-1, Math.min(1, Number(balance))) : 0;
  const leftGain = clampedBalance > 0 ? Math.max(0, 1 - clampedBalance) : 1;
  const rightGain = clampedBalance < 0 ? Math.max(0, 1 + clampedBalance) : 1;
  if (mono) {
    const l = (0.5 * leftGain).toFixed(3);
    const r = (0.5 * rightGain).toFixed(3);
    return `pan=stereo|c0=${l}*c0+${l}*c1|c1=${r}*c0+${r}*c1`;
  }
  if (Math.abs(clampedBalance) > 0.01) {
    return `pan=stereo|c0=${leftGain.toFixed(3)}*c0|c1=${rightGain.toFixed(3)}*c1`;
  }
  return null;
}

function buildIpcPipePath(platform = DEFAULT_PLATFORM, pid = process.pid, now = Date.now()) {
  if (platform === "win32") {
    return `\\\\.\\pipe\\aria-mpv-${pid}-${now}`;
  }
  const suffix = `aria-mpv-${pid}-${Number(now).toString(36)}.sock`;
  if (platform === "darwin") {
    const tmpRoot =
      process.platform !== "darwin"
        ? "/tmp"
        : (() => {
            try {
              fs.accessSync("/tmp", fs.constants.W_OK);
              return "/tmp";
            } catch {
              return require("node:os").tmpdir();
            }
          })();
    return `${tmpRoot.replace(/\/+$/, "")}/${suffix}`;
  }
  return path.join(require("node:os").tmpdir(), suffix);
}

function buildMpvArguments(pipePath, exclusive = false, supportedOptions = null, platform = DEFAULT_PLATFORM) {
  // macOS bundled mpv builds (and older community builds) do not expose every
  // option the Windows decoder has. Only pass the optional media-session flags
  // when the resolved binary actually lists them; an unknown option makes mpv
  // exit before the IPC socket is created, which previously looked like
  // "mpv is not usable on macOS".
  const isWin = platform === "win32";
  const isMac = platform === "darwin";
  const ao = isMac ? "coreaudio" : isWin ? "wasapi" : "pipewire,pulse,alsa";
  const hasOption = (name) => !(supportedOptions instanceof Set) || supportedOptions.has(name);
  return [
    "--idle=yes",
    `--ao=${ao}`,
    "--no-video",
    "--force-window=no",
    "--keep-open=no",
    "--no-terminal",
    // Aria publishes metadata and queue controls through its own native
    // session. mpv's built-in session knows only its private preload playlist.
    ...(hasOption("media-controls") ? ["--media-controls=no"] : []),
    "--input-media-keys=no",
    // Keep the native audio session stable for application-loopback tools.
    ...(hasOption("audio-client-name") ? [`--audio-client-name=${NATIVE_AUDIO_CLIENT_NAME}`] : []),
    ...(hasOption("audio-set-media-role") ? ["--audio-set-media-role=yes"] : []),
    `--title=${NATIVE_AUDIO_CLIENT_NAME}`,
    `--force-media-title=${NATIVE_AUDIO_CLIENT_NAME}`,
    ...(isWin || (isMac && hasOption("audio-exclusive"))
      ? [`--audio-exclusive=${exclusive ? "yes" : "no"}`]
      : []),
    "--msg-level=all=warn",
    "--no-config",
    "--cache=yes",
    "--cache-pause=yes",
    "--cache-pause-initial=no",
    "--cache-pause-wait=0.8",
    // Keep enough readahead headroom so P2P/HTTP audio jitter never causes choppy dropouts.
    "--demuxer-readahead-secs=20",
    "--demuxer-max-bytes=24MiB",
    "--demuxer-max-back-bytes=8MiB",
    "--stream-buffer-size=512KiB",
    // Keep the decoder/AO chain warm across playlist entries so appended
    // tracks start without reopening the audio device.
    "--gapless-audio=yes",
    "--audio-buffer=0.2",
    `--input-ipc-server=${pipePath}`,
  ];
}

// `mpv --list-options` is cheap and cached per executable. It also tells us
// whether the binary is runnable at all (Gatekeeper/quarantine, wrong arch).
const mpvOptionsCache = new Map();

function readSupportedMpvOptions(executable) {
  if (mpvOptionsCache.has(executable)) return mpvOptionsCache.get(executable);
  let options = null;
  try {
    const output = execFileSync(
      executable,
      ["--list-options", "--no-config"],
      { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const names = new Set();
    for (const line of String(output).split(/\r?\n/)) {
      const match = line.match(/^\s+--([a-z0-9-]+)/);
      if (match) names.add(match[1]);
    }
    if (names.size) options = names;
  } catch {
    options = null;
  }
  mpvOptionsCache.set(executable, options);
  return options;
}

const MAC_MPV_CANDIDATES = [
  "/opt/homebrew/bin/mpv",
  "/usr/local/bin/mpv",
  "/opt/local/bin/mpv",
  "/Applications/mpv.app/Contents/MacOS/mpv",
];

let cachedSystemMpv = null;

/** First runnable mpv on this Mac (bundled vendor copy is checked separately). */
function findSystemMpvExecutable() {
  if (cachedSystemMpv !== null) return cachedSystemMpv || null;
  const candidates = [...MAC_MPV_CANDIDATES];
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    if (!candidates.includes(path.join(directory, "mpv"))) candidates.push(path.join(directory, "mpv"));
  }
  cachedSystemMpv = candidates.find((candidate) => {
    try {
      const stats = fs.statSync(candidate);
      if (!stats.isFile()) return false;
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || "";
  return cachedSystemMpv || null;
}

const macBinaryArchCache = new Map();

/** True when a Mach-O decoder contains a slice for the running Electron CPU. */
function macBinaryMatchesHost(filePath) {
  if (!IS_MAC) return true;
  try {
    const stats = fs.statSync(filePath);
    const key = `${filePath}:${stats.size}:${stats.mtimeMs}`;
    if (!macBinaryArchCache.has(key)) {
      const info = inspectMachO(filePath);
      const hostArch = process.arch === "arm64" ? "arm64" : "x64";
      macBinaryArchCache.set(key, Boolean(info?.archs.includes(hostArch)));
    }
    return macBinaryArchCache.get(key);
  } catch {
    return false;
  }
}

class MpvAudioEngine {
  constructor({ app, writeLog, sendEvent }) {
    this.app = app;
    this.writeLog = writeLog;
    this.sendEvent = sendEvent;
    this.process = null;
    this.socket = null;
    this.pipePath = null;
    this.buffer = "";
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.ensurePromise = null;
    this.launchExclusive = null;
    this.loadToken = 0;
    this.pendingSeek = 0;
    this.pendingPause = true;
    this.pauseToken = 0;
    this.seekToken = 0;
    this.volumeToken = 0;
    this.normalizationQueue = Promise.resolve();
    this.lastRecoveryAt = 0;
    // When the renderer preloads the next track, mpv advances its internal
    // playlist on EOF. The pending entry's identity and a generation counter
    // (so the renderer can re-arm after each seamless advance) live here.
    this.pendingAutoAdvance = null;
    this.windowVisible = true;
    this.lastEmittedPosition = -1;
    this.lastProgressEmitAt = 0;
    this.cachedExecutable = null;
    this.cachedSupported = null;
    this.cachedSupportCheckedAt = 0;
    this.cdRipper = new CdAudioRipper({ app, writeLog });
    this.state = {
      supported: this.isSupported(),
      ready: false,
      active: false,
      trackId: null,
      url: null,
      position: 0,
      duration: 0,
      paused: true,
      volume: 72,
      speed: 1,
      exclusive: false,
      exclusiveFallback: false,
      deviceId: "auto",
      bitrate: null,
      gaplessGeneration: 0,
      normalizationEnabled: false,
      equalizerEnabled: false,
      equalizerBands: EQUALIZER_FREQUENCIES.map(() => 0),
      equalizerChain: { preampDb: 0, filters: [] },
      channelBalance: 0,
      monoAudio: false,
    };
  }

  setWindowVisible(visible) {
    const nextVisible = Boolean(visible);
    if (this.windowVisible === nextVisible) return;
    this.windowVisible = nextVisible;
    if (nextVisible && this.state.active) {
      this.lastProgressEmitAt = Date.now();
      this.lastEmittedPosition = this.state.position;
      this.emit({ kind: "progress" });
    }
  }

  isSupported() {
    const now = Date.now();
    if (typeof this.cachedSupported === "boolean" && now - this.cachedSupportCheckedAt < 30000) {
      return this.cachedSupported;
    }
    const executable = this.resolveExecutable();
    let supported = fs.existsSync(executable);
    // A packaged app can accidentally carry the other architecture's decoder.
    // Check the Mach-O slices so the renderer falls back to Web Audio instead
    // of offering native output that can never start.
    if (supported && IS_MAC && !macBinaryMatchesHost(executable)) {
      supported = false;
    }
    this.cachedSupported = supported;
    this.cachedSupportCheckedAt = now;
    return supported;
  }

  resolveExecutable() {
    const now = Date.now();
    if (this.cachedExecutable && now - this.cachedSupportCheckedAt < 30000) {
      return this.cachedExecutable;
    }
    const mpvDirectory = this.app.isPackaged
      ? path.join(process.resourcesPath, "app.asar.unpacked", "vendor", "mpv")
      : path.join(__dirname, "..", "vendor", "mpv");
    const brandedExecutable = path.join(mpvDirectory, NATIVE_AUDIO_PROCESS_NAME);
    if (fs.existsSync(brandedExecutable)) {
      this.cachedExecutable = brandedExecutable;
      return brandedExecutable;
    }

    const vendored = path.join(mpvDirectory, NATIVE_AUDIO_EXECUTABLE);
    // macOS has no official mpv release to bundle, so a packaged build often
    // ships without vendor/mpv. Reuse the user's own install (Homebrew, MacPorts,
    // or the official .app) instead of forcing a rebuild — installing mpv and
    // restarting Aria is then enough to leave the browser audio engine.
    if (IS_MAC && !fs.existsSync(vendored)) {
      const systemMpv = findSystemMpvExecutable();
      if (systemMpv) {
        this.cachedExecutable = systemMpv;
        return systemMpv;
      }
    }

    this.cachedExecutable = vendored;
    return vendored;
  }

  snapshot(extra = {}) {
    return {
      ...this.state,
      supported: this.isSupported(),
      ...extra,
    };
  }

  emit(extra = {}) {
    this.sendEvent(this.snapshot(extra));
  }

  async listDevices() {
    if (!this.isSupported()) return [{ id: "default", label: "System Default" }];

    const output = await new Promise((resolve, reject) => {
      execFile(
        this.resolveExecutable(),
        ["--audio-device=help", `--ao=${NATIVE_AUDIO_OUTPUT}`, "--no-config", "--msg-level=ao=info"],
        { windowsHide: true },
        (error, stdout = "", stderr = "") => {
          if (error && !stdout && !stderr) {
            reject(error);
            return;
          }
          resolve(`${stdout}\n${stderr}`);
        },
      );
    });

    const devices = [{ id: "default", label: "System Default" }];
    for (const line of String(output).split(/\r?\n/)) {
      const match = line.match(/'([^']+)' \((.+)\)/);
      if (!match) continue;
      const [, id, label] = match;
      devices.push({ id, label });
    }
    return devices;
  }

  async ensureProcess(exclusive = this.launchExclusive ?? false) {
    if (!this.isSupported()) {
      throw new Error("Native audio engine is not available.");
    }
    const requestedExclusive = Boolean(exclusive);
    if (this.process && this.socket && !this.socket.destroyed && this.launchExclusive === requestedExclusive) return;
    if (this.ensurePromise) {
      await this.ensurePromise;
      if (this.process && this.socket && !this.socket.destroyed && this.launchExclusive === requestedExclusive) return;
    }

    this.ensurePromise = (async () => {
      await this.teardown();

      this.pipePath = buildIpcPipePath(process.platform);
      this.buffer = "";
      this.launchExclusive = requestedExclusive;

      const executable = this.resolveExecutable();
      // Windows ships a known mpv build; macOS/Linux may point at a system or
      // community binary, so ask it which optional flags exist before spawning.
      const supportedOptions = IS_WINDOWS
        ? null
        : (readSupportedMpvOptions(executable) ?? new Set());

      this.process = spawn(
        executable,
        buildMpvArguments(this.pipePath, requestedExclusive, supportedOptions),
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      this.process.stdout?.on("data", (chunk) => this.writeLog("native-audio.log", String(chunk).trimEnd()));
      this.process.stderr?.on("data", (chunk) => this.writeLog("native-audio.log", `ERR ${String(chunk).trimEnd()}`));
      const child = this.process;
      child.once("exit", (code, signal) => {
        this.writeLog("native-audio.log", `mpv exited: code=${code} signal=${signal}`);
        // A mode/device switch may already have spawned the replacement.
        if (this.process !== child) return;
        this.process = null;
        this.socket = null;
        this.launchExclusive = null;
        this.state.ready = false;
        this.state.active = false;
        this.rejectPending(new Error("mpv process exited"));
        this.emit({ kind: "stopped" });
      });

      await this.connectPipe();
      await this.observeProperties();
    })();

    try {
      await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  async connectPipe() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(this.pipePath, () => {
            this.socket = socket;
            socket.setEncoding("utf8");
            socket.on("data", (chunk) => this.handleChunk(chunk));
            socket.on("error", (error) => {
              this.writeLog("native-audio.log", `socket error: ${error.stack || error}`);
            });
            socket.on("close", () => {
              if (this.socket !== socket) return;
              this.socket = null;
              this.state.ready = false;
              this.rejectPending(new Error("Native audio socket closed."));
            });
            resolve();
          });
          socket.once("error", reject);
        });
        this.state.ready = true;
        this.emit({ kind: "ready" });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    throw new Error("Timed out while connecting to the native audio engine.");
  }

  async observeProperties() {
    await this.command("observe_property", 1, "time-pos");
    await this.command("observe_property", 2, "duration");
    await this.command("observe_property", 3, "pause");
    await this.command("observe_property", 5, "audio-exclusive");
    await this.command("observe_property", 6, "audio-device");
  }

  handleChunk(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        this.writeLog("native-audio.log", `ipc parse error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  handleMessage(message) {
    if (typeof message.request_id === "number" && this.pendingRequests.has(message.request_id)) {
      const { resolve, reject } = this.pendingRequests.get(message.request_id);
      this.pendingRequests.delete(message.request_id);
      if (message.error && message.error !== "success") {
        reject(new Error(message.error));
      } else {
        resolve(message.data);
      }
      return;
    }

    if (message.event === "property-change") {
      // mpv temporarily reports an unavailable time-pos while it flushes a
      // seek. Keep the last playhead until a real timestamp arrives.
      if (message.name === "time-pos") {
        if (!this.state.active) return;
        if (typeof message.data !== "number" || !Number.isFinite(message.data)) return;
        const nextPosition = Math.max(0, message.data);
        this.state.position = nextPosition;
        const now = Date.now();
        const minIntervalMs = this.windowVisible === false ? 1500 : 150;
        const minDeltaSec = this.windowVisible === false ? 0.24 : 0.14;
        if (
          Math.abs(nextPosition - this.lastEmittedPosition) < minDeltaSec &&
          now - this.lastProgressEmitAt < minIntervalMs
        ) {
          return;
        }
        this.lastEmittedPosition = nextPosition;
        this.lastProgressEmitAt = now;
        this.emit({ kind: "progress" });
        return;
      }
      if (message.name === "audio-bitrate") {
        this.state.bitrate = Number(message.data) || null;
        return;
      }
      if (message.name === "duration") {
        if (!this.state.active) return;
        this.state.duration = Number(message.data) || 0;
      }
      if (message.name === "pause") this.state.paused = Boolean(message.data);
      if (message.name === "audio-exclusive") this.state.exclusive = Boolean(message.data);
      if (message.name === "audio-device" && typeof message.data === "string") this.state.deviceId = message.data;
      this.emit({ kind: "progress" });
      return;
    }

    if (message.event === "file-loaded") {
      const advanced = this.pendingAutoAdvance;
      this.pendingAutoAdvance = null;
      this.state.active = true;
      this.state.ready = true;
      if (advanced) {
        // Seamless playlist advance: mpv started the preloaded entry on its
        // own, so keep the current pause state and just adopt its identity.
        this.state.trackId = advanced.trackId;
        this.state.url = advanced.url;
        this.state.position = 0;
        this.lastEmittedPosition = 0;
        this.lastProgressEmitAt = 0;
        this.state.duration = 0;
        this.state.bitrate = null;
        this.state.gaplessGeneration += 1;
        this.writeLog("native-audio.log", `gapless advance: ${advanced.trackId}`);
        this.emit({ kind: "advanced", gaplessGeneration: this.state.gaplessGeneration });
        return;
      }
      const pendingSeek = this.pendingSeek;
      const loadToken = this.loadToken;
      this.pendingSeek = 0;
      this.state.position = pendingSeek;
      this.lastEmittedPosition = pendingSeek;
      this.lastProgressEmitAt = 0;
      Promise.resolve()
        .then(async () => {
          if (!this.isCurrentLoad(loadToken)) return;
          if (pendingSeek > 0) {
            await this.command("seek", pendingSeek, "absolute+exact");
          }
          if (this.isCurrentLoad(loadToken)) await this.setPaused(this.pendingPause);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          if (!/being restarted/i.test(message)) {
            this.writeLog("native-audio.log", `post-load sync failed: ${message}`);
          }
        });
      this.emit({ kind: "loaded" });
      return;
    }

    if (message.event === "end-file") {
      const advanced = this.pendingAutoAdvance;
      if (message.reason === "eof" && advanced) {
        // mpv moves to the appended entry itself; suppress the renderer's
        // own advance so the track does not skip.
        this.state.position = 0;
        this.lastEmittedPosition = 0;
        this.lastProgressEmitAt = 0;
        this.state.duration = 0;
        this.emit({ kind: "progress" });
        return;
      }
      this.pendingAutoAdvance = null;
      this.state.active = false;
      this.state.position = this.state.duration || this.state.position;
      this.lastEmittedPosition = this.state.position;
      this.lastProgressEmitAt = 0;
      this.state.paused = true;
      if (message.reason !== "eof" && advanced) {
        // The preloaded entry failed to load; fall back to the renderer's
        // normal advance path instead of stalling.
        this.emit({ kind: "ended" });
        return;
      }
      this.emit({ kind: message.reason === "eof" ? "ended" : "stopped" });
    }
  }

  command(...args) {
    return this.send({ command: args });
  }

  send(payload) {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error("Native audio socket is not connected."));
    }

    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Native audio command timed out: ${JSON.stringify(payload.command ?? payload)}`));
      }, 8000);
      timeout.unref?.();
      this.pendingRequests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.socket.write(`${JSON.stringify({ ...payload, request_id: requestId })}\n`);
      } catch (error) {
        const pending = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        pending?.reject(error);
      }
    });
  }

  rejectPending(error) {
    for (const { reject } of this.pendingRequests.values()) {
      reject(error);
    }
    this.pendingRequests.clear();
  }

  normalizeDeviceId(deviceId) {
    if (!deviceId || deviceId === "default") return "auto";
    return deviceId;
  }

  async applyOutputSettings({
    exclusive,
    deviceId,
    volume,
    normalizationEnabled = this.state.normalizationEnabled,
    equalizerEnabled,
    equalizerBands,
    equalizerChain,
    channelBalance,
    monoAudio,
  }) {
    const requestedExclusive = typeof exclusive === "boolean" ? exclusive : this.launchExclusive ?? false;
    await this.ensureProcess(requestedExclusive);
    if (typeof normalizationEnabled === "boolean") {
      await this.setNormalization(normalizationEnabled);
    }
    if (typeof equalizerEnabled === "boolean" || Array.isArray(equalizerBands) || equalizerChain) {
      await this.setEqualizer(
        typeof equalizerEnabled === "boolean" ? equalizerEnabled : this.state.equalizerEnabled,
        Array.isArray(equalizerBands) ? equalizerBands : this.state.equalizerBands,
        equalizerChain ?? this.state.equalizerChain,
      );
    }
    if (typeof channelBalance === "number" || typeof monoAudio === "boolean") {
      await this.setChannelMix(
        typeof channelBalance === "number" ? channelBalance : this.state.channelBalance,
        typeof monoAudio === "boolean" ? monoAudio : this.state.monoAudio,
      );
    }
    if (typeof volume === "number" && Number.isFinite(volume)) {
      this.state.volume = Math.max(0, Math.min(100, volume));
      await this.command("set_property", "volume", this.state.volume);
    }
    if (typeof exclusive === "boolean") {
      const supportedOptions = IS_WINDOWS ? null : readSupportedMpvOptions(this.resolveExecutable());
      const canToggleExclusive = !(supportedOptions instanceof Set) || supportedOptions.has("audio-exclusive");
      if (!canToggleExclusive) {
        this.state.exclusive = false;
        if (exclusive) {
          this.state.exclusiveFallback = true;
          const reason = IS_MAC
            ? "当前 mpv 构建不支持 CoreAudio 独占模式，已自动回退至共享模式。"
            : "当前音频后端不支持独占模式，已自动回退至共享模式。";
          this.writeLog("native-audio.log", `exclusive fallback: ${reason}`);
          this.emit({ kind: "exclusive-fallback", reason });
        } else {
          this.state.exclusiveFallback = false;
        }
      } else {
        let toggleFailed = false;
        await this.command("set_property", "audio-exclusive", exclusive).catch(() => {
          if (exclusive) toggleFailed = true;
        });
        this.state.exclusive =
          exclusive && !toggleFailed
            ? Boolean(await this.command("get_property", "audio-exclusive").catch(() => false))
            : false;
        if (exclusive && !this.state.exclusive) {
          await this.command("set_property", "audio-exclusive", false).catch(() => undefined);
          this.state.exclusiveFallback = true;
          const reason = IS_MAC
            ? "CoreAudio 独占模式被输出设备拒绝或占用，已自动回退至共享模式。"
            : "WASAPI 独占模式被其他程序占用或被输出设备拒绝，已自动回退至共享模式。";
          this.writeLog("native-audio.log", `exclusive fallback: ${reason}`);
          this.emit({ kind: "exclusive-fallback", reason });
        } else {
          this.state.exclusiveFallback = false;
        }
      }
    }
    if (typeof deviceId === "string") {
      this.state.deviceId = this.normalizeDeviceId(deviceId);
      await this.command("set_property", "audio-device", this.state.deviceId);
      const resolvedDevice = await this.command("get_property", "audio-device").catch(() => this.state.deviceId);
      if (typeof resolvedDevice === "string") {
        this.state.deviceId = resolvedDevice;
      }
    }
    this.writeLog("native-audio.log", `native output: ${this.state.exclusive ? "exclusive" : "shared"} device=${this.state.deviceId}`);
    this.emit({ kind: "settings" });
    return this.snapshot();
  }

  async load(options) {
    if (this.isCdLoad(options)) {
      const token = ++this.loadToken;
      return this.performCdLoad(options, token);
    }

    await this.ensureProcess(Boolean(options?.exclusive));
    const token = ++this.loadToken;
    return this.performLoad(options, token);
  }

  setNormalization(enabled) {
    const task = this.normalizationQueue.then(async () => {
      // Label only Aria's filter so toggling never removes other mpv filters.
      const filters = await this.command("get_property", "af");
      const list = Array.isArray(filters) ? filters : [];
      const eqIdx = list.findIndex((filter) => filter.label === "aria-eq");
      const normIdx = list.findIndex((filter) => filter.label === "aria-normalization");
      const installed = normIdx !== -1;
      if (enabled && !installed) {
        await this.command("af", "add", "@aria-normalization:lavfi=[dynaudnorm=f=100:g=5:p=0.95:m=4:r=0.12]");
      } else if (enabled && installed && eqIdx !== -1 && normIdx < eqIdx) {
        // Ensure EQ sits ahead of dynamic normalization so boosted bands hit the limiter cleanly.
        await this.command("af", "remove", "@aria-normalization");
        await this.command("af", "add", "@aria-normalization:lavfi=[dynaudnorm=f=100:g=5:p=0.95:m=4:r=0.12]");
      } else if (!enabled && installed) {
        await this.command("af", "remove", "@aria-normalization");
      }
      this.state.normalizationEnabled = Boolean(enabled);
    });
    this.normalizationQueue = task.catch(() => undefined);
    return task;
  }

  setEqualizer(enabled, bands, chain) {
    const nextBands = sanitizeEqualizerBands(bands);
    const nextChain = sanitizeEqualizerChain(chain, nextBands);
    const task = this.normalizationQueue.then(async () => {
      // Rebuild Aria's own labeled filter and keep @aria-eq before @aria-normalization.
      const filters = await this.command("get_property", "af");
      const list = Array.isArray(filters) ? filters : [];
      const installedEq = list.some((filter) => filter.label === "aria-eq");
      const installedNorm = list.some((filter) => filter.label === "aria-normalization");
      const filterGraph = buildEqualizerFilterFromChain(nextChain);
      const active = Boolean(enabled) && Boolean(filterGraph);
      if (installedEq) {
        await this.command("af", "remove", "@aria-eq");
      }
      if (active) {
        if (installedNorm) {
          await this.command("af", "remove", "@aria-normalization");
        }
        await this.command("af", "add", `@aria-eq:lavfi=[${filterGraph}]`);
        if (installedNorm) {
          await this.command("af", "add", "@aria-normalization:lavfi=[dynaudnorm=f=100:g=5:p=0.95:m=4:r=0.12]");
        }
      }
      this.state.equalizerEnabled = Boolean(enabled);
      this.state.equalizerBands = nextBands;
      this.state.equalizerChain = nextChain;
    });
    this.normalizationQueue = task.catch(() => undefined);
    return task;
  }

  setChannelMix(balance, mono) {
    const nextBalance = Number.isFinite(Number(balance)) ? Math.max(-1, Math.min(1, Number(balance))) : 0;
    const nextMono = Boolean(mono);
    const filterExpr = buildChannelMixFilter(nextBalance, nextMono);
    const task = this.normalizationQueue.then(async () => {
      const filters = await this.command("get_property", "af");
      const list = Array.isArray(filters) ? filters : [];
      const installedChannel = list.some((filter) => filter.label === "aria-channel");
      const installedNorm = list.some((filter) => filter.label === "aria-normalization");
      if (installedChannel) {
        await this.command("af", "remove", "@aria-channel");
      }
      if (filterExpr) {
        if (installedNorm) {
          await this.command("af", "remove", "@aria-normalization");
        }
        await this.command("af", "add", `@aria-channel:lavfi=[${filterExpr}]`);
        if (installedNorm) {
          await this.command("af", "add", "@aria-normalization:lavfi=[dynaudnorm=f=100:g=5:p=0.95:m=4:r=0.12]");
        }
      }
      this.state.channelBalance = nextBalance;
      this.state.monoAudio = nextMono;
    });
    this.normalizationQueue = task.catch(() => undefined);
    return task;
  }

  // Append the next track to mpv's internal playlist so the advance happens
  // inside mpv (gapless) instead of round-tripping through the renderer.
  async loadNext(options = {}) {
    if (!this.process || !this.socket || this.socket.destroyed) {
      return this.snapshot({ kind: "preload-skipped" });
    }
    if (!this.state.active || this.isCdLoad(options)) {
      return this.snapshot({ kind: "preload-skipped" });
    }
    const url = String(options.url ?? "");
    const trackId = typeof options.trackId === "string" ? options.trackId : null;
    if (!url || !trackId) return this.snapshot({ kind: "preload-skipped" });
    if (this.pendingAutoAdvance?.trackId === trackId) return this.snapshot();

    await this.command("loadfile", url, "append");
    this.pendingAutoAdvance = { trackId, url };
    this.writeLog("native-audio.log", `gapless preload: ${trackId}`);
    return this.snapshot();
  }

  isCurrentLoad(token) {
    return token === this.loadToken;
  }

  isCdLoad(options = {}) {
    const url = String(options?.url ?? "");
    return Boolean(
      options?.nativeDevice ||
        options?.startChapter ||
        /^cdda:\/\//i.test(url) ||
        /\.cda(?:$|[?#])/i.test(url),
    );
  }

  parseCdTrackNumber(value) {
    const match = String(value ?? "").match(/#?(\d+)/);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  normalizeCdDevice(device) {
    const text = String(device ?? "").trim();
    if (!text) return "";
    if (/^[a-z]:$/i.test(text)) return `${text}\\`;
    return text.endsWith("\\") ? text : `${text}\\`;
  }

  resolveCdTrackPath({ url, nativeDevice, startChapter }) {
    const rawUrl = String(url ?? "");
    if (/\.cda(?:$|[?#])/i.test(rawUrl)) return rawUrl;

    const device = this.normalizeCdDevice(nativeDevice);
    const trackNumber = this.parseCdTrackNumber(startChapter) ?? 1;
    if (!device) {
      throw new Error("Audio CD device is missing.");
    }
    return path.join(device, `Track${String(trackNumber).padStart(2, "0")}.cda`);
  }

  async performCdLoad(
    {
      trackId,
      url,
      position = 0,
      paused = true,
      volume = 72,
      exclusive = false,
      deviceId = "default",
      nativeDevice = null,
      startChapter = null,
      endChapter = null,
      cdReadQuality = "high",
      normalizationEnabled = false,
      equalizerEnabled = this.state.equalizerEnabled,
      equalizerBands = this.state.equalizerBands,
      equalizerChain = this.state.equalizerChain,
      channelBalance = this.state.channelBalance,
      monoAudio = this.state.monoAudio,
    },
    token,
  ) {
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    this.pendingAutoAdvance = null;
    const cdPath = this.resolveCdTrackPath({ url, nativeDevice, startChapter });
    const trackNumber = this.parseCdTrackNumber(startChapter) ?? this.parseCdTrackNumber(path.basename(cdPath)) ?? 1;
    const cdDevice = nativeDevice || path.parse(cdPath).root;

    this.pendingSeek = Math.max(0, Number(position) || 0);
    this.pendingPause = Boolean(paused);
    this.state.trackId = trackId;
    this.state.url = cdPath;
    this.state.position = this.pendingSeek;
    this.state.duration = 0;
    this.state.active = false;
    this.state.paused = this.pendingPause;
    this.state.volume = Math.max(0, Math.min(100, Number(volume) || 0));
    this.state.exclusive = Boolean(exclusive);
    this.state.bitrate = cdReadQuality === "low" ? 705_600 : 1_411_200;
    this.emit({ kind: "cd-ripping" });

    if (this.process && this.socket && !this.socket.destroyed) {
      await this.command("stop").catch(() => undefined);
    }

    const ripped = await this.cdRipper.ripTrack({ device: cdDevice, trackNumber, qualityMode: cdReadQuality });
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    return this.performLoad(
      {
        trackId,
        url: ripped.path,
        position,
        paused,
        volume,
        exclusive,
        deviceId,
        normalizationEnabled,
        equalizerEnabled,
        equalizerBands,
        equalizerChain,
        channelBalance,
        monoAudio,
        nativeDevice: null,
        startChapter: null,
        endChapter: null,
      },
      token,
    );
  }

  async performLoad(
    {
      trackId,
      url,
      position = 0,
      paused = true,
      volume = 72,
      exclusive = false,
      deviceId = "default",
      nativeDevice = null,
      startChapter = null,
      endChapter = null,
      normalizationEnabled = this.state.normalizationEnabled,
      equalizerEnabled = this.state.equalizerEnabled,
      equalizerBands = this.state.equalizerBands,
      equalizerChain = this.state.equalizerChain,
      channelBalance = this.state.channelBalance,
      monoAudio = this.state.monoAudio,
    },
    token,
  ) {
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    this.pendingAutoAdvance = null;
    this.pendingSeek = Math.max(0, Number(position) || 0);
    this.pendingPause = Boolean(paused);
    this.state.trackId = trackId;
    this.state.url = url;
    this.state.position = this.pendingSeek;
    this.lastEmittedPosition = this.pendingSeek;
    this.lastProgressEmitAt = 0;
    this.state.duration = 0;
    this.state.active = false;
    this.state.paused = this.pendingPause;
    this.state.speed = 1;
    this.state.bitrate = null;
    this.emit({ kind: "switching" });

    await this.command("set_property", "pause", true).catch(() => undefined);
    await this.command("set_property", "speed", 1).catch(() => undefined);
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    await this.applyOutputSettings({
      exclusive,
      deviceId,
      volume,
      normalizationEnabled,
      equalizerEnabled,
      equalizerBands,
      equalizerChain,
      channelBalance,
      monoAudio,
    });
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    if (String(url).startsWith("cdda://")) {
      const loadOptions = {};
      if (nativeDevice) loadOptions["cdda-device"] = nativeDevice;
      if (startChapter) loadOptions.start = startChapter;
      if (endChapter) loadOptions.end = endChapter;
      await this.command("loadfile", url, "replace", -1, loadOptions);
    } else {
      await this.command("loadfile", url, "replace");
    }
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    this.emit({ kind: "loading" });
    return this.snapshot();
  }

  async setPaused(paused, options = {}) {
    const token = ++this.pauseToken;
    const desiredPaused = Boolean(paused);
    const fadeMs = Number(options?.fadeMs) || 0;
    this.pendingPause = desiredPaused;
    await this.ensureProcess(this.launchExclusive ?? false);
    if (token !== this.pauseToken) return this.snapshot({ kind: "superseded" });
    const child = this.process;
    const canFade =
      fadeMs > 0 &&
      !this.state.exclusive &&
      this.state.active &&
      this.process &&
      this.socket &&
      !this.socket.destroyed;
    if (canFade && desiredPaused && !this.state.paused) {
      const targetVol = this.state.volume;
      const steps = 4;
      const stepDelay = Math.max(15, Math.round(fadeMs / steps));
      for (let i = steps - 1; i >= 0; i -= 1) {
        if (token !== this.pauseToken || this.process !== child) return this.snapshot({ kind: "superseded" });
        await this.command("set_property", "volume", Math.round((targetVol * i) / steps)).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      }
      if (token !== this.pauseToken || this.process !== child) return this.snapshot({ kind: "superseded" });
      await this.command("set_property", "pause", true);
      await this.command("set_property", "volume", targetVol).catch(() => undefined);
    } else if (canFade && !desiredPaused && this.state.paused) {
      const targetVol = this.state.volume;
      await this.command("set_property", "volume", 0).catch(() => undefined);
      await this.command("set_property", "pause", false);
      const steps = 4;
      const stepDelay = Math.max(15, Math.round(fadeMs / steps));
      for (let i = 1; i <= steps; i += 1) {
        if (token !== this.pauseToken || this.process !== child) return this.snapshot({ kind: "superseded" });
        await this.command("set_property", "volume", Math.round((targetVol * i) / steps)).catch(() => undefined);
        if (i < steps) await new Promise((resolve) => setTimeout(resolve, stepDelay));
      }
    } else {
      await this.command("set_property", "pause", desiredPaused);
    }
    if (token !== this.pauseToken || this.process !== child) return this.snapshot({ kind: "superseded" });
    this.state.paused = desiredPaused;
    this.emit({ kind: "pause" });
    return this.snapshot();
  }

  async seek(position) {
    const token = ++this.seekToken;
    await this.ensureProcess(this.launchExclusive ?? false);
    if (token !== this.seekToken) return this.snapshot({ kind: "superseded" });
    const child = this.process;
    const loadToken = this.loadToken;
    const nextPosition = Math.max(0, Number(position) || 0);
    this.state.position = nextPosition;
    this.lastEmittedPosition = nextPosition;
    this.lastProgressEmitAt = 0;
    await this.command("seek", nextPosition, "absolute+exact");
    if (token !== this.seekToken || this.process !== child || !this.isCurrentLoad(loadToken)) {
      return this.snapshot({ kind: "superseded" });
    }
    // Old property ticks can arrive while the seek command is in flight.
    // Publish the requested position, then let later time-pos ticks advance it.
    this.state.position = nextPosition;
    this.lastEmittedPosition = nextPosition;
    this.lastProgressEmitAt = 0;
    this.emit({ kind: "seek" });
    return this.snapshot({ kind: "seek" });
  }

  async setVolume(volume) {
    const token = ++this.volumeToken;
    const parsed = Number(volume);
    const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : this.state.volume;
    this.state.volume = clamped;
    if (this.process && this.socket && !this.socket.destroyed) {
      await this.command("set_property", "volume", clamped).catch(() => undefined);
      if (token !== this.volumeToken) return this.snapshot({ kind: "superseded" });
    }
    this.emit({ kind: "volume" });
    return this.snapshot();
  }

  async setSpeed(speed) {
    const parsed = Number(speed);
    const clamped = Number.isFinite(parsed)
      ? Math.max(0.5, Math.min(2, Math.round(parsed * 1000) / 1000))
      : 1;
    if (Math.abs((this.state.speed ?? 1) - clamped) < 0.001) {
      return this.snapshot();
    }
    this.state.speed = clamped;
    if (this.process && this.socket && !this.socket.destroyed) {
      await this.command("set_property", "speed", clamped).catch(() => undefined);
    }
    this.emit({ kind: "speed" });
    return this.snapshot();
  }

  async recoverOutput(reason = "system-resume") {
    if (!this.process || !this.socket || this.socket.destroyed || !this.state.active) {
      return this.snapshot({ kind: "recover-skipped", reason });
    }

    const now = Date.now();
    if (now - this.lastRecoveryAt < 2500) {
      return this.snapshot({ kind: "recover-throttled", reason });
    }
    this.lastRecoveryAt = now;

    const wasPaused = this.state.paused;
    const position = this.state.position;
    this.writeLog("native-audio.log", `recover output: reason=${reason} paused=${wasPaused} position=${position}`);

    try {
      await this.command("set_property", "pause", true).catch(() => undefined);
      await this.command("ao-reload").catch(() => undefined);
      await this.command("audio-reload", 1).catch(() => undefined);
      if (position > 0) {
        await this.command("seek", Math.max(0, position), "absolute+exact").catch(() => undefined);
      }
      await this.command("set_property", "pause", wasPaused);
      this.state.paused = wasPaused;
      this.emit({ kind: "recover", reason });
    } catch (error) {
      this.writeLog("native-audio.log", `recover output failed: ${error?.stack || error}`);
      this.emit({ kind: "recover-failed", reason });
    }
    return this.snapshot();
  }

  async stop() {
    this.pauseToken += 1;
    this.seekToken += 1;
    const token = ++this.loadToken;
    this.pendingAutoAdvance = null;
    if (!this.process) return this.snapshot();
    await this.command("stop").catch(() => undefined);
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });
    this.state.active = false;
    this.state.trackId = null;
    this.state.url = null;
    this.state.position = 0;
    this.state.duration = 0;
    this.state.paused = true;
    this.state.bitrate = null;
    // Browser playback and an empty queue do not need an idle decoder or an
    // open WASAPI endpoint. Recreate it on the next explicit native load.
    await this.teardown();
    this.emit({ kind: "stop" });
    return this.snapshot();
  }

  async teardown() {
    this.loadToken += 1;
    this.pendingAutoAdvance = null;
    this.rejectPending(new Error("Native audio engine is being restarted."));
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.launchExclusive = null;
    this.state.ready = false;
    // POSIX IPC endpoints are real files that mpv does not remove itself.
    if (!IS_WINDOWS && this.pipePath) {
      try {
        fs.rmSync(this.pipePath, { force: true });
      } catch {
        /* the socket is already gone */
      }
    }
  }
}

module.exports = {
  MpvAudioEngine,
  buildEqualizerFilter,
  buildEqualizerFilterFromChain,
  buildChannelMixFilter,
  sanitizeEqualizerChain,
  buildIpcPipePath,
  buildMpvArguments,
  NATIVE_AUDIO_CLIENT_NAME,
  NATIVE_AUDIO_PROCESS_NAME,
};
