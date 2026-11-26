const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerMonitor, clipboard, globalShortcut, dialog, session } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const zlib = require("node:zlib");
const { createLogger, serializeError } = require("./logger.cjs");
const { MpvAudioEngine } = require("./mpvEngine.cjs");
const { buildQqLoginCookie } = require("./qqLoginCookies.cjs");
const {
  YOUTUBE_STAGE_PARTITION,
  isAllowedYoutubeStageUrl,
  isAllowedYoutubeStageNavigation,
  isBlockedYoutubeStageAdUrl,
  parseYoutubeCookieHeader,
} = require("./youtubeStageHelper.cjs");
// The packaged build carries a bundled electron-updater; development can use
// the readable source module and the root node_modules dependency.
let setupUpdates;
try {
  ({ setupUpdates } = require("./updater.bundle.cjs"));
} catch {
  ({ setupUpdates } = require("./updater.cjs"));
}

const logger = createLogger(app);
const { writeLog } = logger;
logger.writeRuntimeSnapshot("desktop.log", "main loaded");

// Optional native addon that answers the DWM iconic-thumbnail messages so
// the taskbar hover preview shows the album art (NetEase-style).
let iconicThumbAddon = null;
try {
  iconicThumbAddon = require("./native/aria-thumbnail/index.cjs");
} catch (error) {
  iconicThumbAddon = null;
  logger.writeLog("desktop.log", `iconic thumbnail addon unavailable: ${error?.message || error}`);
}

// Optional macOS addon owning MPNowPlayingInfoCenter / MPRemoteCommandCenter;
// without it the Chromium media session still reaches Control Center.
let nowPlayingAddon = null;
try {
  nowPlayingAddon = require("./native/aria-nowplaying/index.cjs");
} catch (error) {
  nowPlayingAddon = null;
  logger.writeLog("desktop.log", `now playing addon unavailable: ${error?.message || error}`);
}

// Windows needs an app-provided iconic bitmap for the compact taskbar card.
// Keep an explicit opt-out for diagnostics, but enable the native DWM bridge
// by default on Windows so the taskbar does not fall back to a full-window
// capture. Electron still owns the thumbnail toolbar and clip region.
const nativeIconicThumbnailEnabled = process.platform === "win32" && process.env.ARIA_NATIVE_ICONIC_THUMBNAIL !== "0";

const apiPort = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);
const apiBase = `http://127.0.0.1:${apiPort}`;

let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let backgroundEnabled = true;
let rendererRecoveries = 0;
let nativeAudioEngine = null;
let mediaSessionReady = false;
let powerRecoveryAttached = false;
let taskbarPlayback = {
  title: "",
  artist: "",
  playing: false,
};
const taskbarRetryTimers = new Set();
let lastTaskbarClipLogKey = "";
let taskbarButtonCreatedEver = false;
let lastIconicBitmap = null;
// Taskbar hover preview: clip the window thumbnail to the current cover art.
// Electron BrowserWindow rectangles and renderer getBoundingClientRect() both
// use device-independent/CSS pixels. setThumbarButtons drops an existing
// clip, so it is re-applied after every thumbar update.
let taskbarClipRect = null;

function applyTaskbarClip() {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed() || typeof mainWindow.setThumbnailClip !== "function") return;
  // When the native DWM iconic thumbnail addon is active, never call
  // SetThumbnailClip — Chromium's clip conflicts with DWMWA_FORCE_ICONIC_REPRESENTATION
  // and causes Windows taskbar hover cards to lose the album cover.
  if (nativeIconicThumbnailEnabled && iconicThumbAddon?.available) return;
  try {
    if (!taskbarClipRect) {
      mainWindow.setThumbnailClip({ x: 0, y: 0, width: 0, height: 0 });
      if (lastTaskbarClipLogKey !== "reset") {
        lastTaskbarClipLogKey = "reset";
        writeLog("desktop.log", "taskbar thumbnail clip reset");
      }
      return;
    }

    const [contentWidth, contentHeight] = mainWindow.getContentSize();
    if (contentWidth < 32 || contentHeight < 32) return;
    const requestedSide = Math.max(8, Math.min(taskbarClipRect.width, taskbarClipRect.height));
    const requestedX = taskbarClipRect.x + (taskbarClipRect.width - requestedSide) / 2;
    const requestedY = taskbarClipRect.y + (taskbarClipRect.height - requestedSide) / 2;
    const x = Math.max(0, Math.min(Math.round(requestedX), Math.max(0, contentWidth - 8)));
    const y = Math.max(0, Math.min(Math.round(requestedY), Math.max(0, contentHeight - 8)));
    const side = Math.max(8, Math.min(Math.round(requestedSide), contentWidth - x, contentHeight - y));
    const clip = { x, y, width: side, height: side };
    mainWindow.setThumbnailClip(clip);

    const key = `${clip.x}|${clip.y}|${clip.width}|${clip.height}|${contentWidth}|${contentHeight}`;
    if (lastTaskbarClipLogKey !== key) {
      lastTaskbarClipLogKey = key;
      writeLog("desktop.log", `taskbar thumbnail clip applied: ${JSON.stringify(clip)} content=${contentWidth}x${contentHeight}`);
    }
  } catch (error) {
    writeLog("desktop.log", `taskbar thumbnail clip failed: ${error?.stack || error}`);
  }
}
let globalShortcutConfig = {
  toggle: "Control+Alt+Space",
  previous: "Control+Alt+Left",
  next: "Control+Alt+Right",
  volumeUp: "Control+Alt+Up",
  volumeDown: "Control+Alt+Down",
  mute: "Control+Alt+M",
  like: "Control+Alt+L",
  mode: "Control+Alt+R",
  equalizer: "Control+Alt+E",
  show: "Control+Alt+A",
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.setName("Aria");
if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId("com.yrrlyb.aria");
}
// Windows/Linux render their own window chrome, so the app menu is dropped
// entirely there. macOS needs the standard application menu or the Edit roles
// (Cmd+C/V/X), Cmd+Q and the About panel all stop working.
if (process.platform === "darwin") {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "设置…",
        accelerator: "Command+,",
        click: () => {
          showWindow();
          mainWindow?.webContents.send("aria:open-settings");
        },
      },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ] },
    { role: "editMenu" },
    { label: "播放", submenu: [
      { label: "播放 / 暂停", click: () => sendPlaybackCommand("toggle") },
      { label: "上一首", click: () => sendPlaybackCommand("previous") },
      { label: "下一首", click: () => sendPlaybackCommand("next") },
      { type: "separator" },
      { label: "提高音量", click: () => sendPlaybackCommand("volumeUp") },
      { label: "降低音量", click: () => sendPlaybackCommand("volumeDown") },
    ] },
    { label: "View", submenu: [
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
  ]));
} else {
  Menu.setApplicationMenu(null);
}

function ensureWindowsTaskbarPreviewPolicy() {
  if (process.platform !== "win32") return;
  try {
    // Windows suppresses every taskbar thumbnail when this per-user flag is
    // set. Aria owns its taskbar card, so make the prerequisite explicit at
    // startup and ask Explorer to refresh its per-user shell parameters.
    execFileSync("reg.exe", [
      "ADD",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
      "/v",
      "DisablePreviewDesktop",
      "/t",
      "REG_DWORD",
      "/d",
      "0",
      "/f",
    ], { windowsHide: true, stdio: "ignore" });
    spawn("rundll32.exe", ["user32.dll,UpdatePerUserSystemParameters"], {
      windowsHide: true,
      stdio: "ignore",
      detached: true,
    }).unref();
    writeLog("desktop.log", "taskbar thumbnail preview policy enabled");
  } catch (error) {
    writeLog("desktop.log", `taskbar thumbnail preview policy unavailable: ${error?.message || error}`);
  }
}

// Chromium spends GPU process memory on the many frosted-glass layers; keep
// the app on the integrated GPU when a discrete one is present and cap every
// V8 heap so long sessions collect garbage instead of growing without bound.
// MediaSessionService is what publishes playback state to the OS media
// overlay / lock screen (SMTC) on Windows.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=192 --optimize-for-size --expose-gc");
app.commandLine.appendSwitch("enable-features", "MediaSessionService");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Aria is a mainland-first NetEase client. The app session is switched to
// direct network once Electron is ready (configureDirectNetwork), because a
// stale system proxy made artwork and the first library refresh appear frozen.
// This is scoped per session instead of a global --no-proxy-server switch so
// the updater can still use the user's proxy to reach GitHub.
// The app owns SMTC for both Chromium and mpv. Avoid a second Chromium card.
const disabledChromiumFeatures = [];
if (iconicThumbAddon?.mediaSessionAvailable || nowPlayingAddon?.available) {
  disabledChromiumFeatures.push("HardwareMediaKeyHandling");
}
if (disabledChromiumFeatures.length > 0) {
  app.commandLine.appendSwitch("disable-features", disabledChromiumFeatures.join(","));
}

function getNativeAudioEngine() {
  if (!nativeAudioEngine) {
    nativeAudioEngine = new MpvAudioEngine({
      app,
      writeLog,
      sendEvent: (payload) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
        mainWindow.webContents.send("aria:native-audio-event", payload);
      },
    });
  }
  return nativeAudioEngine;
}

function scheduleNativeAudioRecovery(reason, delayMs = 900) {
  setTimeout(() => {
    nativeAudioEngine?.recoverOutput?.(reason).catch((error) => {
      writeLog("native-audio.log", `scheduled recovery failed: ${error?.stack || error}`);
    });
  }, delayMs);
}

function attachPowerRecoveryHandlers() {
  if (powerRecoveryAttached) return;
  powerRecoveryAttached = true;
  powerMonitor.on("resume", () => scheduleNativeAudioRecovery("system-resume", 1100));
  powerMonitor.on("unlock-screen", () => scheduleNativeAudioRecovery("unlock-screen", 700));
  powerMonitor.on("suspend", () => writeLog("native-audio.log", "system suspend"));
}

logger.attachProcessHandlers("desktop.log");

function resolveServerEntry() {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "dist-server", "index.cjs");
    if (fs.existsSync(unpacked)) return unpacked;
    return path.join(process.resourcesPath, "app.asar", "dist-server", "index.cjs");
  }

  return path.join(__dirname, "..", "dist-server", "index.cjs");
}

function resolvePreload() {
  return path.join(__dirname, "preload.cjs");
}

function resolveBuildAsset(filename) {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "build", filename);
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return path.join(__dirname, "..", "build", filename);
}

function resolveIcon() {
  // Windows wants a multi-size .ico; macOS/Linux read the PNG.
  if (process.platform === "win32") return resolveBuildAsset("icon.ico");
  return resolveBuildAsset("icon.png");
}

function resolveTrayIcon() {
  return resolveBuildAsset("icon.png");
}

function trayIcon() {
  const iconPath = fs.existsSync(resolveTrayIcon()) ? resolveTrayIcon() : resolveIcon();
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon.resize({ width: 18, height: 18 });
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="#f7f8fb"/>
      <path d="M9 23.5 15.2 7.8h3.4l6.4 15.7h-3.7l-1.2-3.1h-6.6l-1.1 3.1H9Zm5.6-6h4.4l-2.2-5.9-2.2 5.9Z" fill="#8fa7ff"/>
      <path d="M17.8 8.2c3.7 2.9 5.6 8 4 11.6-.8 1.9-2.4 3-4.1 3.2 1.8-2.3 2-5.4.6-8.4-.7-1.6-1.4-3.5-.5-6.4Z" fill="#e58de7" opacity=".82"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`).resize({ width: 18, height: 18 });
}

async function apiOnline(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return true;
    } catch {
      // Wait for the child process to finish booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// Remote access (phone companion over the LAN). The server reads
// <userData>/data/remote.json at boot: `enabled` decides whether it binds
// 0.0.0.0, and every non-loopback /api request must present `token`. The
// desktop mints the token once so enabling the toggle is instant.
function remoteAccessFilePath() {
  return path.join(app.getPath("userData"), "data", "remote.json");
}

function readRemoteAccessFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(remoteAccessFilePath(), "utf8"));
    return {
      enabled: Boolean(parsed?.enabled),
      token: typeof parsed?.token === "string" ? parsed.token : "",
    };
  } catch {
    return { enabled: false, token: "" };
  }
}

function writeRemoteAccessFile(config) {
  const file = remoteAccessFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
}

function lanAddresses() {
  const rankName = (name) => {
    const lower = String(name || "").toLowerCase();
    if (/^(?:utun|awdl|llw|bridge|docker|veth|br-|lo|gif|stf|anpi)/.test(lower)) return 2;
    if (/^(?:en\d+|eth\d+|wlan\d+|wi-?fi|ethernet)/.test(lower)) return 0;
    return 1;
  };
  const candidates = [];
  for (const [ifName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        candidates.push({ address: entry.address, rank: rankName(ifName) });
      }
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return Array.from(new Set(candidates.map((item) => item.address)));
}

function ensureRemoteAccessToken() {
  const config = readRemoteAccessFile();
  if (config.token) return config;
  config.token = crypto.randomBytes(16).toString("base64url");
  writeRemoteAccessFile(config);
  return config;
}

function restartBackendForRemoteAccess() {
  if (typeof globalThis.__ariaRestartServer === "function") {
    void globalThis.__ariaRestartServer().catch((error) => {
      writeLog("desktop.log", `in-process backend restart failed: ${error?.stack || error}`);
    });
    return;
  }
  if (backendProcess && !backendProcess.killed) {
    // The exit handler schedules startBackend() 1.5s later, after the port
    // is released; apiOnline() inside startBackend prevents a double spawn.
    backendProcess.kill();
    return;
  }
  void startBackend();
}

async function urlOnline(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return true;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function directBackendEnvironment() {
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ARIA_API_PORT: String(apiPort),
    MUSICBOX_API_PORT: String(apiPort),
    ARIA_DATA_DIR: path.join(app.getPath("userData"), "data"),
  };
  // The backend performs NetEase requests directly. Strip inherited proxy
  // variables as well as the Chromium switch above so a stale system proxy
  // cannot silently route domestic music, cover or API traffic elsewhere.
  for (const key of Object.keys(environment)) {
    if (/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete environment[key];
  }
  return environment;
}

async function configureDirectNetwork() {
  try {
    await session.defaultSession.setProxy({ mode: "direct" });
    writeLog("desktop.log", "network mode: direct (proxy disabled)");
  } catch (error) {
    writeLog("desktop.log", `unable to force direct network mode: ${error?.stack || error}`);
  }
}

let inProcessBackendLoaded = false;

async function startBackend() {
  if (await apiOnline(500)) return;

  ensureRemoteAccessToken();
  const serverEntry = resolveServerEntry();

  if (process.env.ARIA_BACKEND_SUBPROCESS !== "1") {
    try {
      const env = directBackendEnvironment();
      process.env.ARIA_API_PORT = env.ARIA_API_PORT;
      process.env.MUSICBOX_API_PORT = env.MUSICBOX_API_PORT;
      process.env.ARIA_DATA_DIR = env.ARIA_DATA_DIR;
      for (const key of Object.keys(process.env)) {
        if (/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete process.env[key];
      }
      if (!inProcessBackendLoaded) {
        writeLog("desktop.log", `starting in-process backend: ${serverEntry}`);
        require(serverEntry);
        inProcessBackendLoaded = true;
      } else if (typeof globalThis.__ariaRestartServer === "function") {
        await globalThis.__ariaRestartServer();
      }
      const online = await apiOnline(6000);
      if (online) {
        writeLog("desktop.log", "in-process backend online: true");
        return;
      }
    } catch (error) {
      writeLog("desktop.log", `in-process backend fallback to child process: ${error?.stack || error}`);
    }
  }

  writeLog("desktop.log", `starting backend child process: ${serverEntry}`);
  // Cap the backend V8 heap so long sessions GC eagerly instead of letting V8
  // grow its old space with machine RAM on large-memory hosts.
  backendProcess = spawn(process.execPath, ["--max-old-space-size=192", "--optimize-for-size", serverEntry], {
    cwd: app.getPath("userData"),
    env: directBackendEnvironment(),
    stdio: app.isPackaged ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });

  if (app.isPackaged) {
    backendProcess.stdout?.on("data", (chunk) => writeLog("backend.log", String(chunk).trimEnd()));
    backendProcess.stderr?.on("data", (chunk) => writeLog("backend.log", `ERR ${String(chunk).trimEnd()}`));
  }

  backendProcess.once("exit", (code, signal) => {
    writeLog("desktop.log", `backend exited: code=${code} signal=${signal}`);
    backendProcess = null;
    if (!isQuitting) {
      setTimeout(() => startBackend(), 1500);
    }
  });

  const online = await apiOnline(9000);
  writeLog("desktop.log", `backend online: ${online}`);
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  sendWindowVisibility(true);
  sendWindowFocus(true);
}

function sendWindowVisibility(visible) {
  const isVisible = Boolean(visible);
  nativeAudioEngine?.setWindowVisible?.(isVisible);
  mainWindow?.webContents.send("aria:window-visibility", isVisible);
}

function sendWindowFocus(focused) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("aria:window-focus", Boolean(focused));
}

function sendPlaybackCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("aria:playback-command", command);
}

function executeGlobalShortcut(command) {
  if (command === "show") {
    showWindow();
    return;
  }
  sendPlaybackCommand(command);
}

function sanitizeGlobalShortcut(value, fallback) {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate || candidate.length > 80 || !/(Control|Alt|Shift|Super|Command|Cmd|CommandOrControl|Option)/i.test(candidate)) return fallback;
  return candidate;
}

function syncGlobalShortcuts(payload = {}) {
  const nextConfig = {};
  for (const [command, fallback] of Object.entries(globalShortcutConfig)) {
    nextConfig[command] = sanitizeGlobalShortcut(payload?.[command], fallback);
  }
  globalShortcutConfig = nextConfig;

  globalShortcut.unregisterAll();
  const registered = {};
  const usedAccelerators = new Set();
  for (const [command, accelerator] of Object.entries(globalShortcutConfig)) {
    const duplicate = usedAccelerators.has(accelerator.toLowerCase());
    const success = !duplicate && globalShortcut.register(accelerator, () => executeGlobalShortcut(command));
    registered[command] = success;
    if (success) usedAccelerators.add(accelerator.toLowerCase());
    else writeLog("desktop.log", `global shortcut unavailable: ${command}=${accelerator}`);
  }
  return { shortcuts: globalShortcutConfig, registered };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createTaskbarButtonIcon(kind) {
  const width = 20;
  const height = 20;
  const pixels = Buffer.alloc(width * height * 4);
  const setPixel = (x, y, red = 32, green = 36, blue = 43, alpha = 255) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = alpha;
  };
  const fillRect = (x, y, rectWidth, rectHeight) => {
    for (let row = y; row < y + rectHeight; row += 1) {
      for (let col = x; col < x + rectWidth; col += 1) setPixel(col, row);
    }
  };
  const drawTriangle = (direction, left, right) => {
    for (let row = 0; row < 12; row += 1) {
      const distance = row <= 6 ? row : 12 - row;
      const span = Math.max(1, Math.round((right - left) * distance / 6));
      const start = direction === "right" ? left : right - span;
      const end = direction === "right" ? left + span : right;
      for (let col = Math.min(start, end); col <= Math.max(start, end); col += 1) setPixel(col, 4 + row);
    }
  };

  if (kind === "play") drawTriangle("right", 6, 15);
  else if (kind === "pause") {
    fillRect(5, 4, 3, 12);
    fillRect(12, 4, 3, 12);
  } else if (kind === "previous") {
    fillRect(4, 4, 2, 12);
    drawTriangle("left", 8, 15);
  } else {
    fillRect(14, 4, 2, 12);
    drawTriangle("right", 5, 12);
  }

  const scanlines = Buffer.alloc((height * (width * 4 + 1)));
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (width * 4 + 1)] = 0;
    pixels.copy(scanlines, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const icon = nativeImage.createFromBuffer(png).resize({ width: 20, height: 20 });
  if (icon.isEmpty()) {
    writeLog("desktop.log", `taskbar button icon creation returned an empty image: ${kind}`);
  }
  return icon;
}

const taskbarIcons = process.platform === "win32"
  ? {
      previous: createTaskbarButtonIcon("previous"),
      play: createTaskbarButtonIcon("play"),
      pause: createTaskbarButtonIcon("pause"),
      next: createTaskbarButtonIcon("next"),
    }
  : null;

function taskbarDescription() {
  const title = String(taskbarPlayback.title || "").trim();
  const artist = String(taskbarPlayback.artist || "").trim();
  if (!title) return "Aria";
  return artist ? `${title} - ${artist}` : title;
}

function syncTaskbarPlayback(reason = "state") {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const description = taskbarDescription();
  // Keep the native app identity stable for OOPZ/application-loopback. The
  // song title is published through the thumbnail tooltip and media session.
  mainWindow.setTitle("Aria");
  tray?.setToolTip(description);

  if (process.platform !== "win32") return;
  // Windows-only APIs live strictly behind the platform guard — macOS has no
  // setThumbnailToolTip and calling it aborts createWindow before loadFile
  // (which rendered as a permanently white window on 0.6.0 macOS builds).
  mainWindow.setThumbnailToolTip(description);
  const hasTrack = Boolean(taskbarPlayback.title);
  if (nativeIconicThumbnailEnabled && iconicThumbAddon?.available) {
    try {
      const stats = iconicThumbAddon.getStats?.();
      if (stats?.taskbarButtonReady) taskbarButtonCreatedEver = true;
      if (!taskbarButtonCreatedEver && stats && stats.taskbarButtonReady === false && !reason.includes("fallback")) {
        writeLog("desktop.log", `taskbar buttons waiting for TaskbarButtonCreated reason=${reason}`);
        return;
      }
      if (reason.startsWith("show:") || reason.startsWith("restore:")) {
        iconicThumbAddon.attach(mainWindow.getNativeWindowHandle());
      }
      if (lastIconicBitmap && hasTrack) {
        iconicThumbAddon.setBitmap(lastIconicBitmap.buffer, lastIconicBitmap.width, lastIconicBitmap.height);
      }
    } catch {
      // The optional readiness probe is best effort; Electron remains the fallback.
    }
  }
  try {
    const applied = mainWindow.setThumbarButtons([
      {
        tooltip: "Previous",
        icon: taskbarIcons.previous,
        flags: hasTrack ? [] : ["disabled"],
        click: () => sendPlaybackCommand("previous"),
      },
      {
        tooltip: taskbarPlayback.playing ? "Pause" : "Play",
        icon: taskbarPlayback.playing ? taskbarIcons.pause : taskbarIcons.play,
        flags: hasTrack ? [] : ["disabled"],
        click: () => sendPlaybackCommand("toggle"),
      },
      {
        tooltip: "Next",
        icon: taskbarIcons.next,
        flags: hasTrack ? [] : ["disabled"],
        click: () => sendPlaybackCommand("next"),
      },
    ]);
    const iconState = Object.entries(taskbarIcons)
      .map(([name, icon]) => `${name}:${icon.isEmpty() ? "empty" : icon.getSize().width + "x" + icon.getSize().height}`)
      .join(",");
    writeLog(
      "desktop.log",
      `taskbar buttons applied: ${Boolean(applied)} track=${hasTrack} visible=${mainWindow.isVisible()} reason=${reason} icons=${iconState}`,
    );
  } catch (error) {
    writeLog("desktop.log", `taskbar buttons failed: ${error?.stack || error}`);
  }
  // setThumbarButtons clears an existing thumbnail clip; restore it so the
  // preview keeps showing the cover art instead of the whole window.
  applyTaskbarClip();
  const clipTimer = setTimeout(applyTaskbarClip, 80);
  clipTimer.unref?.();
}

function scheduleTaskbarSync(reason) {
  for (const timer of taskbarRetryTimers) clearTimeout(timer);
  taskbarRetryTimers.clear();

  syncTaskbarPlayback(`${reason}:now`);
  for (const delay of [100, 300, 700, 1500, 3000, 5000]) {
    const timer = setTimeout(() => {
      taskbarRetryTimers.delete(timer);
      syncTaskbarPlayback(`${reason}:${delay}ms${delay === 5000 ? ":fallback" : ""}`);
    }, delay);
    timer.unref?.();
    taskbarRetryTimers.add(timer);
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("Aria");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Aria", click: showWindow },
      { type: "separator" },
      { label: "播放 / 暂停", click: () => sendPlaybackCommand("toggle") },
      { label: "上一首", click: () => sendPlaybackCommand("previous") },
      { label: "下一首", click: () => sendPlaybackCommand("next") },
      { type: "separator" },
      { label: "后台托管", click: () => mainWindow?.hide() },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", showWindow);
}

async function createWindow() {
  // Start the API and the renderer concurrently. The first screen paints from
  // cached state immediately; startup API requests retry briefly until the
  // local server is listening.
  const backendReady = startBackend();
  void backendReady.catch((error) => writeLog("desktop.log", `backend startup failed: ${error?.stack || error}`));
  createTray();

  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1160,
    minHeight: 720,
    show: false,
    // macOS keeps its native traffic lights (inset into our header); Windows and
    // Linux get the frameless window with the in-app controls.
    ...(isMac
      ? { frame: true, titleBarStyle: "hiddenInset", trafficLightPosition: { x: 20, y: 20 } }
      : { frame: false }),
    title: "Aria",
    icon: resolveIcon(),
    autoHideMenuBar: true,
    backgroundColor: "#f5f6f8",
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  if (process.platform !== "darwin") {
    // macOS keeps the application menu (traffic-light window + native roles);
    // the other platforms draw their own chrome without a menu bar.
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }
  if (iconicThumbAddon?.mediaSessionAvailable) {
    try {
      mediaSessionReady = Boolean(iconicThumbAddon.attachMediaSession(mainWindow.getNativeWindowHandle(), sendPlaybackCommand));
      writeLog("desktop.log", `Windows media session attached: ${mediaSessionReady}`);
    } catch (error) {
      writeLog("desktop.log", `Windows media session failed: ${error?.stack || error}`);
    }
  }
  if (process.platform === "darwin" && nowPlayingAddon?.available) {
    try {
      mediaSessionReady = Boolean(nowPlayingAddon.attach(sendPlaybackCommand));
      writeLog("desktop.log", `macOS media session attached: ${mediaSessionReady}`);
    } catch (error) {
      writeLog("desktop.log", `macOS media session failed: ${error?.stack || error}`);
    }
  }
  if (process.platform === "win32" && typeof mainWindow.setAppDetails === "function") {
    // Keep the native window identity stable so Windows application-loopback
    // capture tools can associate the mpv child session with Aria.
    try {
      mainWindow.setAppDetails({
        appId: "com.yrrlyb.aria",
        appIconPath: resolveIcon(),
        appIconIndex: 0,
        relaunchDisplayName: "Aria",
        relaunchCommand: process.execPath,
      });
    } catch (error) {
      writeLog("desktop.log", `unable to set Windows app details: ${error?.stack || error}`);
    }
  }
  if (nativeIconicThumbnailEnabled && iconicThumbAddon?.available) {
    try {
      const attached = iconicThumbAddon.attach(mainWindow.getNativeWindowHandle());
      writeLog("desktop.log", `iconic thumbnail addon attached: ${Boolean(attached)}`);
    } catch (error) {
      writeLog("desktop.log", `iconic thumbnail attach failed: ${error?.message || error}`);
    }
  }

  syncTaskbarPlayback();

  mainWindow.once("ready-to-show", () => {
    showWindow();
    scheduleTaskbarSync("ready-to-show");
  });

  mainWindow.webContents.once("did-finish-load", () => {
    scheduleTaskbarSync("did-finish-load");
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeLog("desktop.log", `renderer gone: ${JSON.stringify(details)}`);
    if (!isQuitting && rendererRecoveries < 2) {
      rendererRecoveries += 1;
      setTimeout(() => mainWindow?.reload(), 800);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeLog("desktop.log", `did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      writeLog("renderer.log", `${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (params.partition !== YOUTUBE_STAGE_PARTITION || !isAllowedYoutubeStageUrl(params.src)) {
      writeLog("desktop.log", `youtube stage rejected: partition=${params.partition || "(none)"} src=${params.src || "(none)"}`);
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.preload = path.join(__dirname, "youtubeStagePreload.cjs");
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.allowRunningInsecureContent = false;
  });

  mainWindow.webContents.on("did-attach-webview", (_event, guestWebContents) => {
    writeLog("desktop.log", `youtube stage attached: ${guestWebContents.getURL() || "(pending)"}`);
    guestWebContents.setWindowOpenHandler(() => ({ action: "deny" }));
    guestWebContents.on("will-navigate", (navEvent, navUrl, _isInPlace, isMainFrame) => {
      if (isMainFrame !== false && !isAllowedYoutubeStageNavigation(navUrl)) {
        writeLog("desktop.log", `youtube stage blocked nav: ${navUrl}`);
        navEvent.preventDefault();
      }
    });
    guestWebContents.on("did-fail-load", (_ev, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      writeLog("desktop.log", `youtube stage did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`);
    });
    guestWebContents.on("render-process-gone", (_ev, details) => {
      writeLog("desktop.log", `youtube stage render-process-gone: ${details?.reason || "unknown"}`);
    });
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && backgroundEnabled) {
      event.preventDefault();
      if (process.platform === "darwin" && mainWindow.isFullScreen()) {
        mainWindow.once("leave-full-screen", () => {
          if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
        });
        mainWindow.setFullScreen(false);
        return;
      }
      mainWindow.hide();
    }
  });
  mainWindow.on("hide", () => {
    sendWindowVisibility(false);
    sendWindowFocus(false);
  });
  mainWindow.on("minimize", () => {
    sendWindowVisibility(false);
    sendWindowFocus(false);
  });
  mainWindow.on("blur", () => sendWindowFocus(false));
  mainWindow.on("focus", () => sendWindowFocus(true));
  mainWindow.on("show", () => {
    sendWindowVisibility(true);
    sendWindowFocus(true);
    scheduleTaskbarSync("show");
  });
  mainWindow.on("restore", () => {
    sendWindowVisibility(true);
    sendWindowFocus(true);
    scheduleTaskbarSync("restore");
  });
  mainWindow.on("closed", () => {
    iconicThumbAddon?.detachMediaSession?.();
    nowPlayingAddon?.detach?.();
    mediaSessionReady = false;
    for (const timer of taskbarRetryTimers) clearTimeout(timer);
    taskbarRetryTimers.clear();
  });

  if (!app.isPackaged) {
    const devUrl = process.env.ARIA_DEV_SERVER_URL || "http://127.0.0.1:5173";
    await urlOnline(devUrl);
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("aria:minimize-to-tray", () => {
  mainWindow?.hide();
  return true;
});

ipcMain.handle("aria:minimize-window", () => {
  mainWindow?.minimize();
  return true;
});

ipcMain.handle("aria:toggle-maximize-window", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle("aria:close-window", () => {
  mainWindow?.close();
  return true;
});

ipcMain.handle("aria:show", () => {
  showWindow();
  return true;
});

ipcMain.handle("aria:quit", () => {
  isQuitting = true;
  app.quit();
  return true;
});

ipcMain.handle("aria:set-background-enabled", (_event, enabled) => {
  backgroundEnabled = Boolean(enabled);
  return backgroundEnabled;
});

ipcMain.handle("aria:choose-music-folder", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择本地音乐文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// QQ 音乐登录：网页端 OAuth 握手依赖浏览器行为（登录跳转页/风控脚本），
// 服务端纯 HTTP 复刻只能拿到 p_skey 缺失或授权链不返回 code。
// 这里在应用内开一个真实 Chromium 窗口完成扫码，登录成功后从会话里取 Cookie。
const QQ_LOGIN_USER_AGENT =
  process.platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

ipcMain.handle("aria:qq-login-window", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, message: "主窗口不可用" };
  const loginSession = session.fromPartition("aria:qq-login");
  loginSession.setUserAgent(QQ_LOGIN_USER_AGENT);
  return new Promise((resolve) => {
    const loginWindow = new BrowserWindow({
      width: 480,
      height: 760,
      parent: mainWindow,
      autoHideMenuBar: true,
      title: "登录 QQ 音乐",
      webPreferences: {
        partition: "aria:qq-login",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      if (!loginWindow.isDestroyed()) loginWindow.close();
      resolve(value);
    };
    const readLoginCookie = async () => {
      const cookies = await loginSession.cookies.get({});
      const cookieHeader = buildQqLoginCookie(cookies);
      if (!cookieHeader) return;
      writeLog("desktop.log", "qq login window: credentials captured");
      finish({ ok: true, cookie: cookieHeader });
    };
    timer = setInterval(() => {
      if (!settled) readLoginCookie().catch(() => {});
    }, 1200);
    loginWindow.on("closed", () => finish({ ok: false, message: "登录窗口已关闭" }));
    loginWindow.webContents.setUserAgent(QQ_LOGIN_USER_AGENT);
    loginWindow.loadURL("https://y.qq.com/").catch(() => finish({ ok: false, message: "登录页加载失败" }));
  });
});

// YouTube Music 登录：Google 没有面向第三方的扫码方案，这里沿用 QQ 的
// 窗口登录思路——在应用内开一个真实 Chromium 窗口，让用户像平时一样登录
// Google 账号；窗口会话绑定用户配置的 YouTube 代理（没有代理国内打不开），
// 登录成功后自动从会话 Cookie 里提取 innertube 所需的会话字段回传后端。
// Cookie 粘贴保留为备用路径（与其它源一致）。
//
// UA 策略（2026-11 实测修订）：Google 拦截的是「伪装成 Chrome 但其它信号
// 对不上」的浏览器，而对如实标识自己的 Electron 默认 UA 放行，并会把会话
// 路由到允许登录的 WebLiteSignIn 流程。Google 官方指引同样要求连接
// accounts.google.com 时如实标识、不得套用 Chrome 的 UA。因此这里不覆盖
// 登录窗口的 UA——保留 Electron 默认 UA（真实 Chromium 版本 + Electron token）。
// 真正的粘性拦截来自旧持久化分区里反复被拦的风控 Cookie：每次窗口登录都
// 换一个从零开始的内存会话，Google 侧永远是"新浏览器"的干净首登。
const YOUTUBE_COOKIE_KEYS = new Set([
  "SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO", "PREF",
  "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDTS", "__Secure-3PSIDTS",
  "__Secure-1PAPISID", "__Secure-3PAPISID", "__Secure-1SID", "__Secure-3SID",
]);
// 登录链路走 music.youtube.com 网页版自己的入口（ltmpl=music，经
// www.youtube.com/signin 跳回），与真实浏览器点击「登录」完全一致；
// passive=true 之类的简化入口在嵌入式 Chromium 上更容易触发
// Google 的「此浏览器或应用可能不安全」拦截。
const YOUTUBE_LOGIN_URL =
  "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=" +
  encodeURIComponent(
    "https://www.youtube.com/signin?action_handle_signin=true&next=" +
      encodeURIComponent("https://music.youtube.com/"),
  );

function isLoopbackHost(hostname) {
  return /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(String(hostname || ""));
}

function formatProxyHostPort(hostname, port) {
  const cleanHost = String(hostname || "").replace(/^\[|\]$/g, "");
  const formattedHost = cleanHost.includes(":") ? `[${cleanHost}]` : cleanHost;
  return `${formattedHost}:${port}`;
}

function normalizeYoutubeProxyUrl(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";
  if (/^\d{1,5}$/.test(trimmed)) {
    const port = Number(trimmed);
    return port >= 1 && port <= 65535 ? `http://127.0.0.1:${port}` : "";
  }
  const hostPortMatch = trimmed.match(/^(\[[^\]]+\]|[\w.-]+):(\d{1,5})$/);
  if (hostPortMatch) {
    const port = Number(hostPortMatch[2]);
    return port >= 1 && port <= 65535 ? `http://${formatProxyHostPort(hostPortMatch[1], port)}` : "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      let protocol = parsed.protocol.toLowerCase();
      if (protocol === "socks:" || protocol === "socks5h:") protocol = "socks5:";
      if (protocol === "socks4a:") protocol = "socks4:";
      const allowed = protocol === "http:" || protocol === "https:" || protocol === "socks5:" || protocol === "socks4:";
      if (!allowed || !parsed.hostname) return "";
      if (protocol === "https:" && isLoopbackHost(parsed.hostname)) {
        // Local proxy tools listen with plain HTTP/SOCKS on loopback; https:// makes Chromium abort with ERR_NO_SUPPORTED_PROXIES.
        protocol = "http:";
      }
      const port = parsed.port ? Number(parsed.port) : protocol === "https:" ? 443 : protocol === "http:" ? 80 : 0;
      if (!Number.isFinite(port) || port < 1 || port > 65535) return "";
      return `${protocol}//${formatProxyHostPort(parsed.hostname, port)}`;
    } catch {
      return "";
    }
  }
  return "";
}

function healStoredYoutubeProxy(storeFile, parsed, rawValue) {
  const healed = normalizeYoutubeProxyUrl(rawValue);
  if (!parsed || typeof rawValue !== "string" || !healed || healed === rawValue) return healed;
  try {
    parsed.youtubeProxy = healed;
    fs.writeFileSync(storeFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    writeLog("desktop.log", `youtube proxy auto-healed: ${rawValue} -> ${healed}`);
  } catch {
    // Store healing is best-effort.
  }
  return healed;
}

function resolveYoutubeLoginProxy(rawProxy) {
  const direct = normalizeYoutubeProxyUrl(rawProxy);
  try {
    const storeFile = path.join(app.getPath("userData"), "data", "store.json");
    if (fs.existsSync(storeFile)) {
      const parsed = JSON.parse(fs.readFileSync(storeFile, "utf8"));
      const healedStored = healStoredYoutubeProxy(storeFile, parsed, parsed?.youtubeProxy);
      if (direct) return direct;
      return healedStored;
    }
  } catch {
    // Store fallback is best-effort.
  }
  return direct;
}

function saveAutoDetectedYoutubeProxyToStore(proxyUrl) {
  const normalized = normalizeYoutubeProxyUrl(proxyUrl);
  if (!normalized || !/^http:\/\//i.test(normalized)) return;
  try {
    const storeFile = path.join(app.getPath("userData"), "data", "store.json");
    let parsed = {};
    if (fs.existsSync(storeFile)) {
      parsed = JSON.parse(fs.readFileSync(storeFile, "utf8")) || {};
    } else {
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    }
    if (normalizeYoutubeProxyUrl(parsed.youtubeProxy)) return;
    parsed.youtubeProxy = normalized;
    fs.writeFileSync(storeFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    writeLog("desktop.log", `youtube proxy auto-saved from detected local proxy: ${normalized}`);
  } catch {
    // Auto-save is best-effort.
  }
}

let youtubeProxyRelayState = null;
const youtubeProxyRelayPending = new Map();

function stopYoutubeProxyRelay() {
  if (youtubeProxyRelayState?.proc && !youtubeProxyRelayState.proc.killed) {
    try {
      youtubeProxyRelayState.proc.kill();
    } catch {
      // Ignore exit errors during shutdown.
    }
  }
  youtubeProxyRelayState = null;
}

function buildWindowsProxyRelayScript(upstreamHost, upstreamPort, parentPid) {
  const escapedHost = String(upstreamHost).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'SilentlyContinue'
$parentPid = ${Number(parentPid)}
$upHost = '${escapedHost}'
$upPort = ${Number(upstreamPort)}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
[Console]::Out.WriteLine('RELAY_PORT=' + $listener.LocalEndpoint.Port)
[Console]::Out.Flush()
$conns = [System.Collections.Generic.List[object]]::new()
$acc = $listener.AcceptTcpClientAsync()
$ticks = 0
while ($true) {
  $waitList = [System.Collections.Generic.List[System.Threading.Tasks.Task]]::new()
  $waitList.Add($acc)
  foreach ($cn in $conns) {
    if (-not $cn.t1Done) { $waitList.Add($cn.t1) }
    if (-not $cn.t2Done) { $waitList.Add($cn.t2) }
  }
  [void][System.Threading.Tasks.Task]::WaitAny($waitList.ToArray(), 1500)
  $ticks++
  if ($ticks % 2 -eq 0) {
    try {
      $p = [System.Diagnostics.Process]::GetProcessById($parentPid)
      if ($null -eq $p -or $p.HasExited) { break }
    } catch { break }
  }
  if ($acc.IsCompleted) {
    if ($acc.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
      $c = $acc.Result
      $u = $null
      try {
        $c.NoDelay = $true
        $u = [System.Net.Sockets.TcpClient]::new()
        $u.NoDelay = $true
        $iar = $u.BeginConnect($upHost, $upPort, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(2000)) { throw [System.TimeoutException]::new('connect timeout') }
        $u.EndConnect($iar)
        $s1 = $c.GetStream()
        $s2 = $u.GetStream()
        $conns.Add([pscustomobject]@{
          c = $c
          u = $u
          t1 = $s1.CopyToAsync($s2)
          t2 = $s2.CopyToAsync($s1)
          t1Done = $false
          t2Done = $false
        })
      } catch {
        try { if ($c) { $c.Close() } } catch {}
        try { if ($u) { $u.Close() } } catch {}
      }
    }
    $acc = $listener.AcceptTcpClientAsync()
  }
  for ($i = $conns.Count - 1; $i -ge 0; $i--) {
    $cn = $conns[$i]
    if (-not $cn.t1Done -and $cn.t1.IsCompleted) {
      $cn.t1Done = $true
      if ($cn.t1.IsFaulted -or $cn.t1.IsCanceled) {
        $cn.t2Done = $true
      } else {
        try { $cn.u.Client.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch {}
      }
    }
    if (-not $cn.t2Done -and $cn.t2.IsCompleted) {
      $cn.t2Done = $true
      if ($cn.t2.IsFaulted -or $cn.t2.IsCanceled) {
        $cn.t1Done = $true
      } else {
        try { $cn.c.Client.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch {}
      }
    }
    if ($cn.t1Done -and $cn.t2Done) {
      try { $cn.c.Close() } catch {}
      try { $cn.u.Close() } catch {}
      $conns.RemoveAt($i)
    }
  }
}
`;
}

async function ensureYoutubeProxyRelay(upstreamHost, upstreamPort) {
  if (process.platform !== "win32") return null;
  const host = String(upstreamHost || "").replace(/^\[|\]$/g, "");
  const port = Number(upstreamPort);
  if (!/^[a-zA-Z0-9.:_-]+$/.test(host) || !Number.isFinite(port) || port < 1 || port > 65535) {
    return null;
  }
  const upstreamKey = `${host}:${port}`;
  if (
    youtubeProxyRelayState &&
    youtubeProxyRelayState.upstreamKey === upstreamKey &&
    youtubeProxyRelayState.proc &&
    !youtubeProxyRelayState.proc.killed &&
    youtubeProxyRelayState.proc.exitCode === null
  ) {
    return youtubeProxyRelayState.localPort;
  }
  const existingPending = youtubeProxyRelayPending.get(upstreamKey);
  if (existingPending) return existingPending;

  const task = (async () => {
    stopYoutubeProxyRelay();
    const script = buildWindowsProxyRelayScript(host, port, process.pid);
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return new Promise((resolve) => {
      let settled = false;
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdoutBuf = "";
      let stderrBuf = "";
      const finish = (localPort) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (localPort) {
          youtubeProxyRelayState = { upstreamKey, localPort, proc };
          writeLog("desktop.log", `youtube proxy relay started: 127.0.0.1:${localPort} -> ${upstreamKey}`);
          resolve(localPort);
        } else {
          try { proc.kill(); } catch {}
          resolve(null);
        }
      };
      const timer = setTimeout(() => {
        writeLog("desktop.log", `youtube proxy relay startup timeout for ${upstreamKey} ${stderrBuf.trim()}`);
        finish(null);
      }, 4500);

      proc.stderr.on("data", (chunk) => {
        if (stderrBuf.length < 512) stderrBuf += String(chunk);
      });

      proc.stdout.on("data", (chunk) => {
        stdoutBuf += String(chunk);
        const match = stdoutBuf.match(/RELAY_PORT=(\d+)/);
        if (match) {
          const relayPort = Number(match[1]);
          if (Number.isFinite(relayPort) && relayPort > 0 && relayPort <= 65535) {
            finish(relayPort);
          }
        }
      });
      proc.once("exit", () => {
        if (youtubeProxyRelayState?.proc === proc) {
          youtubeProxyRelayState = null;
        }
        finish(null);
      });
      proc.once("error", (err) => {
        writeLog("desktop.log", `youtube proxy relay spawn error: ${err?.message || err}`);
        finish(null);
      });
    });
  })();

  youtubeProxyRelayPending.set(upstreamKey, task);
  try {
    return await task;
  } finally {
    youtubeProxyRelayPending.delete(upstreamKey);
  }
}

globalThis.__ariaEnsureYoutubeProxyRelay = async (rawProxyUrl) => {
  if (process.platform !== "win32") return rawProxyUrl || null;
  const normalized = normalizeYoutubeProxyUrl(rawProxyUrl);
  if (!normalized) return rawProxyUrl || null;
  try {
    const parsed = new URL(normalized);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return normalized;
    if (protocol === "https:" && !isLoopbackHost(parsed.hostname)) return normalized;
    const port = Number(parsed.port || 80);
    const relayPort = await ensureYoutubeProxyRelay(parsed.hostname, port);
    return relayPort ? `http://127.0.0.1:${relayPort}` : normalized;
  } catch {
    return rawProxyUrl || null;
  }
};

function makeProxyCandidate(scheme, host, port, tag) {
  const cleanHost = String(host || "").replace(/^\[|\]$/g, "");
  const hostPort = formatProxyHostPort(cleanHost, port);
  const proxyRules =
    scheme === "socks5"
      ? `socks5://${hostPort}`
      : scheme === "socks4"
        ? `socks4://${hostPort}`
        : scheme === "https"
          ? `https://${hostPort}`
          : `http=${hostPort};https=${hostPort}`;
  const label = `${scheme}://${hostPort}${tag ? ` (${tag})` : ""}`;
  return {
    key: `${scheme}:${cleanHost}:${port}`,
    scheme,
    host: cleanHost,
    port,
    hostPort,
    proxyRules,
    label,
  };
}

function buildYoutubeProxyCandidates(resolvedProxy) {
  const list = [];
  const seen = new Set();
  const push = (candidate) => {
    if (!candidate || seen.has(candidate.key)) return;
    seen.add(candidate.key);
    list.push(candidate);
  };

  if (resolvedProxy) {
    try {
      const parsed = new URL(resolvedProxy);
      const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
      const port = Number(parsed.port || (protocol === "https" ? 443 : 80));
      const host = parsed.hostname;
      if (protocol === "socks5" || protocol === "socks4") {
        push(makeProxyCandidate(protocol, host, port, "已配置"));
        push(makeProxyCandidate("http", host, port, "同端口 HTTP 回退"));
      } else if (protocol === "https" && !isLoopbackHost(host)) {
        push(makeProxyCandidate("https", host, port, "已配置"));
      } else {
        push(makeProxyCandidate("http", host, port, "已配置"));
        push(makeProxyCandidate("socks5", host, port, "同端口 SOCKS5"));
      }
      if (port === 10808) {
        push(makeProxyCandidate("http", host, 10809, "v2rayN 默认 HTTP 端口"));
      } else if (port === 10809) {
        push(makeProxyCandidate("socks5", host, 10808, "v2rayN 默认 SOCKS5 端口"));
      }
    } catch {
      // Ignore malformed proxy fallback; common loopback candidates still run below.
    }
  }

  for (const [scheme, port, tag] of [
    ["http", 7890, "Clash 常用端口"],
    ["http", 10809, "v2rayN HTTP"],
    ["http", 10808, "混合端口 10808"],
    ["http", 7897, "Clash Verge 端口"],
    ["socks5", 10808, "v2rayN SOCKS5"],
    ["socks5", 1080, "本地 SOCKS5"],
  ]) {
    push(makeProxyCandidate(scheme, "127.0.0.1", port, tag));
  }

  return list;
}

function probeYoutubeProxyCandidate(candidate) {
  if (candidate.scheme === "https" || candidate.scheme === "socks4") {
    return Promise.resolve({ candidate, status: "skipped", detail: "跳过非 HTTP/SOCKS5 协议探测" });
  }

  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    let socksStage = "greeting";
    let rxChunks = [];
    let connectTimer = null;
    let tunnelTimer = null;

    const socket = net.createConnection({ host: candidate.host, port: candidate.port });

    const finishProbe = (status, detail) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (tunnelTimer) clearTimeout(tunnelTimer);
      socket.removeAllListeners();
      socket.destroy();
      resolve({ candidate, status, detail });
    };

    connectTimer = setTimeout(() => {
      finishProbe("unreachable", "本地端口未响应");
    }, 450);

    socket.once("connect", () => {
      connected = true;
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      tunnelTimer = setTimeout(() => {
        finishProbe("tunnel_timeout", "本地端口已握手但代理节点连接 Google 超时");
      }, 3200);

      if (candidate.scheme === "http") {
        socket.write(
          "CONNECT accounts.google.com:443 HTTP/1.1\r\n" +
            "Host: accounts.google.com:443\r\n" +
            "Proxy-Connection: keep-alive\r\n\r\n",
        );
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });

    socket.on("data", (chunk) => {
      if (settled) return;
      rxChunks.push(chunk);
      const buf = Buffer.concat(rxChunks);

      if (candidate.scheme === "http") {
        const text = buf.toString("latin1");
        const crlfIndex = text.indexOf("\n");
        if (crlfIndex === -1 && buf.length < 16) {
          if (buf[0] === 0x05 || buf[0] === 0x15) {
            finishProbe("protocol_mismatch", "端口返回非 HTTP 响应");
          }
          return;
        }
        const statusLine = (crlfIndex >= 0 ? text.slice(0, crlfIndex) : text).trim();
        const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/i);
        if (!match) {
          finishProbe("protocol_mismatch", "端口非 HTTP CONNECT 代理");
          return;
        }
        const statusCode = Number(match[1]);
        if (statusCode === 200) {
          finishProbe("ok", "HTTP CONNECT -> accounts.google.com:443 握手成功");
          return;
        }
        finishProbe("tunnel_failed", `本地 HTTP 代理返回 ${statusCode}`);
        return;
      }

      if (socksStage === "greeting") {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) {
          finishProbe("protocol_mismatch", "端口非 SOCKS5 协议");
          return;
        }
        if (buf[1] !== 0x00) {
          finishProbe("tunnel_failed", "SOCKS5 需要身份认证");
          return;
        }
        socksStage = "connect";
        rxChunks = buf.length > 2 ? [buf.subarray(2)] : [];
        const hostBuf = Buffer.from("accounts.google.com", "ascii");
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([(443 >> 8) & 0xff, 443 & 0xff]),
        ]);
        socket.write(req);
        if (rxChunks.length) socket.emit("data", Buffer.alloc(0));
        return;
      }

      if (socksStage === "connect") {
        if (buf.length < 4) return;
        if (buf[0] === 0x05 && buf[1] === 0x00) {
          finishProbe("ok", "SOCKS5 -> accounts.google.com:443 握手成功");
        } else {
          finishProbe("tunnel_failed", `本地 SOCKS5 握手已通但连接 Google 失败 (rep=${buf[1]})`);
        }
      }
    });

    socket.on("error", (error) => {
      if (!connected) {
        finishProbe("unreachable", `本地端口未监听 (${error?.code || "connect failed"})`);
      } else {
        finishProbe("tunnel_failed", `代理连接异常 (${error?.code || error?.message || "socket error"})`);
      }
    });

    socket.on("close", () => {
      if (settled) return;
      if (!connected) {
        finishProbe("unreachable", "本地端口未监听");
      } else if (candidate.scheme === "socks5" && socksStage === "greeting") {
        finishProbe("protocol_mismatch", "端口非 SOCKS5 协议");
      } else if (candidate.scheme === "http" && rxChunks.length === 0) {
        finishProbe("protocol_mismatch", "端口拒绝 HTTP CONNECT 请求");
      } else {
        finishProbe("tunnel_failed", "代理连接提前关闭");
      }
    });
  });
}

function parseSystemResolvedProxy(resolvedString) {
  const tokens = String(resolvedString || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const match = token.match(/^(PROXY|HTTPS|SOCKS5|SOCKS4|SOCKS)\s+(.+)$/i);
    if (!match) continue;
    const kind = match[1].toUpperCase();
    const target = match[2].trim();
    const scheme = kind === "SOCKS5" || kind === "SOCKS" ? "socks5" : kind === "SOCKS4" ? "socks4" : kind === "HTTPS" ? "https" : "http";
    const normalized = normalizeYoutubeProxyUrl(`${scheme}://${target}`);
    if (normalized) return normalized;
  }
  return "";
}

function summarizeProbeDiagnostics(results, configuredHostPort) {
  const timeoutResult = results.find((item) => item.status === "tunnel_timeout");
  if (timeoutResult) {
    return `探测诊断：${timeoutResult.candidate.hostPort} 本地端口已握手，但代理节点连接 Google 超时（请检查节点可用性或代理软件配置）。`;
  }
  const tunnelFail = results.find((item) => item.status === "tunnel_failed");
  if (tunnelFail) {
    return `探测诊断：${tunnelFail.candidate.hostPort} ${tunnelFail.detail}。`;
  }
  const mismatch = results.find((item) => item.status === "protocol_mismatch");
  if (mismatch && configuredHostPort) {
    return `探测诊断：${configuredHostPort} 本地端口在线但协议不匹配，可改填 HTTP 端口（如 v2rayN 填 10809、Clash 填 7890）。`;
  }
  if (configuredHostPort) {
    return `探测诊断：未检测到 ${configuredHostPort} 在监听，请先启动代理软件并确认端口号正确。`;
  }
  return "探测诊断：未检测到可用的系统代理或常见本地代理端口（7890 / 10808 / 10809）。";
}

async function verifyProxyTlsEndToEnd(candidate) {
  if (candidate.scheme === "https" || candidate.scheme === "socks4") {
    return { ok: true, relayPort: null, detail: "" };
  }
  const relayPort = process.platform === "win32" ? await ensureYoutubeProxyRelay(candidate.host, candidate.port) : null;
  const connectHost = relayPort ? "127.0.0.1" : candidate.host;
  const connectPort = relayPort || candidate.port;

  return new Promise((resolve) => {
    let settled = false;
    let tlsSocket = null;
    let socksStage = "greeting";
    let rxChunks = [];
    const socket = net.createConnection({ host: connectHost, port: connectPort });

    const finish = (ok, status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { tlsSocket?.destroy(); } catch {}
      try { socket.destroy(); } catch {}
      resolve({ ok, status, detail, relayPort });
    };

    const timer = setTimeout(() => {
      finish(false, "tunnel_timeout", "本地代理端口已握手，但访问 accounts.google.com TLS 超时");
    }, 4500);

    const startTls = () => {
      tlsSocket = tls.connect({ socket, servername: "accounts.google.com", ALPNProtocols: ["h2", "http/1.1"] }, () => {
        finish(true, "ok", "TLS 握手成功");
      });
      tlsSocket.once("error", (err) => {
        finish(false, "tunnel_failed", `Google TLS 握手失败 (${err?.code || err?.message || "error"})`);
      });
    };

    socket.once("connect", () => {
      if (candidate.scheme === "http") {
        socket.write(
          "CONNECT accounts.google.com:443 HTTP/1.1\r\n" +
            "Host: accounts.google.com:443\r\n" +
            "Proxy-Connection: keep-alive\r\n\r\n",
        );
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });

    const onHandshakeData = (chunk) => {
      if (settled || tlsSocket) return;
      rxChunks.push(chunk);
      const buf = Buffer.concat(rxChunks);

      if (candidate.scheme === "http") {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString("latin1");
        socket.off("data", onHandshakeData);
        if (!/^HTTP\/1\.[01]\s+200\b/i.test(head)) {
          finish(false, "tunnel_failed", `HTTP 代理拒绝 CONNECT (${head.split(/\r?\n/, 1)[0]})`);
          return;
        }
        startTls();
        return;
      }

      if (socksStage === "greeting") {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00) {
          socket.off("data", onHandshakeData);
          finish(false, "protocol_mismatch", "端口 SOCKS5 握手失败");
          return;
        }
        socksStage = "connect";
        rxChunks = buf.length > 2 ? [buf.subarray(2)] : [];
        const hostBuf = Buffer.from("accounts.google.com", "ascii");
        socket.write(
          Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf,
            Buffer.from([(443 >> 8) & 0xff, 443 & 0xff]),
          ]),
        );
        if (rxChunks.length) socket.emit("data", Buffer.alloc(0));
        return;
      }

      if (socksStage === "connect") {
        if (buf.length < 4) return;
        if (buf[0] === 0x05 && buf[1] === 0x00) {
          // Consume typical IPv4 SOCKS5 reply (10 bytes) or wait until header length arrived.
          const atyp = buf[3];
          const needed = atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 ? (buf.length >= 5 ? 7 + buf[4] : 999) : 10;
          if (buf.length < needed) return;
          socket.off("data", onHandshakeData);
          startTls();
        } else {
          socket.off("data", onHandshakeData);
          finish(false, "tunnel_failed", `SOCKS5 连接 Google 失败 (rep=${buf[1]})`);
        }
      }
    };

    socket.on("data", onHandshakeData);
    socket.once("error", (err) => {
      if (!tlsSocket) finish(false, "tunnel_failed", `代理连接异常 (${err?.code || err?.message || "error"})`);
    });
    socket.once("close", () => {
      if (!tlsSocket) finish(false, "tunnel_failed", "代理在 TLS 握手完成前关闭连接");
    });
  });
}

async function resolveWorkingYoutubeLoginProxy(loginSession, rawProxy) {
  const userOrStoredProxy = resolveYoutubeLoginProxy(rawProxy);
  let effectiveConfigured = userOrStoredProxy;
  let usingSystemProxy = false;

  if (!effectiveConfigured) {
    await loginSession.setProxy({ mode: "system" }).catch(() => {});
    const systemResolved = await loginSession.resolveProxy("https://accounts.google.com").catch(() => "DIRECT");
    const parsedSystem = parseSystemResolvedProxy(systemResolved);
    if (parsedSystem) {
      effectiveConfigured = parsedSystem;
      usingSystemProxy = true;
    } else if (!/^DIRECT$/i.test(String(systemResolved || "").trim())) {
      return {
        proxyConfig: { mode: "system" },
        label: `系统代理 (${systemResolved})`,
        diagnostic: "",
      };
    }
  }

  const candidates = buildYoutubeProxyCandidates(effectiveConfigured);
  const results = await Promise.all(candidates.map((candidate) => probeYoutubeProxyCandidate(candidate)));

  let selected = null;
  let selectedRelayPort = null;
  for (const item of results) {
    if (item.status !== "ok") continue;
    const verified = await verifyProxyTlsEndToEnd(item.candidate);
    if (verified.ok) {
      selected = item.candidate;
      selectedRelayPort = verified.relayPort;
      break;
    }
    item.status = verified.status || "tunnel_failed";
    item.detail = verified.detail || item.detail;
  }

  if (selected) {
    if (!userOrStoredProxy && selected.scheme === "http") {
      saveAutoDetectedYoutubeProxyToStore(`http://${selected.host}:${selected.port}`);
    }
    const relayPort =
      selectedRelayPort || (selected.scheme !== "https" ? await ensureYoutubeProxyRelay(selected.host, selected.port) : null);
    const proxyRules = relayPort
      ? selected.scheme === "socks5"
        ? `socks5://127.0.0.1:${relayPort}`
        : `http=127.0.0.1:${relayPort};https=127.0.0.1:${relayPort}`
      : selected.proxyRules;
    const tagNote = relayPort ? `${selected.label} · 本地防分流中继 :${relayPort}` : selected.label;
    writeLog("desktop.log", `youtube login proxy probe selected: ${tagNote}`);
    return {
      proxyConfig: { mode: "fixed_servers", proxyRules, proxyBypassRules: "<local>" },
      label: tagNote,
      diagnostic: "",
    };
  }

  let configuredHost = "";
  let configuredPort = 0;
  let configuredHostPort = "";
  let isRemoteHttps = false;
  if (effectiveConfigured) {
    try {
      const u = new URL(effectiveConfigured);
      configuredHost = u.hostname;
      configuredPort = Number(u.port || (u.protocol === "https:" ? 443 : 80));
      configuredHostPort = formatProxyHostPort(configuredHost, configuredPort);
      isRemoteHttps = u.protocol === "https:" && !isLoopbackHost(configuredHost);
    } catch {
      configuredHostPort = "";
    }
  }

  const diagnostic = summarizeProbeDiagnostics(results, configuredHostPort);
  writeLog("desktop.log", `youtube login proxy probe exhausted configured=${effectiveConfigured || "none"} :: ${diagnostic}`);

  if (configuredHostPort && !isRemoteHttps && !usingSystemProxy) {
    const relayPort = await ensureYoutubeProxyRelay(configuredHost, configuredPort);
    const targetHostPort = relayPort ? `127.0.0.1:${relayPort}` : configuredHostPort;
    return {
      proxyConfig: {
        mode: "fixed_servers",
        proxyRules: `http=${targetHostPort};https=${targetHostPort},socks5://${targetHostPort}`,
        proxyBypassRules: "<local>",
      },
      label: `http://${configuredHostPort} + socks5://${configuredHostPort}`,
      diagnostic,
    };
  }

  if (isRemoteHttps) {
    return {
      proxyConfig: { mode: "fixed_servers", proxyRules: `https://${configuredHostPort}`, proxyBypassRules: "<local>" },
      label: `https://${configuredHostPort}`,
      diagnostic,
    };
  }

  return {
    proxyConfig: { mode: "system" },
    label: "跟随系统代理 (system)",
    diagnostic,
  };
}

function buildYoutubeLoginCookie(cookies) {
  const domainCookies = cookies.filter((cookie) => {
    const domain = String(cookie.domain || "").replace(/^\./, "");
    if (!domain.endsWith("youtube.com")) return false;
    return YOUTUBE_COOKIE_KEYS.has(cookie.name) || cookie.name.startsWith("__Secure-");
  });
  const hasSession = domainCookies.some((cookie) => ["SID", "__Secure-1PSID", "__Secure-3PSID"].includes(cookie.name));
  const hasLoginMarker = domainCookies.some((cookie) =>
    ["SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID", "LOGIN_INFO"].includes(cookie.name),
  );
  if (!hasSession || !hasLoginMarker) return "";
  return domainCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function youtubeLoginLoadingHtml(proxyLabel) {
  const safeProxy = String(proxyLabel || "跟随系统代理 (system)").replace(/[<>&"]/g, "");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>正在连接 YouTube Music 登录…</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121218;color:#ecebf4;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}main{width:min(420px,88vw);padding:28px;border-radius:18px;border:1px solid #2b2b38;background:#1a1a24;text-align:center}.spinner{width:34px;height:34px;margin:0 auto 16px;border-radius:50%;border:3px solid #2e2e40;border-top-color:#8b73e3;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}h1{margin:0 0 8px;font-size:17px;font-weight:600}p{margin:8px 0 0;font-size:13px;line-height:1.6;color:#b4b1c5}code{display:inline-block;margin-top:6px;padding:3px 8px;border-radius:6px;background:#262634;color:#d6c7ff;font-size:12px}</style></head><body><main><div class="spinner"></div><h1>正在通过代理连接 Google 登录页…</h1><p>正在校验网络通道，请稍候片刻</p><p><code>${safeProxy}</code></p></main></body></html>`;
}

function youtubeLoginErrorHtml(detail, proxyLabel, diagText) {
  const safeDetail = String(detail || "页面加载超时或网络连接失败").replace(/[<>&"]/g, "");
  const safeProxy = String(proxyLabel || "跟随系统代理 (system)").replace(/[<>&"]/g, "");
  const safeDiag = String(diagText || "").replace(/[<>&"]/g, "");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>YouTube 登录</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121218;color:#ecebf4;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:480px;padding:28px;border-radius:18px;border:1px solid #2b2b38;background:#1a1a24}h1{margin:0 0 10px;font-size:18px}p{margin:8px 0;font-size:13px;line-height:1.65;color:#b4b1c5}code{padding:2px 6px;border-radius:6px;background:#262634;color:#d6c7ff}.err{color:#fca5a5}.diag{padding:10px 12px;border-radius:10px;background:#222230;color:#dedcf0;border:1px solid #303044}.actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}.primary{background:#8b73e3;color:#fff}.ghost{background:#272736;color:#ecebf4}</style></head><body><main><h1>YouTube 登录页加载失败</h1><p class="err">${safeDetail}</p><p>当前登录窗口代理：<code>${safeProxy}</code></p>${safeDiag ? `<p class="diag">${safeDiag}</p>` : ""}<p>如果使用 Clash / v2rayN 等代理工具，请在 Aria「设置 → YouTube Music」填写 HTTP 代理端口（如 <code>7890</code>、<code>10809</code>）或开启系统代理后重试。</p><div class="actions"><button class="primary" onclick="location.replace('${YOUTUBE_LOGIN_URL}')">重试 Google 登录</button><button class="ghost" onclick="location.replace('https://music.youtube.com/')">打开 YouTube Music</button></div></main></body></html>`;
}

ipcMain.handle("aria:youtube-login-window", async (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, message: "主窗口不可用" };
  // 内存分区（无 persist: 前缀）：每次窗口登录都是零 Cookie、零缓存的全新
  // Google 会话。旧持久化分区里 0.8.0 时代被拦截的风控残留会持续触发拦截，
  // 而登录 Cookie 只需在窗口存活期内经 session API 读取，无需跨启动保留。
  const loginSession = session.fromPartition("aria-youtube-login");
  const resolved = await resolveWorkingYoutubeLoginProxy(loginSession, payload?.proxy);
  await loginSession.setProxy(resolved.proxyConfig).catch(() => {});
  await loginSession.clearHostResolverCache?.().catch(() => {});
  await loginSession.closeAllConnections?.().catch(() => {});

  return new Promise((resolve) => {
    const attachParent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
    const loginWindow = new BrowserWindow({
      width: 1120,
      height: 780,
      center: true,
      show: true,
      ...(attachParent ? { parent: mainWindow } : {}),
      autoHideMenuBar: true,
      title: "登录 YouTube Music",
      backgroundColor: "#121218",
      webPreferences: {
        session: loginSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    loginWindow.show();
    loginWindow.focus();

    let settled = false;
    let timer = null;
    const popupWindows = new Set();
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      for (const popup of popupWindows) {
        try {
          if (!popup.isDestroyed()) popup.close();
        } catch {
          // Popup cleanup is best-effort.
        }
      }
      popupWindows.clear();
      if (!loginWindow.isDestroyed()) loginWindow.close();
      resolve(value);
    };
    const readLoginCookie = async () => {
      if (settled || loginWindow.isDestroyed()) return;
      const currentUrl = loginWindow.webContents.getURL() || "";
      let landedOnYoutube = false;
      try {
        const host = new URL(currentUrl).hostname.toLowerCase();
        landedOnYoutube = host === "music.youtube.com" || host === "www.youtube.com";
      } catch {
        landedOnYoutube = false;
      }
      if (!landedOnYoutube) return;
      const cookies = await loginSession.cookies.get({});
      const cookieHeader = buildYoutubeLoginCookie(cookies);
      if (!cookieHeader) return;
      writeLog("desktop.log", "youtube login window: credentials captured");
      finish({ ok: true, cookie: cookieHeader });
    };
    timer = setInterval(() => {
      if (!settled) readLoginCookie().catch(() => {});
    }, 1500);
    loginWindow.on("closed", () => finish({ ok: false, message: "登录窗口已关闭" }));
    // Google 登录链路（账号选择器 / passkey 确认 / 部分二次验证）偶尔需要真正
    // 弹出子窗口，一律拒绝会把流程卡死。放行 Google/YouTube 域的弹窗为同会话
    // 子窗口（共享登录 Cookie），其余弹窗仍按原逻辑在当前窗口内导航。
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return { action: "deny" };
      }
      const trustedPopup =
        host.endsWith(".google.com") ||
        host.endsWith(".googleusercontent.com") ||
        host.endsWith(".youtube.com");
      if (trustedPopup) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: "#121218",
            width: 1120,
            height: 780,
          },
        };
      }
      if (/^https?:\/\//i.test(url)) loginWindow.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    loginWindow.webContents.on("did-create-window", (childWindow) => {
      popupWindows.add(childWindow);
      childWindow.once("closed", () => popupWindows.delete(childWindow));
    });
    loginWindow.webContents.on("did-finish-load", () => {
      readLoginCookie().catch(() => {});
    });
    loginWindow.webContents.on("did-navigate", () => {
      readLoginCookie().catch(() => {});
    });
    loginWindow.webContents.on("did-fail-load", (_ev, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (settled || loginWindow.isDestroyed() || !isMainFrame) return;
      if (errorCode === -3 || String(validatedURL || "").startsWith("data:")) return;
      writeLog("desktop.log", `youtube login window: did-fail-load ${errorCode} ${errorDescription} url=${validatedURL}`);
      const html = youtubeLoginErrorHtml(errorDescription || `错误代码 ${errorCode}`, resolved.label, resolved.diagnostic);
      loginWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
    });
    const splashHtml = youtubeLoginLoadingHtml(resolved.label);
    loginWindow
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`)
      .catch(() => {})
      .finally(() => {
        if (settled || loginWindow.isDestroyed()) return;
        loginWindow.loadURL(YOUTUBE_LOGIN_URL).catch((error) => {
          if (settled || loginWindow.isDestroyed()) return;
          if (error && (error.errno === -3 || String(error.code) === "ERR_ABORTED")) return;
          writeLog("desktop.log", `youtube login window: initial load failed: ${error?.message || error}`);
        });
      });
  });
});

let youtubeStagePreparedKey = "";
let youtubeStageProxyLabel = "";
let youtubeStageAdBlockerInstalled = false;

function readStoredYoutubeStageConfig() {
  try {
    const storeFile = path.join(app.getPath("userData"), "data", "store.json");
    if (!fs.existsSync(storeFile)) return { youtubeProxy: "", youtubeCookie: "" };
    const parsed = JSON.parse(fs.readFileSync(storeFile, "utf8")) || {};
    return {
      youtubeProxy: typeof parsed.youtubeProxy === "string" ? parsed.youtubeProxy : "",
      youtubeCookie: typeof parsed.youtubeCookie === "string" ? parsed.youtubeCookie : "",
    };
  } catch {
    return { youtubeProxy: "", youtubeCookie: "" };
  }
}

ipcMain.handle("aria:youtube-stage:prepare", async (_event, payload) => {
  const stageSession = session.fromPartition(YOUTUBE_STAGE_PARTITION);
  if (!youtubeStageAdBlockerInstalled) {
    youtubeStageAdBlockerInstalled = true;
    stageSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isBlockedYoutubeStageAdUrl(details.url) });
    });
  }
  const stored = readStoredYoutubeStageConfig();
  const rawProxy = typeof payload?.proxy === "string" && payload.proxy.trim() ? payload.proxy : stored.youtubeProxy;
  const storedCookie = stored.youtubeCookie.trim();
  const cookieHash = crypto.createHash("sha256").update(storedCookie).digest("hex");
  const normalizedProxy = normalizeYoutubeProxyUrl(rawProxy) || "auto";
  const key = `${normalizedProxy}|${cookieHash}`;

  if (!payload?.force && key === youtubeStagePreparedKey) {
    return {
      ok: true,
      partition: YOUTUBE_STAGE_PARTITION,
      proxyLabel: youtubeStageProxyLabel,
      hasCookie: Boolean(storedCookie),
    };
  }

  const resolved = await resolveWorkingYoutubeLoginProxy(stageSession, rawProxy);
  await stageSession.setProxy(resolved.proxyConfig).catch(() => {});
  await stageSession.clearHostResolverCache?.().catch(() => {});
  await stageSession.closeAllConnections?.().catch(() => {});

  try {
    const existing = await stageSession.cookies.get({ domain: "youtube.com" });
    await Promise.all(
      existing.map((cookie) => {
        const host = String(cookie.domain || "www.youtube.com").replace(/^\./, "");
        const cookieUrl = `https://${host}${cookie.path || "/"}`;
        return stageSession.cookies.remove(cookieUrl, cookie.name).catch(() => {});
      }),
    );
  } catch {
    // Best-effort cookie cleanup before re-seeding.
  }

  const entries = parseYoutubeCookieHeader(storedCookie);
  await Promise.all(entries.map((entry) => stageSession.cookies.set(entry).catch(() => {})));

  youtubeStagePreparedKey = key;
  youtubeStageProxyLabel = resolved.label;
  writeLog("desktop.log", `youtube stage prepared: proxy=${resolved.label} cookie=${Boolean(storedCookie)}`);
  return {
    ok: true,
    partition: YOUTUBE_STAGE_PARTITION,
    proxyLabel: resolved.label,
    hasCookie: Boolean(storedCookie),
  };
});

ipcMain.handle("aria:get-remote-access", () => {
  const config = ensureRemoteAccessToken();
  return {
    enabled: config.enabled,
    token: config.token,
    port: apiPort,
    addresses: lanAddresses(),
  };
});

ipcMain.handle("aria:set-remote-access", (_event, payload) => {
  const config = ensureRemoteAccessToken();
  config.enabled = Boolean(payload?.enabled);
  writeRemoteAccessFile(config);
  writeLog("desktop.log", `remote access ${config.enabled ? "enabled" : "disabled"}, restarting backend`);
  restartBackendForRemoteAccess();
  return config;
});

ipcMain.handle("aria:update-media-session", (_event, payload) => {
  if (!mediaSessionReady) return false;
  const artwork = typeof payload?.artwork === "string" && payload.artwork.length < 1_400_000 &&
    payload.artwork.startsWith("data:image/png;base64,")
    ? Buffer.from(payload.artwork.slice("data:image/png;base64,".length), "base64") : Buffer.alloc(0);
  const state = {
    title: typeof payload?.title === "string" ? payload.title.slice(0, 512) : "",
    artist: typeof payload?.artist === "string" ? payload.artist.slice(0, 512) : "",
    album: typeof payload?.album === "string" ? payload.album.slice(0, 512) : "",
    active: Boolean(payload?.active),
    playing: Boolean(payload?.playing),
    canPrevious: Boolean(payload?.canPrevious),
    canNext: Boolean(payload?.canNext),
  };
  if (process.platform === "darwin") {
    return Boolean(nowPlayingAddon?.updateMediaSession?.(state, artwork));
  }
  return iconicThumbAddon.updateMediaSession(state, artwork);
});

ipcMain.handle("aria:update-taskbar-playback", (_event, payload) => {
  taskbarPlayback = {
    title: typeof payload?.title === "string" ? payload.title.slice(0, 180) : "",
    artist: typeof payload?.artist === "string" ? payload.artist.slice(0, 120) : "",
    playing: Boolean(payload?.playing),
  };
  syncTaskbarPlayback();
  return true;
});

ipcMain.handle("aria:configure-global-shortcuts", (_event, payload) => {
  return syncGlobalShortcuts(payload || {});
});

ipcMain.handle("aria:copy-image", async (_event, payload) => {
  try {
    const dataUrl = typeof payload?.dataUrl === "string" && payload.dataUrl.startsWith("data:")
      ? payload.dataUrl
      : null;
    const url = typeof payload?.url === "string" && payload.url ? payload.url : null;
    let image = null;

    if (dataUrl) {
      image = nativeImage.createFromDataURL(dataUrl);
    } else if (url) {
      const response = await fetch(url);
      if (!response.ok) return false;
      const buffer = Buffer.from(await response.arrayBuffer());
      image = nativeImage.createFromBuffer(buffer);
    }

    if (!image || image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  } catch (error) {
    writeLog("desktop.log", `copy image failed: ${error?.stack || error}`);
    return false;
  }
});

ipcMain.handle("aria:log", (_event, payload) => {
  try {
    logger.logRendererPayload(payload);
    return true;
  } catch (error) {
    writeLog("renderer.log", "renderer log bridge failed", { error: serializeError(error) });
    return false;
  }
});

ipcMain.handle("aria:native-audio:supported", () => {
  return getNativeAudioEngine().isSupported();
});

ipcMain.handle("aria:native-audio:devices", async () => {
  return getNativeAudioEngine().listDevices();
});

ipcMain.handle("aria:native-audio:state", () => {
  return getNativeAudioEngine().snapshot();
});

ipcMain.handle("aria:native-audio:load", async (_event, payload) => {
  return getNativeAudioEngine().load(payload);
});

ipcMain.handle("aria:native-audio:load-next", async (_event, payload) => {
  return getNativeAudioEngine().loadNext(payload || {});
});

ipcMain.handle("aria:set-thumbnail-clip", (_event, rect) => {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return false;
  const valid =
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 8 &&
    rect.height >= 8;
  taskbarClipRect = valid
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : null;
  applyTaskbarClip();
  return true;
});

ipcMain.handle("aria:set-iconic-thumbnail", (_event, pixels, width, height) => {
  if (!nativeIconicThumbnailEnabled || !iconicThumbAddon?.available) return false;
  try {
    const buffer = Buffer.from(pixels);
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w > 0 && h > 0) lastIconicBitmap = { buffer, width: w, height: h };
    let ok = Boolean(iconicThumbAddon.setBitmap(buffer, w, h));
    if (!ok && mainWindow && !mainWindow.isDestroyed()) {
      try {
        iconicThumbAddon.attach(mainWindow.getNativeWindowHandle());
        ok = Boolean(iconicThumbAddon.setBitmap(buffer, w, h));
      } catch {
        ok = false;
      }
    }
    writeLog("desktop.log", `iconic thumbnail setBitmap: ${w}x${h} ok=${ok}`);
    return ok;
  } catch (error) {
    writeLog("desktop.log", `iconic thumbnail setBitmap failed: ${error?.message || error}`);
    return false;
  }
});

ipcMain.handle("aria:set-iconic-live-preview", (_event, pixels, width, height) => {
  if (!nativeIconicThumbnailEnabled || !iconicThumbAddon?.available || typeof iconicThumbAddon.setLiveBitmap !== "function") return false;
  try {
    const ok = Boolean(iconicThumbAddon.setLiveBitmap(Buffer.from(pixels), Number(width) || 0, Number(height) || 0));
    writeLog("desktop.log", `iconic live preview setBitmap: ${Number(width)}x${Number(height)} ok=${ok}`);
    return ok;
  } catch (error) {
    writeLog("desktop.log", `iconic live preview setBitmap failed: ${error?.message || error}`);
    return false;
  }
});

ipcMain.handle("aria:iconic-stats", () => {
  if (!nativeIconicThumbnailEnabled || !iconicThumbAddon?.available) return null;
  try {
    return iconicThumbAddon.getStats();
  } catch {
    return null;
  }
});

ipcMain.handle("aria:clear-iconic-thumbnail", () => {
  lastIconicBitmap = null;
  if (!nativeIconicThumbnailEnabled || !iconicThumbAddon?.available) return false;
  try {
    iconicThumbAddon.clearBitmap();
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("aria:native-audio:pause", async (_event, paused) => {
  return getNativeAudioEngine().setPaused(Boolean(paused));
});

ipcMain.handle("aria:native-audio:seek", async (_event, position) => {
  return getNativeAudioEngine().seek(Number(position) || 0);
});

ipcMain.handle("aria:native-audio:volume", async (_event, volume) => {
  return getNativeAudioEngine().setVolume(Number(volume) || 0);
});

ipcMain.handle("aria:native-audio:speed", async (_event, speed) => {
  return getNativeAudioEngine().setSpeed(Number(speed) || 1);
});

ipcMain.handle("aria:native-audio:configure", async (_event, payload) => {
  return getNativeAudioEngine().applyOutputSettings(payload || {});
});

ipcMain.handle("aria:native-audio:stop", async () => {
  return getNativeAudioEngine().stop();
});

ipcMain.handle("aria:native-audio:recover", async (_event, reason) => {
  return getNativeAudioEngine().recoverOutput(typeof reason === "string" && reason ? reason : "manual");
});

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  attachPowerRecoveryHandlers();
  if (!app.isPackaged && process.platform === "darwin" && app.dock?.setIcon) {
    try {
      const dockIcon = nativeImage.createFromPath(resolveBuildAsset("icon-1024.png"));
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    } catch {
      // Optional dev Dock icon.
    }
  }
  // Registry/shell maintenance is not part of the first paint path.
  setImmediate(ensureWindowsTaskbarPreviewPolicy);
  await configureDirectNetwork();
  setupUpdates({
    writeLog,
    resolveLocalProxy: () => resolveYoutubeLoginProxy(""),
    onBeforeInstall: () => {
      isQuitting = true;
      stopYoutubeProxyRelay();
      nativeAudioEngine?.teardown?.();
      if (backendProcess && !backendProcess.killed) {
        try {
          backendProcess.kill();
        } catch {
          // Ignore child process teardown errors before installer takes over.
        }
      }
    },
  });
  await createWindow();
  syncGlobalShortcuts(globalShortcutConfig);
});

app.on("window-all-closed", () => {
  // macOS apps stay resident in the dock; the tray/window pattern does the rest.
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  stopYoutubeProxyRelay();
  nativeAudioEngine?.teardown?.();
  nowPlayingAddon?.detach?.();
  iconicThumbAddon?.detachMediaSession?.();
  iconicThumbAddon?.detach?.();
});
