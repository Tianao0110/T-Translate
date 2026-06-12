// Preload for the standalone detached child-pane window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronChildPane', {
  close: () => ipcRenderer.send('child-pane:close'),

  resize: (width, height) => ipcRenderer.send('child-pane:resize', width, height),
});
