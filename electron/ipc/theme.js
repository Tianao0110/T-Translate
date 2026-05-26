// Theme IPC — get / set / sync / broadcast to all windows.

const { ipcMain, BrowserWindow } = require('electron');
const { CHANNELS } = require('../shared/channels');

let currentTheme = 'light';

function registerThemeIPC({ store, logger }) {
  logger.info('Registering Theme IPC handlers');

  ipcMain.handle(CHANNELS.THEME.GET, async () => {
    try {
      const settings = store.get('settings') || {};
      currentTheme = settings.interface?.theme || 'light';
      return { success: true, theme: currentTheme };
    } catch (error) {
      logger.error('Failed to get theme:', error);
      return { success: false, error: error.message, theme: 'light' };
    }
  });

  // SET also broadcasts to every window — theme is a global UI concern.
  ipcMain.handle(CHANNELS.THEME.SET, async (event, theme) => {
    try {
      logger.info('Setting theme:', theme);

      const settings = store.get('settings') || {};
      settings.interface = { ...settings.interface, theme };
      store.set('settings', settings);

      currentTheme = theme;

      broadcastThemeChange(theme, logger);

      return { success: true, theme };
    } catch (error) {
      logger.error('Failed to set theme:', error);
      return { success: false, error: error.message };
    }
  });

  // Pull current theme — used when a window mounts and needs to initialize its UI.
  ipcMain.handle(CHANNELS.THEME.SYNC, async (event) => {
    try {
      const settings = store.get('settings') || {};
      const theme = settings.interface?.theme || 'light';
      return { success: true, theme };
    } catch (error) {
      logger.error('Failed to sync theme:', error);
      return { success: false, error: error.message, theme: 'light' };
    }
  });

  logger.info('Theme IPC handlers registered');
}

function broadcastThemeChange(theme, logger) {
  const windows = BrowserWindow.getAllWindows();

  windows.forEach(win => {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send(CHANNELS.THEME.CHANGED, theme);
        logger.debug(`Theme broadcasted to window ${win.id}`);
      } catch (e) {
        logger.warn(`Failed to broadcast theme to window ${win.id}:`, e.message);
      }
    }
  });
}

function getCurrentTheme() {
  return currentTheme;
}

function setCurrentTheme(theme) {
  currentTheme = theme;
}

module.exports = {
  registerThemeIPC,
  broadcastThemeChange,
  getCurrentTheme,
  setCurrentTheme,
};
