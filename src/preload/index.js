const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getModelInfo: () => ipcRenderer.invoke('model:get-info'),
  setToken: (token) => ipcRenderer.invoke('model:set-token', token),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  loadModel: (opts) => ipcRenderer.invoke('model:load', opts),
  unloadModel: () => ipcRenderer.invoke('model:unload'),
  clearHistory: () => ipcRenderer.invoke('model:clear-history'),
  generate: (opts) => ipcRenderer.invoke('chat:generate', opts),
  stopGenerate: () => ipcRenderer.invoke('chat:stop'),
  getGpuInfo: () => ipcRenderer.invoke('gpu:info'),
  onProgress: (callback) => subscribe('model:progress', callback),
  onChunk: (callback) => subscribe('chat:chunk', callback),
  onTick: (callback) => subscribe('chat:tick', callback),
});
