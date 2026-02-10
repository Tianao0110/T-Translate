// electron/ipc/shortcuts.js
// 快捷键管理 IPC handlers
// 包含：获取、更新、暂停、恢复快捷键

const { ipcMain, globalShortcut } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Shortcuts');

// 默认快捷键配置
const DEFAULT_SHORTCUTS = {
  screenshot: 'Alt+Q',
  toggleWindow: 'CommandOrControl+Shift+W',
  glassWindow: 'CommandOrControl+Alt+G',
  selectionTranslate: 'CommandOrControl+Shift+T',
};

/**
 * 将渲染进程的快捷键格式转换为 Electron 格式
 * @param {string} shortcut - 快捷键字符串
 * @returns {string}
 */
function toElectronFormat(shortcut) {
  return shortcut
    .replace(/Ctrl/g, 'CommandOrControl')
    .replace(/Meta/g, 'Command');
}

/**
 * 注册快捷键管理 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { store, getMainWindow, managers } = ctx;
  
  // 获取快捷键处理函数映射
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
  
  // ==================== 获取快捷键 ====================
  
  /**
   * 获取当前快捷键配置
   */
  ipcMain.handle(CHANNELS.SHORTCUTS.GET, () => {
    const settings = store.get('settings', {});
    return settings.shortcuts || {};
  });
  
  // ==================== 更新快捷键 ====================
  
  /**
   * 更新某个快捷键
   */
  ipcMain.handle(CHANNELS.SHORTCUTS.UPDATE, (event, action, shortcut) => {
    try {
      const handlers = getShortcutHandlers();
      const handler = handlers[action];
      
      if (!handler) {
        logger.warn('Unknown action:', action);
        return { success: false, error: 'Unknown action' };
      }
      
      // 转换格式
      const electronShortcut = toElectronFormat(shortcut);
      
      // 获取旧的快捷键
      const settings = store.get('settings', {});
      const oldShortcut = settings.shortcuts?.[action] || DEFAULT_SHORTCUTS[action];
      const oldElectronShortcut = toElectronFormat(oldShortcut);
      
      // 先注销旧的快捷键
      try {
        globalShortcut.unregister(oldElectronShortcut);
        logger.debug('Unregistered old shortcut:', oldElectronShortcut);
      } catch (e) {
        logger.debug('Failed to unregister old shortcut:', oldElectronShortcut);
      }
      
      // 注册新的快捷键
      const success = globalShortcut.register(electronShortcut, handler);
      
      if (success) {
        // 保存到设置
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
        // 注册失败，尝试恢复旧的
        try {
          globalShortcut.register(oldElectronShortcut, handler);
        } catch (e) {
          logger.error('Failed to restore old shortcut');
        }
        logger.warn('Shortcut registration failed (may be in use):', electronShortcut);
        return { success: false, error: '快捷键已被占用' };
      }
    } catch (error) {
      logger.error('Update shortcut error:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ==================== 暂停快捷键 ====================
  
  /**
   * 暂时禁用某个全局快捷键（用于编辑时防止误触发）
   */
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
  
  // ==================== 恢复快捷键 ====================
  
  /**
   * 恢复某个全局快捷键
   */
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
        return { success: false, error: '快捷键恢复失败' };
      }
    } catch (error) {
      logger.error('Resume shortcut error:', error);
      return { success: false, error: error.message };
    }
  });
  
  logger.info('Shortcuts IPC handlers registered');
}

/**
 * 注册所有默认快捷键（在应用启动时调用）
 * @param {Object} ctx - 共享上下文
 */
function registerAllShortcuts(ctx) {
  const { store, getMainWindow, managers } = ctx;
  
  const settings = store.get('settings', {});
  const shortcuts = settings.shortcuts || {};
  
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
  
  // 注册每个快捷键
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
          logger.warn(`Failed to register: ${action} [${electronShortcut}]`);
        }
      } catch (e) {
        logger.error(`Error registering ${action}:`, e.message);
      }
    }
  }
  
  logger.info('All shortcuts registered');
}

/**
 * 注销所有快捷键（在应用退出时调用）
 */
function unregisterAllShortcuts() {
  globalShortcut.unregisterAll();
  logger.info('All shortcuts unregistered');
}

module.exports = register;
module.exports.registerAllShortcuts = registerAllShortcuts;
module.exports.unregisterAllShortcuts = unregisterAllShortcuts;
module.exports.DEFAULT_SHORTCUTS = DEFAULT_SHORTCUTS;
