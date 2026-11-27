const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ariaDesktopLyrics", {
  onState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("aria:desktop-lyrics:state-push", handler);
    return () => ipcRenderer.removeListener("aria:desktop-lyrics:state-push", handler);
  },
  sendCommand: (command) => ipcRenderer.invoke("aria:desktop-lyrics:command", command),
  toggleLock: (locked) => ipcRenderer.invoke("aria:desktop-lyrics:set-locked", locked),
  setStyle: (style) => ipcRenderer.invoke("aria:desktop-lyrics:set-style", style),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("aria:desktop-lyrics:set-always-on-top", enabled),
  close: () => ipcRenderer.invoke("aria:desktop-lyrics:close"),
  dragStart: () => ipcRenderer.send("aria:desktop-lyrics:drag-start"),
  dragMove: () => ipcRenderer.send("aria:desktop-lyrics:drag-move"),
  dragEnd: () => ipcRenderer.send("aria:desktop-lyrics:drag-end"),
});
