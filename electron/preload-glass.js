// electron/preload-glass.js
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 玻璃翻译窗口 preload 脚本
 * 暴露必要的 API 给渲染进程
 */
contextBridge.exposeInMainWorld('electron', {
  // 玻璃窗口专用 API
  glass: {
    // 获取窗口边界
    getBounds: () => ipcRenderer.invoke('glass:get-bounds'),
    
    // 截取区域
    captureRegion: (bounds) => ipcRenderer.invoke('glass:capture-region', bounds),
    
    // 翻译文本
    translate: (text) => ipcRenderer.invoke('glass:translate', text),
    
    // 设置穿透模式
    setPassThrough: (enabled) => ipcRenderer.invoke('glass:set-pass-through', enabled),
    
    // 动态设置穿透（根据鼠标位置）
    setIgnoreMouse: (ignore) => ipcRenderer.invoke('glass:set-ignore-mouse', ignore),
    
    // 设置置顶
    setAlwaysOnTop: (enabled) => ipcRenderer.invoke('glass:set-always-on-top', enabled),
    
    // 关闭窗口
    close: () => ipcRenderer.invoke('glass:close'),
    
    // 获取设置（合并主程序设置）
    getSettings: () => ipcRenderer.invoke('glass:get-settings'),
    
    // 保存本地设置
    saveSettings: (settings) => ipcRenderer.invoke('glass:save-settings', settings),
    
    // 添加到收藏
    addToFavorites: (item) => ipcRenderer.invoke('glass:add-to-favorites', item),
    
    // 添加到历史记录
    addToHistory: (item) => ipcRenderer.invoke('glass:add-to-history', item),
    
    // 同步目标语言到主程序
    syncTargetLanguage: (langCode) => ipcRenderer.invoke('glass:sync-target-language', langCode),
    
    // 监听隐藏（截图前）
    onHideForCapture: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('glass:hide-for-capture', handler);
      return () => ipcRenderer.removeListener('glass:hide-for-capture', handler);
    },
    
    // 监听显示（截图后）
    onShowAfterCapture: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('glass:show-after-capture', handler);
      return () => ipcRenderer.removeListener('glass:show-after-capture', handler);
    },
  },
  
  // 剪贴板
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    readText: () => ipcRenderer.invoke('clipboard:read-text'),
  },
});
