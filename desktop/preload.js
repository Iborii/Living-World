const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lwUpdate', {
  onReady: (fn) => ipcRenderer.on('lw-update-ready', (_e, info) => fn(info)),
  onStatus: (fn) => ipcRenderer.on('lw-update-status', (_e, msg) => fn(msg)),
  check: () => ipcRenderer.invoke('lw-update-check'),
  restartNow: () => ipcRenderer.send('lw-update-restart'),
  later: () => ipcRenderer.send('lw-update-later'),
  version: () => ipcRenderer.invoke('lw-version'),
});
contextBridge.exposeInMainWorld('lwApp', {
  getWipeOnUninstall: () => ipcRenderer.invoke('lw-get-wipe'),
  setWipeOnUninstall: (on) => ipcRenderer.invoke('lw-set-wipe', !!on),
  wipeAll: () => ipcRenderer.invoke('lw-wipe-all'),
});
