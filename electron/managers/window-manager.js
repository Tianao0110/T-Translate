// electron/managers/window-manager.js
// 窗口管理器 - 负责创建、管理各种窗口
// 使用依赖注入，避免循环依赖

const { BrowserWindow, shell } = require('electron');
const path = require('path');
const PATHS = require('../shared/paths');

// 依赖（通过 init 注入）
let store = null;
let runtime = null;
let windows = null;
let isDev = false;
let logger = null;
let makeWindowInvisibleToCapture = null;
let CHANNELS = null;

// 冻结的划词翻译窗口池
const frozenSelectionWindows = new Map();  // Map<windowId, BrowserWindow>
let selectionWindowIdCounter = 0;
const MAX_FROZEN_WINDOWS = 8;  // 最大冻结窗口数

/**
 * 初始化窗口管理器
 * @param {Object} deps - 依赖注入
 */
function init(deps) {
  store = deps.store;
  runtime = deps.runtime;
  windows = deps.windows;
  isDev = deps.isDev;
  logger = deps.logger || console;
  makeWindowInvisibleToCapture = deps.makeWindowInvisibleToCapture || (() => {});
  CHANNELS = deps.CHANNELS || {};
  
  logger.info?.('Window manager initialized') || console.log('Window manager initialized');
}

// ==================== 主窗口 ====================

/**
 * 创建主窗口
 */
function createMainWindow() {
  if (windows.main) {
    windows.main.focus();
    return windows.main;
  }

  const windowBounds = store.get('windowBounds');
  const windowPosition = store.get('windowPosition');

  const mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowPosition?.x,
    y: windowPosition?.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: PATHS.preloads.main,
      webSecurity: false,
    },
    autoHideMenuBar: true,
    menuBarVisible: false,
    icon: PATHS.resources.icon,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    backgroundColor: '#ffffff',
    alwaysOnTop: store.get('alwaysOnTop', false),
  });

  mainWindow.removeMenu();

  // 加载应用
  if (isDev) {
    mainWindow.loadURL(PATHS.pages.main.url);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(PATHS.pages.main.file);
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    if (!store.get('startMinimized')) {
      mainWindow.show();
    }
  });

  // 保存窗口状态
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('move', () => {
    if (!mainWindow.isMaximized()) {
      store.set('windowPosition', mainWindow.getPosition());
    }
  });

  // 关闭窗口处理
  mainWindow.on('close', (event) => {
    if (!runtime.isQuitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    windows.main = null;
  });

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  windows.main = mainWindow;
  logger.info?.('Main window created');
  return mainWindow;
}

// ==================== 玻璃窗口 ====================

/**
 * 创建玻璃翻译窗口
 */
function createGlassWindow() {
  if (windows.glass) {
    windows.glass.focus();
    return windows.glass;
  }

  const glassBounds = store.get('glassBounds', {
    width: 400,
    height: 200,
    x: undefined,
    y: undefined,
  });

  const glassWindow = new BrowserWindow({
    width: glassBounds.width,
    height: glassBounds.height,
    x: glassBounds.x,
    y: glassBounds.y,
    minWidth: 150,
    minHeight: 80,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PATHS.preloads.glass,
    },
  });

  // Windows: 设置窗口为截图不可见
  if (process.platform === 'win32') {
    glassWindow.webContents.on('did-finish-load', () => {
      makeWindowInvisibleToCapture(glassWindow);
    });
  }

  // 加载页面
  if (isDev) {
    glassWindow.loadURL(PATHS.pages.glass.url);
  } else {
    glassWindow.loadFile(PATHS.pages.glass.file);
  }

  // 保存位置
  glassWindow.on('moved', () => {
    if (glassWindow) {
      store.set('glassBounds', glassWindow.getBounds());
    }
  });

  glassWindow.on('resized', () => {
    if (glassWindow) {
      store.set('glassBounds', glassWindow.getBounds());
    }
  });

  glassWindow.on('closed', () => {
    windows.glass = null;
  });

  // 快捷键
  glassWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      glassWindow.close();
    } else if (input.key === ' ' && !input.control && !input.alt && !input.meta) {
      glassWindow.webContents.send(CHANNELS.GLASS?.REFRESH || 'glass:refresh');
    }
  });

  windows.glass = glassWindow;
  logger.info?.('Glass window created');
  return glassWindow;
}

/**
 * 切换玻璃窗口
 */
function toggleGlassWindow() {
  if (windows.glass) {
    if (windows.glass.isVisible()) {
      windows.glass.close();
    } else {
      windows.glass.show();
      windows.glass.focus();
    }
  } else {
    createGlassWindow();
  }
}

// ==================== 字幕采集窗口 ====================

/**
 * 创建字幕采集区窗口
 */
function createSubtitleCaptureWindow() {
  if (windows.subtitleCapture && !windows.subtitleCapture.isDestroyed()) {
    windows.subtitleCapture.show();
    windows.subtitleCapture.focus();
    return windows.subtitleCapture;
  }

  const savedRect = store.get('subtitleCaptureRect', {
    width: 600,
    height: 80,
    x: undefined,
    y: undefined,
  });

  const subtitleWindow = new BrowserWindow({
    width: savedRect.width,
    height: savedRect.height,
    x: savedRect.x,
    y: savedRect.y,
    minWidth: 100,
    minHeight: 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PATHS.preloads.subtitleCapture,
    },
  });

  // Windows: 设置窗口为截图不可见
  if (process.platform === 'win32') {
    subtitleWindow.webContents.on('did-finish-load', () => {
      makeWindowInvisibleToCapture(subtitleWindow);
    });
  }

  // 加载页面
  if (isDev) {
    subtitleWindow.loadURL(PATHS.pages.subtitleCapture.url);
  } else {
    subtitleWindow.loadFile(PATHS.pages.subtitleCapture.file);
  }

  // 更新采集区坐标
  const updateCaptureRect = () => {
    if (subtitleWindow && !subtitleWindow.isDestroyed()) {
      const bounds = subtitleWindow.getBounds();
      runtime.subtitleCaptureRect = bounds;
      store.set('subtitleCaptureRect', bounds);
      // 通知玻璃窗口
      if (windows.glass && !windows.glass.isDestroyed()) {
        windows.glass.webContents.send(
          CHANNELS.SUBTITLE?.CAPTURE_RECT_UPDATED || 'subtitle:capture-rect-updated',
          bounds
        );
      }
    }
  };

  subtitleWindow.on('moved', updateCaptureRect);
  subtitleWindow.on('resized', updateCaptureRect);

  subtitleWindow.on('closed', () => {
    windows.subtitleCapture = null;
  });

  // ESC 关闭
  subtitleWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      subtitleWindow.close();
    }
  });

  runtime.subtitleCaptureRect = savedRect;
  windows.subtitleCapture = subtitleWindow;
  logger.info?.('Subtitle capture window created');
  return subtitleWindow;
}

/**
 * 切换字幕采集区窗口
 */
function toggleSubtitleCaptureWindow() {
  if (windows.subtitleCapture && !windows.subtitleCapture.isDestroyed()) {
    if (windows.subtitleCapture.isVisible()) {
      windows.subtitleCapture.close();
      windows.subtitleCapture = null;
    } else {
      windows.subtitleCapture.show();
      windows.subtitleCapture.focus();
    }
  } else {
    createSubtitleCaptureWindow();
  }
}

// ==================== 划词翻译窗口（多窗口支持） ====================

/**
 * 创建划词翻译窗口
 * 每次创建新窗口，支持多窗口共存
 */
function createSelectionWindow() {
  // 如果当前有活动窗口且未冻结，复用它
  if (windows.selection && !windows.selection.isDestroyed()) {
    // 检查是否已冻结
    const isFrozen = windows.selection._isFrozen;
    if (!isFrozen) {
      return windows.selection;
    }
    // 已冻结，创建新窗口
  }

  // 生成唯一 ID
  const windowId = ++selectionWindowIdCounter;

  const selectionWindow = new BrowserWindow({
    width: 450,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: PATHS.preloads.selection,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  // 存储窗口 ID
  selectionWindow._windowId = windowId;
  selectionWindow._isFrozen = false;

  selectionWindow.setAlwaysOnTop(true, 'screen-saver');
  selectionWindow.setIgnoreMouseEvents(false);

  if (isDev) {
    selectionWindow.loadURL(PATHS.pages.selection.url);
  } else {
    selectionWindow.loadFile(PATHS.pages.selection.file);
  }

  selectionWindow.on('closed', () => {
    // 从冻结窗口池中移除
    if (selectionWindow._isFrozen) {
      frozenSelectionWindows.delete(selectionWindow._windowId);
      logger.debug?.(`Frozen selection window ${selectionWindow._windowId} closed, remaining: ${frozenSelectionWindows.size}`);
    }
    // 如果是当前活动窗口，清除引用
    if (windows.selection === selectionWindow) {
      windows.selection = null;
    }
  });

  windows.selection = selectionWindow;
  logger.debug?.(`Selection window ${windowId} created`);
  return selectionWindow;
}

/**
 * 冻结当前划词翻译窗口
 * 冻结后窗口变成独立的，新划词会创建新窗口
 */
function freezeSelectionWindow() {
  const currentWindow = windows.selection;
  if (!currentWindow || currentWindow.isDestroyed()) {
    return { success: false, error: 'No active window' };
  }

  if (currentWindow._isFrozen) {
    return { success: false, error: 'Already frozen' };
  }

  // 检查是否达到最大数量
  if (frozenSelectionWindows.size >= MAX_FROZEN_WINDOWS) {
    // 关闭最早的冻结窗口
    const oldestId = frozenSelectionWindows.keys().next().value;
    const oldestWindow = frozenSelectionWindows.get(oldestId);
    if (oldestWindow && !oldestWindow.isDestroyed()) {
      oldestWindow.close();
    }
    frozenSelectionWindows.delete(oldestId);
    logger.debug?.(`Closed oldest frozen window ${oldestId} due to limit`);
  }

  // 标记为冻结
  currentWindow._isFrozen = true;
  frozenSelectionWindows.set(currentWindow._windowId, currentWindow);
  
  // 清除活动窗口引用，下次划词会创建新窗口
  windows.selection = null;

  logger.info?.(`Selection window ${currentWindow._windowId} frozen, total frozen: ${frozenSelectionWindows.size}`);
  
  return { 
    success: true, 
    windowId: currentWindow._windowId,
    frozenCount: frozenSelectionWindows.size 
  };
}

/**
 * 关闭指定的冻结窗口
 */
function closeFrozenSelectionWindow(windowId) {
  const frozenWindow = frozenSelectionWindows.get(windowId);
  if (frozenWindow && !frozenWindow.isDestroyed()) {
    frozenWindow.close();
    return { success: true };
  }
  return { success: false, error: 'Window not found' };
}

/**
 * 获取冻结窗口数量
 */
function getFrozenSelectionWindowsCount() {
  return frozenSelectionWindows.size;
}

/**
 * 关闭所有冻结窗口
 */
function closeAllFrozenSelectionWindows() {
  for (const [id, win] of frozenSelectionWindows) {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }
  frozenSelectionWindows.clear();
  logger.info?.('All frozen selection windows closed');
}

// ==================== 截图窗口 ====================

/**
 * 创建截图选区窗口
 * @param {Object} bounds - 屏幕边界
 */
function createScreenshotWindow(bounds) {
  if (windows.screenshot) {
    windows.screenshot.close();
    windows.screenshot = null;
  }

  const { minX, minY, totalWidth, totalHeight } = bounds;

  const screenshotWindow = new BrowserWindow({
    x: minX,
    y: minY,
    width: totalWidth,
    height: totalHeight,
    transparent: true,
    frame: false,
    fullscreen: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  screenshotWindow.setBounds({ x: minX, y: minY, width: totalWidth, height: totalHeight });
  screenshotWindow.loadFile(PATHS.pages.screenshot.file);
  screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  screenshotWindow.focus();

  screenshotWindow.on('closed', () => {
    windows.screenshot = null;
  });

  windows.screenshot = screenshotWindow;
  logger.info?.('Screenshot window created');
  return screenshotWindow;
}

// ==================== 导出 ====================

// 检查点是否在任何划词窗口内
function isPointInSelectionWindows(x, y) {
  // 检查当前活动窗口
  if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
    const bounds = windows.selection.getBounds();
    if (x >= bounds.x && x <= bounds.x + bounds.width &&
        y >= bounds.y && y <= bounds.y + bounds.height) {
      return true;
    }
  }
  
  // 检查所有冻结窗口
  for (const [id, win] of frozenSelectionWindows) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      const bounds = win.getBounds();
      if (x >= bounds.x && x <= bounds.x + bounds.width &&
          y >= bounds.y && y <= bounds.y + bounds.height) {
        return true;
      }
    }
  }
  
  return false;
}

module.exports = {
  isPointInSelectionWindows,
  init,
  // 窗口创建
  createMainWindow,
  createGlassWindow,
  createSubtitleCaptureWindow,
  createSelectionWindow,
  createScreenshotWindow,
  // 窗口切换
  toggleGlassWindow,
  toggleSubtitleCaptureWindow,
  // 划词多窗口管理
  freezeSelectionWindow,
  closeFrozenSelectionWindow,
  getFrozenSelectionWindowsCount,
  closeAllFrozenSelectionWindows,
};
