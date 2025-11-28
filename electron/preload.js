// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs').promises;

/**
 * 预加载脚本
 * 在渲染进程中运行，但可以访问 Node.js API
 * 通过 contextBridge 安全地暴露 API 给前端
 */

// 验证通道名称的安全性
const validChannels = {
  send: [
    'minimize-window',
    'maximize-window', 
    'close-window',
    'set-always-on-top',
    'open-external',
    'write-clipboard-text',
    'menu-action'
  ],
  receive: [
    'menu-action',
    'import-file'
  ],
  invoke: [
    'get-app-version',
    'get-platform',
    'show-save-dialog',
    'show-open-dialog',
    'read-clipboard-text',
    'read-clipboard-image',
    'read-file',
    'write-file',
    'file-exists',
    'get-app-path'
  ]
};

/**
 * 主 API 对象
 * 暴露给渲染进程使用
 */
const electronAPI = {
  // 应用信息
  app: {
    getVersion: () => ipcRenderer.invoke('get-app-version'),
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    getPath: (name) => ipcRenderer.invoke('get-app-path', name)
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('minimize-window'),
    maximize: () => ipcRenderer.send('maximize-window'),
    close: () => ipcRenderer.send('close-window'),
    setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),
    
    // 监听窗口事件
    onMaximize: (callback) => {
      ipcRenderer.on('window-maximized', callback);
    },
    onUnmaximize: (callback) => {
      ipcRenderer.on('window-unmaximized', callback);
    }
  },

  // 对话框
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options)
  },

  // 剪贴板
  clipboard: {
    readText: () => ipcRenderer.invoke('read-clipboard-text'),
    writeText: (text) => ipcRenderer.send('write-clipboard-text', text),
    readImage: () => ipcRenderer.invoke('read-clipboard-image')
  },

  // 文件系统（受限）
  fs: {
    readFile: async (filePath) => {
      try {
        const data = await fs.readFile(filePath, 'utf8');
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    
    writeFile: async (filePath, content) => {
      try {
        await fs.writeFile(filePath, content, 'utf8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    
    exists: async (filePath) => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    readJSON: async (filePath) => {
      try {
        const data = await fs.readFile(filePath, 'utf8');
        return { success: true, data: JSON.parse(data) };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    writeJSON: async (filePath, data) => {
      try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  },

  // 系统
  system: {
    openExternal: (url) => ipcRenderer.send('open-external', url),
    
    // 获取系统信息
    getInfo: () => ({
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      versions: process.versions
    })
  },

  // IPC 通信
  ipc: {
    send: (channel, ...args) => {
      if (validChannels.send.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      } else {
        console.error(`Invalid IPC send channel: ${channel}`);
      }
    },
    
    on: (channel, callback) => {
      if (validChannels.receive.includes(channel)) {
        // 包装回调函数，移除 event 参数
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        
        // 返回取消订阅函数
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      } else {
        console.error(`Invalid IPC receive channel: ${channel}`);
      }
    },
    
    once: (channel, callback) => {
      if (validChannels.receive.includes(channel)) {
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.once(channel, subscription);
      } else {
        console.error(`Invalid IPC receive channel: ${channel}`);
      }
    },
    
    invoke: async (channel, ...args) => {
      if (validChannels.invoke.includes(channel)) {
        return await ipcRenderer.invoke(channel, ...args);
      } else {
        console.error(`Invalid IPC invoke channel: ${channel}`);
        throw new Error(`Invalid channel: ${channel}`);
      }
    },
    
    removeAllListeners: (channel) => {
      if (validChannels.receive.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    }
  },

  // 存储（使用 electron-store）
  store: {
    get: async (key, defaultValue) => {
      return await ipcRenderer.invoke('store-get', key, defaultValue);
    },
    
    set: async (key, value) => {
      return await ipcRenderer.invoke('store-set', key, value);
    },
    
    delete: async (key) => {
      return await ipcRenderer.invoke('store-delete', key);
    },
    
    clear: async () => {
      return await ipcRenderer.invoke('store-clear');
    },
    
    has: async (key) => {
      return await ipcRenderer.invoke('store-has', key);
    }
  },

  // 菜单事件监听
  menu: {
    onAction: (callback) => {
      return electronAPI.ipc.on('menu-action', callback);
    }
  },

  // 翻译相关
  translation: {
    // 监听导入文件事件
    onImportFile: (callback) => {
      return electronAPI.ipc.on('import-file', callback);
    },
    
    // 截图功能（需要配合第三方库）
    captureScreen: async () => {
      // 这里可以集成截图功能
      // 例如使用 desktopCapturer API
      return await ipcRenderer.invoke('capture-screen');
    }
  },

  // 工具函数
  utils: {
    // 获取文件路径的基本信息
    pathInfo: (filePath) => {
      return {
        dir: path.dirname(filePath),
        base: path.basename(filePath),
        ext: path.extname(filePath),
        name: path.basename(filePath, path.extname(filePath))
      };
    },
    
    // 路径拼接
    joinPath: (...paths) => {
      return path.join(...paths);
    },
    
    // 获取用户主目录
    getHomePath: () => {
      return process.env.HOME || process.env.USERPROFILE;
    }
  },

  // 环境信息
  env: {
    isDev: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    platform: process.platform,
    appVersion: process.env.npm_package_version || '1.0.0'
  }
};

/**
 * 安全地暴露 API 给渲染进程
 * 渲染进程可以通过 window.electron 访问
 */
contextBridge.exposeInMainWorld('electron', electronAPI);

/**
 * 暴露一些安全的 Node.js 全局对象
 */
contextBridge.exposeInMainWorld('nodeAPI', {
  Buffer: {
    from: (...args) => Buffer.from(...args),
    isBuffer: (obj) => Buffer.isBuffer(obj),
    byteLength: (string, encoding) => Buffer.byteLength(string, encoding),
    concat: (list, totalLength) => Buffer.concat(list, totalLength),
    alloc: (size, fill, encoding) => Buffer.alloc(size, fill, encoding)
  },
  
  process: {
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    versions: process.versions,
    env: {
      // 只暴露安全的环境变量
      NODE_ENV: process.env.NODE_ENV,
      PUBLIC_URL: process.env.PUBLIC_URL
    }
  }
});

/**
 * 性能监控
 */
contextBridge.exposeInMainWorld('performance', {
  // 内存使用情况
  getMemoryUsage: () => {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
      external: Math.round(usage.external / 1024 / 1024) + ' MB'
    };
  },
  
  // CPU 使用情况
  getCPUUsage: () => {
    return process.cpuUsage();
  },
  
  // 运行时间
  getUptime: () => {
    return process.uptime();
  }
});

// 初始化日志
console.log('[Preload] Electron API exposed to renderer');
console.log('[Preload] Platform:', process.platform);
console.log('[Preload] Electron version:', process.versions.electron);
console.log('[Preload] Node version:', process.versions.node);