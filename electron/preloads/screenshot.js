// Preload for the screenshot-selection window.
// Exposes a limited API via contextBridge (no nodeIntegration).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronScreenshot', {
  sendSelection: (bounds) => {
    ipcRenderer.send('screenshot-selection', bounds);
  },

  cancel: () => {
    ipcRenderer.send('screenshot-cancel');
  },

  onConfig: (callback) => {
    ipcRenderer.on('screenshot-config', (event, config) => callback(config));
  },
});
