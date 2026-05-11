// Preload for the standalone child glass-pane window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronChildPane', {
  close: () => ipcRenderer.send('child-pane:close'),

  resize: (width, height) => ipcRenderer.send('child-pane:resize', width, height),

  onUpdate: (callback) => {
    ipcRenderer.on('child-pane:update', (event, data) => callback(data));
  },

  getId: () => ipcRenderer.invoke('child-pane:get-id'),
});
