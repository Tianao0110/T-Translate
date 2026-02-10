// electron/preloads/child-pane.js
// 子玻璃板独立窗口的 preload 脚本

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronChildPane', {
  // 关闭窗口
  close: () => ipcRenderer.send('child-pane:close'),
  
  // 调整窗口大小
  resize: (width, height) => ipcRenderer.send('child-pane:resize', width, height),
  
  // 监听更新
  onUpdate: (callback) => {
    ipcRenderer.on('child-pane:update', (event, data) => callback(data));
  },
  
  // 获取窗口 ID
  getId: () => ipcRenderer.invoke('child-pane:get-id'),
});
