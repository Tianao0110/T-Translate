// Preload for the floating-window (screen translation overlay).
// Exposes window-specific IPC plus shared OCR / translate / clipboard / theme APIs.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Privacy mode must be visible here: the pipeline filters cloud providers by
  // it, and screen captures are the most privacy-sensitive input in the app.
  // Read-only — mode switching stays in the main window.
  privacy: {
    getMode: () => ipcRenderer.invoke('privacy:getMode'),
  },

  // Read-only settings access (pipeline reads the local-LLM endpoint at init).
  store: {
    get: (key) => ipcRenderer.invoke('store-get', key),
  },

  floatingWindow: {
    getBounds: () => ipcRenderer.invoke('floating-window:get-bounds'),

    captureRegion: (bounds) => ipcRenderer.invoke('floating-window:capture-region', bounds),

    setPassThrough: (enabled) => ipcRenderer.invoke('floating-window:set-pass-through', enabled),

    close: () => ipcRenderer.invoke('floating-window:close'),

    // Merged settings (main app + window-local)
    getSettings: () => ipcRenderer.invoke('floating-window:get-settings'),

    getProviderConfigs: () => ipcRenderer.invoke('floating-window:get-provider-configs'),

    // Persists window-locally (survives relaunch and settings broadcasts)
    setOpacity: (opacity) => ipcRenderer.invoke('floating-window:set-opacity', opacity),

    getHistory: (limit) => ipcRenderer.invoke('floating-window:get-history', limit),

    openMainSettings: (section) => ipcRenderer.invoke('floating-window:open-main-settings', section),

    onSettingsChanged: (callback) => {
      const handler = (event, settings) => callback(settings);
      ipcRenderer.on('floating-window:settings-changed', handler);
      return () => ipcRenderer.removeListener('floating-window:settings-changed', handler);
    },

    // ===== Detached child panes (standalone windows) =====

    createChildWindow: (options) => ipcRenderer.invoke('floating-window:create-child-window', options),
    closeChildWindow: (id) => ipcRenderer.invoke('floating-window:close-child-window', id),
    closeAllChildWindows: () => ipcRenderer.invoke('floating-window:close-all-child-windows'),

    onChildWindowClosed: (callback) => {
      const handler = (event, id) => callback(id);
      ipcRenderer.on('child-pane:closed', handler);
      return () => ipcRenderer.removeListener('child-pane:closed', handler);
    },
  },

  // Shared OCR API (also exposed in the main-window preload).
  ocr: {
    recognizeWithPaddleOCR: (imageData, options) =>
      ipcRenderer.invoke('ocr:paddle-ocr', imageData, options),
    recognizeWithWindowsOCR: (imageData, options) =>
      ipcRenderer.invoke('ocr:windows-ocr', imageData, options),
    recognizeWithOCRSpace: (imageData, options) =>
      ipcRenderer.invoke('ocr:ocrspace', imageData, options),
    recognizeWithGoogleVision: (imageData, options) =>
      ipcRenderer.invoke('ocr:google-vision', imageData, options),
    recognizeWithAzureOCR: (imageData, options) =>
      ipcRenderer.invoke('ocr:azure-ocr', imageData, options),
    recognizeWithBaiduOCR: (imageData, options) =>
      ipcRenderer.invoke('ocr:baidu-ocr', imageData, options),
    checkInstalled: () => ipcRenderer.invoke('ocr:check-installed'),
  },

  translate: {
    translate: (text, options) => ipcRenderer.invoke('translate:translate', text, options),
    streamTranslate: (text, options) => ipcRenderer.invoke('translate:stream', text, options),
    onStreamChunk: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('translate:stream-chunk', handler);
      return () => ipcRenderer.removeListener('translate:stream-chunk', handler);
    },
  },

  // Encrypted storage for API keys etc.
  secureStorage: {
    encrypt: (key, value) => ipcRenderer.invoke('secure-storage:encrypt', key, value),
    decrypt: (key) => ipcRenderer.invoke('secure-storage:decrypt', key),
    delete: (key) => ipcRenderer.invoke('secure-storage:delete', key),
    isAvailable: () => ipcRenderer.invoke('secure-storage:isAvailable'),
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    readText: () => ipcRenderer.invoke('clipboard:read-text'),
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
