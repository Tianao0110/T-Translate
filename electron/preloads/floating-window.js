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

    // Manual title-bar drag: high-frequency fire-and-forget position stream.
    // width/height = drag-start size, held constant to defeat fractional-DPI
    // rounding accumulation (window grew while dragging on 1.75x displays).
    moveTo: (x, y, width, height) => ipcRenderer.send('floating-window:set-position', x, y, width, height),

    captureRegion: (bounds) => ipcRenderer.invoke('floating-window:capture-region', bounds),

    setPassThrough: (enabled) => ipcRenderer.invoke('floating-window:set-pass-through', enabled),

    close: () => ipcRenderer.invoke('floating-window:close'),

    // Merged settings (main app + window-local)
    getSettings: () => ipcRenderer.invoke('floating-window:get-settings'),

    // Persists window-locally (survives relaunch and settings broadcasts)
    setOpacity: (opacity) => ipcRenderer.invoke('floating-window:set-opacity', opacity),

    getHistory: (limit) => ipcRenderer.invoke('floating-window:get-history', limit),

    // Forward a completed translation into the main window's history store
    // (which applies its own secure-mode gate).
    addToHistory: (item) => ipcRenderer.invoke('floating-window:add-to-history', item),
    attachAiResult: (payload) => ipcRenderer.invoke('floating-window:attach-ai-result', payload),

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

    // Global-hotkey re-capture trigger (fires while another app holds focus).
    onTriggerCapture: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('floating-window:trigger-capture', handler);
      return () => ipcRenderer.removeListener('floating-window:trigger-capture', handler);
    },
  },

  // Encrypted storage for API keys etc.
  secureStorage: {
    encrypt: (key, value) => ipcRenderer.invoke('secure-storage:encrypt', key, value),
    decrypt: (key, options) => ipcRenderer.invoke('secure-storage:decrypt', key, options),
    delete: (key) => ipcRenderer.invoke('secure-storage:delete', key),
    isAvailable: () => ipcRenderer.invoke('secure-storage:isAvailable'),
  },

  // AI action results open in their own window, owned by this one.
  aiResult: {
    open: (payload) => ipcRenderer.invoke('ai-result:open', payload),
  },

  // Main-process translation stack (same bridge as the main-window preload).
  stack: {
    translate: (payload) => ipcRenderer.invoke('stack:translate', payload),
    streamStart: (payload) => ipcRenderer.invoke('stack:translate-stream-start', payload),
    abort: (id) => ipcRenderer.invoke('stack:abort', { id }),
    chat: (payload) => ipcRenderer.invoke('stack:chat', payload),
    chatCapability: () => ipcRenderer.invoke('stack:chat-capability'),
    testProvider: (providerId) => ipcRenderer.invoke('stack:test-provider', { providerId }),
    testProviderConfig: (providerId, config) =>
      ipcRenderer.invoke('stack:test-provider-config', { providerId, config }),
    providersStatus: () => ipcRenderer.invoke('stack:providers-status'),
    currentProvider: () => ipcRenderer.invoke('stack:current-provider'),
    reload: () => ipcRenderer.invoke('stack:reload'),
    clearCache: (level) => ipcRenderer.invoke('stack:clear-cache', { level }),
    cacheStats: () => ipcRenderer.invoke('stack:cache-stats'),
    ocrRecognize: (imageData, options) =>
      ipcRenderer.invoke('stack:ocr-recognize', { imageData, options }),
    ocrResetVision: () => ipcRenderer.invoke('stack:ocr-reset-vision'),
    visionChat: (messages, imageData, options) =>
      ipcRenderer.invoke('stack:vision-chat', { messages, imageData, options }),
    visionCapability: () => ipcRenderer.invoke('stack:vision-capability'),
    onStreamChunk: (callback) => {
      const handler = (event, frame) => callback(frame);
      ipcRenderer.on('stack:stream-chunk', handler);
      return () => ipcRenderer.removeListener('stack:stream-chunk', handler);
    },
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('stack:changed', handler);
      return () => ipcRenderer.removeListener('stack:changed', handler);
    },
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
