const { contextBridge, ipcRenderer } = require("electron");

const apiPort = Number(process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636);

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
  showApp: () => ipcRenderer.invoke("aria:show"),
  quitApp: () => ipcRenderer.invoke("aria:quit"),
  setBackgroundEnabled: (enabled) => ipcRenderer.invoke("aria:set-background-enabled", Boolean(enabled)),
});
