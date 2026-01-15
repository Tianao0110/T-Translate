// electron/ipc/privacy.js
// 隐私模式 IPC handlers
// 包含：模式切换、状态获取

const { ipcMain } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Privacy');

/**
 * 注册隐私模式相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { store } = ctx;
  
  // ==================== 模式管理 ====================
  
  /**
   * 设置隐私模式
   */
  ipcMain.handle(CHANNELS.PRIVACY.SET_MODE, (event, mode) => {
    try {
      // 验证模式有效性
      const validModes = Object.values(PRIVACY_MODES);
      if (!validModes.includes(mode)) {
        return { success: false, error: `Invalid mode: ${mode}` };
      }
      
      store.set('privacyMode', mode);
      logger.info('Mode changed to:', mode);
      
      // 根据模式调整行为
      if (mode === PRIVACY_MODES.OFFLINE) {
        logger.info('Offline mode enabled - network features restricted');
      } else if (mode === PRIVACY_MODES.STRICT) {
        logger.info('Strict mode enabled - all telemetry disabled');
      }
      
      return { success: true, mode };
    } catch (error) {
      logger.error('Set mode error:', error);
      return { success: false, error: error.message };
    }
  });
  
  /**
   * 获取当前隐私模式
   */
  ipcMain.handle(CHANNELS.PRIVACY.GET_MODE, () => {
    return store.get('privacyMode', PRIVACY_MODES.STANDARD);
  });
  
  logger.info('Privacy IPC handlers registered');
}

module.exports = register;
