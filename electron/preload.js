const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("optionChainPulseUpdater", {
  checkForUpdates: () => ipcRenderer.invoke("ocp:update-check"),
  installUpdate: () => ipcRenderer.invoke("ocp:update-install"),
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ocp:update-status", listener);
    return () => ipcRenderer.removeListener("ocp:update-status", listener);
  },
});
