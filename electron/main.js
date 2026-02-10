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
const { SelectionStateMachine, STATES } = require('./utils/selection-state-machine');

// 全局状态机实例
let selectionStateMachine = null;
const logger = require('./utils/logger')('Main');

// 管理器
const { createMenu } = require('./managers/menu-manager');
const { createTray, updateTrayMenu, destroyTray } = require('./managers/tray-manager');
const windowManager = require('./managers/window-manager');

// 截图模块
const screenshotModule = require('./screenshot-module');

// 多显示器支持
const displayHelper = require('./utils/display-helper');

// ==================== 划词翻译逻辑 ====================

/**
 * 延迟确认：检测双击是否真的选中了文本
 * 通过 Ctrl+C 获取选中内容，如果有内容则显示触发图标
 */
async function handleDelayedConfirm(x, y, rect) {
  try {
    const { hasTextSelection, checkSelectionViaClipboard } = require('./utils/native-helper');
    
    // 等待一小段时间确保双击选中完成（系统需要时间响应）
    // Office 等复杂应用可能需要更长时间
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // ========== 第一层 + 第二层：零剪贴板检测 ==========
    const selectionCheck = hasTextSelection();
    logger.debug(`Selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);
    
    if (selectionCheck.hasSelection === true) {
      // 确认有选区，显示图标
      logger.debug('Delayed confirm: selection detected via Win32 API (layer 1-2)');
      showSelectionTrigger(x, y, rect);
      selectionStateMachine.reset();
      return;
    }
    
    if (selectionCheck.hasSelection === false) {
      // 确认无选区，不显示
      logger.debug('Delayed confirm: no selection detected (layer 1-2)');
      selectionStateMachine.reset();
      return;
    }
    
    // ========== 第三层：剪贴板兜底（复杂应用） ==========
    // 检测是否是 Office 应用（需要更长的等待时间）
    const isOfficeApp = selectionCheck.reason?.includes('OpusApp') || 
                        selectionCheck.reason?.includes('EXCEL') ||
                        selectionCheck.reason?.includes('PPTFrameClass');
    logger.debug(`Delayed confirm: layer 3 - clipboard fallback (office=${isOfficeApp})`);
    
    const clipboardResult = await checkSelectionViaClipboard({ isComplexApp: isOfficeApp });
    
    if (clipboardResult.hasSelection === true) {
      logger.debug(`Delayed confirm: text selected via clipboard "${clipboardResult.text.substring(0, 20)}..."`);
      showSelectionTrigger(x, y, rect);
    } else if (clipboardResult.hasSelection === null) {
      // 防抖跳过或出错，静默处理
      logger.debug('Delayed confirm: clipboard check skipped or failed');
    } else {
      logger.debug('Delayed confirm: no text selected, skip trigger');
    }
    
    // 重置状态机
    selectionStateMachine.reset();
  } catch (err) {
    logger.error('handleDelayedConfirm error:', err);
    // 确保状态机被重置，避免卡住
    if (selectionStateMachine) {
      selectionStateMachine.reset();
    }
  }
}

/**
 * 显示划词翻译触发点
 * 从主窗口获取实时语言设置
 */
async function showSelectionTrigger(mouseX, mouseY, rect) {
  logger.debug('showSelectionTrigger called');
  
  if (!runtime.selectionEnabled) return;

  const settings = store.get('settings', {});
  const selectionSettings = settings.selection || {};
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};

  runtime.lastSelectionRect = rect;

  // 从 electron-store 读取语言设置
  // TranslationPanel 在每次语言变化时已同步到 settings.translation
  // 单一数据源: electron-store，无需 executeJavaScript 注入渲染进程
  const currentTargetLang = translationSettings.targetLanguage
    || translationSettings.defaultTargetLang
    || settings.targetLanguage
    || 'zh';
  const currentSourceLang = translationSettings.sourceLanguage
    || translationSettings.defaultSourceLang
    || settings.sourceLanguage
    || 'auto';
  logger.debug(`Language from electron-store: ${currentSourceLang} -> ${currentTargetLang}`);

  const win = windowManager.createSelectionWindow();

  // 圆点位置
  let triggerX = mouseX + 5;
  let triggerY = mouseY + 5;

  // 屏幕边界检测
  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  const bounds = display.bounds;

  if (triggerX + 24 > bounds.x + bounds.width) {
    triggerX = mouseX - 29;
  }
  if (triggerY + 24 > bounds.y + bounds.height) {
    triggerY = mouseY - 29;
  }

  win.setBounds({
    x: Math.round(triggerX),
    y: Math.round(triggerY),
    width: 24,
    height: 24,
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
        windowOpacity: selectionSettings.windowOpacity || 95,  // 窗口透明度
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
 * 显示划词翻译窗口并直接显示翻译结果（截图翻译联动用）
 * @param {Object} data - 翻译结果数据
 * @param {string} data.sourceText - 原文
 * @param {string} data.translatedText - 译文
 * @param {string} data.sourceLanguage - 源语言
 * @param {string} data.targetLanguage - 目标语言
 */
/**
 * 发送 OCR 文字给划词窗口翻译
 */
function showSelectionWithText(text) {
  const win = runtime.screenshotSelectionWindow;
  
  if (!win || win.isDestroyed()) {
    logger.warn('No selection window to send text to');
    return;
  }
  
  logger.debug('Sending OCR text to selection window');
  
  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const selectionSettings = settings.selection || {};
  
  // 发送文字，划词窗口收到后会自己翻译
  win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
    text: text,  // 模式2：有 text 无 translatedText，划词窗口自己翻译
    theme: interfaceSettings.theme || 'light',
    settings: {
      windowOpacity: selectionSettings.windowOpacity || 95,
      autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
    },
  });
}

/**
 * 关闭截图加载窗口（OCR 失败时调用）
 */
function hideSelectionLoading(errorMsg) {
  const win = runtime.screenshotSelectionWindow;
  
  if (win && !win.isDestroyed()) {
    if (errorMsg) {
      // 显示错误，2秒后关闭
      win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
        sourceText: '',
        translatedText: '',
        error: errorMsg,
      });
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.close();
      }, 2000);
    } else {
      win.close();
    }
  }
  
  runtime.screenshotSelectionWindow = null;
}

/**
 * 显示截图加载窗口
 */
async function showSelectionLoading(bounds) {
  logger.debug('Showing selection loading window');

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const selectionSettings = settings.selection || {};

  const win = windowManager.createSelectionWindow();
  runtime.screenshotSelectionWindow = win;

  // 定位到截图区域右下角
  let posX = bounds.x + bounds.width + 10;
  let posY = bounds.y + bounds.height + 10;

  const display = screen.getDisplayNearestPoint({ x: posX, y: posY });
  const screenBounds = display.bounds;
  // 正方形窗口，与划词翻译的 loading 一致
  const winSize = 24;

  if (posX + winSize > screenBounds.x + screenBounds.width) {
    posX = bounds.x - winSize - 10;
  }
  if (posY + winSize > screenBounds.y + screenBounds.height) {
    posY = bounds.y - winSize - 10;
  }

  posX = Math.max(screenBounds.x, Math.min(posX, screenBounds.x + screenBounds.width - winSize));
  posY = Math.max(screenBounds.y, Math.min(posY, screenBounds.y + screenBounds.height - winSize));

  win.setBounds({ x: Math.round(posX), y: Math.round(posY), width: winSize, height: winSize });
  win.show();

  // 发送 loading 状态
  const sendData = () => {
    win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
      isLoading: true,
      theme: interfaceSettings.theme || 'light',
      settings: { windowOpacity: selectionSettings.windowOpacity || 95 },
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    setTimeout(sendData, 50);
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
 * 启动划词监听（状态机版本）
 */
function startSelectionHook() {
  if (runtime.selectionHook || !runtime.selectionEnabled) return;

  try {
    const { uIOhook } = require('uiohook-napi');
    
    // 初始化状态机
    if (!selectionStateMachine) {
      selectionStateMachine = new SelectionStateMachine();
    }
    selectionStateMachine.reset();

    // ==================== mousedown ====================
    uIOhook.on('mousedown', (e) => {
      if (e.button !== 1) return; // 只处理左键
      
      const cursorPos = screen.getCursorScreenPoint();
      const { x, y } = cursorPos;

      // 检查是否点击在任何划词窗口内（包括冻结窗口）
      if (windowManager.isPointInSelectionWindows(x, y)) {
        runtime.isDraggingOverlay = true;
        return;
      }

      runtime.isDraggingOverlay = false;

      // 检查是否在我们的窗口内
      if (isClickInOurWindows(x, y)) {
        return;
      }

      // 检测是否是连续点击（双击/三击）
      // 如果是，先不隐藏窗口，避免闪烁
      const isMultiClick = selectionStateMachine.peekMultiClick(x, y);
      
      if (!isMultiClick) {
        // 单击：隐藏现有的划词窗口
        hideSelectionWindow();
      }
      
      // 状态机处理 mousedown（双击/三击会在 mouseup 后延迟确认）
      selectionStateMachine.onMouseDown(x, y);
    });

    // ==================== mousemove ====================
    uIOhook.on('mousemove', (e) => {
      if (runtime.isDraggingOverlay) return;
      if (!selectionStateMachine) return;
      
      const state = selectionStateMachine.getState();
      if (state === STATES.IDLE) return;
      
      // 只有在 Possible 或 Likely 状态下才处理
      const cursorPos = screen.getCursorScreenPoint();
      selectionStateMachine.onMouseMove(cursorPos.x, cursorPos.y);
    });

    // ==================== mouseup ====================
    uIOhook.on('mouseup', async (e) => {
      try {
        if (e.button !== 1) return;
        
        if (runtime.isDraggingOverlay) {
          runtime.isDraggingOverlay = false;
          return;
        }

        if (!selectionStateMachine) return;
        
        const state = selectionStateMachine.getState();
        if (state === STATES.IDLE) return;

        const cursorPos = screen.getCursorScreenPoint();
        const { x, y } = cursorPos;

        // 检查是否在 selectionWindow 内
        if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
          const bounds = windows.selection.getBounds();
          if (x >= bounds.x && x <= bounds.x + bounds.width &&
              y >= bounds.y && y <= bounds.y + bounds.height) {
            selectionStateMachine.reset();
            return;
          }
        }

        // 状态机处理 mouseup
        const result = selectionStateMachine.onMouseUp(x, y);
        
        if (result.shouldShow) {
          const rect = result.rect || {
            x: x - 50,
            y: y - 20,
            width: 100,
            height: 40,
          };
          
          // 双击/三击：走延迟确认（三层检测）
          if (result.needsDelayedConfirm) {
            handleDelayedConfirm(x, y, rect);
            return;
          }
          
          // 正常划选：也做选区检测
          const { hasTextSelection, checkSelectionViaClipboard } = require('./utils/native-helper');
          const selectionCheck = hasTextSelection();
          logger.debug(`Normal drag selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);
          
          if (selectionCheck.hasSelection === true) {
            // 第一/二层确认有选区
            showSelectionTrigger(x, y, rect);
            selectionStateMachine.reset();
            return;
          }
          
          if (selectionCheck.hasSelection === false) {
            // 第一层确认无选区（桌面、文件管理器等）
            logger.debug('Normal drag: no selection detected, skip trigger');
            selectionStateMachine.reset();
            return;
          }
          
          // hasSelection 为 null（浏览器等复杂应用），走剪贴板兜底
          // 检测是否是 Office 应用（需要更长的等待时间）
          const isOfficeApp = selectionCheck.reason?.includes('OpusApp') || 
                              selectionCheck.reason?.includes('EXCEL') ||
                              selectionCheck.reason?.includes('PPTFrameClass');
          logger.debug(`Normal drag: complex app, using clipboard fallback (office=${isOfficeApp})`);
          const clipboardResult = await checkSelectionViaClipboard({ isComplexApp: isOfficeApp });
          
          if (clipboardResult.hasSelection === true) {
            showSelectionTrigger(x, y, rect);
          } else {
            logger.debug('Normal drag: clipboard check found no selection');
          }
          selectionStateMachine.reset();
        } else {
          // 重置状态机准备下次
          selectionStateMachine.reset();
        }
      } catch (err) {
        logger.error('mouseup handler error:', err);
        // 确保状态机被重置
        if (selectionStateMachine) {
          selectionStateMachine.reset();
        }
      }
    });

    uIOhook.start();
    runtime.selectionHook = uIOhook;
    logger.info('Selection hook started (state machine mode)');
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
  // 重置状态机（清除定时器）
  if (selectionStateMachine) {
    selectionStateMachine.reset();
  }
  
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

    // 记录截图位置（用于联动划词窗口）
    runtime.lastScreenshotBounds = {
      x: bounds.x + bounds.width,  // 右下角 x
      y: bounds.y + bounds.height, // 右下角 y
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
      timestamp: Date.now(),
    };
    logger.debug('Screenshot position saved:', runtime.lastScreenshotBounds);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.screenshotFromHotkey = false;

    // 获取截图输出模式设置
    const settings = store.get('settings', {});
    const screenshotSettings = settings.screenshot || {};
    const outputMode = screenshotSettings.outputMode || 'bubble'; // 默认气泡模式
    
    if (outputMode === 'main') {
      // 主窗口模式：显示主窗口，发送截图数据
      runtime.wasMainWindowVisible = false;
      if (windows.main) {
        windows.main.show();
        windows.main.focus();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      if (windows.main && dataURL) {
        windows.main.webContents.send(CHANNELS.SCREENSHOT.CAPTURED, dataURL);
      }
    } else {
      // 气泡模式：后台处理，不显示主窗口
      logger.info('Screenshot bubble mode: processing in background');
      
      // 先显示加载状态的划词窗口
      await showSelectionLoading(bounds);
      
      // 确保主窗口已加载（用于后台处理）
      if (!windows.main) {
        windowManager.createMainWindow();
        // 等待窗口加载，但确保不显示
        await new Promise(resolve => setTimeout(resolve, 500));
        // 强制隐藏（防止 ready-to-show 触发显示）
        if (windows.main && !windows.main.isDestroyed()) {
          windows.main.hide();
        }
      }
      
      // 发送截图数据到主窗口（后台处理）
      if (windows.main && dataURL) {
        // 使用字符串而非常量，确保兼容性
        windows.main.webContents.send('screenshot-captured-silent', dataURL);
      }
    }

    return dataURL;
  } catch (error) {
    logger.error('Screenshot selection error:', error);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;

    // 出错时恢复主窗口
    if (windows.main && runtime.wasMainWindowVisible) {
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
  
  // 记录显示器信息
  logger.info('Displays:', displayHelper.getDisplaySummary());
  
  // 监听显示器变化
  displayHelper.onDisplayChange((eventType, display) => {
    logger.info(`Display ${eventType}:`, display?.id, displayHelper.getDisplaySummary());
    
    // 显示器移除时，验证所有窗口位置
    if (eventType === 'removed') {
      // 验证主窗口
      if (windows.main && !windows.main.isDestroyed()) {
        const bounds = windows.main.getBounds();
        const validBounds = displayHelper.ensureBoundsOnDisplay(bounds);
        if (validBounds.adjusted) {
          logger.info('Main window moved to valid display');
          windows.main.setBounds(validBounds);
        }
      }
      // 验证玻璃板窗口
      if (windows.glass && !windows.glass.isDestroyed()) {
        const bounds = windows.glass.getBounds();
        const validBounds = displayHelper.ensureBoundsOnDisplay(bounds);
        if (validBounds.adjusted) {
          logger.info('Glass window moved to valid display');
          windows.glass.setBounds(validBounds);
        }
      }
    }
  });

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
    showSelectionWithText,      // OCR 完成后发送文字给划词窗口
    hideSelectionLoading,       // OCR 失败时关闭加载窗口
    toggleGlassWindow: windowManager.toggleGlassWindow,
    createGlassWindow: windowManager.createGlassWindow,
    toggleSelectionTranslate,
    toggleGlassWindow: windowManager.toggleGlassWindow,
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

  // 内存监控（保存定时器ID以便清理）
  runtime.memoryMonitorInterval = setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    logger.debug(`Memory: ${heapUsedMB}MB`);
    if (heapUsedMB > 500 && global.gc) {
      logger.info('Running garbage collection...');
      global.gc();
    }
  }, 5 * 60 * 1000);

  logger.success('App initialized');
  
  // 预热机制：延迟加载划词翻译相关模块，避免首次使用卡顿
  setTimeout(() => {
    preheatSelectionModules();
  }, 1000); // 1秒后预热
});

/**
 * 预热划词翻译相关模块
 */
function preheatSelectionModules() {
  logger.info('Preheating selection modules...');
  
  try {
    // 1. 预加载 uiohook-napi 并预热 native binding
    const { uIOhook } = require('uiohook-napi');
    logger.debug('uiohook-napi preloaded');
    
    // 预热：start → stop 让 native 层完成初始化，后续启动几乎零延迟
    try {
      uIOhook.start();
      uIOhook.stop();
      logger.debug('uiohook native binding warmed up');
    } catch (e) {
      logger.debug('uiohook warm-up skipped:', e.message);
    }
    
    // 2. 预加载 koffi（Windows API）
    if (process.platform === 'win32') {
      try {
        require('koffi');
        logger.debug('koffi preloaded');
      } catch (e) {
        // 忽略，不是必须的
      }
    }
    
    // 3. 预创建 SelectionWindow（隐藏）
    const preWin = windowManager.createSelectionWindow();
    if (preWin && !preWin.isDestroyed()) {
      // 确保窗口加载完成
      preWin.webContents.once('did-finish-load', () => {
        logger.debug('SelectionWindow preheated');
      });
    }
    
    // 4. 预初始化状态机
    if (!selectionStateMachine) {
      const { SelectionStateMachine } = require('./utils/selection-state-machine');
      selectionStateMachine = new SelectionStateMachine();
      logger.debug('SelectionStateMachine preheated');
    }
    
    logger.success('Selection modules preheated');
  } catch (err) {
    logger.warn('Preheat failed (non-critical):', err.message);
  }
}

// 全局异常处理
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason);
});

// 处理控制台退出 (Ctrl+C)
process.on('SIGINT', () => {
  logger.info('Received SIGINT, quitting...');
  runtime.isQuitting = true;
  app.quit();
});

// 处理终止信号
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, quitting...');
  runtime.isQuitting = true;
  app.quit();
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

// 应用准备退出 - 设置标志并强制销毁所有窗口
app.on('before-quit', () => {
  runtime.isQuitting = true;
  
  // 先停止划词翻译钩子（避免在窗口关闭过程中触发）
  stopSelectionHook();
  
  // 强制销毁所有窗口
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
  });
});

// 应用退出前清理
app.on('will-quit', () => {
  // 清理内存监控定时器
  if (runtime.memoryMonitorInterval) {
    clearInterval(runtime.memoryMonitorInterval);
    runtime.memoryMonitorInterval = null;
  }
  
  unregisterAllShortcuts();
  // stopSelectionHook 已在 before-quit 中调用
  destroyTray();
  
  logger.info('App cleanup completed');
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
