// electron/ipc/store.js
// 存储相关 IPC handlers
// 包含：配置读写、删除、清空等

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Store');

/**
 * 注册存储相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { store } = ctx;
  
  // ==================== 基础 CRUD ====================
  
  /**
   * 获取存储值
   */
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
  
  /**
   * 设置存储值
   */
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
  
  /**
   * 删除存储项
   */
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
  
  /**
   * 清空所有存储
   * 危险操作，需要谨慎使用
   */
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
  
  /**
   * 检查键是否存在
   */
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
