// electron/preload-selection.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  selection: {
    hide: () => ipcRenderer.invoke("selection:hide"),
    setBounds: (bounds) => ipcRenderer.invoke("selection:set-bounds", bounds),
    addToHistory: (item) => ipcRenderer.invoke("selection:add-to-history", item),
    getText: (rect) => ipcRenderer.invoke("selection:get-text", rect),
    resize: (size) => ipcRenderer.invoke("selection:resize", size),
    startDrag: () => ipcRenderer.invoke("selection:start-drag"),
    
    // 多窗口支持
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
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  },
  
  // 添加 store 访问，让翻译服务可以读取配置
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, value) => ipcRenderer.invoke("store-set", key, value),
  },
  
  // 添加 secureStorage 访问，让翻译服务可以读取加密的 API keys
  secureStorage: {
    encrypt: (key, value) => ipcRenderer.invoke("secure-storage:encrypt", key, value),
    decrypt: (key) => ipcRenderer.invoke("secure-storage:decrypt", key),
  },
});
