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
  
  // OCR API（与主窗口共享）
  ocr: {
    // PaddleOCR / RapidOCR
    recognizeWithPaddleOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:paddle-ocr", imageData, options),
    // OCR.space
    recognizeWithOCRSpace: (imageData, options) =>
      ipcRenderer.invoke("ocr:ocrspace", imageData, options),
    // Google Vision
    recognizeWithGoogleVision: (imageData, options) =>
      ipcRenderer.invoke("ocr:google-vision", imageData, options),
    // Azure OCR
    recognizeWithAzureOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:azure-ocr", imageData, options),
    // 百度 OCR
    recognizeWithBaiduOCR: (imageData, options) =>
      ipcRenderer.invoke("ocr:baidu-ocr", imageData, options),
    // 获取可用引擎
    getAvailableEngines: () => ipcRenderer.invoke("ocr:get-available-engines"),
    // 检查安装状态
    checkInstalled: () => ipcRenderer.invoke("ocr:check-installed"),
  },
  
  // 翻译 API
  translate: {
    // 调用翻译
    translate: (text, options) => ipcRenderer.invoke('translate:translate', text, options),
    // 流式翻译
    streamTranslate: (text, options) => ipcRenderer.invoke('translate:stream', text, options),
    // 监听流式输出
    onStreamChunk: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('translate:stream-chunk', handler);
      return () => ipcRenderer.removeListener('translate:stream-chunk', handler);
    },
  },
  
  // 剪贴板
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    readText: () => ipcRenderer.invoke('clipboard:read-text'),
  },
});
