const { app, BrowserWindow, ipcMain } = require("electron");

// Update state is intentionally small and serializable: the renderer only
// needs a status line, version, progress and an error message.
let state = {
  supported: false,
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseName: null,
  releaseNotes: null,
  percent: null,
  bytesPerSecond: null,
  error: null,
  checkedAt: null,
  reason: null,
};

let writeLog = () => {};
let autoUpdater = null;
let checking = null;
let autoCheckTimer = null;

function broadcast() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("aria:update-state", state);
  }
}

function update(patch) {
  state = { ...state, ...patch };
  broadcast();
}

function releaseNotesText(info) {
  const notes = info?.releaseNotes;
  if (typeof notes === "string") return notes.slice(0, 12_000);
  if (Array.isArray(notes)) {
    return notes.map((item) => typeof item?.note === "string" ? item.note : "").filter(Boolean).join("\n").slice(0, 12_000);
  }
  return null;
}

function friendlyUpdateError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/latest\.yml/i.test(raw) || /404/.test(raw)) {
    return "当前发布还没有生成更新清单（latest.yml），请稍后再试。";
  }
  if (/timeout|timed out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network/i.test(raw)) {
    return "检查更新超时，请检查网络后重试。";
  }
  return raw.slice(0, 600);
}

function setupUpdates(options = {}) {
  writeLog = options.writeLog ?? (() => {});
  const macAutoUpdate = process.env.ARIA_MAC_AUTO_UPDATE === "1";
  const supported = process.platform === "win32" || (process.platform === "darwin" && macAutoUpdate);
  update({
    supported,
    currentVersion: app.getVersion(),
    status: supported ? "idle" : "unsupported",
    reason: supported
      ? null
      : process.platform === "darwin"
        ? "macOS 自动更新需要签名/公证版本；当前请手动下载新版 DMG。"
        : "当前平台不支持自动更新。",
  });

  ipcMain.handle("aria:update:state", () => state);
  ipcMain.handle("aria:update:check", async () => {
    await check(true);
    return state;
  });
  ipcMain.handle("aria:update:download", async () => {
    if (!supported || !autoUpdater) return state;
    if (state.status !== "available") return state;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      update({ status: "error", error: friendlyUpdateError(error) });
    }
    return state;
  });
  ipcMain.handle("aria:update:install", () => {
    if (!supported || !autoUpdater || state.status !== "downloaded") return false;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  if (!supported || !app.isPackaged) {
    if (!supported) return state;
    update({ supported: false, status: "unsupported", reason: "开发版不执行自动更新，请使用打包后的安装包测试。" });
    return state;
  }

  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (error) {
    update({ status: "error", error: `更新模块不可用：${friendlyUpdateError(error)}` });
    return state;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (message) => writeLog("update.log", `info ${message}`),
    warn: (message) => writeLog("update.log", `warn ${message}`),
    error: (message) => writeLog("update.log", `error ${message}`),
    debug: (message) => writeLog("update.log", `debug ${message}`),
  };

  autoUpdater.on("checking-for-update", () => update({ status: "checking", error: null }));
  autoUpdater.on("update-available", (info) => update({
    status: "available",
    availableVersion: info?.version ?? null,
    releaseName: info?.releaseName ?? null,
    releaseNotes: releaseNotesText(info),
    checkedAt: Date.now(),
    error: null,
  }));
  autoUpdater.on("update-not-available", (info) => update({
    status: "up-to-date",
    availableVersion: info?.version ?? state.currentVersion,
    checkedAt: Date.now(),
    error: null,
  }));
  autoUpdater.on("download-progress", (progress) => update({
    status: "downloading",
    percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
    bytesPerSecond: Number(progress?.bytesPerSecond) || null,
  }));
  autoUpdater.on("update-downloaded", (info) => update({
    status: "downloaded",
    availableVersion: info?.version ?? state.availableVersion,
    percent: 100,
    error: null,
  }));
  autoUpdater.on("error", (error) => update({
    status: "error",
    error: friendlyUpdateError(error),
    checkedAt: Date.now(),
  }));

  async function check(manual = false) {
    if (!supported || !autoUpdater) return state;
    if (checking) return checking;
    update({ status: "checking", error: null });
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("检查更新超时，请稍后重试。")), 20_000);
      timer.unref?.();
    });
    checking = Promise.race([autoUpdater.checkForUpdates(), timeout])
      .then(() => state)
      .catch((error) => {
        update({ status: "error", error: friendlyUpdateError(error), checkedAt: Date.now() });
        return state;
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        checking = null;
      });
    if (manual) writeLog("update.log", "manual update check");
    return checking;
  }

  if (process.env.ARIA_DISABLE_AUTO_UPDATE !== "1") {
    autoCheckTimer = setTimeout(() => { void check(false); }, 15_000);
    autoCheckTimer.unref?.();
    const interval = setInterval(() => { void check(false); }, 6 * 60 * 60_000);
    interval.unref?.();
  }
  return state;
}

module.exports = { setupUpdates, getUpdateState: () => state };
