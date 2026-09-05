const { contextBridge, ipcRenderer } = require("electron");

const apiPort = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);
const nativeIconicThumbnailEnabled = process.platform === "win32" && process.env.ARIA_NATIVE_ICONIC_THUMBNAIL !== "0";

contextBridge.exposeInMainWorld("ariaDesktop", {
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
  onPlaybackCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("aria:playback-command", handler);
    return () => ipcRenderer.removeListener("aria:playback-command", handler);
  },
  showApp: () => ipcRenderer.invoke("aria:show"),
  quitApp: () => ipcRenderer.invoke("aria:quit"),
  setBackgroundEnabled: (enabled) => ipcRenderer.invoke("aria:set-background-enabled", Boolean(enabled)),
  chooseMusicFolder: () => ipcRenderer.invoke("aria:choose-music-folder"),
  updateTaskbarPlayback: (payload) => ipcRenderer.invoke("aria:update-taskbar-playback", payload || {}),
  setTaskbarPreviewRect: (rect) => ipcRenderer.invoke("aria:set-thumbnail-clip", rect || null),
  setTaskbarIconicThumb: nativeIconicThumbnailEnabled
    ? (pixels, width, height) => ipcRenderer.invoke("aria:set-iconic-thumbnail", pixels, width, height)
    : undefined,
  setTaskbarIconicLive: nativeIconicThumbnailEnabled
    ? (pixels, width, height) => ipcRenderer.invoke("aria:set-iconic-live-preview", pixels, width, height)
    : undefined,
  clearTaskbarIconicThumb: nativeIconicThumbnailEnabled ? () => ipcRenderer.invoke("aria:clear-iconic-thumbnail") : undefined,
  getTaskbarIconicStats: nativeIconicThumbnailEnabled ? () => ipcRenderer.invoke("aria:iconic-stats") : undefined,
  configureGlobalShortcuts: (payload) => ipcRenderer.invoke("aria:configure-global-shortcuts", payload || {}),
  copyImageToClipboard: (payload) => ipcRenderer.invoke("aria:copy-image", payload || {}),
  log: (payload) => ipcRenderer.invoke("aria:log", payload),
  nativeAudio: {
    supported: process.platform === "win32",
    isSupported: () => ipcRenderer.invoke("aria:native-audio:supported"),
    listDevices: () => ipcRenderer.invoke("aria:native-audio:devices"),
    getState: () => ipcRenderer.invoke("aria:native-audio:state"),
    load: (payload) => ipcRenderer.invoke("aria:native-audio:load", payload),
    loadNext: (payload) => ipcRenderer.invoke("aria:native-audio:load-next", payload || {}),
    setPaused: (paused) => ipcRenderer.invoke("aria:native-audio:pause", Boolean(paused)),
    seek: (position) => ipcRenderer.invoke("aria:native-audio:seek", Number(position) || 0),
    setVolume: (volume) => ipcRenderer.invoke("aria:native-audio:volume", Number(volume) || 0),
    configure: (payload) => ipcRenderer.invoke("aria:native-audio:configure", payload),
    stop: () => ipcRenderer.invoke("aria:native-audio:stop"),
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("aria:native-audio-event", handler);
      return () => ipcRenderer.removeListener("aria:native-audio-event", handler);
    },
  },
});
