// Global shortcut IPC: get/update/pause/resume + startup registration.

const { ipcMain, globalShortcut } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Shortcuts');
const { t } = require('../shared/main-i18n');

const DEFAULT_SHORTCUTS = {
  screenshot: 'Alt+Q',
  toggleWindow: 'CommandOrControl+Shift+W',
  glassWindow: 'CommandOrControl+Alt+G',
  selectionTranslate: 'CommandOrControl+Shift+T',
};

// Renderer uses Ctrl/Meta; Electron globalShortcut wants CommandOrControl/Command
function toElectronFormat(shortcut) {
  return shortcut
    .replace(/Ctrl/g, 'CommandOrControl')
    .replace(/Meta/g, 'Command');
}

function register(ctx) {
  const { store, getMainWindow, managers } = ctx;

  const getShortcutHandlers = () => ({
    screenshot: () => managers.startScreenshot?.(true),
    toggleWindow: () => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    glassWindow: () => managers.toggleGlassWindow?.(),
    selectionTranslate: () => managers.toggleSelectionTranslate?.(),
  });

  ipcMain.handle(CHANNELS.SHORTCUTS.GET, () => {
    const settings = store.get('settings', {});
    return settings.shortcuts || {};
  });

  ipcMain.handle(CHANNELS.SHORTCUTS.UPDATE, (event, action, shortcut) => {
    try {
      const handlers = getShortcutHandlers();
      const handler = handlers[action];

      if (!handler) {
        logger.warn('Unknown action:', action);
        return { success: false, error: 'Unknown action' };
      }

      const electronShortcut = toElectronFormat(shortcut);

      const settings = store.get('settings', {});
      const oldShortcut = settings.shortcuts?.[action] || DEFAULT_SHORTCUTS[action];
      const oldElectronShortcut = toElectronFormat(oldShortcut);

      try {
        globalShortcut.unregister(oldElectronShortcut);
        logger.debug('Unregistered old shortcut:', oldElectronShortcut);
      } catch (e) {
        logger.debug('Failed to unregister old shortcut:', oldElectronShortcut);
      }

      const success = globalShortcut.register(electronShortcut, handler);

      if (success) {
        const newSettings = {
          ...settings,
          shortcuts: {
            ...settings.shortcuts,
            [action]: shortcut,
          },
        };
        store.set('settings', newSettings);
        logger.info(`Shortcut updated: ${action} [${oldShortcut} → ${shortcut}]`);
        return { success: true };
      } else {
        // Restore previous binding if new one collides with another app
        try {
          globalShortcut.register(oldElectronShortcut, handler);
        } catch (e) {
          logger.error('Failed to restore old shortcut');
        }
        logger.warn('Shortcut registration failed (may be in use):', electronShortcut);
        return { success: false, error: t('shortcuts.occupied', '快捷键已被占用') };
      }
    } catch (error) {
      logger.error('Update shortcut error:', error);
      return { success: false, error: error.message };
    }
  });

  // Pause = unregister so the user can press the key while editing the binding
  ipcMain.handle(CHANNELS.SHORTCUTS.PAUSE, (event, action) => {
    try {
      const settings = store.get('settings', {});
      const shortcut = settings.shortcuts?.[action] || DEFAULT_SHORTCUTS[action];

      if (!shortcut) {
        return { success: false, error: 'Shortcut not found' };
      }

      const electronShortcut = toElectronFormat(shortcut);
      globalShortcut.unregister(electronShortcut);

      logger.debug('Paused shortcut:', action, electronShortcut);
      return { success: true, shortcut };
    } catch (error) {
      logger.error('Pause shortcut error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.SHORTCUTS.RESUME, (event, action) => {
    try {
      const handlers = getShortcutHandlers();
      const handler = handlers[action];

      if (!handler) {
        return { success: false, error: 'Unknown action' };
      }

      const settings = store.get('settings', {});
      const shortcut = settings.shortcuts?.[action] || DEFAULT_SHORTCUTS[action];

      if (!shortcut) {
        return { success: false, error: 'Shortcut not found' };
      }

      const electronShortcut = toElectronFormat(shortcut);
      const success = globalShortcut.register(electronShortcut, handler);

      if (success) {
        logger.debug('Resumed shortcut:', action, electronShortcut);
        return { success: true };
      } else {
        logger.warn('Failed to resume shortcut:', electronShortcut);
        return { success: false, error: t('shortcuts.resumeFailed', '快捷键恢复失败') };
      }
    } catch (error) {
      logger.error('Resume shortcut error:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('Shortcuts IPC handlers registered');
}

// Returns list of bindings that failed (likely held by another process)
function registerAllShortcuts(ctx) {
  const { store, getMainWindow, managers } = ctx;

  const settings = store.get('settings', {});
  const shortcuts = settings.shortcuts || {};
  const failed = [];

  const handlers = {
    screenshot: () => managers.startScreenshot?.(true),
    toggleWindow: () => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    glassWindow: () => managers.toggleGlassWindow?.(),
    selectionTranslate: () => managers.toggleSelectionTranslate?.(),
  };

  for (const [action, defaultKey] of Object.entries(DEFAULT_SHORTCUTS)) {
    const shortcut = shortcuts[action] || defaultKey;
    const electronShortcut = toElectronFormat(shortcut);
    const handler = handlers[action];

    if (handler) {
      try {
        const success = globalShortcut.register(electronShortcut, handler);
        if (success) {
          logger.debug(`Registered: ${action} [${electronShortcut}]`);
        } else {
          logger.warn(`Failed to register: ${action} [${electronShortcut}] (may be in use by another app)`);
          failed.push({ action, shortcut });
        }
      } catch (e) {
        logger.error(`Error registering ${action}:`, e.message);
        failed.push({ action, shortcut });
      }
    }
  }

  logger.info(`Shortcuts registered (${failed.length} failed)`);
  return failed;
}

function unregisterAllShortcuts() {
  globalShortcut.unregisterAll();
  logger.info('All shortcuts unregistered');
}

module.exports = register;
module.exports.registerAllShortcuts = registerAllShortcuts;
module.exports.unregisterAllShortcuts = unregisterAllShortcuts;
module.exports.DEFAULT_SHORTCUTS = DEFAULT_SHORTCUTS;
