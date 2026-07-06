const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { MpvAudioEngine } = require("./mpvEngine.cjs");

try {
  const earlyLogDir = path.join(app.getPath("appData"), "aria", "logs");
  fs.mkdirSync(earlyLogDir, { recursive: true });
  fs.appendFileSync(path.join(earlyLogDir, "desktop.log"), `[${new Date().toISOString()}] main loaded\n`, "utf8");
} catch {
  // Ignore early logging failures.
}

const apiPort = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);
const apiBase = `http://127.0.0.1:${apiPort}`;

let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let backgroundEnabled = true;
let rendererRecoveries = 0;
let nativeAudioEngine = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.setName("Aria");
app.setAppUserModelId("com.yrrlyb.aria");
Menu.setApplicationMenu(null);

function logDir() {
  const baseDir = app.isReady() ? app.getPath("userData") : path.join(app.getPath("appData"), "Aria");
  return path.join(baseDir, "logs");
}

function writeLog(fileName, message) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, fileName), `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Logging should never become a reason for the app to exit.
  }
}

function getNativeAudioEngine() {
  if (!nativeAudioEngine) {
    nativeAudioEngine = new MpvAudioEngine({
      app,
      writeLog,
      sendEvent: (payload) => {
        mainWindow?.webContents.send("aria:native-audio-event", payload);
      },
    });
  }
  return nativeAudioEngine;
}

process.on("uncaughtException", (error) => {
  writeLog("desktop.log", `uncaughtException: ${error?.stack || error}`);
});

process.on("unhandledRejection", (reason) => {
  writeLog("desktop.log", `unhandledRejection: ${reason?.stack || reason}`);
});

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

function resolveIcon() {
  return path.join(__dirname, "..", "build", "icon.ico");
}

function trayIcon() {
  const iconPath = resolveIcon();
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="#171717"/>
      <path d="M9 23.5 15.2 7.8h3.4l6.4 15.7h-3.7l-1.2-3.1h-6.6l-1.1 3.1H9Zm5.6-6h4.4l-2.2-5.9-2.2 5.9Z" fill="#fff"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`).resize({ width: 16, height: 16 });
}

async function apiOnline(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/api/health`);
      if (response.ok) return true;
    } catch {
      // Wait for the child process to finish booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function urlOnline(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startBackend() {
  if (await apiOnline(500)) return;

  const serverEntry = resolveServerEntry();
  writeLog("desktop.log", `starting backend: ${serverEntry}`);
  backendProcess = spawn(process.execPath, [serverEntry], {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ARIA_API_PORT: String(apiPort),
      MUSICBOX_API_PORT: String(apiPort),
      ARIA_DATA_DIR: path.join(app.getPath("userData"), "data"),
    },
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
  mainWindow.webContents.send("aria:window-visibility", true);
}

function sendWindowVisibility(visible) {
  mainWindow?.webContents.send("aria:window-visibility", Boolean(visible));
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("Aria");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Aria", click: showWindow },
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
  await startBackend();
  createTray();

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1160,
    minHeight: 720,
    show: false,
    frame: false,
    title: "Aria",
    icon: resolveIcon(),
    autoHideMenuBar: true,
    backgroundColor: "#f5f6f8",
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => {
    showWindow();
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

  mainWindow.on("close", (event) => {
    if (!isQuitting && backgroundEnabled) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("hide", () => sendWindowVisibility(false));
  mainWindow.on("minimize", () => sendWindowVisibility(false));
  mainWindow.on("show", () => sendWindowVisibility(true));
  mainWindow.on("restore", () => sendWindowVisibility(true));

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

ipcMain.handle("aria:native-audio:pause", async (_event, paused) => {
  return getNativeAudioEngine().setPaused(Boolean(paused));
});

ipcMain.handle("aria:native-audio:seek", async (_event, position) => {
  return getNativeAudioEngine().seek(Number(position) || 0);
});

ipcMain.handle("aria:native-audio:volume", async (_event, volume) => {
  return getNativeAudioEngine().setVolume(Number(volume) || 0);
});

ipcMain.handle("aria:native-audio:configure", async (_event, payload) => {
  return getNativeAudioEngine().applyOutputSettings(payload || {});
});

ipcMain.handle("aria:native-audio:stop", async () => {
  return getNativeAudioEngine().stop();
});

app.on("second-instance", showWindow);

app.whenReady().then(createWindow);

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
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  nativeAudioEngine?.teardown?.();
});
