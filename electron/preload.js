// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");
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
    "screenshot-selection",
    "screenshot-cancel",
  ],
  receive: [
    "menu-action", 
    "import-file",
    "screenshot-captured",  // 新增：接收截图
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
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, val) => ipcRenderer.invoke("store-set", key, val),
    delete: (key) => ipcRenderer.invoke("store-delete", key),
    clear: () => ipcRenderer.invoke("store-clear"),
  },
  // 截图相关 API
  screenshot: {
    // 触发截图
    capture: () => ipcRenderer.invoke("capture-screen"),
    // 监听截图完成
    onCaptured: (callback) => {
      const handler = (event, dataURL) => callback(dataURL);
      ipcRenderer.on("screenshot-captured", handler);
      return () => ipcRenderer.removeListener("screenshot-captured", handler);
    },
  },
  // 通用 IPC
  ipc: {
    on: (channel, func) => {
      if (validChannels.receive.includes(channel)) {
        const subscription = (_event, ...args) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
      }
    },
    send: (channel, ...args) => {
      if (validChannels.send.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      }
    },
  },
};

// 暴露 API
try {
  if (!window.electron) {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    console.log("[Preload] electron API exposed");
  }
} catch (error) {
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
