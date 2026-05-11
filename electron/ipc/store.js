// electron-store CRUD IPC handlers.

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Store');

function register(ctx) {
  const { store } = ctx;

  ipcMain.handle(CHANNELS.STORE.GET, async (event, key) => {
    try {
      const value = store.get(key);
      logger.debug('Get:', key);
      return value;
    } catch (error) {
      logger.error('Get error:', key, error.message);
      return null;
    }
  });

  ipcMain.handle(CHANNELS.STORE.SET, async (event, key, val) => {
    try {
      store.set(key, val);
      logger.debug('Set:', key);
      return { success: true };
    } catch (error) {
      logger.error('Set error:', key, error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.STORE.DELETE, async (event, key) => {
    try {
      store.delete(key);
      logger.debug('Delete:', key);
      return { success: true };
    } catch (error) {
      logger.error('Delete error:', key, error.message);
      return { success: false, error: error.message };
    }
  });

  // Wipe everything — destructive, expected only for "reset settings" UI action.
  ipcMain.handle(CHANNELS.STORE.CLEAR, async (event) => {
    try {
      store.clear();
      logger.warn('Store cleared!');
      return { success: true };
    } catch (error) {
      logger.error('Clear error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.STORE.HAS, async (event, key) => {
    try {
      return store.has(key);
    } catch (error) {
      logger.error('Has error:', key, error.message);
      return false;
    }
  });

  logger.info('Store IPC handlers registered');
}

module.exports = register;
