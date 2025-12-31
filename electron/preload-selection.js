// electron/preload-selection.js
// 划词翻译窗口的 preload 脚本
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // 划词翻译 API
  selection: {
    // 获取设置
    getSettings: () => ipcRenderer.invoke('selection:get-settings'),
    
    // 隐藏窗口
    hide: () => ipcRenderer.invoke('selection:hide'),
    
    // 设置窗口位置
    setPosition: (x, y) => ipcRenderer.invoke('selection:set-position', x, y),
    
    // 添加到历史记录
    addToHistory: (item) => ipcRenderer.invoke('selection:add-to-history', item),
    
    // 监听显示触发点
    onShowTrigger: (callback) => {
      ipcRenderer.on('selection:show-trigger', (event, data) => callback(data));
    },
    
    // 监听隐藏
    onHide: (callback) => {
      ipcRenderer.on('selection:hide', () => callback());
    },
  },
  
  // 剪贴板
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    readText: () => ipcRenderer.invoke('clipboard:read-text'),
  },
});
