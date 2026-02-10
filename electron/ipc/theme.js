// electron/ipc/theme.js
// ============================================================
// 主题管理 IPC - 统一处理主题切换和同步
// ============================================================

const { ipcMain, BrowserWindow } = require('electron');
const { CHANNELS } = require('../shared/channels');

// 当前主题缓存
let currentTheme = 'light';

/**
 * 注册主题相关的 IPC 处理器
 * @param {Object} context - 上下文对象
 * @param {Object} context.store - electron-store 实例
 * @param {Object} context.logger - 日志实例
 */
function registerThemeIPC({ store, logger }) {
  logger.info('Registering Theme IPC handlers');

  // ==================== 获取当前主题 ====================
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

  // ==================== 设置主题（广播到所有窗口）====================
  ipcMain.handle(CHANNELS.THEME.SET, async (event, theme) => {
    try {
      logger.info('Setting theme:', theme);
      
      // 1. 保存到 store
      const settings = store.get('settings') || {};
      settings.interface = { ...settings.interface, theme };
      store.set('settings', settings);
      
      // 2. 更新缓存
      currentTheme = theme;
      
      // 3. 广播到所有窗口
      broadcastThemeChange(theme, logger);
      
      return { success: true, theme };
    } catch (error) {
      logger.error('Failed to set theme:', error);
      return { success: false, error: error.message };
    }
  });

  // ==================== 同步主题到指定窗口 ====================
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

/**
 * 广播主题变化到所有窗口
 * @param {string} theme - 新主题
 * @param {Object} logger - 日志实例
 */
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

/**
 * 获取当前主题（供其他模块使用）
 */
function getCurrentTheme() {
  return currentTheme;
}

/**
 * 设置当前主题缓存（供初始化时使用）
 */
function setCurrentTheme(theme) {
  currentTheme = theme;
}

module.exports = {
  registerThemeIPC,
  broadcastThemeChange,
  getCurrentTheme,
  setCurrentTheme,
};
