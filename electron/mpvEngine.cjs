const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

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
    this.pendingSeek = 0;
    this.pendingPause = true;
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
    };
  }

  isSupported() {
    return process.platform === "win32" && fs.existsSync(this.resolveExecutable());
  }

  resolveExecutable() {
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, "app.asar.unpacked", "vendor", "mpv", "mpv.exe");
    }
    return path.join(__dirname, "..", "vendor", "mpv", "mpv.exe");
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

    await this.teardown();

    this.pipePath = `\\\\.\\pipe\\aria-mpv-${process.pid}-${Date.now()}`;
    this.buffer = "";

    this.process = spawn(
      this.resolveExecutable(),
      [
        "--idle=yes",
        "--no-video",
        "--force-window=no",
        "--keep-open=no",
        "--no-terminal",
        "--msg-level=all=warn",
        "--no-config",
        `--input-ipc-server=${this.pipePath}`,
      ],
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
    await this.setVolume(this.state.volume);
    await this.applyOutputSettings({
      exclusive: this.state.exclusive,
      deviceId: this.state.deviceId,
    });
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
      this.emit({ kind: "progress" });
      return;
    }

    if (message.event === "file-loaded") {
      this.state.active = true;
      this.state.ready = true;
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
          this.writeLog("native-audio.log", `post-load sync failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        });
      this.emit({ kind: "loaded" });
      return;
    }

    if (message.event === "end-file") {
      this.state.active = false;
      this.state.position = this.state.duration || this.state.position;
      this.state.paused = true;
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
      this.pendingRequests.set(requestId, { resolve, reject });
      this.socket.write(`${JSON.stringify({ ...payload, request_id: requestId })}\n`);
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
      this.state.exclusive = exclusive;
      await this.command("set_property", "audio-exclusive", exclusive ? "yes" : "no");
    }
    if (typeof deviceId === "string") {
      this.state.deviceId = this.normalizeDeviceId(deviceId);
      await this.command("set_property", "audio-device", this.state.deviceId);
    }
    this.emit({ kind: "settings" });
    return this.snapshot();
  }

  async load({ trackId, url, position = 0, paused = true, volume = 72, exclusive = false, deviceId = "default" }) {
    await this.ensureProcess();
    this.pendingSeek = Math.max(0, Number(position) || 0);
    this.pendingPause = Boolean(paused);
    this.state.trackId = trackId;
    this.state.url = url;
    this.state.position = this.pendingSeek;
    this.state.duration = 0;
    this.state.active = false;
    this.state.bitrate = null;
    await this.applyOutputSettings({ exclusive, deviceId, volume });
    await this.command("loadfile", url, "replace");
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

  async stop() {
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

module.exports = { MpvAudioEngine };
