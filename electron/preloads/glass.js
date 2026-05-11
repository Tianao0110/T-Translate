// Preload for the glass (floating-overlay) translator window.
// Exposes window-specific IPC plus shared OCR / translate / clipboard / theme APIs.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  glass: {
    getBounds: () => ipcRenderer.invoke('glass:get-bounds'),

    captureRegion: (bounds) => ipcRenderer.invoke('glass:capture-region', bounds),

    translate: (text) => ipcRenderer.invoke('glass:translate', text),

    setPassThrough: (enabled) => ipcRenderer.invoke('glass:set-pass-through', enabled),

    // Mouse-event ignore toggle — used to switch between draggable and click-through modes.
    setIgnoreMouse: (ignore) => ipcRenderer.invoke('glass:set-ignore-mouse', ignore),

    setAlwaysOnTop: (enabled) => ipcRenderer.invoke('glass:set-always-on-top', enabled),

    close: () => ipcRenderer.invoke('glass:close'),

    // Returns merged settings (main app + window-local).
    getSettings: () => ipcRenderer.invoke('glass:get-settings'),

    getProviderConfigs: () => ipcRenderer.invoke('glass:get-provider-configs'),

    saveSettings: (settings) => ipcRenderer.invoke('glass:save-settings', settings),

    setOpacity: (opacity) => ipcRenderer.invoke('glass:set-opacity', opacity),

    addToFavorites: (item) => ipcRenderer.invoke('glass:add-to-favorites', item),

    addToHistory: (item) => ipcRenderer.invoke('glass:add-to-history', item),

    getHistory: (limit) => ipcRenderer.invoke('glass:get-history', limit),

    syncTargetLanguage: (langCode) => ipcRenderer.invoke('glass:sync-target-language', langCode),

    // Hide before a screenshot is taken (so the glass window doesn't appear in the capture).
    onHideForCapture: (callback) => {
      const handler = (event, settings) => callback(settings);
      ipcRenderer.on('glass:hide-for-capture', handler);
      return () => ipcRenderer.removeListener('glass:hide-for-capture', handler);
    },

    onShowAfterCapture: (callback) => {
      const handler = (event, settings) => callback(settings);
      ipcRenderer.on('glass:show-after-capture', handler);
      return () => ipcRenderer.removeListener('glass:show-after-capture', handler);
    },

    onSettingsChanged: (callback) => {
      const handler = (event, settings) => callback(settings);
      ipcRenderer.on('glass:settings-changed', handler);
      return () => ipcRenderer.removeListener('glass:settings-changed', handler);
    },

    // ===== Child glass panes (standalone windows spawned from main glass) =====

    createChildWindow: (options) => ipcRenderer.invoke('glass:create-child-window', options),
    closeChildWindow: (id) => ipcRenderer.invoke('glass:close-child-window', id),
    updateChildWindow: (id, data) => ipcRenderer.invoke('glass:update-child-window', id, data),
    moveChildWindow: (id, x, y) => ipcRenderer.invoke('glass:move-child-window', id, x, y),
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
    recognizeWithOCRSpace: (imageData, options) =>
      ipcRenderer.invoke('ocr:ocrspace', imageData, options),
    recognizeWithGoogleVision: (imageData, options) =>
      ipcRenderer.invoke('ocr:google-vision', imageData, options),
    recognizeWithAzureOCR: (imageData, options) =>
      ipcRenderer.invoke('ocr:azure-ocr', imageData, options),
    recognizeWithBaiduOCR: (imageData, options) =>
      ipcRenderer.invoke('ocr:baidu-ocr', imageData, options),
    getAvailableEngines: () => ipcRenderer.invoke('ocr:get-available-engines'),
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
