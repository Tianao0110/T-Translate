// Glass overlay window IPC: controls, settings, translate proxy, region capture,
// child-pane sub-windows.

const { ipcMain, safeStorage } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Glass');
const displayHelper = require('../utils/display-helper');
const { t } = require('../shared/main-i18n');

function register(ctx) {
  const { getMainWindow, getGlassWindow, store, managers } = ctx;

  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };

  // ===== Window controls =====

  ipcMain.handle(CHANNELS.GLASS.OPEN, () => {
    if (managers.createGlassWindow) {
      managers.createGlassWindow();
      return true;
    }
    logger.warn('createGlassWindow not available');
    return false;
  });

  ipcMain.handle(CHANNELS.GLASS.CLOSE, () => {
    const glassWindow = getGlassWindow();
    if (glassWindow) {
      glassWindow.close();
      return true;
    }
    return false;
  });

  ipcMain.handle(CHANNELS.GLASS.GET_BOUNDS, () => {
    const glassWindow = getGlassWindow();
    if (glassWindow) {
      return glassWindow.getBounds();
    }
    return null;
  });

  ipcMain.handle(CHANNELS.GLASS.SET_ALWAYS_ON_TOP, (event, enabled) => {
    const glassWindow = getGlassWindow();
    if (glassWindow) {
      glassWindow.setAlwaysOnTop(enabled);
      return true;
    }
    return false;
  });

  // Opacity is applied via CSS variable in the renderer (so child panes aren't
  // affected). We only persist the value for next launch.
  ipcMain.handle(CHANNELS.GLASS.SET_OPACITY, (event, opacity) => {
    const current = store.get('glassLocalSettings', {});
    store.set('glassLocalSettings', { ...current, opacity });
    return true;
  });

  // ===== Mouse pass-through =====

  ipcMain.handle(CHANNELS.GLASS.SET_PASS_THROUGH, (event, enabled) => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      logger.debug('Setting pass-through mode:', enabled);
      if (enabled) {
        glassWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        glassWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });

  ipcMain.handle(CHANNELS.GLASS.SET_IGNORE_MOUSE, (event, ignore) => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      if (ignore) {
        glassWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        glassWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });

  // ===== Settings =====

  // Reads live language from main-window renderer store, falls back to persisted
  // defaults if the main window isn't around yet
  ipcMain.handle(CHANNELS.GLASS.GET_SETTINGS, async () => {
    const mainWindow = getMainWindow();
    const mainSettings = store.get('settings', {});
    const glassConfig = mainSettings.glassWindow || {};
    const ocrConfig = mainSettings.ocr || {};
    const localSettings = store.get('glassLocalSettings', {});

    let currentTargetLang = mainSettings.translation?.defaultTargetLang ?? 'zh';
    let currentSourceLang = mainSettings.translation?.defaultSourceLang ?? 'auto';

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

    const merged = {
      refreshInterval: glassConfig.refreshInterval ?? 3000,
      smartDetect: glassConfig.smartDetect ?? true,
      streamOutput: glassConfig.streamOutput ?? true,
      ocrEngine: ocrConfig.engine ?? glassConfig.ocrEngine ?? 'llm-vision',
      globalOcrEngine: ocrConfig.engine ?? 'llm-vision',
      defaultOpacity: glassConfig.defaultOpacity ?? 0.85,
      autoPin: glassConfig.autoPin ?? true,
      lockTargetLang: glassConfig.lockTargetLang ?? true,
      targetLanguage: currentTargetLang,
      sourceLanguage: currentSourceLang,
      theme: mainSettings.interface?.theme ?? 'light',
      opacity: localSettings.opacity ?? glassConfig.defaultOpacity ?? 0.85,
      isPinned: localSettings.isPinned ?? glassConfig.autoPin ?? true,
    };

    logger.debug('Get settings:', merged);
    return merged;
  });

  ipcMain.handle(CHANNELS.GLASS.SAVE_SETTINGS, (event, settings) => {
    const glassWindow = getGlassWindow();
    const current = store.get('glassLocalSettings', {});
    store.set('glassLocalSettings', { ...current, ...settings });
    return true;
  });

  // Decrypts the '***encrypted***' apiKey placeholder before returning
  ipcMain.handle(CHANNELS.GLASS.GET_PROVIDER_CONFIGS, async () => {
    const mainSettings = store.get('settings', {});
    const providerSettings = mainSettings.providers || {};

    const configs = JSON.parse(JSON.stringify(providerSettings.configs || {}));

    for (const providerId of Object.keys(configs)) {
      const config = configs[providerId];
      if (config?.apiKey === '***encrypted***') {
        const encryptKey = `provider_${providerId}_apiKey`;
        const stored = store.get(`__encrypted_${encryptKey}`);

        if (stored) {
          try {
            if (safeStorage.isEncryptionAvailable()) {
              const buffer = Buffer.from(stored, 'base64');
              configs[providerId].apiKey = safeStorage.decryptString(buffer);
            } else {
              configs[providerId].apiKey = Buffer.from(stored, 'base64').toString('utf-8');
            }
          } catch (e) {
            logger.error(`Failed to decrypt ${providerId} API key:`, e);
            configs[providerId].apiKey = '';
          }
        } else {
          configs[providerId].apiKey = '';
        }
      }
    }

    return {
      list: providerSettings.list || [],
      configs,
    };
  });

  ipcMain.handle(CHANNELS.GLASS.NOTIFY_SETTINGS_CHANGED, () => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      const settings = store.get('settings', {});
      glassWindow.webContents.send(CHANNELS.GLASS.SETTINGS_CHANGED, settings);
      return true;
    }
    return false;
  });

  // Show + focus main window, then send 'navigate' with 'settings:<section>' format
  // so MainWindow can switch tab AND jump to the right SettingsPanel section in one trip.
  ipcMain.handle(CHANNELS.GLASS.OPEN_MAIN_SETTINGS, (event, section) => {
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

  // ===== Translation =====

  ipcMain.handle(CHANNELS.GLASS.TRANSLATE, async (event, text) => {
    try {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send(CHANNELS.GLASS.TRANSLATE_REQUEST, text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ===== Region capture =====

  ipcMain.handle(CHANNELS.GLASS.CAPTURE_REGION, async (event, bounds) => {
    const glassWindow = getGlassWindow();

    try {
      if (!glassWindow || glassWindow.isDestroyed()) {
        throw new Error(t('glass.windowNotFound', '玻璃窗口不存在'));
      }

      // Hide self before capture so we don't OCR our own translation overlay.
      // WDA_EXCLUDEFROMCAPTURE is unreliable on some GPU/driver combos, so we
      // still drop opacity as a fallback.
      try {
        glassWindow.setOpacity(0);
        await new Promise(resolve => setTimeout(resolve, 80));
      } catch (e) {
        logger.warn('Failed to hide for capture:', e.message);
      }

      const screenshotMod = getScreenshotModule();
      const screenshot = await screenshotMod.captureRegion(bounds);

      try {
        glassWindow.setOpacity(1);
      } catch (e) {
        logger.warn('Failed to restore after capture:', e.message);
      }

      if (screenshot) {
        return { success: true, imageData: screenshot };
      } else {
        throw new Error(t('screenshot.failed', '截图失败'));
      }
    } catch (error) {
      logger.error('Capture region error:', error);
      if (glassWindow && !glassWindow.isDestroyed()) {
        try { glassWindow.setOpacity(1); } catch {}
      }
      return { success: false, error: error.message };
    }
  });

  // ===== Data sync (forward to main window) =====

  ipcMain.handle(CHANNELS.GLASS.ADD_TO_FAVORITES, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_FAVORITES, item);
    return true;
  });

  ipcMain.handle(CHANNELS.GLASS.ADD_TO_HISTORY, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_HISTORY, item);
    return true;
  });

  ipcMain.handle(CHANNELS.GLASS.GET_HISTORY, async (event, limit = 20) => {
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

  ipcMain.handle(CHANNELS.GLASS.SYNC_TARGET_LANGUAGE, (event, langCode) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.SYNC_TARGET_LANGUAGE, langCode);
    return true;
  });

  // ===== Child pane standalone windows =====

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

  ipcMain.handle(CHANNELS.GLASS.CREATE_CHILD_WINDOW, async (event, options) => {
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

    // Auto-size from text dimensions; clamp to keep tiny snippets readable
    // and prevent giant overlays.
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

      childWindow.on('closed', () => {
        childPaneWindows.delete(id);
        const glassWindow = getGlassWindow();
        if (glassWindow && !glassWindow.isDestroyed()) {
          glassWindow.webContents.send('child-pane:closed', id);
        }
      });

      ipcMain.once(`child-pane:close:${id}`, () => {
        if (childPaneWindows.has(id)) {
          try {
            childPaneWindows.get(id).window.close();
          } catch (e) {}
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

  ipcMain.handle(CHANNELS.GLASS.CLOSE_CHILD_WINDOW, (event, id) => {
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

  ipcMain.handle(CHANNELS.GLASS.UPDATE_CHILD_WINDOW, (event, id, data) => {
    if (childPaneWindows.has(id)) {
      const paneData = childPaneWindows.get(id);
      if (paneData.window && !paneData.window.isDestroyed()) {
        paneData.window.webContents.send('child-pane:update', data);
        return true;
      }
    }
    return false;
  });

  ipcMain.handle(CHANNELS.GLASS.MOVE_CHILD_WINDOW, (event, id, x, y) => {
    if (childPaneWindows.has(id)) {
      const paneData = childPaneWindows.get(id);
      if (paneData.window && !paneData.window.isDestroyed()) {
        paneData.window.setPosition(Math.round(x), Math.round(y));
        return true;
      }
    }
    return false;
  });

  ipcMain.handle(CHANNELS.GLASS.CLOSE_ALL_CHILD_WINDOWS, () => {
    let count = 0;
    for (const [id, data] of childPaneWindows) {
      try {
        if (data.window && !data.window.isDestroyed()) {
          data.window.close();
          count++;
        }
      } catch (e) {}
    }
    childPaneWindows.clear();
    logger.debug('Closed all child pane windows:', count);
    return count;
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

  logger.info('Glass IPC handlers registered');
}

module.exports = register;
