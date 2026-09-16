// Main process entry: app paths, crash guard, single-instance lock, then the
// wiring of windows / IPC / menu / tray / shortcuts once the app is ready.
// Selection translate lives in selection/controller.js, the screenshot flow
// in screenshot/flow.js; this file only hands them to the IPC layer.

const {
  app,
  BrowserWindow,
  dialog,
} = require('electron');

// Where everything on disk goes; must run before require('./state').
const { applyAppPaths } = require('./platform/app-paths');
const appPaths = applyAppPaths(app, { override: process.env.TT_USERDATA });

const { store, runtime, windows, isDev } = require('./state');
const { CHANNELS } = require('./shared/channels');
const { t } = require('./shared/main-i18n');
const { initIPC } = require('./ipc');
const { registerAllShortcuts, unregisterAllShortcuts } = require('./ipc/shortcuts');
const { makeWindowInvisibleToCapture } = require('./platform/native-helper');

const logger = require('./platform/logger')('Main');
logger.info(`userData: ${appPaths.userData}${appPaths.relocated ? ` (was ${appPaths.legacyUserData})` : ''}`);
for (const note of appPaths.notes) logger.info(`[app-paths] ${note}`);

const { createCrashGuard, SAFE_MODE_THRESHOLD } = require('./platform/crash-guard');
const { extractOpenableFile } = require('./platform/open-with');
const crashGuard = createCrashGuard({ store, logger });

const { createMenu } = require('./windows/menu-manager');
const { createTray, destroyTray } = require('./windows/tray-manager');
const windowManager = require('./windows/window-manager');
const audioEngineManager = require('./listen/audio-engine-manager');
const displayHelper = require('./platform/display-helper');
const selection = require('./selection/controller');
const screenshot = require('./screenshot/flow');

// Main-window renderer crashed past the reload limit: relaunch into safe mode.
function onMainRendererGiveUp() {
  logger.error('Main window renderer kept crashing — relaunching into safe mode');
  crashGuard.forceSafeModeNextLaunch();
  try { selection.stopSelectionHook(); } catch (e) { /* ignore */ }
  app.relaunch();
  app.exit(0);
}

// ===== App lifecycle =====

app.whenReady().then(() => {
  logger.info('App ready, initializing...');

  // AppUserModelID for toast notifications; must match build.appId in package.json.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.ttranslate.core');
  }

  // --startup: launched at logon, stay silent.
  const isStartup = process.argv.includes('--startup');
  if (isStartup) {
    logger.info('Started via auto-launch, running in silent mode');
    store.set('startMinimized', true);
  }

  logger.info('Displays:', displayHelper.getDisplaySummary());

  // A removed monitor: bring windows that sat on it back on screen.
  displayHelper.onDisplayChange((eventType, display) => {
    logger.info(`Display ${eventType}:`, display?.id, displayHelper.getDisplaySummary());

    if (eventType === 'removed') {
      if (windows.main && !windows.main.isDestroyed()) {
        const bounds = windows.main.getBounds();
        const validBounds = displayHelper.ensureBoundsOnDisplay(bounds);
        if (validBounds.adjusted) {
          logger.info('Main window moved to valid display');
          windows.main.setBounds(validBounds);
        }
      }
      if (windows.floatingWindow && !windows.floatingWindow.isDestroyed()) {
        const bounds = windows.floatingWindow.getBounds();
        const validBounds = displayHelper.ensureBoundsOnDisplay(bounds);
        if (validBounds.adjusted) {
          logger.info('Floating window moved to valid display');
          windows.floatingWindow.setBounds(validBounds);
        }
      }
    }
  });

  windowManager.init({
    store,
    runtime,
    windows,
    isDev,
    logger,
    makeWindowInvisibleToCapture,
    crashGuard,
    onMainRendererGiveUp,
  });

  // Listen-translate engine: hosted by the floating window's listen mode.
  audioEngineManager.init({
    store,
    getWindow: () => windows.floatingWindow,
  });

  // What the IPC layer, menu, tray and shortcuts may call.
  const managers = {
    startScreenshot: screenshot.startScreenshot,
    handleScreenshotSelection: screenshot.handleScreenshotSelection,
    showSelectionWithText: selection.showSelectionWithText,
    showSelectionResult: selection.showSelectionResult,
    hideSelectionLoading: selection.hideSelectionLoading,
    toggleFloatingWindow: (...args) => windowManager.toggleFloatingWindow(...args),
    createFloatingWindow: (...args) => windowManager.createFloatingWindow(...args),
    // Global-hotkey capture, sent as an event so the target app keeps focus.
    triggerFloatingCapture: () => {
      const fw = windows.floatingWindow;
      if (fw && !fw.isDestroyed() && fw.isVisible()) {
        fw.webContents.send(CHANNELS.FLOATING_WINDOW.TRIGGER_CAPTURE);
      }
    },
    toggleSelectionTranslate: selection.toggleSelectionTranslate,
  };

  // IPC before any window, so no renderer call finds a missing handler.
  initIPC({
    windows,
    runtime,
    store,
    app,
    managers,
  });

  windowManager.createMainWindow();

  const ctx = {
    getMainWindow: () => windows.main,
    runtime,
    store,
    managers,
    isDev,
  };

  createMenu(ctx);
  createTray(ctx);

  const failedShortcuts = registerAllShortcuts({
    store,
    getMainWindow: () => windows.main,
    managers,
  });

  if (failedShortcuts.length > 0 && windows.main) {
    windows.main.webContents.once('did-finish-load', () => {
      windows.main.webContents.send('shortcut-conflict', failedShortcuts);
    });
  }

  // Safe-mode notice as a native dialog (the renderer may be the problem).
  if (runtime.safeMode && !isStartup && windows.main) {
    windows.main.webContents.once('did-finish-load', () => {
      dialog.showMessageBox(windows.main, {
        type: 'warning',
        title: t('safeMode.title'),
        message: t('safeMode.title'),
        detail: t('safeMode.body'),
        buttons: [t('menu.ok')],
      }).catch(() => {});
    });
  }

  runtime.selectionEnabled = false;
  store.set('selectionEnabled', false);

  // Memory monitor: GC past 500MB heap when gc is exposed.
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

  crashGuard.scheduleStableMark();

  // Pre-warm the selection modules; later on auto-launch to spare the boot.
  const preheatDelay = isStartup ? 8000 : 3000;
  setTimeout(() => {
    // Safe mode: no native modules, no auto-enable.
    if (runtime.safeMode) {
      logger.warn('Safe mode: skipped module preheat and selection auto-enable');
    } else {
      selection.preheatSelectionModules();

      if (isStartup && store.get('settings.startup.autoEnableSelection')) {
        logger.info('Auto-enabling selection translate after startup');
        selection.toggleSelectionTranslate();
      }
    }

    if (isStartup) {
      store.set('startMinimized', false);
    }
  }, preheatDelay);
});

// Process-level handlers: the native hook must stop so the process can exit.

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  try { selection.stopSelectionHook(); } catch (e) { /* ignore */ }
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason instanceof Error) {
    logger.error('Unhandled rejection:', reason.message);
    logger.error('Stack:', reason.stack);
  } else {
    try {
      logger.error('Unhandled rejection:', JSON.stringify(reason, null, 2));
    } catch {
      logger.error('Unhandled rejection:', reason);
    }
  }
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, quitting...');
  runtime.isQuitting = true;
  try { selection.stopSelectionHook(); } catch (e) { /* ignore */ }
  app.quit();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, quitting...');
  runtime.isQuitting = true;
  try { selection.stopSelectionHook(); } catch (e) { /* ignore */ }
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  } else {
    windows.main?.show();
  }
});

// Native hooks stop before windows are destroyed.
app.on('before-quit', () => {
  runtime.isQuitting = true;

  // A deliberate quit is a healthy launch, however short.
  crashGuard.markStartupHealthy('clean-quit');

  selection.stopSelectionHook();

  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
  });
});

app.on('will-quit', () => {
  if (runtime.memoryMonitorInterval) {
    clearInterval(runtime.memoryMonitorInterval);
    runtime.memoryMonitorInterval = null;
  }

  unregisterAllShortcuts();

  try { selection.stopSelectionHook(); } catch (e) { /* ignore */ }

  // Engine hosts are utilityProcesses Electron does not reap by itself.
  try { require('./tengine').get().shutdownAll(); } catch (e) { /* ignore */ }

  destroyTray();

  logger.info('App cleanup completed');

  // Last resort if a native thread keeps the process alive.
  setTimeout(() => {
    logger.warn('Force exit: process still alive after 5s');
    process.exit(0);
  }, 5000).unref();
});

// Single-instance lock.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // "Open with" while already running: the losing instance forwards its argv.
    const openFile = extractOpenableFile(commandLine);
    if (openFile) {
      runtime.pendingOpenFile = openFile;
      logger.info('Open-with file from second instance:', openFile);
    }

    if (windows.main) {
      if (windows.main.isMinimized()) windows.main.restore();
      windows.main.show();
      windows.main.focus();
      if (openFile) {
        windows.main.webContents.send(CHANNELS.DOCUMENT.OPEN_FILE_READY);
      }
    }
  });

  // Cold start from the context menu: the file rides process.argv.
  runtime.pendingOpenFile = extractOpenableFile(process.argv);
  if (runtime.pendingOpenFile) {
    logger.info('Open-with file from cold start:', runtime.pendingOpenFile);
  }

  // Startup-crash probation (crash-guard), before app-ready so hardware
  // acceleration can still be switched off.
  const startupFailures = crashGuard.beginStartupProbation();
  if (startupFailures >= SAFE_MODE_THRESHOLD) {
    runtime.safeMode = true;
    app.disableHardwareAcceleration();
    logger.warn(`Safe mode: ${startupFailures} consecutive startup failures — hardware acceleration off, module preheat will be skipped`);
  }
}
