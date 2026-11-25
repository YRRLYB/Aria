let electron = null;
try {
  electron = require("electron");
} catch {
  // Pure helpers remain importable outside Electron during Vitest unit tests.
}

const UPDATER_SESSION_PARTITION = "electron-updater";
const UPDATER_PROBE_URL = "https://github.com/YRRLYB/Aria/releases/latest/download/latest.yml";
const RELEASES_API_URL = "https://api.github.com/repos/YRRLYB/Aria/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/YRRLYB/Aria/releases/latest";

// Update state is intentionally small and serializable: the renderer only
// needs a status line, version, progress and an error message.
let state = {
  supported: false,
  status: "idle",
  currentVersion: electron?.app?.getVersion?.() ?? "0.0.0",
  availableVersion: null,
  releaseName: null,
  releaseNotes: null,
  percent: null,
  bytesPerSecond: null,
  error: null,
  checkedAt: null,
  reason: null,
  manualDownloadOnly: false,
};

let writeLog = () => {};
let autoUpdater = null;
let checking = null;
let autoCheckTimer = null;
let activeRoute = null;
let resolveLocalProxy = () => "";
let onBeforeInstall = () => {};
let suppressUpdaterErrorEvent = false;

function toElectronProxyRules(rawProxyUrl) {
  const trimmed = typeof rawProxyUrl === "string" ? rawProxyUrl.trim() : "";
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const hostPort = `${parsed.hostname}:${parsed.port}`;
    if (!parsed.hostname || !parsed.port) return "";
    if (parsed.protocol === "socks:" || parsed.protocol === "socks4:" || parsed.protocol === "socks5:") {
      return `${parsed.protocol}//${hostPort}`;
    }
    return `http=${hostPort};https=${hostPort}`;
  } catch {
    return "";
  }
}

function buildUpdaterProxyCandidates(localProxyUrl) {
  const routes = [
    { id: "system", label: "system proxy", config: { mode: "system" }, proxyUrl: "" },
  ];
  const rules = toElectronProxyRules(localProxyUrl);
  if (rules) {
    routes.push({
      id: "local-proxy",
      label: `local proxy (${localProxyUrl})`,
      config: { mode: "fixed_servers", proxyRules: rules },
      proxyUrl: String(localProxyUrl).trim(),
    });
  }
  routes.push({ id: "direct", label: "direct", config: { mode: "direct" }, proxyUrl: "" });
  return routes;
}

function isRetriableNetworkError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|ERR_PROXY_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EPIPE|EAI_AGAIN|检查更新超时|timeout|timed out/i.test(raw);
}

function compareSemver(a, b) {
  const parse = (input) => {
    const cleaned = String(input || "").trim().replace(/^v/i, "");
    const [core, pre = ""] = cleaned.split("-", 2);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { major: nums[0] || 0, minor: nums[1] || 0, patch: nums[2] || 0, pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.pre && right.pre) return 1;
  if (left.pre && !right.pre) return -1;
  if (left.pre !== right.pre) return left.pre > right.pre ? 1 : -1;
  return 0;
}

function getUpdaterSession() {
  return electron.session.fromPartition(UPDATER_SESSION_PARTITION, { cache: false });
}

async function probeUpdaterNetwork(updaterSession, probeUrl = UPDATER_PROBE_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await updaterSession.fetch(probeUrl, {
      headers: { "User-Agent": "Aria-Update", Accept: "*/*" },
      signal: controller.signal,
    });
    const ok = response.status >= 200 && response.status < 500;
    try {
      await response.body?.cancel();
    } catch {
      // The probe only needs the status line; a broken body is fine.
    }
    return ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The renderer session runs direct (music APIs are domestic), but GitHub and
 * its release-asset CDN may only be reachable through the system proxy or
 * the user's configured local proxy. Probe the ordered candidate routes and
 * keep whichever route reaches the actual release endpoint.
 */
async function ensureUpdaterNetwork(options = {}) {
  const { force = false, excludeRouteIds = [], probeUrl = UPDATER_PROBE_URL } = options;
  const updaterSession = getUpdaterSession();
  let configuredLocalProxy = "";
  try {
    configuredLocalProxy = resolveLocalProxy?.() || "";
  } catch {
    configuredLocalProxy = "";
  }
  const candidates = buildUpdaterProxyCandidates(configuredLocalProxy);
  if (
    !force &&
    activeRoute &&
    !excludeRouteIds.includes(activeRoute.id) &&
    candidates.some((c) => c.id === activeRoute.id && c.proxyUrl === activeRoute.proxyUrl)
  ) {
    return activeRoute;
  }

  try {
    for (const route of candidates) {
      if (excludeRouteIds.includes(route.id)) continue;
      await updaterSession.setProxy(route.config);
      if (await probeUpdaterNetwork(updaterSession, probeUrl)) {
        activeRoute = route;
        writeLog("update.log", `updater network: ${route.label}`);
        return activeRoute;
      }
      writeLog("update.log", `updater network probe failed: ${route.label}`);
    }
    writeLog("update.log", "updater network: no candidate route reached GitHub");
    await updaterSession.setProxy({ mode: "system" });
    activeRoute = null;
    return null;
  } catch (error) {
    writeLog("update.log", `updater network setup failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function broadcast() {
  if (!electron?.BrowserWindow) return;
  for (const window of electron.BrowserWindow.getAllWindows()) {
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
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/ERR_UPDATER_INVALID_SIGNATURE|is not signed|signature/i.test(raw)) {
    return "安装包签名校验未通过，已停止自动安装，请前往发布页手动下载核验。";
  }
  if (/latest\.yml|Cannot find latest\.yml|\b404\b/i.test(raw)) {
    return "当前发布还没有生成更新清单（latest.yml），请稍后再试或打开发布页手动下载。";
  }
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_IO_SUSPENDED/i.test(raw)) {
    return "当前网络已断开或设备刚从休眠恢复，请联网后重试检查更新。";
  }
  if (/ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|timeout|timed out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(raw)) {
    return "无法连接 GitHub 更新服务器（连接被重置或超时），请检查系统代理或在「播放源 → YouTube」配置本地代理后重试，也可直接打开发布页手动下载。";
  }
  return raw.slice(0, 600);
}

function setupUpdates(options = {}) {
  const { app, ipcMain, shell } = electron;
  writeLog = options.writeLog ?? (() => {});
  resolveLocalProxy = typeof options.resolveLocalProxy === "function" ? options.resolveLocalProxy : (() => "");
  onBeforeInstall = typeof options.onBeforeInstall === "function" ? options.onBeforeInstall : (() => {});
  const macAutoUpdate = process.env.ARIA_MAC_AUTO_UPDATE === "1";
  const checkOnlyMode = process.platform === "darwin" && !macAutoUpdate;
  const supported = process.platform === "win32" || process.platform === "darwin";
  update({
    supported,
    manualDownloadOnly: checkOnlyMode,
    currentVersion: app.getVersion(),
    status: supported ? "idle" : "unsupported",
    reason: supported
      ? null
      : "当前平台不支持自动更新。",
  });

  ipcMain.handle("aria:update:state", () => state);
  ipcMain.handle("aria:update:check", async () => {
    await check(true);
    return state;
  });
  ipcMain.handle("aria:update:open-releases", async () => {
    await shell.openExternal(RELEASES_PAGE_URL);
    return true;
  });
  ipcMain.handle("aria:update:download", async () => {
    if (!supported || !autoUpdater || checkOnlyMode) return state;
    if (state.status !== "available" && !(state.status === "error" && state.availableVersion)) {
      return state;
    }
    const runDownloadAttempt = async (excludedIds = []) => {
      await ensureUpdaterNetwork({ force: excludedIds.length > 0, excludeRouteIds: excludedIds });
      update({ status: "downloading", percent: 0, bytesPerSecond: null, error: null });
      return autoUpdater.downloadUpdate();
    };
    suppressUpdaterErrorEvent = true;
    try {
      await runDownloadAttempt([]);
    } catch (firstError) {
      const failedRouteId = activeRoute?.id ?? null;
      if (failedRouteId && isRetriableNetworkError(firstError)) {
        writeLog("update.log", `download failed via ${failedRouteId}, retrying fallback route`);
        activeRoute = null;
        try {
          suppressUpdaterErrorEvent = false;
          await runDownloadAttempt([failedRouteId]);
          return state;
        } catch (retryError) {
          update({ status: "error", error: friendlyUpdateError(retryError), checkedAt: Date.now() });
          return state;
        }
      }
      update({ status: "error", error: friendlyUpdateError(firstError), checkedAt: Date.now() });
    } finally {
      suppressUpdaterErrorEvent = false;
    }
    return state;
  });
  ipcMain.handle("aria:update:install", () => {
    if (!supported || !autoUpdater || checkOnlyMode || state.status !== "downloaded") return false;
    try {
      onBeforeInstall();
    } catch {
      // Teardown helper is best-effort before NSIS replacement.
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  if (!supported || !app.isPackaged) {
    if (!supported) return state;
    update({ supported: false, status: "unsupported", reason: "开发版不执行自动更新，请使用打包后的安装包测试。" });
    return state;
  }

  if (!checkOnlyMode) {
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

    try {
      autoUpdater.on("before-quit-for-update", () => {
        try { onBeforeInstall(); } catch {}
      });
    } catch {
      // Optional hook depending on platform updater implementation.
    }

    autoUpdater.on("checking-for-update", () => update({ status: "checking", error: null }));
    autoUpdater.on("update-available", (info) => update({
      status: "available",
      availableVersion: info?.version ?? null,
      releaseName: info?.releaseName ?? null,
      releaseNotes: releaseNotesText(info),
      checkedAt: Date.now(),
      error: null,
      manualDownloadOnly: false,
    }));
    autoUpdater.on("update-not-available", (info) => update({
      status: "up-to-date",
      availableVersion: info?.version ?? state.currentVersion,
      checkedAt: Date.now(),
      error: null,
      manualDownloadOnly: false,
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
    autoUpdater.on("error", (error) => {
      if (suppressUpdaterErrorEvent) return;
      update({
        status: "error",
        error: friendlyUpdateError(error),
        checkedAt: Date.now(),
      });
    });
  }

  async function checkGithubReleaseOnly(manual) {
    const updaterSession = getUpdaterSession();
    await ensureUpdaterNetwork({ force: manual, probeUrl: RELEASES_API_URL });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await updaterSession.fetch(RELEASES_API_URL, {
        headers: { "User-Agent": "Aria-Update", Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HttpError: ${res.status}`);
      }
      const data = await res.json();
      const latestVersion = String(data?.tag_name || "").replace(/^v/i, "").trim();
      if (!latestVersion) throw new Error("未在 Release 中读取到版本号");
      const hasNewer = compareSemver(latestVersion, state.currentVersion) > 0;
      if (hasNewer) {
        update({
          status: "available",
          availableVersion: latestVersion,
          releaseName: typeof data?.name === "string" ? data.name : null,
          releaseNotes: typeof data?.body === "string" ? data.body.slice(0, 12_000) : null,
          manualDownloadOnly: true,
          checkedAt: Date.now(),
          error: null,
        });
      } else {
        update({
          status: "up-to-date",
          availableVersion: latestVersion,
          manualDownloadOnly: true,
          checkedAt: Date.now(),
          error: null,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function check(manual = false) {
    if (!supported || (!autoUpdater && !checkOnlyMode)) return state;
    if (checking) return checking;
    const forceProbe = manual && (state.status === "error" || !activeRoute);
    update({ status: "checking", error: null });
    if (manual) writeLog("update.log", "manual update check");
    checking = (async () => {
      try {
        if (checkOnlyMode) {
          await checkGithubReleaseOnly(manual);
          return state;
        }
        const runCheckOnce = async (force, excludeRouteIds) => {
          await ensureUpdaterNetwork({ force, excludeRouteIds });
          let timer = null;
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("检查更新超时，请稍后重试。")), 45_000);
            timer.unref?.();
          });
          try {
            await Promise.race([autoUpdater.checkForUpdates(), timeout]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        suppressUpdaterErrorEvent = true;
        try {
          await runCheckOnce(forceProbe, []);
          return state;
        } catch (firstError) {
          const failedRouteId = activeRoute?.id ?? null;
          if (failedRouteId && isRetriableNetworkError(firstError)) {
            writeLog("update.log", `check failed via ${failedRouteId}, trying next route`);
            activeRoute = null;
            const fallback = await ensureUpdaterNetwork({ force: true, excludeRouteIds: [failedRouteId] });
            if (fallback) {
              suppressUpdaterErrorEvent = false;
              await runCheckOnce(false, [failedRouteId]);
              return state;
            }
          }
          throw firstError;
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error ?? "");
        if (!manual && /ERR_NETWORK_IO_SUSPENDED|ERR_INTERNET_DISCONNECTED/i.test(raw)) {
          writeLog("update.log", `background update check skipped (${raw})`);
          update({ status: state.availableVersion ? "available" : "idle", error: null });
          return state;
        }
        update({ status: "error", error: friendlyUpdateError(error), checkedAt: Date.now() });
        return state;
      } finally {
        suppressUpdaterErrorEvent = false;
        checking = null;
      }
    })();
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

module.exports = {
  setupUpdates,
  getUpdateState: () => state,
  friendlyUpdateError,
  buildUpdaterProxyCandidates,
  compareSemver,
  isRetriableNetworkError,
  toElectronProxyRules,
};
