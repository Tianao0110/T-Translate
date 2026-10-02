// Preload for a pinned screenshot window (screenshot/pin-windows.js).

const { contextBridge, ipcRenderer } = require('electron');
const { stackBridge } = require('./stack-bridge');

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
    // copy: 'image' | 'view' (with rect) | null.
    close: (copy, rect) => ipcRenderer.send('pin:close', { copy: copy || null, rect: rect || null }),
    addToHistory: (item) => ipcRenderer.invoke('pin:add-to-history', item),
  },

  theme: {
    onChanged: (callback) => {
      const handler = (event, theme) => callback(theme);
      ipcRenderer.on('theme:changed', handler);
      return () => ipcRenderer.removeListener('theme:changed', handler);
    },
  },

  // Recognize + translate only.
  stack: stackBridge(ipcRenderer, ['translate', 'detectLanguage', 'ocrRecognize']),
});
