// electron-store CRUD IPC handlers, key-allowlisted (store-allowlist.js):
// the generic bridge is shared by every window.

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const { isReadableKey, isWritableKey, isDeletableKey } = require('./store-allowlist');
const logger = require('../platform/logger')('IPC:Store');

function register(ctx) {
  const { store } = ctx;

  ipcMain.handle(CHANNELS.STORE.GET, async (event, key) => {
    if (!isReadableKey(key)) {
      logger.warn('Get blocked (key not allowlisted):', key);
      return null;
    }
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
    if (!isWritableKey(key)) {
      logger.warn('Set blocked (key not allowlisted):', key);
      return { success: false, error: `store key not allowed: ${key}` };
    }
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
    if (!isDeletableKey(key)) {
      logger.warn('Delete blocked (key not allowlisted):', key);
      return { success: false, error: `store key not allowed: ${key}` };
    }
    try {
      store.delete(key);
      logger.debug('Delete:', key);
      return { success: true };
    } catch (error) {
      logger.error('Delete error:', key, error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info('Store IPC handlers registered');
}

module.exports = register;
