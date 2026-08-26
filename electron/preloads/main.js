// Main-window preload — exposes the `electron` API via contextBridge.
// main.js MUST set `sandbox: false` for fs access (preload runs in renderer process).

const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs").promises;

// Receive allow-list — the generic ipc.on / ipcRenderer.on bridges below are
// gated by this so renderer code can't subscribe to arbitrary channels.
// (send/invoke need no list: they are only reachable through the explicit
// electronAPI methods, never generically.)
const validChannels = {
  receive: [
    "menu-action",
    "import-file",
    "add-to-history",
    "attach-ai-result",
    "screenshot-captured",
    "screenshot-captured-silent",
    "selection-state-changed",
    "theme:changed",
    "maximize-change",
    "shortcut-conflict",
    "navigate",
    "security-alert",
  ],
};

const electronAPI = {
  app: {
    getVersion: () => ipcRenderer.invoke("get-app-version"),
    getPlatform: () => ipcRenderer.invoke("get-platform"),
    getPath: (name) => ipcRenderer.invoke("get-app-path", name),
    checkUpdate: () => ipcRenderer.invoke("app:check-update"),
    downloadUpdate: (info) => ipcRenderer.invoke("app:download-update", info),
    installUpdate: (info) => ipcRenderer.invoke("app:install-update", info),
    setAutoLaunch: (enabled) => ipcRenderer.invoke("app:set-auto-launch", enabled),
    getAutoLaunch: () => ipcRenderer.invoke("app:get-auto-launch"),
    getDataStats: () => ipcRenderer.invoke("app:get-data-stats"),
    onDownloadProgress: (callback) => {
      const handler = (event, progress) => callback(progress);
      ipcRenderer.on("update:download-progress", handler);
      return () => ipcRenderer.removeListener("update:download-progress", handler);
    },
  },
  window: {
    minimize: () => ipcRenderer.send("minimize-window"),
    maximize: () => ipcRenderer.send("maximize-window"),
    close: () => ipcRenderer.send("close-window"),
    show: () => ipcRenderer.send("show-window"),
    setAlwaysOnTop: (flag) => ipcRenderer.send("set-always-on-top", flag),
    isMaximized: () => ipcRenderer.invoke("is-maximized"),
    onMaximizeChange: (callback) => {
      const handler = (event, maximized) => callback(maximized);
      ipcRenderer.on("maximize-change", handler);
    },
    offMaximizeChange: (callback) => {
      ipcRenderer.removeAllListeners("maximize-change");
    },
  },
  dialog: {
    showSaveDialog: (opts) => ipcRenderer.invoke("show-save-dialog", opts),
    showOpenDialog: (opts) => ipcRenderer.invoke("show-open-dialog", opts),
    saveFile: (opts) => ipcRenderer.invoke("save-file", opts),
  },
  document: {
    // "Open with T-Translate": pull the pending context-menu file (one-shot),
    // and get pinged when a running instance receives a new one.
    takePendingOpen: () => ipcRenderer.invoke("document:take-pending-open"),
    onOpenFileReady: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("document:open-file-ready", handler);
      return () => ipcRenderer.removeListener("document:open-file-ready", handler);
    },
  },
  clipboard: {
    readText: () => ipcRenderer.invoke("read-clipboard-text"),
    writeText: (text) => ipcRenderer.send("write-clipboard-text", text),
    readImage: () => ipcRenderer.invoke("read-clipboard-image"),
  },
  // Minimal fs helpers — JSON read/write only.
  fs: {
    readJSON: async (filePath) => {
      try {
        const data = await fs.readFile(filePath, "utf8");
        return { success: true, data: JSON.parse(data) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    writeJSON: async (filePath, data) => {
      try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
  },
  shell: {
    openExternal: (url) => ipcRenderer.send("open-external", url),
  },
  logs: {
    openDirectory: () => ipcRenderer.invoke("logs:open-directory"),
    // One-way: logging must never make the caller await, and a failed write
    // must never surface as a rejected promise in the renderer.
    write: (payload) => ipcRenderer.send("logs:write", payload),
  },
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, val) => ipcRenderer.invoke("store-set", key, val),
    delete: (key) => ipcRenderer.invoke("store-delete", key),
    clear: () => ipcRenderer.invoke("store-clear"),
  },
  // Encrypted storage for API keys etc.
  secureStorage: {
    encrypt: (key, value) => ipcRenderer.invoke("secure-storage:encrypt", key, value),
    decrypt: (key, options) => ipcRenderer.invoke("secure-storage:decrypt", key, options),
    delete: (key) => ipcRenderer.invoke("secure-storage:delete", key),
    isAvailable: () => ipcRenderer.invoke("secure-storage:isAvailable"),
  },
  // Main-process translation stack (services/stack-client.js is the consumer).
  // No privacyMode/useCache here — the main-process facade injects them.
  stack: {
    translate: (payload) => ipcRenderer.invoke("stack:translate", payload),
    streamStart: (payload) => ipcRenderer.invoke("stack:translate-stream-start", payload),
    abort: (id) => ipcRenderer.invoke("stack:abort", { id }),
    chat: (payload) => ipcRenderer.invoke("stack:chat", payload),
    chatCapability: () => ipcRenderer.invoke("stack:chat-capability"),
    testProvider: (providerId) => ipcRenderer.invoke("stack:test-provider", { providerId }),
    testProviderConfig: (providerId, config) =>
      ipcRenderer.invoke("stack:test-provider-config", { providerId, config }),
    providersStatus: () => ipcRenderer.invoke("stack:providers-status"),
    readiness: () => ipcRenderer.invoke("stack:readiness"),
    currentProvider: () => ipcRenderer.invoke("stack:current-provider"),
    reload: () => ipcRenderer.invoke("stack:reload"),
    clearCache: (level) => ipcRenderer.invoke("stack:clear-cache", { level }),
    cacheStats: () => ipcRenderer.invoke("stack:cache-stats"),
    ocrRecognize: (imageData, options) =>
      ipcRenderer.invoke("stack:ocr-recognize", { imageData, options }),
    ocrResetVision: () => ipcRenderer.invoke("stack:ocr-reset-vision"),
    visionChat: (messages, imageData, options) =>
      ipcRenderer.invoke("stack:vision-chat", { messages, imageData, options }),
    visionCapability: () => ipcRenderer.invoke("stack:vision-capability"),
    onStreamChunk: (callback) => {
      const handler = (event, frame) => callback(frame);
      ipcRenderer.on("stack:stream-chunk", handler);
      return () => ipcRenderer.removeListener("stack:stream-chunk", handler);
    },
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("stack:changed", handler);
      return () => ipcRenderer.removeListener("stack:changed", handler);
    },
  },
  floatingWindow: {
    notifySettingsChanged: () => ipcRenderer.invoke("floating-window:notify-settings-changed"),
  },
  selection: {
    toggle: () => ipcRenderer.invoke("selection:toggle"),
    getEnabled: () => ipcRenderer.invoke("selection:get-enabled"),
  },
  theme: {
    get: () => ipcRenderer.invoke("theme:get"),
    set: (theme) => ipcRenderer.invoke("theme:set", theme),
    sync: () => ipcRenderer.invoke("theme:sync"),
    onChanged: (callback) => {
      const handler = (event, theme) => callback(theme);
      ipcRenderer.on("theme:changed", handler);
      return () => ipcRenderer.removeListener("theme:changed", handler);
    },
  },
  shortcuts: {
    update: (action, shortcut) => ipcRenderer.invoke("shortcuts:update", action, shortcut),
    get: () => ipcRenderer.invoke("shortcuts:get"),
    pause: (action) => ipcRenderer.invoke("shortcuts:pause", action),
    resume: (action) => ipcRenderer.invoke("shortcuts:resume", action),
  },
  privacy: {
    setMode: (mode) => ipcRenderer.invoke("privacy:setMode", mode),
    getMode: () => ipcRenderer.invoke("privacy:getMode"),
  },
  ocr: {
    // Recognition itself goes through stack.ocrRecognize (main-process stack);
    // only detection and pack management stay on the ocr:* channels.
    checkWindowsOCR: () => ipcRenderer.invoke("ocr:check-windows-ocr"),

    // Engine management
    checkInstalled: () => ipcRenderer.invoke("ocr:check-installed"),
    healthCheck: (engineId, options) => ipcRenderer.invoke("ocr:health-check", engineId, options),

    // Model packs (download/refresh/uninstall in settings)
    listPacks: (options) => ipcRenderer.invoke("ocr:packs-list", options),
    downloadPack: (packId) => ipcRenderer.invoke("ocr:packs-download", packId),
    removePack: (packId) => ipcRenderer.invoke("ocr:packs-remove", packId),
    setModelTier: (tier) => ipcRenderer.invoke("ocr:set-model-tier", tier),
    onPackProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on("ocr:download-progress", handler);
      return () => ipcRenderer.removeListener("ocr:download-progress", handler);
    },
  },
  screenshot: {
    capture: () => ipcRenderer.invoke("capture-screen"),
    onCaptured: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on("screenshot-captured", handler);
      return () => ipcRenderer.removeListener("screenshot-captured", handler);
    },
    // Silent-mode capture — completes without showing main window (background processing).
    onCapturedSilent: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on("screenshot-captured-silent", handler);
      return () => ipcRenderer.removeListener("screenshot-captured-silent", handler);
    },
    // Main window calls this after background OCR finishes.
    notifyOcrComplete: (data) => {
      ipcRenderer.send("screenshot:ocr-complete", data);
    },
  },
  // Generic IPC with allow-list check.
  ipc: {
    on: (channel, func) => {
      if (validChannels.receive.includes(channel)) {
        const subscription = (_event, ...args) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
      }
    },
  },
  // Direct ipcRenderer for floating-window-style use cases.
  ipcRenderer: {
    on: (channel, func) => {
      if (validChannels.receive.includes(channel)) {
        ipcRenderer.on(channel, func);
      }
    },
    removeListener: (channel, func) => {
      ipcRenderer.removeListener(channel, func);
    },
  },
};

// Expose API with dedup — hot-reload can re-execute preload.
try {
  if (!window.electron) {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    console.log("[Preload] electron API exposed");
  }
} catch (error) {
  // Ignore "API already exposed" — only that specific error is benign.
  if (!error.message?.includes("bind an API on top of")) {
    console.error("Failed to expose electron API:", error);
  }
}

try {
  if (!window.nodeAPI) {
    contextBridge.exposeInMainWorld("nodeAPI", {
      process: {
        platform: process.platform,
        env: { NODE_ENV: process.env.NODE_ENV },
      },
    });
  }
} catch (error) {
  // Same dedup-error tolerance.
}
