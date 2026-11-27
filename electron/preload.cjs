const { contextBridge, ipcRenderer, webUtils } = require("electron");

const apiPort = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);
const nativeIconicThumbnailEnabled = process.platform === "win32" && process.env.ARIA_NATIVE_ICONIC_THUMBNAIL !== "0";

contextBridge.exposeInMainWorld("ariaDesktop", {
  platform: process.platform,
  apiBase: `http://127.0.0.1:${apiPort}`,
  minimizeToTray: () => ipcRenderer.invoke("aria:minimize-to-tray"),
  minimizeWindow: () => ipcRenderer.invoke("aria:minimize-window"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("aria:toggle-maximize-window"),
  closeWindow: () => ipcRenderer.invoke("aria:close-window"),
  onWindowVisibilityChange: (callback) => {
    const handler = (_event, visible) => callback(Boolean(visible));
    ipcRenderer.on("aria:window-visibility", handler);
    return () => ipcRenderer.removeListener("aria:window-visibility", handler);
  },
  onWindowFocusChange: (callback) => {
    const handler = (_event, focused) => callback(Boolean(focused));
    ipcRenderer.on("aria:window-focus", handler);
    return () => ipcRenderer.removeListener("aria:window-focus", handler);
  },
  onPlaybackCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("aria:playback-command", handler);
    return () => ipcRenderer.removeListener("aria:playback-command", handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("aria:open-settings", handler);
    return () => ipcRenderer.removeListener("aria:open-settings", handler);
  },
  onNavigateHistory: (callback) => {
    const handler = (_event, direction) => {
      if (direction === -1 || direction === 1) callback(direction);
    };
    ipcRenderer.on("aria:navigate-history", handler);
    return () => ipcRenderer.removeListener("aria:navigate-history", handler);
  },
  showApp: () => ipcRenderer.invoke("aria:show"),
  quitApp: () => ipcRenderer.invoke("aria:quit"),
  setBackgroundEnabled: (enabled) => ipcRenderer.invoke("aria:set-background-enabled", Boolean(enabled)),
  chooseMusicFolder: () => ipcRenderer.invoke("aria:choose-music-folder"),
  showItemInFolder: (filePath) => ipcRenderer.invoke("aria:show-item-in-folder", typeof filePath === "string" ? filePath : ""),
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === "function") {
        return webUtils.getPathForFile(file) || "";
      }
      return typeof file?.path === "string" ? file.path : "";
    } catch {
      return typeof file?.path === "string" ? file.path : "";
    }
  },
  consumePendingOpenFiles: () => ipcRenderer.invoke("aria:consume-open-files"),
  onOpenAudioFiles: (callback) => {
    const handler = (_event, files) => callback(Array.isArray(files) ? files : []);
    ipcRenderer.on("aria:open-audio-files", handler);
    return () => ipcRenderer.removeListener("aria:open-audio-files", handler);
  },
  getWindowMaterial: () => ipcRenderer.invoke("aria:get-window-material"),
  setWindowMaterial: (mode) => ipcRenderer.invoke("aria:set-window-material", mode === "translucent" ? "translucent" : "default"),
  desktopLyrics: {
    getState: () => ipcRenderer.invoke("aria:desktop-lyrics:get-state"),
    toggle: () => ipcRenderer.invoke("aria:desktop-lyrics:toggle"),
    close: () => ipcRenderer.invoke("aria:desktop-lyrics:close"),
    setLocked: (locked) => ipcRenderer.invoke("aria:desktop-lyrics:set-locked", locked),
    update: (payload) => ipcRenderer.invoke("aria:desktop-lyrics:update", payload || {}),
    onStateChange: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("aria:desktop-lyrics:state", handler);
      return () => ipcRenderer.removeListener("aria:desktop-lyrics:state", handler);
    },
  },
  qqLoginWindow: () => ipcRenderer.invoke("aria:qq-login-window"),
  youtubeLoginWindow: (proxy) => ipcRenderer.invoke("aria:youtube-login-window", { proxy: typeof proxy === "string" ? proxy : "" }),
  youtubeStage: {
    supported: true,
    prepare: (payload) => ipcRenderer.invoke("aria:youtube-stage:prepare", payload || {}),
  },
  getRemoteAccess: () => ipcRenderer.invoke("aria:get-remote-access"),
  setRemoteAccess: (enabled) => ipcRenderer.invoke("aria:set-remote-access", { enabled: Boolean(enabled) }),
  updateTaskbarPlayback: (payload) => ipcRenderer.invoke("aria:update-taskbar-playback", payload || {}),
  updateMediaSession: (payload) => ipcRenderer.invoke("aria:update-media-session", payload || {}),
  setTaskbarPreviewRect: (rect) => ipcRenderer.invoke("aria:set-thumbnail-clip", rect || null),
  setTaskbarIconicThumb: nativeIconicThumbnailEnabled
    ? (pixels, width, height) => ipcRenderer.invoke("aria:set-iconic-thumbnail", pixels, width, height)
    : undefined,
  setTaskbarIconicLive: nativeIconicThumbnailEnabled
    ? (pixels, width, height) => ipcRenderer.invoke("aria:set-iconic-live-preview", pixels, width, height)
    : undefined,
  clearTaskbarIconicThumb: nativeIconicThumbnailEnabled ? () => ipcRenderer.invoke("aria:clear-iconic-thumbnail") : undefined,
  getTaskbarIconicStats: nativeIconicThumbnailEnabled ? () => ipcRenderer.invoke("aria:iconic-stats") : undefined,
  updates: {
    getState: () => ipcRenderer.invoke("aria:update:state"),
    check: () => ipcRenderer.invoke("aria:update:check"),
    download: () => ipcRenderer.invoke("aria:update:download"),
    install: () => ipcRenderer.invoke("aria:update:install"),
    openReleases: () => ipcRenderer.invoke("aria:update:open-releases"),
    onState: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("aria:update-state", handler);
      return () => ipcRenderer.removeListener("aria:update-state", handler);
    },
  },
  configureGlobalShortcuts: (payload) => ipcRenderer.invoke("aria:configure-global-shortcuts", payload || {}),
  copyImageToClipboard: (payload) => ipcRenderer.invoke("aria:copy-image", payload || {}),
  log: (payload) => ipcRenderer.invoke("aria:log", payload),
  nativeAudio: {
    // The renderer refines this with isSupported(), which checks whether the
    // platform mpv binary is actually present (vendor/mpv/<Aria.exe|mpv>).
    supported: process.platform === "win32" || process.platform === "darwin",
    isSupported: () => ipcRenderer.invoke("aria:native-audio:supported"),
    listDevices: () => ipcRenderer.invoke("aria:native-audio:devices"),
    getState: () => ipcRenderer.invoke("aria:native-audio:state"),
    load: (payload) => ipcRenderer.invoke("aria:native-audio:load", payload),
    loadNext: (payload) => ipcRenderer.invoke("aria:native-audio:load-next", payload || {}),
    setPaused: (paused, options) => ipcRenderer.invoke("aria:native-audio:pause", Boolean(paused), options || {}),
    seek: (position) => ipcRenderer.invoke("aria:native-audio:seek", Number(position) || 0),
    setVolume: (volume) => ipcRenderer.invoke("aria:native-audio:volume", Number(volume) || 0),
    setSpeed: (speed) => ipcRenderer.invoke("aria:native-audio:speed", Number(speed) || 1),
    configure: (payload) => ipcRenderer.invoke("aria:native-audio:configure", payload),
    stop: () => ipcRenderer.invoke("aria:native-audio:stop"),
    recoverOutput: (reason) => ipcRenderer.invoke("aria:native-audio:recover", reason || "manual"),
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("aria:native-audio-event", handler);
      return () => ipcRenderer.removeListener("aria:native-audio-event", handler);
    },
  },
});
