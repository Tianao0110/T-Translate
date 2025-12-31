// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
// 注意：main.js 必须设置 sandbox: false 才能使用 fs
const fs = require("fs").promises;

/**
 * 安全通道白名单
 */
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
    "add-to-favorites",  // 玻璃窗口收藏
    "glass:translate-request",  // 玻璃窗口翻译请求
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
    "glass:open",  // 打开玻璃窗口
  ],
};

/**
 * 主 API 定义
 */
const electronAPI = {
  app: {
    getVersion: () => ipcRenderer.invoke("get-app-version"),
    getPlatform: () => ipcRenderer.invoke("get-platform"),
    getPath: (name) => ipcRenderer.invoke("get-app-path", name),
  },
  window: {
    minimize: () => ipcRenderer.send("minimize-window"),
    maximize: () => ipcRenderer.send("maximize-window"),
    close: () => ipcRenderer.send("close-window"),
    setAlwaysOnTop: (flag) => ipcRenderer.send("set-always-on-top", flag),
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
  // 简单的文件系统封装
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
  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.send("open-external", url),
  },
  // Electron Store
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, val) => ipcRenderer.invoke("store-set", key, val),
    delete: (key) => ipcRenderer.invoke("store-delete", key),
    clear: () => ipcRenderer.invoke("store-clear"),
  },
  // 玻璃翻译窗口
  glass: {
    open: () => ipcRenderer.invoke("glass:open"),
  },
  // 通用 IPC (带白名单检查)
  ipc: {
    on: (channel, func) => {
      if (validChannels.receive.includes(channel)) {
        const subscription = (_event, ...args) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
      }
    },
  },
  // 直接暴露 ipcRenderer（用于玻璃窗口通信）
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

// ============================================================
// 暴露 API (带防重复检查)
// ============================================================

try {
  // 只有当 window.electron 不存在时才暴露，防止热重载报错
  if (!window.electron) {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    console.log("[Preload] electron API exposed");
  }
} catch (error) {
  // 忽略 "API already exists" 错误
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
  // 忽略重复绑定错误
}
