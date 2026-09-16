// Floating-window IPC: window controls, settings merge, region capture, and detached child-pane windows.

const { ipcMain, BrowserWindow } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../platform/logger')('IPC:FloatingWindow');
const displayHelper = require('../platform/display-helper');
const { t } = require('../shared/main-i18n');

// Module scope: window-manager closes the panes with the floating window.
const childPaneWindows = new Map();
const MAX_CHILD_WINDOWS = 15;

function removeOldestChildWindow() {
  let oldest = null;
  let oldestId = null;

  for (const [id, data] of childPaneWindows) {
    if (!oldest || data.createdAt < oldest.createdAt) {
      oldest = data;
      oldestId = id;
    }
  }

  if (oldestId && oldest) {
    try {
      if (!oldest.window.isDestroyed()) {
        oldest.window.close();
      }
    } catch (e) {}
    childPaneWindows.delete(oldestId);
    logger.debug('Removed oldest child window:', oldestId);
  }
}

function closeAllChildPaneWindows() {
  let count = 0;
  for (const [, data] of childPaneWindows) {
    try {
      if (data.window && !data.window.isDestroyed()) {
        data.window.close();
        count++;
      }
    } catch (e) {}
  }
  childPaneWindows.clear();
  if (count > 0) logger.debug('Closed all child pane windows:', count);
  return count;
}

function register(ctx) {
  const { getMainWindow, getFloatingWindow, getSelectionWindow, store, managers } = ctx;

  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot/screenshot-module');
    }
    return screenshotModule;
  };

  // ===== Window controls =====
  // No OPEN handler: the floating window opens exclusively via the global
  // shortcut (managers.toggleFloatingWindow).

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.CLOSE, () => {
    const floatingWindow = getFloatingWindow();
    if (floatingWindow) {
      floatingWindow.close();
      return true;
    }
    return false;
  });

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.GET_BOUNDS, () => {
    const floatingWindow = getFloatingWindow();
    if (floatingWindow) {
      return floatingWindow.getBounds();
    }
    return null;
  });

  // Opacity is applied by the renderer (CSS variable); only persisted here.
  ipcMain.handle(CHANNELS.FLOATING_WINDOW.SET_OPACITY, (event, opacity) => {
    const current = store.get('floatingWindowLocal', {});
    store.set('floatingWindowLocal', { ...current, opacity });
    return true;
  });

  // ===== Manual window drag =====

  // The renderer tracks the pointer and streams positions here (`on`,
  // fire-and-forget, addressed via event.sender). Size is the drag-start
  // size, applied through setBounds every frame (docs/design/ipc.md).
  ipcMain.on(CHANNELS.FLOATING_WINDOW.SET_POSITION, (event, x, y, width, height) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Number.isFinite(width) && Number.isFinite(height)) {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
    } else {
      win.setPosition(Math.round(x), Math.round(y));
    }
  });

  // ===== Mouse pass-through =====

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.SET_PASS_THROUGH, (event, enabled) => {
    const floatingWindow = getFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      logger.debug('Setting pass-through mode:', enabled);
      if (enabled) {
        floatingWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        floatingWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });

  // ===== Settings =====

  // Live language from the main-window store, else the persisted defaults.
  ipcMain.handle(CHANNELS.FLOATING_WINDOW.GET_SETTINGS, async () => {
    const mainWindow = getMainWindow();
    const mainSettings = store.get('settings', {});
    const fwConfig = mainSettings.floatingWindow || {};
    const ocrConfig = mainSettings.ocr || {};
    const localSettings = store.get('floatingWindowLocal', {});

    let currentTargetLang = mainSettings.translation?.targetLanguage ?? 'zh';
    let currentSourceLang = mainSettings.translation?.sourceLanguage ?? 'auto';

    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const langSettings = await mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              const store = window.__TRANSLATION_STORE__;
              if (store) {
                const state = store.getState();
                return {
                  targetLanguage: state.currentTranslation?.targetLanguage || 'zh',
                  sourceLanguage: state.currentTranslation?.sourceLanguage || 'auto'
                };
              }
              return { targetLanguage: 'zh', sourceLanguage: 'auto' };
            } catch(e) {
              return { targetLanguage: 'zh', sourceLanguage: 'auto' };
            }
          })()
        `);
        currentTargetLang = langSettings.targetLanguage;
        currentSourceLang = langSettings.sourceLanguage;
      } catch (e) {
        logger.debug('Could not get language settings from main window:', e.message);
      }
    }

    // Fallbacks mirror DEFAULT_SETTINGS.floatingWindow in
    // src/components/SettingsPanel/constants.js — keep both in sync.
    const merged = {
      ocrEngine: ocrConfig.engine ?? 'llm-vision',
      sameLanguageBehavior: mainSettings.translation?.sameLanguageBehavior ?? 'original',
      targetLanguage: currentTargetLang,
      sourceLanguage: currentSourceLang,
      theme: mainSettings.interface?.theme ?? 'light',
      // window-local slider value wins over the settings-page default
      opacity: localSettings.opacity ?? fwConfig.defaultOpacity ?? 0.85,
      displayMode: fwConfig.displayMode ?? 'auto',
    };

    logger.debug('Get settings:', merged);
    return merged;
  });

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.NOTIFY_SETTINGS_CHANGED, () => {
    const settings = store.get('settings', {});

    const floatingWindow = getFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send(CHANNELS.FLOATING_WINDOW.SETTINGS_CHANGED, settings);

      // Capture-visibility applies live (platform/native-helper.js).
      if (process.platform === 'win32') {
        const helper = require('../platform/native-helper');
        if (settings.floatingWindow?.captureVisible) {
          helper.makeWindowVisibleToCapture(floatingWindow);
        } else {
          helper.makeWindowInvisibleToCapture(floatingWindow);
        }
      }
    }

    // The persistent selection window must see the change too.
    const selectionWindow = getSelectionWindow?.();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.webContents.send(CHANNELS.SELECTION.SETTINGS_CHANGED);
    }

    return !!(floatingWindow && !floatingWindow.isDestroyed());
  });

  // Forward translations into the main window's history store (same channel
  // as the selection window); the store applies the secure-mode gate.
  ipcMain.handle(CHANNELS.FLOATING_WINDOW.ADD_TO_HISTORY, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_HISTORY, item);
    return true;
  });

  // Same route for AI results, which attach to a history entry rather than
  // creating one — the store decides whether there is anything to attach to.
  ipcMain.handle(CHANNELS.FLOATING_WINDOW.ATTACH_AI_RESULT, (event, payload) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ATTACH_AI_RESULT, payload);
    return true;
  });

  // Show + focus the main window, then 'navigate' with 'settings:<section>'.
  ipcMain.handle(CHANNELS.FLOATING_WINDOW.OPEN_MAIN_SETTINGS, (event, section) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.warn('openMainSettings: main window not available');
      return false;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    const target = section ? `settings:${section}` : 'settings';
    mainWindow.webContents.send('navigate', target);
    logger.debug('openMainSettings dispatched:', target);
    return true;
  });

  // ===== Region capture =====

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.CAPTURE_REGION, async (event, bounds) => {
    const floatingWindow = getFloatingWindow();

    try {
      if (!floatingWindow || floatingWindow.isDestroyed()) {
        throw new Error(t('floatingWindow.windowNotFound', '玻璃窗口不存在'));
      }

      // Hide self and the detached child panes before capture; the capture
      // affinity alone is not relied on (docs/design/ipc.md).
      const hideForCapture = (visible) => {
        try {
          floatingWindow.setOpacity(visible ? 1 : 0);
        } catch (e) {
          logger.warn('Failed to toggle overlay for capture:', e.message);
        }
        for (const [, data] of childPaneWindows) {
          try {
            if (data.window && !data.window.isDestroyed()) {
              data.window.setOpacity(visible ? 1 : 0);
            }
          } catch (e) {}
        }
      };

      hideForCapture(false);
      await new Promise(resolve => setTimeout(resolve, 80));

      const screenshotMod = getScreenshotModule();
      let screenshot;
      try {
        screenshot = await screenshotMod.captureRegion(bounds);
      } finally {
        hideForCapture(true);
      }

      if (screenshot) {
        // The captured display's scale, for mapping OCR pixels back to CSS px.
        const { screen } = require('electron');
        const scaleFactor = screen.getDisplayMatching({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        }).scaleFactor;
        return { success: true, imageData: screenshot, scaleFactor };
      } else {
        throw new Error(t('screenshot.failed', '截图失败'));
      }
    } catch (error) {
      logger.error('Capture region error:', error);
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        try { floatingWindow.setOpacity(1); } catch {}
      }
      return { success: false, error: error.message };
    }
  });

  // ===== Data sync =====

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.GET_HISTORY, async (event, limit = 20) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return [];
    }

    try {
      // Reaches into the renderer's Zustand-persisted store.
      // Persist key 'translation-store' shape: { state: { history: [...] } }
      const history = await mainWindow.webContents.executeJavaScript(`
        (function() {
          try {
            const stored = localStorage.getItem('translation-store');
            if (stored) {
              const parsed = JSON.parse(stored);
              const state = parsed.state || parsed;
              const items = state.history || [];
              return items.slice(0, ${limit}).map(item => ({
                id: item.id,
                source: item.sourceText,
                translated: item.translatedText,
                timestamp: item.timestamp,
                sourceLang: item.sourceLanguage,
                targetLang: item.targetLanguage,
                kind: item.kind,
              }));
            }
            return [];
          } catch(e) {
            console.error('Failed to get history:', e);
            return [];
          }
        })()
      `);
      return history || [];
    } catch (e) {
      logger.debug('Could not get history from main window:', e.message);
      return [];
    }
  });

  // ===== Child pane standalone windows =====

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.CREATE_CHILD_WINDOW, async (event, options) => {
    const { BrowserWindow } = require('electron');
    const path = require('path');
    const PATHS = require('../shared/paths');

    const { id, text, x, y, width, height, theme } = options;

    if (childPaneWindows.has(id)) {
      try {
        childPaneWindows.get(id).window.close();
      } catch (e) {}
      childPaneWindows.delete(id);
    }

    while (childPaneWindows.size >= MAX_CHILD_WINDOWS) {
      removeOldestChildWindow();
    }

    // Auto-size from text dimensions, clamped.
    const textLength = (text || '').length;
    const lineCount = (text || '').split('\n').length;
    const estimatedWidth = Math.min(Math.max(textLength * 8 + 80, 120), 400);
    const winWidth = width ? Math.min(Math.max(width, 120), 400) : estimatedWidth;
    const estimatedHeight = Math.min(Math.max(lineCount * 20 + 16, 36), 300);
    const winHeight = height ? Math.min(Math.max(height, 36), 300) : estimatedHeight;

    const validBounds = displayHelper.ensureBoundsOnDisplay({
      x: x,
      y: y,
      width: winWidth,
      height: winHeight,
    }, {
      minVisiblePixels: 50,
      centerOnInvalid: false, // snap to nearest display instead of centering
    });

    try {
      const childWindow = new BrowserWindow({
        x: Math.round(validBounds.x),
        y: Math.round(validBounds.y),
        width: validBounds.width,
        height: validBounds.height,
        minWidth: 100,
        minHeight: 36,
        maxWidth: 600,
        maxHeight: 400,
        frame: false,
        transparent: true,
        resizable: true,
        movable: true,
        minimizable: false,
        maximizable: false,
        closable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        webPreferences: {
          preload: PATHS.preloads.childPane,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      const encodedText = encodeURIComponent(text || '');
      const queryParams = `?id=${id}&text=${encodedText}&theme=${theme || 'light'}`;

      if (process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged) {
        childWindow.loadURL(`http://localhost:5173/child-pane.html${queryParams}`);
      } else {
        childWindow.loadFile(PATHS.pages.childPane.file, {
          query: { id, text: text || '', theme: theme || 'light' }
        });
      }

      childWindow.once('ready-to-show', () => {
        childWindow.show();
      });

      // Panes sit over the source text: excluded from capture.
      if (process.platform === 'win32') {
        childWindow.webContents.once('did-finish-load', () => {
          try {
            const { makeWindowInvisibleToCapture } = require('../platform/native-helper');
            makeWindowInvisibleToCapture(childWindow);
          } catch (e) {
            logger.warn('Failed to exclude child pane from capture:', e.message);
          }
        });
      }

      childWindow.on('closed', () => {
        childPaneWindows.delete(id);
        const floatingWindow = getFloatingWindow();
        if (floatingWindow && !floatingWindow.isDestroyed()) {
          floatingWindow.webContents.send('child-pane:closed', id);
        }
      });

      childPaneWindows.set(id, {
        window: childWindow,
        createdAt: Date.now(),
      });

      logger.debug('Created child pane window:', id, 'Total:', childPaneWindows.size);
      return { success: true, id };
    } catch (error) {
      logger.error('Failed to create child pane window:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.CLOSE_CHILD_WINDOW, (event, id) => {
    if (childPaneWindows.has(id)) {
      try {
        const data = childPaneWindows.get(id);
        if (data.window && !data.window.isDestroyed()) {
          data.window.close();
        }
        childPaneWindows.delete(id);
        return true;
      } catch (e) {
        logger.error('Failed to close child pane window:', e);
      }
    }
    return false;
  });

  ipcMain.handle(CHANNELS.FLOATING_WINDOW.CLOSE_ALL_CHILD_WINDOWS, () => {
    return closeAllChildPaneWindows();
  });

  ipcMain.on('child-pane:close', (event) => {
    for (const [id, data] of childPaneWindows) {
      if (data.window && data.window.webContents === event.sender) {
        try {
          data.window.close();
        } catch (e) {}
        break;
      }
    }
  });

  ipcMain.on('child-pane:resize', (event, width, height) => {
    for (const [id, data] of childPaneWindows) {
      if (data.window && data.window.webContents === event.sender) {
        try {
          if (!data.window.isDestroyed()) {
            data.window.setSize(Math.round(width), Math.round(height));
          }
        } catch (e) {
          logger.error('Failed to resize child pane:', e);
        }
        break;
      }
    }
  });

  logger.info('Floating-window IPC handlers registered');
}

module.exports = register;
module.exports.closeAllChildPaneWindows = closeAllChildPaneWindows;
