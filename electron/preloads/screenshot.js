// electron/preloads/screenshot.js
// 截图选区窗口 preload 脚本
// 安全改造：使用 contextBridge 暴露有限 API

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronScreenshot', {
  // 发送选区结果
  sendSelection: (bounds) => {
    ipcRenderer.send('screenshot-selection', bounds);
  },
  
  // 取消截图
  cancel: () => {
    ipcRenderer.send('screenshot-cancel');
  },
  
  // 接收配置
  onConfig: (callback) => {
    ipcRenderer.on('screenshot-config', (event, config) => callback(config));
  },
});
