// electron/shared/paths.js
// ============================================================
// 路径配置中心 - 统一管理所有文件路径
// ============================================================
// 
// 使用方法:
// const PATHS = require('./shared/paths');
// mainWindow.loadFile(PATHS.pages.main.file);
// mainWindow.loadURL(PATHS.pages.main.url);
// ============================================================

const path = require('path');

// 检测是否为开发环境
// 注意：此文件可能在 app ready 之前被加载，所以不能直接使用 app.isPackaged
const isDev = process.env.NODE_ENV === 'development' || 
              process.argv.includes('--dev') ||
              !process.defaultApp === false;

// 开发服务器地址
const DEV_SERVER = 'http://localhost:5173';

// 基础目录（相对于此文件所在位置 electron/shared/）
const BASE_DIR = path.join(__dirname, '../..');
const ELECTRON_DIR = path.join(__dirname, '..');

/**
 * Preload 脚本路径
 */
const preloads = {
  main: path.join(ELECTRON_DIR, 'preloads/main.js'),
  selection: path.join(ELECTRON_DIR, 'preloads/selection.js'),
  glass: path.join(ELECTRON_DIR, 'preloads/glass.js'),
  subtitleCapture: path.join(ELECTRON_DIR, 'preloads/subtitle-capture.js'),
  childPane: path.join(ELECTRON_DIR, 'preloads/child-pane.js'),
};

/**
 * HTML 页面路径
 * 每个页面提供 url (开发环境) 和 file (生产环境) 两个路径
 */
const pages = {
  main: {
    url: DEV_SERVER,
    file: path.join(BASE_DIR, 'build/index.html'),
  },
  selection: {
    url: `${DEV_SERVER}/selection.html`,
    file: path.join(BASE_DIR, 'build/selection.html'),
  },
  glass: {
    url: `${DEV_SERVER}/glass.html`,
    file: path.join(BASE_DIR, 'build/glass.html'),
  },
  subtitleCapture: {
    // 字幕采集不经过 Vite 构建，直接从 public 加载
    url: path.join(BASE_DIR, 'public/subtitle-capture.html'),
    file: path.join(BASE_DIR, 'public/subtitle-capture.html'),
  },
  screenshot: {
    // 截图页面不经过 Vite 构建，直接从 public 加载
    url: path.join(BASE_DIR, 'public/screenshot.html'),
    file: path.join(BASE_DIR, 'public/screenshot.html'),
  },
  childPane: {
    // 子玻璃板独立窗口
    url: `${DEV_SERVER}/child-pane.html`,
    file: path.join(BASE_DIR, 'build/child-pane.html'),
  },
};

/**
 * 资源文件路径
 */
const resources = {
  icon: path.join(BASE_DIR, 'public/icon.png'),
  trayIcon: path.join(BASE_DIR, 'public/tray-icon.ico'),
  ocrData: path.join(BASE_DIR, 'resources/ocr'),
};

/**
 * 辅助函数：根据环境加载页面
 * @param {BrowserWindow} window - Electron 窗口实例
 * @param {string} pageName - 页面名称 (main, selection, glass, subtitleCapture, screenshot)
 * @param {boolean} devMode - 是否为开发模式（可选，默认自动检测）
 */
function loadPage(window, pageName, devMode = isDev) {
  const page = pages[pageName];
  if (!page) {
    throw new Error(`Unknown page: ${pageName}`);
  }
  
  if (devMode && pageName !== 'screenshot') {
    window.loadURL(page.url);
  } else {
    window.loadFile(page.file);
  }
}

/**
 * 获取 preload 脚本路径
 * @param {string} name - preload 名称 (main, selection, glass, subtitleCapture)
 * @returns {string} 完整路径
 */
function getPreload(name) {
  const preload = preloads[name];
  if (!preload) {
    throw new Error(`Unknown preload: ${name}`);
  }
  return preload;
}

module.exports = {
  // 路径对象
  preloads,
  pages,
  resources,
  
  // 辅助函数
  loadPage,
  getPreload,
  
  // 环境变量
  isDev,
  DEV_SERVER,
  BASE_DIR,
  ELECTRON_DIR,
};
