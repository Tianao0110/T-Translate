// electron/preload-subtitle-capture.js
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 字幕采集区选择窗口 preload 脚本
 * 这个窗口只需要最简单的功能
 */
contextBridge.exposeInMainWorld('electron', {
  // 关闭窗口
  close: () => ipcRenderer.invoke('subtitle:toggle-capture-window'),
});
