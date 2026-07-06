// Screenshot IPC handlers. The capture core itself lives in main.js (wired via
// managers) — the copy that used to live here had drifted and was unreferenced.

const { ipcMain, globalShortcut } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Screenshot');
const { t } = require('../shared/main-i18n');

function register(ctx) {
  const { getMainWindow, runtime, managers } = ctx;

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
        managers.showSelectionWithText(data.text, data.notice);
      } else {
        logger.warn('showSelectionWithText not available in managers');
      }
    } else {
      logger.warn('OCR failed:', data.error);
      const errorText = data.error || '';

      // main-i18n t(key, params): the 2nd arg is interpolation params, not a
      // fallback — these keys exist in main-i18n, so pass the key alone.
      let displayError;
      if (errorText.includes('vision') || errorText.includes('not support') || errorText.includes('不支持')) {
        displayError = t('screenshot.visionNotSupported');
      } else if (errorText.includes('timeout') || errorText.includes('超时')) {
        displayError = t('screenshot.ocrTimeout');
      } else {
        displayError = t('screenshot.ocrFailed') + '：' + errorText;
      }

      if (managers.showSelectionResult) {
        managers.showSelectionResult({
          sourceText: t('screenshot.ocrError'),
          translatedText: displayError,
          isOcrError: true,  // SelectionTranslator shows "Go to OCR Settings" button when set
        });
      } else if (managers.hideSelectionLoading) {
        managers.hideSelectionLoading();
      }
    }
  });

  logger.info('Screenshot IPC handlers registered');
}

module.exports = register;
