// Preload for the selection-translator window.

const { contextBridge, ipcRenderer } = require("electron");
const { stackBridge } = require("./stack-bridge");

contextBridge.exposeInMainWorld("electron", {
  // One-way crash reporting to the on-disk log.
  logs: {
    write: (payload) => ipcRenderer.send('logs:write', payload),
  },

  selection: {
    hide: () => ipcRenderer.invoke("selection:hide"),
    setBounds: (bounds) => ipcRenderer.invoke("selection:set-bounds", bounds),
    addToHistory: (item) => ipcRenderer.invoke("selection:add-to-history", item),
    attachAiResult: (payload) => ipcRenderer.invoke("selection:attach-ai-result", payload),
    getText: () => ipcRenderer.invoke("selection:get-text"),
    startDrag: () => ipcRenderer.invoke("selection:start-drag"),

    // Multi-window support
    freeze: () => ipcRenderer.invoke("selection:freeze"),
    closeFrozen: (windowId) => ipcRenderer.invoke("selection:close-frozen", windowId),

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
    // Provider / settings changed in the main window: reload here too.
    onSettingsChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("selection:settings-changed", listener);
      return () => ipcRenderer.removeListener("selection:settings-changed", listener);
    },
    // Reuses the floating-window:open-main-settings channel.
    openOcrSettings: () => ipcRenderer.invoke("floating-window:open-main-settings", "ocr"),
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  },

  // Privacy mode, read-only (same contract as the floating window's preload).
  privacy: {
    getMode: () => ipcRenderer.invoke("privacy:getMode"),
  },

  // Store access — translation service needs to read config.
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, value) => ipcRenderer.invoke("store-set", key, value),
  },

  // No secureStorage here: this window never sees a decrypted key.

  // Main-process translation stack (same bridge as the main-window preload;
  // this window only translates, so no test/management surface is exposed).
  stack: stackBridge(ipcRenderer, [
    'translate', 'streamStart', 'abort', 'chat', 'chatCapability',
    'providersStatus', 'currentProvider', 'reload', 'cacheStats',
    'onStreamChunk', 'onChanged',
  ]),
});
