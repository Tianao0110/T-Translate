// Main-window preload — exposes the `electron` API via contextBridge.
// main.js MUST set `sandbox: false` for fs access (preload runs in renderer process).

const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs").promises;

// Channel allow-lists — generic on/send/invoke are gated by these to prevent
// renderer code from talking to arbitrary IPC channels.
const validChannels = {
  send: [
    "minimize-window",
    "maximize-window",
    "close-window",
    "set-always-on-top",
    "open-external",
    "write-clipboard-text",
    "menu-action",
  ],
  receive: [
    "menu-action",
    "import-file",
    "add-to-favorites",
    "add-to-history",
    "sync-target-language",
    "screenshot-captured",
    "screenshot-captured-silent",
    "selection-state-changed",
    "theme:changed",
    "maximize-change",
    "shortcut-conflict",
    "navigate",
    "security-alert",
  ],
  invoke: [
    "get-app-version",
    "get-platform",
    "show-save-dialog",
    "show-open-dialog",
    "read-clipboard-text",
    "read-clipboard-image",
    "store-get",
    "store-set",
    "store-delete",
    "store-clear",
    "store-has",
    "get-app-path",
    "capture-screen",
    "floating-window:open",
    "floating-window:notify-settings-changed",
    "secure-storage:encrypt",
    "secure-storage:decrypt",
    "secure-storage:delete",
    "secure-storage:isAvailable",
    "selection:toggle",
    "selection:get-enabled",
    "theme:get",
    "theme:set",
    "theme:sync",
    "logs:open-directory",
    "logs:get-directory",
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
    getDirectory: () => ipcRenderer.invoke("logs:get-directory"),
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
    getAccessLog: () => ipcRenderer.invoke("secure-storage:getAccessLog"),
  },
  floatingWindow: {
    open: () => ipcRenderer.invoke("floating-window:open"),
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
  api: {
    healthCheck: () => ipcRenderer.invoke("api:health-check"),
  },
  ocr: {
    // Local engines
    checkWindowsOCR: () => ipcRenderer.invoke("ocr:check-windows-ocr"),
    recognizeWithWindowsOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:windows-ocr", imageData, options),
    recognizeWithPaddleOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:paddle-ocr", imageData, options),

    // Online APIs
    recognizeWithOCRSpace: (imageData, options) =>
      ipcRenderer.invoke("ocr:ocrspace", imageData, options),
    recognizeWithGoogleVision: (imageData, options) =>
      ipcRenderer.invoke("ocr:google-vision", imageData, options),
    recognizeWithAzureOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:azure-ocr", imageData, options),
    recognizeWithBaiduOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:baidu-ocr", imageData, options),

    // Engine management
    checkInstalled: () => ipcRenderer.invoke("ocr:check-installed"),
    healthCheck: (engineId) => ipcRenderer.invoke("ocr:health-check", engineId),

    // Model packs (download/refresh/uninstall in settings)
    listPacks: (options) => ipcRenderer.invoke("ocr:packs-list", options),
    downloadPack: (packId) => ipcRenderer.invoke("ocr:packs-download", packId),
    removePack: (packId) => ipcRenderer.invoke("ocr:packs-remove", packId),
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
