// electron/main.js
// 主进程入口 - 精简版
// 窗口创建已移至 managers/window-manager.js

const {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
} = require('electron');
const path = require('path');

// ==================== 模块导入 ====================
const { store, runtime, windows, isDev } = require('./state');
const { CHANNELS } = require('./shared/channels');
const { initIPC } = require('./ipc');
const { registerAllShortcuts, unregisterAllShortcuts } = require('./ipc/shortcuts');
const { makeWindowInvisibleToCapture, getWindowInfoAtPoint } = require('./utils/native-helper');
const logger = require('./utils/logger')('Main');

// 管理器
const { createMenu } = require('./managers/menu-manager');
const { createTray, updateTrayMenu, destroyTray } = require('./managers/tray-manager');
const windowManager = require('./managers/window-manager');

// 截图模块
const screenshotModule = require('./screenshot-module');

// ==================== 划词翻译逻辑 ====================

/**
 * 显示划词翻译触发点
 * 从主窗口获取实时语言设置
 */
async function showSelectionTrigger(mouseX, mouseY, rect) {
  if (!runtime.selectionEnabled) return;

  const settings = store.get('settings', {});
  const selectionSettings = settings.selection || {};
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};

  runtime.lastSelectionRect = rect;

  // 从主窗口获取实时的目标语言（与主程序同步）
  let currentTargetLang = translationSettings.targetLanguage || 'zh';
  let currentSourceLang = translationSettings.sourceLanguage || 'auto';
  
  if (windows.main && !windows.main.isDestroyed()) {
    try {
      const langSettings = await windows.main.webContents.executeJavaScript(`
        (function() {
          try {
            // 优先从 config store 获取
            const configStore = window.__CONFIG_STORE__;
            if (configStore) {
              const state = configStore.getState();
              return {
                targetLanguage: state.targetLanguage || 'zh',
                sourceLanguage: state.sourceLanguage || 'auto'
              };
            }
            // 备选：从 translation store 获取
            const transStore = window.__TRANSLATION_STORE__;
            if (transStore) {
              const state = transStore.getState();
              return {
                targetLanguage: state.currentTranslation?.targetLanguage || 'zh',
                sourceLanguage: state.currentTranslation?.sourceLanguage || 'auto'
              };
            }
            return null;
          } catch(e) {
            return null;
          }
        })()
      `);
      if (langSettings) {
        currentTargetLang = langSettings.targetLanguage;
        currentSourceLang = langSettings.sourceLanguage;
      }
    } catch (e) {
      // 忽略错误，使用默认值
    }
  }

  const win = windowManager.createSelectionWindow();

  // 圆点位置
  let triggerX = mouseX + 8;
  let triggerY = mouseY + 8;

  // 屏幕边界检测
  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  const bounds = display.bounds;

  if (triggerX + 32 > bounds.x + bounds.width) {
    triggerX = mouseX - 40;
  }
  if (triggerY + 32 > bounds.y + bounds.height) {
    triggerY = mouseY - 40;
  }

  win.setBounds({
    x: Math.round(triggerX),
    y: Math.round(triggerY),
    width: 32,
    height: 32,
  });
  win.show();

  const sendData = () => {
    win.webContents.send(CHANNELS.SELECTION.SHOW_TRIGGER, {
      mouseX,
      mouseY,
      rect,
      theme: interfaceSettings.theme || 'light',
      settings: {
        triggerTimeout: selectionSettings.triggerTimeout || 4000,
        showSourceByDefault: selectionSettings.showSourceByDefault || false,
        autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
        minChars: selectionSettings.minChars || 2,
        maxChars: selectionSettings.maxChars || 500,
      },
      translation: {
        targetLanguage: currentTargetLang,
        sourceLanguage: currentSourceLang,
      },
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    setTimeout(sendData, 50);
  }
}

/**
 * 隐藏划词翻译窗口
 */
function hideSelectionWindow() {
  if (windows.selection && !windows.selection.isDestroyed()) {
    windows.selection.hide();
    windows.selection.webContents.send(CHANNELS.SELECTION.HIDE);
  }
}

/**
 * 切换划词翻译开关
 */
function toggleSelectionTranslate() {
  runtime.selectionEnabled = !runtime.selectionEnabled;
  store.set('selectionEnabled', runtime.selectionEnabled);

  updateTrayMenu();

  if (!runtime.selectionEnabled) {
    hideSelectionWindow();
    stopSelectionHook();
  } else {
    startSelectionHook();
  }

  windows.main?.webContents?.send(CHANNELS.SELECTION.STATE_CHANGED, runtime.selectionEnabled);
  logger.info('Selection translate:', runtime.selectionEnabled ? 'enabled' : 'disabled');
  return runtime.selectionEnabled;
}

/**
 * 启动划词监听
 */
function startSelectionHook() {
  if (runtime.selectionHook || !runtime.selectionEnabled) return;

  try {
    const { uIOhook } = require('uiohook-napi');

    uIOhook.on('mousedown', (e) => {
      if (e.button === 1) {
        runtime.isNativeDragging = false;
        const cursorPos = screen.getCursorScreenPoint();

        // 检查是否点击在 selectionWindow 内
        if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
          const bounds = windows.selection.getBounds();
          if (cursorPos.x >= bounds.x && cursorPos.x <= bounds.x + bounds.width &&
              cursorPos.y >= bounds.y && cursorPos.y <= bounds.y + bounds.height) {
            runtime.isDraggingOverlay = true;
            runtime.mouseDownPos = null;
            return;
          }
        }

        runtime.isDraggingOverlay = false;
        runtime.mouseDownPos = { x: cursorPos.x, y: cursorPos.y };
        runtime.mouseDownTime = Date.now();

        if (isClickInOurWindows(runtime.mouseDownPos.x, runtime.mouseDownPos.y)) {
          runtime.mouseDownPos = null;
          return;
        }

        hideSelectionWindow();
      }
    });

    uIOhook.on('mouseup', async (e) => {
      if (e.button === 1) {
        if (runtime.isDraggingOverlay) {
          runtime.isDraggingOverlay = false;
          runtime.mouseDownPos = null;
          return;
        }

        if (!runtime.mouseDownPos) return;

        const cursorPos = screen.getCursorScreenPoint();
        const mouseUpPos = { x: cursorPos.x, y: cursorPos.y };

        // 检查是否在 selectionWindow 内
        if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
          const bounds = windows.selection.getBounds();
          if (mouseUpPos.x >= bounds.x && mouseUpPos.x <= bounds.x + bounds.width &&
              mouseUpPos.y >= bounds.y && mouseUpPos.y <= bounds.y + bounds.height) {
            runtime.mouseDownPos = null;
            return;
          }
        }

        const distance = Math.sqrt(
          Math.pow(mouseUpPos.x - runtime.mouseDownPos.x, 2) +
          Math.pow(mouseUpPos.y - runtime.mouseDownPos.y, 2)
        );
        const duration = Date.now() - runtime.mouseDownTime;

        // 动态读取设置
        const currentSettings = store.get('settings', {});
        const currentSelectionSettings = currentSettings.selection || {};
        const minDist = currentSelectionSettings.minDistance || 10;
        const minDur = currentSelectionSettings.minDuration || 150;
        const maxDur = currentSelectionSettings.maxDuration || 5000;

        if (distance > minDist && duration > minDur && duration < maxDur && !runtime.isNativeDragging) {
          const startPos = { ...runtime.mouseDownPos };
          const endPos = { ...mouseUpPos };

          const shouldTrigger = await shouldShowSelectionTrigger(startPos, endPos, distance);

          if (!shouldTrigger) {
            runtime.mouseDownPos = null;
            return;
          }

          const rect = {
            x: Math.min(startPos.x, endPos.x),
            y: Math.min(startPos.y, endPos.y),
            width: Math.abs(endPos.x - startPos.x),
            height: Math.abs(endPos.y - startPos.y),
          };

          showSelectionTrigger(endPos.x, endPos.y, rect);
        }

        runtime.mouseDownPos = null;
      }
    });

    uIOhook.start();
    runtime.selectionHook = uIOhook;
    logger.info('Selection hook started');
  } catch (err) {
    logger.error('Failed to start selection hook:', err.message);
    runtime.selectionEnabled = false;
    store.set('selectionEnabled', false);
    updateTrayMenu();
  }
}

/**
 * 停止划词监听
 */
function stopSelectionHook() {
  if (runtime.selectionHook) {
    try {
      runtime.selectionHook.stop();
      runtime.selectionHook = null;
      logger.info('Selection hook stopped');
    } catch (err) {
      logger.error('Failed to stop selection hook:', err);
    }
  }
}

/**
 * 检查坐标是否在我们的窗口内
 */
function isClickInOurWindows(x, y) {
  const windowsToCheck = [windows.main, windows.glass];
  for (const win of windowsToCheck) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      if (win.isMinimized() || !win.isFocused()) continue;
      const bounds = win.getBounds();
      if (x >= bounds.x && x <= bounds.x + bounds.width &&
          y >= bounds.y && y <= bounds.y + bounds.height) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 判断是否应该显示划词翻译触发器
 */
async function shouldShowSelectionTrigger(startPos, endPos, distance) {
  try {
    const deltaX = Math.abs(endPos.x - startPos.x);
    const deltaY = Math.abs(endPos.y - startPos.y);

    // 通用方向检测
    if (deltaX < 5 && deltaY > 30) return false;
    if (deltaY > deltaX && deltaY > 50) return false;

    // 仅 Windows 需要窗口检测
    if (process.platform !== 'win32') return true;

    const windowInfo = getWindowInfoAtPoint(endPos.x, endPos.y);
    if (!windowInfo) return true;

    if (windowInfo.isInputBox) return true;
    if (windowInfo.isDesktop) return false;

    if (windowInfo.isFileManager || windowInfo.isFileView) {
      if (distance > 150) return false;
      if (deltaY > 15) return false;
      if (deltaX > 5 && deltaY > deltaX * 0.2) return false;
      if (deltaX < 30) return false;
    }

    return true;
  } catch (err) {
    logger.error('shouldShowSelectionTrigger error:', err);
    return true;
  }
}

// ==================== 截图功能 ====================

/**
 * 开始截图
 */
async function startScreenshot(fromHotkey = false) {
  if (windows.screenshot) {
    windows.screenshot.close();
    windows.screenshot = null;
  }

  runtime.screenshotFromHotkey = fromHotkey;
  runtime.wasMainWindowVisible = windows.main && windows.main.isVisible();

  logger.info('Starting screenshot, fromHotkey:', fromHotkey);

  if (runtime.wasMainWindowVisible) {
    windows.main.hide();
  }

  await new Promise(resolve => setTimeout(resolve, 300));

  // 获取显示器信息
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxScaleFactor = 1;

  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
    maxScaleFactor = Math.max(maxScaleFactor, display.scaleFactor);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;
  const totalBounds = { minX, minY, maxX, maxY, totalWidth, totalHeight };

  // 截图
  let screenshotData = null;
  if (screenshotModule.isNodeScreenshotsAvailable()) {
    screenshotData = await screenshotModule.captureWithNodeScreenshots(displays, totalBounds);
  }
  if (!screenshotData) {
    screenshotData = await screenshotModule.captureWithDesktopCapturer(
      displays, primaryDisplay, totalBounds, maxScaleFactor
    );
  }

  if (screenshotData) {
    screenshotModule.setScreenshotData(screenshotData);
    runtime.screenshotData = screenshotData;
  } else {
    logger.error('Failed to capture screenshot');
    return null;
  }

  // 注册 ESC 快捷键
  globalShortcut.register('Escape', () => {
    if (windows.screenshot) {
      windows.screenshot.close();
      windows.screenshot = null;
    }
    screenshotModule.clearScreenshotData();
    runtime.screenshotData = null;

    if (!runtime.screenshotFromHotkey && runtime.wasMainWindowVisible && windows.main) {
      windows.main.show();
      windows.main.focus();
    }

    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
    globalShortcut.unregister('Escape');
  });

  // 使用 window-manager 创建截图窗口
  const screenshotWindow = windowManager.createScreenshotWindow(totalBounds);

  screenshotWindow.webContents.on('did-finish-load', () => {
    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.SCREEN_BOUNDS, { minX, minY, maxX, maxY });

    let showConfirmButtons = true;
    try {
      const settings = store.get('settings');
      if (settings?.screenshot?.showConfirmButtons !== undefined) {
        showConfirmButtons = settings.screenshot.showConfirmButtons;
      }
    } catch (e) {}

    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.CONFIG, { showConfirmButtons });
    screenshotWindow.focus();
    screenshotWindow.webContents.focus();
  });

  screenshotWindow.on('closed', () => {
    try { globalShortcut.unregister('Escape'); } catch (e) {}
  });

  return screenshotData;
}

/**
 * 处理截图选区
 */
async function handleScreenshotSelection(bounds) {
  logger.info('Handling screenshot selection:', bounds);

  try { globalShortcut.unregister('Escape'); } catch (e) {}

  try {
    if (windows.screenshot) {
      windows.screenshot.close();
      windows.screenshot = null;
    }

    const data = screenshotModule.getScreenshotData() || runtime.screenshotData;
    if (!data) {
      throw new Error('没有预先截取的屏幕图像');
    }

    let dataURL;
    if (data.type === 'node-screenshots') {
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      dataURL = processDesktopCapturerSelection(data, bounds);
    }

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;

    if (windows.main) {
      windows.main.show();
      windows.main.focus();
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    if (windows.main && dataURL) {
      windows.main.webContents.send(CHANNELS.SCREENSHOT.CAPTURED, dataURL);
    }

    return dataURL;
  } catch (error) {
    logger.error('Screenshot selection error:', error);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;

    if (windows.main) {
      windows.main.show();
      windows.main.focus();
    }

    return null;
  }
}

/**
 * 处理 desktopCapturer 的选区
 */
function processDesktopCapturerSelection(data, bounds) {
  const { sources, totalBounds } = data;

  if (!sources || sources.length === 0) {
    throw new Error('没有可用的截图源');
  }

  const fullScreenshot = sources[0].thumbnail;
  const screenshotSize = fullScreenshot.getSize();

  const scaleX = screenshotSize.width / totalBounds.totalWidth;
  const scaleY = screenshotSize.height / totalBounds.totalHeight;

  const relativeX = bounds.x - totalBounds.minX;
  const relativeY = bounds.y - totalBounds.minY;

  let cropBounds = {
    x: Math.round(relativeX * scaleX),
    y: Math.round(relativeY * scaleY),
    width: Math.round(bounds.width * scaleX),
    height: Math.round(bounds.height * scaleY),
  };

  cropBounds.x = Math.max(0, Math.min(cropBounds.x, screenshotSize.width - 1));
  cropBounds.y = Math.max(0, Math.min(cropBounds.y, screenshotSize.height - 1));
  cropBounds.width = Math.max(1, Math.min(cropBounds.width, screenshotSize.width - cropBounds.x));
  cropBounds.height = Math.max(1, Math.min(cropBounds.height, screenshotSize.height - cropBounds.y));

  const croppedImage = fullScreenshot.crop(cropBounds);
  return croppedImage.toDataURL();
}

// ==================== 应用生命周期 ====================

app.whenReady().then(() => {
  logger.info('App ready, initializing...');

  // 初始化窗口管理器
  windowManager.init({
    store,
    runtime,
    windows,
    isDev,
    logger,
    makeWindowInvisibleToCapture,
    CHANNELS,
  });

  // 创建主窗口
  windowManager.createMainWindow();

  // managers 对象（用于依赖注入）
  const managers = {
    startScreenshot,
    handleScreenshotSelection,
    toggleGlassWindow: windowManager.toggleGlassWindow,
    createGlassWindow: windowManager.createGlassWindow,
    toggleSelectionTranslate,
    toggleSubtitleCaptureWindow: windowManager.toggleSubtitleCaptureWindow,
  };

  // 创建上下文（共享给菜单和托盘）
  const ctx = {
    getMainWindow: () => windows.main,
    runtime,
    store,
    managers,
  };

  // 创建菜单和托盘
  createMenu(ctx);
  createTray(ctx);

  // 初始化 IPC
  initIPC({
    windows,
    runtime,
    store,
    app,
    managers,
  });

  // 注册全局快捷键
  registerAllShortcuts({
    store,
    getMainWindow: () => windows.main,
    managers,
  });

  // 划词翻译默认关闭
  runtime.selectionEnabled = false;
  store.set('selectionEnabled', false);

  // 内存监控
  setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    logger.debug(`Memory: ${heapUsedMB}MB`);
    if (heapUsedMB > 500 && global.gc) {
      logger.info('Running garbage collection...');
      global.gc();
    }
  }, 5 * 60 * 1000);

  logger.success('App initialized');
});

// 全局异常处理
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason);
});

// 窗口全部关闭
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 激活应用
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  } else {
    windows.main?.show();
  }
});

// 应用退出前清理
app.on('will-quit', () => {
  unregisterAllShortcuts();
  stopSelectionHook();
  destroyTray();
});

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (windows.main) {
      if (windows.main.isMinimized()) windows.main.restore();
      windows.main.focus();
    }
  });
}

// 导出（用于测试）
module.exports = { windows };
