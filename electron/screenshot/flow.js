// Screenshot OCR flow in the main process: capture every display, open the
// region-selection overlay, crop the chosen region, then hand the image to
// the main window (main-window mode) or to the selection window via the
// silent OCR chain (bubble mode). Wired from main.js; the IPC layer and the
// global shortcut reach it through `managers`.

const { screen, globalShortcut } = require('electron');
const { store, runtime, windows } = require('../state');
const { CHANNELS } = require('../shared/channels');
const windowManager = require('../windows/window-manager');
const screenshotModule = require('./screenshot-module');
const { showSelectionLoading } = require('../selection/controller');
const logger = require('../platform/logger')('Screenshot');

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

  // Span all displays — compute the union bounding box.
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

  // Prefer node-screenshots (faster) and fall back to Electron's desktopCapturer.
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

  // ESC cancels the screenshot selection.
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

  const screenshotWindow = windowManager.createScreenshotWindow(totalBounds);

  screenshotWindow.webContents.on('did-finish-load', () => {
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
      throw new Error('No screenshot data available');
    }

    let dataURL;
    if (data.type === 'node-screenshots') {
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      dataURL = screenshotModule.cropFromDesktopCapturer(data, bounds);
    }

    // Save screenshot position for chaining into the selection-translate window.
    runtime.lastScreenshotBounds = {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
      timestamp: Date.now(),
    };
    logger.debug('Screenshot position saved:', runtime.lastScreenshotBounds);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.screenshotFromHotkey = false;

    const settings = store.get('settings', {});
    const screenshotSettings = settings.screenshot || {};
    const outputMode = screenshotSettings.outputMode || 'bubble';

    if (outputMode === 'main') {
      // Main-window mode: show main window and hand off the captured dataURL.
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
      // Bubble mode: background-process the screenshot, no main-window show.
      logger.info('Screenshot bubble mode: processing in background');

      await showSelectionLoading(bounds);

      // Make sure main window is loaded for background processing — but force it
      // hidden so ready-to-show doesn't pop it visible.
      if (!windows.main) {
        windowManager.createMainWindow();
        await new Promise(resolve => setTimeout(resolve, 500));
        if (windows.main && !windows.main.isDestroyed()) {
          windows.main.hide();
        }
      }

      if (windows.main && dataURL) {
        // String literal (not constant) for cross-version compat.
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

    if (windows.main && runtime.wasMainWindowVisible) {
      windows.main.show();
      windows.main.focus();
    }

    return null;
  }
}

module.exports = { startScreenshot, handleScreenshotSelection };
