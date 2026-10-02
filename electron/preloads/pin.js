// Preload for a pinned screenshot window (screenshot/pin-windows.js).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // One-way crash reporting to the on-disk log.
  logs: {
    write: (payload) => ipcRenderer.send('logs:write', payload),
  },

  pin: {
    getInit: () => ipcRenderer.invoke('pin:get-init'),
    ready: () => ipcRenderer.send('pin:ready'),
    // Manual drag: fire-and-forget position stream; main keeps the size.
    moveTo: (x, y) => ipcRenderer.send('pin:move', x, y),
    close: (copyImage) => ipcRenderer.send('pin:close', { copyImage: !!copyImage }),
  },

  theme: {
    onChanged: (callback) => {
      const handler = (event, theme) => callback(theme);
      ipcRenderer.on('theme:changed', handler);
      return () => ipcRenderer.removeListener('theme:changed', handler);
    },
  },
});
