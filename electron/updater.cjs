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
let checkNeedsManualSurface = false;
let startupRetryScheduled = false;
let autoCheckTimer = null;
let activeRoute = null;
let resolveLocalProxy = () => "";
let onBeforeInstall = () => {};
let suppressUpdaterErrorEvent = false;
let teardownHooked = false;

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

function readEnvProxyUrl() {
  return String(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      "",
  ).trim();
}

function buildUpdaterProxyCandidates(localProxyUrl, envProxyUrl = "") {
  const routes = [
    { id: "system", label: "system proxy", config: { mode: "system" }, proxyUrl: "" },
  ];
  const seenUrls = new Set();
  const addFixedProxy = (id, labelPrefix, rawUrl) => {
    const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
    const rules = toElectronProxyRules(trimmed);
    if (!rules || seenUrls.has(rules)) return;
    seenUrls.add(rules);
    routes.push({
      id,
      label: `${labelPrefix} (${trimmed})`,
      config: { mode: "fixed_servers", proxyRules: rules },
      proxyUrl: trimmed,
    });
  };
  addFixedProxy("local-proxy", "local proxy", localProxyUrl);
  addFixedProxy("env-proxy", "env proxy", envProxyUrl);
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

function decodeHtmlEntities(input) {
  return String(input || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    });
}

function formatReleaseNotes(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(?:ul|ol|div|section|blockquote|table|thead|tbody|tr|strong|em|b|i|code|pre)[^>]*>/gi, "")
    .replace(/<t[dh][^>]*>/gi, " ")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<a[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "");
  const decoded = decodeHtmlEntities(normalized)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return decoded ? decoded.slice(0, 12_000) : null;
}

function getUpdaterSession() {
  return electron.session.fromPartition(UPDATER_SESSION_PARTITION, { cache: false });
}

function getConfiguredCandidates() {
  let configuredLocalProxy = "";
  try {
    configuredLocalProxy = resolveLocalProxy?.() || "";
  } catch {
    configuredLocalProxy = "";
  }
  return buildUpdaterProxyCandidates(configuredLocalProxy, readEnvProxyUrl());
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
 * its release-asset CDN may only be reachable through the system proxy, a local
 * proxy, or environment proxy settings. Probe candidates and fall back cleanly.
 */
async function ensureUpdaterNetwork(options = {}) {
  const { force = false, excludeRouteIds = [], probeUrl = UPDATER_PROBE_URL } = options;
  const updaterSession = getUpdaterSession();
  const candidates = getConfiguredCandidates();
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
  if (typeof notes === "string") return formatReleaseNotes(notes);
  if (Array.isArray(notes)) {
    const joined = notes
      .map((item) => (typeof item?.note === "string" ? formatReleaseNotes(item.note) : ""))
      .filter(Boolean)
      .join("\n\n");
    return joined ? joined.slice(0, 12_000) : null;
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

function invokeBeforeInstallOnce() {
  if (teardownHooked) return;
  teardownHooked = true;
  try {
    onBeforeInstall();
  } catch {
    // Teardown helper is best-effort before NSIS replacement.
  }
}

function setupUpdates(options = {}) {
  const { app, ipcMain, shell } = electron;
  writeLog = options.writeLog ?? (() => {});
  resolveLocalProxy = typeof options.resolveLocalProxy === "function" ? options.resolveLocalProxy : (() => "");
  onBeforeInstall = typeof options.onBeforeInstall === "function" ? options.onBeforeInstall : (() => {});
  teardownHooked = false;
  const macAutoUpdate = process.env.ARIA_MAC_AUTO_UPDATE === "1";
  const checkOnlyMode = process.platform === "darwin" && !macAutoUpdate;
  const supported = process.platform === "win32" || process.platform === "darwin";
  update({
    supported,
    manualDownloadOnly: checkOnlyMode,
    currentVersion: app.getVersion(),
    status: supported ? "idle" : "unsupported",
    reason: supported ? null : "当前平台不支持自动更新。",
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
    const triedIds = [];
    const runDownloadOnRoute = async (route) => {
      if (route) {
        const updaterSession = getUpdaterSession();
        await updaterSession.setProxy(route.config);
        activeRoute = route;
      }
      update({ status: "downloading", percent: 0, bytesPerSecond: null, error: null });
      return autoUpdater.downloadUpdate();
    };

    suppressUpdaterErrorEvent = true;
    try {
      const initialRoute = await ensureUpdaterNetwork({ force: false });
      triedIds.push(initialRoute?.id ?? "system");
      try {
        await runDownloadOnRoute(initialRoute);
        return state;
      } catch (firstError) {
        if (!isRetriableNetworkError(firstError)) throw firstError;
        const remaining = getConfiguredCandidates().filter((r) => !triedIds.includes(r.id));
        let lastErr = firstError;
        for (const candidate of remaining) {
          triedIds.push(candidate.id);
          writeLog("update.log", `download failed via ${activeRoute?.id ?? "system"}, trying ${candidate.label}`);
          try {
            await runDownloadOnRoute(candidate);
            return state;
          } catch (retryError) {
            lastErr = retryError;
            if (!isRetriableNetworkError(retryError)) break;
          }
        }
        throw lastErr;
      }
    } catch (error) {
      update({ status: "error", error: friendlyUpdateError(error), checkedAt: Date.now() });
    } finally {
      suppressUpdaterErrorEvent = false;
    }
    return state;
  });
  ipcMain.handle("aria:update:install", () => {
    if (!supported || !autoUpdater || checkOnlyMode || state.status !== "downloaded") return false;
    update({ status: "installing", error: null });
    invokeBeforeInstallOnce();
    // Allow Windows child process handles (backend / mpv) a brief window to close cleanly before NSIS starts.
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 180);
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
      autoUpdater.on("before-quit-for-update", invokeBeforeInstallOnce);
    } catch {
      // Optional hook depending on platform updater implementation.
    }
    try {
      electron.autoUpdater?.on?.("before-quit-for-update", invokeBeforeInstallOnce);
    } catch {
      // electron.autoUpdater may be unavailable in some environments.
    }

    autoUpdater.on("checking-for-update", () => update({ status: "checking", error: null }));
    autoUpdater.on("update-available", (info) =>
      update({
        status: "available",
        availableVersion: info?.version ?? null,
        releaseName: info?.releaseName ?? null,
        releaseNotes: releaseNotesText(info),
        checkedAt: Date.now(),
        error: null,
        manualDownloadOnly: false,
      }),
    );
    autoUpdater.on("update-not-available", (info) =>
      update({
        status: "up-to-date",
        availableVersion: info?.version ?? state.currentVersion,
        checkedAt: Date.now(),
        error: null,
        manualDownloadOnly: false,
      }),
    );
    autoUpdater.on("download-progress", (progress) =>
      update({
        status: "downloading",
        percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
        bytesPerSecond: Number(progress?.bytesPerSecond) || null,
      }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      update({
        status: "downloaded",
        availableVersion: info?.version ?? state.availableVersion,
        percent: 100,
        bytesPerSecond: null,
        error: null,
      }),
    );
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
          releaseNotes: formatReleaseNotes(typeof data?.body === "string" ? data.body : null),
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
    if (checking) {
      if (manual) checkNeedsManualSurface = true;
      return checking;
    }
    checkNeedsManualSurface = Boolean(manual);
    const forceProbe = manual && (state.status === "error" || !activeRoute);
    update({ status: "checking", error: null });
    if (manual) writeLog("update.log", "manual update check");
    checking = (async () => {
      try {
        if (checkOnlyMode) {
          await checkGithubReleaseOnly(manual);
          return state;
        }
        const runCheckWithTimeout = async () => {
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
        const triedIds = [];
        try {
          const initialRoute = await ensureUpdaterNetwork({ force: forceProbe });
          triedIds.push(initialRoute?.id ?? "system");
          await runCheckWithTimeout();
          return state;
        } catch (firstError) {
          if (!isRetriableNetworkError(firstError)) throw firstError;
          const updaterSession = getUpdaterSession();
          const remaining = getConfiguredCandidates().filter((r) => !triedIds.includes(r.id));
          let lastError = firstError;
          for (const candidate of remaining) {
            triedIds.push(candidate.id);
            writeLog("update.log", `check failed via ${activeRoute?.id ?? "system"}, trying ${candidate.label}`);
            activeRoute = candidate;
            try {
              await updaterSession.setProxy(candidate.config);
              await runCheckWithTimeout();
              return state;
            } catch (retryError) {
              lastError = retryError;
              if (!isRetriableNetworkError(retryError)) break;
            }
          }
          activeRoute = null;
          throw lastError;
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error ?? "");
        if (!checkNeedsManualSurface && /ERR_NETWORK_IO_SUSPENDED|ERR_INTERNET_DISCONNECTED/i.test(raw)) {
          writeLog("update.log", `background update check skipped (${raw})`);
          update({ status: state.availableVersion ? "available" : "idle", error: null });
        } else {
          update({ status: "error", error: friendlyUpdateError(error), checkedAt: Date.now() });
        }
        if (!checkNeedsManualSurface && !startupRetryScheduled && isRetriableNetworkError(error)) {
          startupRetryScheduled = true;
          const retryTimer = setTimeout(() => {
            void check(false);
          }, 60_000);
          retryTimer.unref?.();
        }
        return state;
      } finally {
        suppressUpdaterErrorEvent = false;
        checkNeedsManualSurface = false;
        checking = null;
      }
    })();
    return checking;
  }

  if (process.env.ARIA_DISABLE_AUTO_UPDATE !== "1") {
    autoCheckTimer = setTimeout(() => {
      void check(false);
    }, 5_000);
    autoCheckTimer.unref?.();
    const interval = setInterval(() => {
      void check(false);
    }, 6 * 60 * 60_000);
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
  formatReleaseNotes,
  isRetriableNetworkError,
  toElectronProxyRules,
};
