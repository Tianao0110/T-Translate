// Preload for the standalone detached child-pane window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronChildPane', {
  // One-way crash reporting to the on-disk log. Renderer logging was
  // console-only, so nothing from this window ever survived a restart.
  logs: {
    write: (payload) => ipcRenderer.send('logs:write', payload),
  },

  close: () => ipcRenderer.send('child-pane:close'),

  resize: (width, height) => ipcRenderer.send('child-pane:resize', width, height),
});
