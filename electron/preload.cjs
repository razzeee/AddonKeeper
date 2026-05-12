const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  scanAddons: (addonsPath) => ipcRenderer.invoke('addons:scan', addonsPath),
  setAddonSource: (data) => ipcRenderer.invoke('addons:setSource', data),
  setPinned: (data) => ipcRenderer.invoke('addons:setPinned', data),
  checkUpdate: (data) => ipcRenderer.invoke('addons:checkUpdate', data),
  updateAddon: (data) => ipcRenderer.invoke('addons:update', data),
  installAddon: (data) => ipcRenderer.invoke('addons:install', data),
  removeAddon: (data) => ipcRenderer.invoke('addons:remove', data),

  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  openUrl: (url) => ipcRenderer.invoke('shell:openUrl', url),

  onUpdateProgress: (cb) => {
    ipcRenderer.on('update:progress', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('update:progress');
  },
  onInstallProgress: (cb) => {
    ipcRenderer.on('install:progress', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('install:progress');
  },
});
