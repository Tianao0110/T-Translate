// Preload for the glass (floating-overlay) translator window.
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

  glass: {
    getBounds: () => ipcRenderer.invoke('glass:get-bounds'),

    captureRegion: (bounds) => ipcRenderer.invoke('glass:capture-region', bounds),

    setPassThrough: (enabled) => ipcRenderer.invoke('glass:set-pass-through', enabled),

    close: () => ipcRenderer.invoke('glass:close'),

    // Merged settings (main app + window-local)
    getSettings: () => ipcRenderer.invoke('glass:get-settings'),

    getProviderConfigs: () => ipcRenderer.invoke('glass:get-provider-configs'),

    // Persists window-locally (survives relaunch and settings broadcasts)
    setOpacity: (opacity) => ipcRenderer.invoke('glass:set-opacity', opacity),

    getHistory: (limit) => ipcRenderer.invoke('glass:get-history', limit),

    openMainSettings: (section) => ipcRenderer.invoke('glass:open-main-settings', section),

    onSettingsChanged: (callback) => {
      const handler = (event, settings) => callback(settings);
      ipcRenderer.on('glass:settings-changed', handler);
      return () => ipcRenderer.removeListener('glass:settings-changed', handler);
    },

    // ===== Detached child panes (standalone windows) =====

    createChildWindow: (options) => ipcRenderer.invoke('glass:create-child-window', options),
    closeChildWindow: (id) => ipcRenderer.invoke('glass:close-child-window', id),
    closeAllChildWindows: () => ipcRenderer.invoke('glass:close-all-child-windows'),

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
    isAvailable: () => ipcRenderer.invoke('secure-storage:is-available'),
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
