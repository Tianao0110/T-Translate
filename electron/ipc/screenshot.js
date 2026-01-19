// electron/ipc/screenshot.js
// 截图功能 IPC handlers
// 包含：截图启动、选区处理、取消等
// 注：核心逻辑暂时在此，后续可拆分到 managers/screenshot-manager.js

const { ipcMain, globalShortcut, screen, BrowserWindow } = require('electron');
const path = require('path');
const { CHANNELS } = require('../shared/channels');
const PATHS = require('../shared/paths');
const logger = require('../utils/logger')('IPC:Screenshot');

/**
 * 注册截图相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { getMainWindow, runtime, store, managers } = ctx;
  
  // 获取截图模块（懒加载）
  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };
  
  // ==================== 截图启动 ====================
  
  /**
   * 开始截图
   */
  ipcMain.handle(CHANNELS.SCREENSHOT.CAPTURE, async () => {
    try {
      // 调用 managers 中的 startScreenshot
      if (managers.startScreenshot) {
        return await managers.startScreenshot(false);
      }
      logger.warn('startScreenshot not available in managers');
      return null;
    } catch (error) {
      logger.error('Capture screen error:', error);
      return null;
    }
  });
  
  // ==================== 选区完成 ====================
  
  /**
   * 截图选区完成
   */
  ipcMain.on(CHANNELS.SCREENSHOT.SELECTION, async (event, bounds) => {
    logger.info('Screenshot selection received:', bounds);
    
    try {
      // 调用 managers 中的 handleScreenshotSelection
      if (managers.handleScreenshotSelection) {
        await managers.handleScreenshotSelection(bounds);
      } else {
        logger.warn('handleScreenshotSelection not available');
      }
    } catch (error) {
      logger.error('Screenshot selection error:', error);
    }
  });
  
  // ==================== 取消截图 ====================
  
  /**
   * 截图取消
   */
  ipcMain.on(CHANNELS.SCREENSHOT.CANCEL, () => {
    logger.info('Screenshot cancelled');
    
    const mainWindow = getMainWindow();
    const screenshotMod = getScreenshotModule();
    
    // 清理截图数据
    runtime.screenshotData = null;
    if (screenshotMod) {
      screenshotMod.clearScreenshotData();
    }
    
    // 取消注册 ESC 快捷键
    try {
      globalShortcut.unregister('Escape');
    } catch (e) {
      // 忽略
    }
    
    // 关闭截图窗口
    const screenshotWindow = runtime._windows?.screenshot;
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.close();
      runtime._windows.screenshot = null;
    }
    
    // 根据来源决定是否恢复主窗口
    if (!runtime.screenshotFromHotkey && runtime.wasMainWindowVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    // 重置状态
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
  });
  
  logger.info('Screenshot IPC handlers registered');
}

// ==================== 截图核心逻辑（供 managers 调用）====================

/**
 * 创建截图选区窗口
 * @param {Object} options - 配置
 * @param {Object} options.runtime - 运行时状态
 * @param {Object} options.store - 存储
 * @param {BrowserWindow} options.mainWindow - 主窗口
 * @param {Function} options.screenshotModule - 截图模块
 * @param {boolean} fromHotkey - 是否从快捷键触发
 */
async function startScreenshot(options, fromHotkey = false) {
  const { runtime, store, mainWindow, screenshotModule } = options;
  
  // 如果已有截图窗口，先关闭
  if (runtime._windows?.screenshot) {
    runtime._windows.screenshot.close();
    runtime._windows.screenshot = null;
  }
  
  // 记录触发来源
  runtime.screenshotFromHotkey = fromHotkey;
  
  // 记录主窗口当前状态
  runtime.wasMainWindowVisible = mainWindow && mainWindow.isVisible();
  
  logger.info('Starting screenshot, fromHotkey:', fromHotkey, 'wasMainWindowVisible:', runtime.wasMainWindowVisible);
  
  // 隐藏主窗口
  if (runtime.wasMainWindowVisible) {
    mainWindow.hide();
  }
  
  // 等待主窗口完全隐藏
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // 获取所有显示器信息
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  // 计算所有显示器的总边界
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
  
  logger.debug('Total screen area:', totalBounds);
  
  // 优先使用 node-screenshots
  let screenshotData = null;
  if (screenshotModule.isNodeScreenshotsAvailable()) {
    logger.debug('Using node-screenshots for capture');
    screenshotData = await screenshotModule.captureWithNodeScreenshots(displays, totalBounds);
  }
  
  // 回退到 desktopCapturer
  if (!screenshotData) {
    logger.debug('Using desktopCapturer fallback');
    screenshotData = await screenshotModule.captureWithDesktopCapturer(
      displays, primaryDisplay, totalBounds, maxScaleFactor
    );
  }
  
  if (screenshotData) {
    screenshotModule.setScreenshotData(screenshotData);
    runtime.screenshotData = screenshotData;
    logger.debug('Screenshot data saved, type:', screenshotData.type);
  } else {
    logger.error('Failed to capture screenshot');
    return null;
  }
  
  // 注册临时的 ESC 全局快捷键用于取消截图
  globalShortcut.register('Escape', () => {
    logger.debug('ESC pressed, cancelling screenshot');
    
    const screenshotWindow = runtime._windows?.screenshot;
    if (screenshotWindow) {
      screenshotWindow.close();
      runtime._windows.screenshot = null;
    }
    
    // 清理
    screenshotModule.clearScreenshotData();
    runtime.screenshotData = null;
    
    // 恢复主窗口
    if (!runtime.screenshotFromHotkey && runtime.wasMainWindowVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    // 重置状态
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
    globalShortcut.unregister('Escape');
  });
  
  // 创建全屏透明窗口用于选区
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
  
  // 保存窗口引用
  runtime._windows.screenshot = screenshotWindow;
  
  // 设置窗口边界
  screenshotWindow.setBounds({ x: minX, y: minY, width: totalWidth, height: totalHeight });
  
  // 传递屏幕边界信息给选区窗口
  screenshotWindow.webContents.on('did-finish-load', async () => {
    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.SCREEN_BOUNDS, {
      minX, minY, maxX, maxY,
    });
    
    // 读取设置中的确认按钮选项
    let showConfirmButtons = true;
    try {
      const settings = store.get('settings');
      if (settings?.screenshot?.showConfirmButtons !== undefined) {
        showConfirmButtons = settings.screenshot.showConfirmButtons;
      }
    } catch (e) {
      logger.debug('Could not read screenshot settings:', e.message);
    }
    
    // 发送配置
    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.CONFIG, {
      showConfirmButtons,
    });
    
    // 确保窗口获得焦点
    screenshotWindow.focus();
    screenshotWindow.webContents.focus();
  });
  
  // 加载截图页面
  screenshotWindow.loadFile(PATHS.pages.screenshot.file);
  
  // 置顶
  screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  screenshotWindow.focus();
  
  // 窗口关闭时清理
  screenshotWindow.on('closed', () => {
    runtime._windows.screenshot = null;
    try {
      globalShortcut.unregister('Escape');
    } catch (e) {
      // 忽略
    }
  });
  
  return screenshotData;
}

/**
 * 处理截图选区
 * @param {Object} options - 配置
 * @param {Object} bounds - 选区边界 { x, y, width, height }
 */
async function handleScreenshotSelection(options, bounds) {
  const { runtime, store, mainWindow, screenshotModule } = options;
  
  logger.info('Handling screenshot selection:', bounds);
  
  // 取消注册 ESC 快捷键
  try {
    globalShortcut.unregister('Escape');
  } catch (e) {
    // 忽略
  }
  
  try {
    // 先关闭选区窗口
    const screenshotWindow = runtime._windows?.screenshot;
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.close();
      runtime._windows.screenshot = null;
    }
    
    // 获取截图数据
    const data = screenshotModule.getScreenshotData() || runtime.screenshotData;
    
    if (!data) {
      throw new Error('没有预先截取的屏幕图像');
    }
    
    let dataURL;
    
    // 根据截图类型处理
    if (data.type === 'node-screenshots') {
      logger.debug('Processing with node-screenshots');
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      // desktopCapturer 回退处理
      logger.debug('Processing with desktopCapturer fallback');
      dataURL = processDesktopCapturerSelection(data, bounds);
    }
    
    logger.debug('DataURL generated, length:', dataURL?.length || 0);
    
    // 清理
    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
    
    // 截图成功后显示主窗口
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 发送截图到渲染进程
    if (mainWindow && dataURL) {
      logger.info('Sending screenshot-captured to renderer');
      mainWindow.webContents.send(CHANNELS.SCREENSHOT.CAPTURED, dataURL);
    }
    
    return dataURL;
  } catch (error) {
    logger.error('Screenshot selection error:', error);
    
    // 清理
    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
    
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    return null;
  }
}

/**
 * 处理 desktopCapturer 的选区（回退方案）
 */
function processDesktopCapturerSelection(data, bounds) {
  const { sources, displays, totalBounds } = data;
  
  if (!sources || sources.length === 0) {
    throw new Error('没有可用的截图源');
  }
  
  const fullScreenshot = sources[0].thumbnail;
  const screenshotSize = fullScreenshot.getSize();
  
  // 计算缩放
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
  
  // 边界检查
  cropBounds.x = Math.max(0, Math.min(cropBounds.x, screenshotSize.width - 1));
  cropBounds.y = Math.max(0, Math.min(cropBounds.y, screenshotSize.height - 1));
  cropBounds.width = Math.max(1, Math.min(cropBounds.width, screenshotSize.width - cropBounds.x));
  cropBounds.height = Math.max(1, Math.min(cropBounds.height, screenshotSize.height - cropBounds.y));
  
  logger.debug('Crop bounds:', cropBounds);
  
  const croppedImage = fullScreenshot.crop(cropBounds);
  return croppedImage.toDataURL();
}

module.exports = register;
module.exports.startScreenshot = startScreenshot;
module.exports.handleScreenshotSelection = handleScreenshotSelection;
