// Preload for the AI action result window. Read-only by design: this window
// shows a snapshot and can copy or close itself, nothing else.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  aiResult: {
    getPayload: (id) => ipcRenderer.invoke('ai-result:payload', id),
    // Fire-and-forget: the window sizes itself to the text it just laid out.
    reportHeight: (id, height) => ipcRenderer.send('ai-result:resize', { id, height }),
    close: (id) => ipcRenderer.invoke('ai-result:close', id),
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  },

  theme: {
    sync: () => ipcRenderer.invoke('theme:sync'),
    onChanged: (callback) => {
      const handler = (event, theme) => callback(theme);
      ipcRenderer.on('theme:changed', handler);
      return () => ipcRenderer.removeListener('theme:changed', handler);
    },
  },
});
