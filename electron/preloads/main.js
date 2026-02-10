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
    "navigate",  // 托盘菜单导航
    "import-file",
    "add-to-favorites",  // 玻璃窗口收藏
    "add-to-history",    // 玻璃窗口历史记录
    "sync-target-language",  // 玻璃窗口语言同步
    "glass:translate-request",  // 玻璃窗口翻译请求
    "screenshot-captured",  // 截图完成
    "screenshot-captured-silent",  // 截图完成（静默模式）
    "selection-state-changed",  // 划词翻译状态变化
    "theme:changed",  // 主题变化通知
    "maximize-change",  // 窗口最大化状态变化
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
    "glass:notify-settings-changed",  // 通知玻璃窗设置更新
    "secure-storage:encrypt",  // 加密存储
    "secure-storage:decrypt",  // 解密读取
    "secure-storage:delete",   // 删除
    "secure-storage:is-available",  // 检查加密是否可用
    "selection:toggle",  // 切换划词翻译
    "selection:get-enabled",  // 获取划词翻译状态
    "theme:get",   // 获取主题
    "theme:set",   // 设置主题
    "theme:sync",  // 同步主题
    "logs:open-directory",  // 打开日志目录
    "logs:get-directory",   // 获取日志目录路径
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
    checkUpdate: () => ipcRenderer.invoke("app:check-update"),
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
  // 日志管理
  logs: {
    openDirectory: () => ipcRenderer.invoke("logs:open-directory"),
    getDirectory: () => ipcRenderer.invoke("logs:get-directory"),
  },
  // Electron Store
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, val) => ipcRenderer.invoke("store-set", key, val),
    delete: (key) => ipcRenderer.invoke("store-delete", key),
    clear: () => ipcRenderer.invoke("store-clear"),
  },
  // 安全存储（加密 API Key 等）
  secureStorage: {
    encrypt: (key, value) => ipcRenderer.invoke("secure-storage:encrypt", key, value),
    decrypt: (key) => ipcRenderer.invoke("secure-storage:decrypt", key),
    delete: (key) => ipcRenderer.invoke("secure-storage:delete", key),
    isAvailable: () => ipcRenderer.invoke("secure-storage:is-available"),
  },
  // 玻璃翻译窗口
  glass: {
    open: () => ipcRenderer.invoke("glass:open"),
    notifySettingsChanged: () => ipcRenderer.invoke("glass:notify-settings-changed"),
  },
  // 划词翻译
  selection: {
    toggle: () => ipcRenderer.invoke("selection:toggle"),
    getEnabled: () => ipcRenderer.invoke("selection:get-enabled"),
  },
  // 主题管理（统一 API）
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
  // 全局快捷键管理
  shortcuts: {
    update: (action, shortcut) => ipcRenderer.invoke("shortcuts:update", action, shortcut),
    get: () => ipcRenderer.invoke("shortcuts:get"),
    pause: (action) => ipcRenderer.invoke("shortcuts:pause", action),
    resume: (action) => ipcRenderer.invoke("shortcuts:resume", action),
  },
  // 隐私模式管理
  privacy: {
    setMode: (mode) => ipcRenderer.invoke("privacy:setMode", mode),
    getMode: () => ipcRenderer.invoke("privacy:getMode"),
  },
  // API 健康检查
  api: {
    healthCheck: () => ipcRenderer.invoke("api:health-check"),
  },
  // OCR API
  ocr: {
    // 本地 OCR
    checkWindowsOCR: () => ipcRenderer.invoke("ocr:check-windows-ocr"),
    recognizeWithWindowsOCR: (imageData, options) => 
      ipcRenderer.invoke("ocr:windows-ocr", imageData, options),
    checkPaddleOCR: () => ipcRenderer.invoke("ocr:check-paddle-ocr"),
    recognizeWithPaddleOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:paddle-ocr", imageData, options),
    
    // 在线 OCR API
    recognizeWithOCRSpace: (imageData, options) =>
      ipcRenderer.invoke("ocr:ocrspace", imageData, options),
    recognizeWithGoogleVision: (imageData, options) =>
      ipcRenderer.invoke("ocr:google-vision", imageData, options),
    recognizeWithAzureOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:azure-ocr", imageData, options),
    recognizeWithBaiduOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:baidu-ocr", imageData, options),
    
    // 管理功能
    getAvailableEngines: () => ipcRenderer.invoke("ocr:get-available-engines"),
    checkInstalled: () => ipcRenderer.invoke("ocr:check-installed"),
    downloadEngine: (engineId) => ipcRenderer.invoke("ocr:download-engine", engineId),
    removeEngine: (engineId) => ipcRenderer.invoke("ocr:remove-engine", engineId),
    repairEngine: (engineId) => ipcRenderer.invoke("ocr:repair-engine", engineId),
    healthCheck: (engineId) => ipcRenderer.invoke("ocr:health-check", engineId),
    onDownloadProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on("ocr:download-progress", handler);
      return () => ipcRenderer.removeListener("ocr:download-progress", handler);
    },
  },
  // 截图 API
  screenshot: {
    capture: () => ipcRenderer.invoke("capture-screen"),
    onCaptured: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on("screenshot-captured", handler);
      return () => ipcRenderer.removeListener("screenshot-captured", handler);
    },
    // 静默模式截图完成（不显示主窗口，后台处理）
    onCapturedSilent: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on("screenshot-captured-silent", handler);
      return () => ipcRenderer.removeListener("screenshot-captured-silent", handler);
    },
    // 通知 OCR 完成（主窗口后台 OCR 完成后调用）
    notifyOcrComplete: (data) => {
      ipcRenderer.send("screenshot:ocr-complete", data);
    },
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
