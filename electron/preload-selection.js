// electron/preload-selection.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  selection: {
    hide: () => ipcRenderer.invoke("selection:hide"),
    setBounds: (bounds) => ipcRenderer.invoke("selection:set-bounds", bounds),
    moveWindow: (delta) => ipcRenderer.invoke("selection:move-window", delta),
    addToHistory: (item) =>
      ipcRenderer.invoke("selection:add-to-history", item),
    getText: (rect) => ipcRenderer.invoke("selection:get-text", rect),
    resize: (size) => ipcRenderer.invoke("selection:resize", size),

    // 获取选中的文字（传递 rect 用于 OCR 兜底）
    getText: (rect) => ipcRenderer.invoke("selection:get-text", rect),

    resize: (size) => ipcRenderer.invoke("selection:resize", size),

    onShowTrigger: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on("selection:show-trigger", listener);
      // 返回移除监听器的函数
      return () =>
        ipcRenderer.removeListener("selection:show-trigger", listener);
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
});
