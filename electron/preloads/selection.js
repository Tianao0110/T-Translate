// Preload for the selection-translator window.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  selection: {
    hide: () => ipcRenderer.invoke("selection:hide"),
    setBounds: (bounds) => ipcRenderer.invoke("selection:set-bounds", bounds),
    addToHistory: (item) => ipcRenderer.invoke("selection:add-to-history", item),
    getText: (rect) => ipcRenderer.invoke("selection:get-text", rect),
    resize: (size) => ipcRenderer.invoke("selection:resize", size),
    startDrag: () => ipcRenderer.invoke("selection:start-drag"),

    // Multi-window support
    freeze: () => ipcRenderer.invoke("selection:freeze"),
    closeFrozen: (windowId) => ipcRenderer.invoke("selection:close-frozen", windowId),
    getWindowId: () => ipcRenderer.invoke("selection:get-window-id"),
    getFrozenCount: () => ipcRenderer.invoke("selection:frozen-windows-count"),

    onShowTrigger: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on("selection:show-trigger", listener);
      return () => ipcRenderer.removeListener("selection:show-trigger", listener);
    },
    onHide: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("selection:hide", listener);
      return () => ipcRenderer.removeListener("selection:hide", listener);
    },
    // Direct result display (screenshot-OCR chain). Two modes:
    //   - { isLoading: true }    → show loading state
    //   - { text, translatedText } → show result
    onShowResult: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on("selection:show-result", listener);
      return () => ipcRenderer.removeListener("selection:show-result", listener);
    },
    // Sticky-direct path: when CapsLock toggle is on, selection skips the trigger icon
    // and the renderer goes straight to translation.
    // payload: { text, targetLanguage, theme, settings }
    onShowDirect: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on("selection:show-direct", listener);
      return () => ipcRenderer.removeListener("selection:show-direct", listener);
    },
    // Reuses floating-window:open-main-settings channel — handler doesn't care which window invoked it
    openOcrSettings: () => ipcRenderer.invoke("floating-window:open-main-settings", "ocr"),
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  },

  // Privacy mode must be visible here: translate() filters providers and gates
  // the disk cache by it (same contract as the floating window's preload).
  privacy: {
    getMode: () => ipcRenderer.invoke("privacy:getMode"),
  },

  // Store access — translation service needs to read config.
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, value) => ipcRenderer.invoke("store-set", key, value),
  },

  // secureStorage access — translation service reads encrypted API keys.
  secureStorage: {
    encrypt: (key, value) => ipcRenderer.invoke("secure-storage:encrypt", key, value),
    decrypt: (key) => ipcRenderer.invoke("secure-storage:decrypt", key),
  },

  theme: {
    sync: () => ipcRenderer.invoke("theme:sync"),
    onChanged: (callback) => {
      const handler = (event, theme) => callback(theme);
      ipcRenderer.on("theme:changed", handler);
      return () => ipcRenderer.removeListener("theme:changed", handler);
    },
  },
});
