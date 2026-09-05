const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { CdAudioRipper } = require("./cdAudioRipper.cjs");

// OOPZ's Windows application-loopback API selects a process by executable
// name (for example, `Aria.exe`).  The branded filename lets the native
// decoder stay in WASAPI while remaining part of the app selected for share.
const NATIVE_AUDIO_CLIENT_NAME = "Aria";
const NATIVE_AUDIO_PROCESS_NAME = `${NATIVE_AUDIO_CLIENT_NAME}.exe`;

function buildMpvArguments(pipePath) {
  return [
    "--idle=yes",
    "--ao=wasapi",
    "--no-video",
    "--force-window=no",
    "--keep-open=no",
    "--no-terminal",
    // Keep the Windows audio session stable for application-loopback tools.
    `--audio-client-name=${NATIVE_AUDIO_CLIENT_NAME}`,
    "--audio-set-media-role=yes",
    `--title=${NATIVE_AUDIO_CLIENT_NAME}`,
    `--force-media-title=${NATIVE_AUDIO_CLIENT_NAME}`,
    "--audio-exclusive=no",
    "--msg-level=all=warn",
    "--no-config",
    "--cache=yes",
    "--cache-pause=no",
    "--cache-pause-initial=no",
    "--cache-pause-wait=0.15",
    // Audio-only streams never need the video-sized default demuxer buffers;
    // trimming them keeps mpv's resident set small during long sessions.
    "--demuxer-readahead-secs=4",
    "--demuxer-max-bytes=8MiB",
    "--demuxer-max-back-bytes=2MiB",
    "--stream-buffer-size=256KiB",
    // Keep the decoder/AO chain warm across playlist entries so appended
    // tracks start without reopening the WASAPI device.
    "--gapless-audio=yes",
    "--audio-buffer=0.12",
    `--input-ipc-server=${pipePath}`,
  ];
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
    this.loadToken = 0;
    this.pendingSeek = 0;
    this.pendingPause = true;
    this.lastRecoveryAt = 0;
    // When the renderer preloads the next track, mpv advances its internal
    // playlist on EOF. The pending entry's identity and a generation counter
    // (so the renderer can re-arm after each seamless advance) live here.
    this.pendingAutoAdvance = null;
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
      exclusive: false,
      deviceId: "auto",
      bitrate: null,
      gaplessGeneration: 0,
    };
  }

  isSupported() {
    return process.platform === "win32" && fs.existsSync(this.resolveExecutable());
  }

  resolveExecutable() {
    const mpvDirectory = this.app.isPackaged
      ? path.join(process.resourcesPath, "app.asar.unpacked", "vendor", "mpv")
      : path.join(__dirname, "..", "vendor", "mpv");
    const brandedExecutable = path.join(mpvDirectory, NATIVE_AUDIO_PROCESS_NAME);
    if (fs.existsSync(brandedExecutable)) return brandedExecutable;

    return path.join(mpvDirectory, "mpv.exe");
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
        ["--audio-device=help", "--ao=wasapi", "--no-config", "--msg-level=ao=info"],
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

  async ensureProcess() {
    if (!this.isSupported()) {
      throw new Error("Native audio engine is not available.");
    }
    if (this.process && this.socket && !this.socket.destroyed) return;
    if (this.ensurePromise) {
      await this.ensurePromise;
      return;
    }

    this.ensurePromise = (async () => {
      await this.teardown();

      this.pipePath = `\\\\.\\pipe\\aria-mpv-${process.pid}-${Date.now()}`;
      this.buffer = "";

      this.process = spawn(
        this.resolveExecutable(),
        buildMpvArguments(this.pipePath),
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      this.process.stdout?.on("data", (chunk) => this.writeLog("native-audio.log", String(chunk).trimEnd()));
      this.process.stderr?.on("data", (chunk) => this.writeLog("native-audio.log", `ERR ${String(chunk).trimEnd()}`));
      this.process.once("exit", (code, signal) => {
        this.writeLog("native-audio.log", `mpv exited: code=${code} signal=${signal}`);
        this.process = null;
        this.socket = null;
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
    await this.command("observe_property", 4, "audio-bitrate");
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
      if (message.name === "time-pos") this.state.position = Number(message.data) || 0;
      if (message.name === "duration") this.state.duration = Number(message.data) || 0;
      if (message.name === "pause") this.state.paused = Boolean(message.data);
      if (message.name === "audio-bitrate") this.state.bitrate = Number(message.data) || null;
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
        this.state.duration = 0;
        this.state.bitrate = null;
        this.state.gaplessGeneration += 1;
        this.writeLog("native-audio.log", `gapless advance: ${advanced.trackId}`);
        this.emit({ kind: "loaded", gaplessGeneration: this.state.gaplessGeneration });
        return;
      }
      const pendingSeek = this.pendingSeek;
      const pendingPause = this.pendingPause;
      this.pendingSeek = 0;
      Promise.resolve()
        .then(async () => {
          if (pendingSeek > 0) {
            await this.command("seek", pendingSeek, "absolute+exact");
          }
          await this.setPaused(pendingPause);
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
        this.state.duration = 0;
        this.emit({ kind: "progress" });
        return;
      }
      this.pendingAutoAdvance = null;
      this.state.active = false;
      this.state.position = this.state.duration || this.state.position;
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

  async applyOutputSettings({ exclusive, deviceId, volume }) {
    await this.ensureProcess();
    if (typeof volume === "number") {
      this.state.volume = volume;
      await this.command("set_property", "volume", volume);
    }
    if (typeof exclusive === "boolean") {
      await this.command("set_property", "audio-exclusive", exclusive);
      this.state.exclusive = Boolean(await this.command("get_property", "audio-exclusive"));
    }
    if (typeof deviceId === "string") {
      this.state.deviceId = this.normalizeDeviceId(deviceId);
      await this.command("set_property", "audio-device", this.state.deviceId);
      const resolvedDevice = await this.command("get_property", "audio-device").catch(() => this.state.deviceId);
      if (typeof resolvedDevice === "string") {
        this.state.deviceId = resolvedDevice;
      }
    }
    this.emit({ kind: "settings" });
    return this.snapshot();
  }

  async load(options) {
    if (this.isCdLoad(options)) {
      const token = ++this.loadToken;
      return this.performCdLoad(options, token);
    }

    await this.ensureProcess();
    const token = ++this.loadToken;
    return this.performLoad(options, token);
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
    this.state.duration = 0;
    this.state.active = false;
    this.state.paused = this.pendingPause;
    this.state.bitrate = null;
    this.emit({ kind: "switching" });

    await this.command("set_property", "pause", true).catch(() => undefined);
    if (!this.isCurrentLoad(token)) return this.snapshot({ kind: "superseded" });

    await this.applyOutputSettings({ exclusive, deviceId, volume });
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

  async setPaused(paused) {
    await this.ensureProcess();
    this.state.paused = Boolean(paused);
    await this.command("set_property", "pause", this.state.paused);
    this.emit({ kind: "pause" });
    return this.snapshot();
  }

  async seek(position) {
    await this.ensureProcess();
    const nextPosition = Math.max(0, Number(position) || 0);
    this.state.position = nextPosition;
    await this.command("seek", nextPosition, "absolute+exact");
    this.emit({ kind: "seek" });
    return this.snapshot();
  }

  async setVolume(volume) {
    await this.ensureProcess();
    this.state.volume = Math.max(0, Math.min(100, Number(volume) || 0));
    await this.command("set_property", "volume", this.state.volume);
    this.emit({ kind: "volume" });
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
    this.loadToken += 1;
    this.pendingAutoAdvance = null;
    if (!this.process) return this.snapshot();
    await this.command("stop").catch(() => undefined);
    this.state.active = false;
    this.state.trackId = null;
    this.state.url = null;
    this.state.position = 0;
    this.state.duration = 0;
    this.state.paused = true;
    this.state.bitrate = null;
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
    this.state.ready = false;
  }
}

module.exports = {
  MpvAudioEngine,
  buildMpvArguments,
  NATIVE_AUDIO_CLIENT_NAME,
  NATIVE_AUDIO_PROCESS_NAME,
};
