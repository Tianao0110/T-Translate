// electron/ipc/clipboard.js
// 剪贴板操作 IPC handlers
// 包含：读写文本、读取图片

const { ipcMain, clipboard } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Clipboard');

/**
 * 注册剪贴板相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  // ==================== 文本操作 ====================
  
  /**
   * 写入文本到剪贴板 (handle 版本，用于玻璃窗口等)
   */
  ipcMain.handle(CHANNELS.CLIPBOARD.WRITE_TEXT, (event, text) => {
    try {
      clipboard.writeText(text);
      logger.debug('Write text, length:', text?.length || 0);
      return true;
    } catch (error) {
      logger.error('Write text error:', error.message);
      return false;
    }
  });
  
  /**
   * 写入文本到剪贴板 (on 版本，兼容旧代码)
   */
  ipcMain.on(CHANNELS.CLIPBOARD.WRITE_TEXT_LEGACY, (event, text) => {
    try {
      clipboard.writeText(text);
      logger.debug('Write text (legacy), length:', text?.length || 0);
    } catch (error) {
      logger.error('Write text error:', error.message);
    }
  });
  
  /**
   * 读取剪贴板文本 (handle 版本)
   */
  ipcMain.handle(CHANNELS.CLIPBOARD.READ_TEXT, () => {
    try {
      const text = clipboard.readText();
      logger.debug('Read text, length:', text?.length || 0);
      return text;
    } catch (error) {
      logger.error('Read text error:', error.message);
      return '';
    }
  });
  
  /**
   * 读取剪贴板文本 (handle 版本，兼容旧通道名)
   */
  ipcMain.handle(CHANNELS.CLIPBOARD.READ_TEXT_LEGACY, () => {
    try {
      return clipboard.readText();
    } catch (error) {
      logger.error('Read text error:', error.message);
      return '';
    }
  });
  
  // ==================== 图片操作 ====================
  
  /**
   * 读取剪贴板图片
   * @returns {string|null} 图片的 DataURL，或 null
   */
  ipcMain.handle(CHANNELS.CLIPBOARD.READ_IMAGE, () => {
    try {
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const dataURL = image.toDataURL();
        logger.debug('Read image, size:', image.getSize());
        return dataURL;
      }
      return null;
    } catch (error) {
      logger.error('Read image error:', error.message);
      return null;
    }
  });
  
  // ==================== 辅助函数 ====================
  
  /**
   * 获取剪贴板可用格式（内部使用，不暴露给渲染进程）
   * @returns {string[]}
   */
  function getAvailableFormats() {
    return clipboard.availableFormats();
  }
  
  /**
   * 清空剪贴板（内部使用）
   */
  function clearClipboard() {
    clipboard.clear();
  }
  
  logger.info('Clipboard IPC handlers registered');
  
  // 返回辅助函数供其他模块使用
  return {
    getAvailableFormats,
    clearClipboard,
  };
}

module.exports = register;
