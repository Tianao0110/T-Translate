// Screenshot IPC handlers + capture core logic (used by managers).

const { ipcMain, globalShortcut, screen, BrowserWindow } = require('electron');
const path = require('path');
const { CHANNELS } = require('../shared/channels');
const PATHS = require('../shared/paths');
const logger = require('../utils/logger')('IPC:Screenshot');
const { t } = require('../shared/main-i18n');

function register(ctx) {
  const { getMainWindow, runtime, store, managers } = ctx;

  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };

  ipcMain.handle(CHANNELS.SCREENSHOT.CAPTURE, async () => {
    try {
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

  ipcMain.on(CHANNELS.SCREENSHOT.SELECTION, async (event, bounds) => {
    logger.info('Screenshot selection received:', bounds);

    try {
      if (managers.handleScreenshotSelection) {
        await managers.handleScreenshotSelection(bounds);
      } else {
        logger.warn('handleScreenshotSelection not available');
      }
    } catch (error) {
      logger.error('Screenshot selection error:', error);
    }
  });

  ipcMain.on(CHANNELS.SCREENSHOT.CANCEL, () => {
    logger.info('Screenshot cancelled');

    const mainWindow = getMainWindow();
    const screenshotMod = getScreenshotModule();

    runtime.screenshotData = null;
    if (screenshotMod) {
      screenshotMod.clearScreenshotData();
    }

    try {
      globalShortcut.unregister('Escape');
    } catch (e) {}

    const screenshotWindow = runtime._windows?.screenshot;
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.close();
      runtime._windows.screenshot = null;
    }

    // Only restore main window if it was visible before AND user opened from UI (not hotkey)
    if (!runtime.screenshotFromHotkey && runtime.wasMainWindowVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }

    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
  });

  // OCR done -> push text into selection window for translation
  ipcMain.on(CHANNELS.SCREENSHOT.OCR_COMPLETE, (event, data) => {
    if (data.success && data.text) {
      logger.info('OCR complete, sending text to selection window for translation');
      if (managers.showSelectionWithText) {
        managers.showSelectionWithText(data.text);
      } else {
        logger.warn('showSelectionWithText not available in managers');
      }
    } else {
      logger.warn('OCR failed:', data.error);
      const settings = store?.get('settings', {}) || {};
      const targetLang = settings.translation?.targetLanguage || 'zh';
      const errorText = data.error || '';
      const isZh = targetLang.startsWith('zh');

      let displayError;
      if (errorText.includes('vision') || errorText.includes('not support') || errorText.includes('不支持')) {
        displayError = t('screenshot.visionNotSupported', '当前模型不支持图片识别，请加载视觉模型（如 Qwen-VL、LLaVA）');
      } else if (errorText.includes('timeout') || errorText.includes('超时')) {
        displayError = t('screenshot.ocrTimeout', 'OCR 识别超时，请检查模型是否正常运行');
      } else {
        displayError = t('screenshot.ocrFailed', 'OCR 识别失败') + '：' + errorText;
      }

      if (managers.showSelectionResult) {
        managers.showSelectionResult({
          sourceText: t('screenshot.ocrError', 'OCR 错误'),
          translatedText: displayError,
        });
      } else if (managers.hideSelectionLoading) {
        managers.hideSelectionLoading();
      }
    }
  });

  logger.info('Screenshot IPC handlers registered');
}

// ===== Capture core (called by managers) =====

async function startScreenshot(options, fromHotkey = false) {
  const { runtime, store, mainWindow, screenshotModule } = options;

  if (runtime._windows?.screenshot) {
    runtime._windows.screenshot.close();
    runtime._windows.screenshot = null;
  }

  runtime.screenshotFromHotkey = fromHotkey;
  runtime.wasMainWindowVisible = mainWindow && mainWindow.isVisible();

  logger.info('Starting screenshot, fromHotkey:', fromHotkey, 'wasMainWindowVisible:', runtime.wasMainWindowVisible);

  if (runtime.wasMainWindowVisible) {
    mainWindow.hide();
  }

  // Let the hide animation complete so it isn't captured in the screenshot
  await new Promise(resolve => setTimeout(resolve, 300));

  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  // Union bounds of all monitors (for multi-display capture)
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

  // Prefer node-screenshots (native, faster, handles HiDPI); fall back to desktopCapturer
  let screenshotData = null;
  if (screenshotModule.isNodeScreenshotsAvailable()) {
    logger.debug('Using node-screenshots for capture');
    screenshotData = await screenshotModule.captureWithNodeScreenshots(displays, totalBounds);
  }

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

  // ESC = cancel. Registered globally so it wins over focused-app shortcuts.
  globalShortcut.register('Escape', () => {
    logger.debug('ESC pressed, cancelling screenshot');

    const screenshotWindow = runtime._windows?.screenshot;
    if (screenshotWindow) {
      screenshotWindow.close();
      runtime._windows.screenshot = null;
    }

    screenshotModule.clearScreenshotData();
    runtime.screenshotData = null;

    if (!runtime.screenshotFromHotkey && runtime.wasMainWindowVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }

    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
    globalShortcut.unregister('Escape');
  });

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

  runtime._windows.screenshot = screenshotWindow;

  screenshotWindow.setBounds({ x: minX, y: minY, width: totalWidth, height: totalHeight });

  screenshotWindow.webContents.on('did-finish-load', async () => {
    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.SCREEN_BOUNDS, {
      minX, minY, maxX, maxY,
    });

    let showConfirmButtons = true;
    try {
      const settings = store.get('settings');
      if (settings?.screenshot?.showConfirmButtons !== undefined) {
        showConfirmButtons = settings.screenshot.showConfirmButtons;
      }
    } catch (e) {
      logger.debug('Could not read screenshot settings:', e.message);
    }

    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.CONFIG, {
      showConfirmButtons,
    });

    screenshotWindow.focus();
    screenshotWindow.webContents.focus();
  });

  screenshotWindow.loadFile(PATHS.pages.screenshot.file);

  // 'screen-saver' level keeps it above fullscreen apps
  screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  screenshotWindow.focus();

  screenshotWindow.on('closed', () => {
    runtime._windows.screenshot = null;
    try {
      globalShortcut.unregister('Escape');
    } catch (e) {}
  });

  return screenshotData;
}

async function handleScreenshotSelection(options, bounds) {
  const { runtime, store, mainWindow, screenshotModule } = options;

  logger.info('Handling screenshot selection:', bounds);

  try {
    globalShortcut.unregister('Escape');
  } catch (e) {}

  try {
    const screenshotWindow = runtime._windows?.screenshot;
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.close();
      runtime._windows.screenshot = null;
    }

    const data = screenshotModule.getScreenshotData() || runtime.screenshotData;

    if (!data) {
      throw new Error(t('screenshot.noImage', '没有预先截取的屏幕图像'));
    }

    let dataURL;

    if (data.type === 'node-screenshots') {
      logger.debug('Processing with node-screenshots');
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      logger.debug('Processing with desktopCapturer fallback');
      dataURL = processDesktopCapturerSelection(data, bounds);
    }

    logger.debug('DataURL generated, length:', dataURL?.length || 0);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    if (mainWindow && dataURL) {
      logger.info('Sending screenshot-captured to renderer');
      mainWindow.webContents.send(CHANNELS.SCREENSHOT.CAPTURED, dataURL);
    }

    return dataURL;
  } catch (error) {
    logger.error('Screenshot selection error:', error);

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

// Fallback when node-screenshots is unavailable. desktopCapturer gives one big
// thumbnail across all displays; scale renderer bounds back to thumbnail pixels.
function processDesktopCapturerSelection(data, bounds) {
  const { sources, displays, totalBounds } = data;

  if (!sources || sources.length === 0) {
    throw new Error(t('screenshot.noSource', '没有可用的截图源'));
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

  // Clamp to thumbnail bounds; crop with width/height < 1 throws
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
