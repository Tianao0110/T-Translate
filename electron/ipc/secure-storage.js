// electron/ipc/secure-storage.js
// 安全存储 IPC handlers（加密 API Key 等敏感信息）
// 使用 Electron 的 safeStorage API

const { ipcMain, safeStorage } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:SecureStorage');

/**
 * 注册安全存储相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { store } = ctx;
  
  // ==================== 加密存储 ====================
  
  /**
   * 加密并存储敏感数据
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.ENCRYPT, async (event, key, value) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('Encryption not available, using fallback');
        // 回退：使用 Base64 编码（不安全，但至少能用）
        store.set(`__encrypted_${key}`, Buffer.from(value).toString('base64'));
        return { success: true, encrypted: false };
      }
      
      const encrypted = safeStorage.encryptString(value);
      store.set(`__encrypted_${key}`, encrypted.toString('base64'));
      logger.debug('Encrypted and stored:', key);
      return { success: true, encrypted: true };
    } catch (error) {
      logger.error('Encrypt failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ==================== 解密读取 ====================
  
  /**
   * 解密读取敏感数据
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.DECRYPT, async (event, key) => {
    try {
      const stored = store.get(`__encrypted_${key}`);
      if (!stored) {
        return null;
      }
      
      if (!safeStorage.isEncryptionAvailable()) {
        // 回退：直接解码
        return Buffer.from(stored, 'base64').toString('utf-8');
      }
      
      const buffer = Buffer.from(stored, 'base64');
      const decrypted = safeStorage.decryptString(buffer);
      return decrypted;
    } catch (error) {
      logger.error('Decrypt failed:', error);
      return null;
    }
  });
  
  // ==================== 删除 ====================
  
  /**
   * 删除加密存储的数据
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.DELETE, async (event, key) => {
    try {
      store.delete(`__encrypted_${key}`);
      logger.debug('Deleted:', key);
      return { success: true };
    } catch (error) {
      logger.error('Delete failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // ==================== 可用性检查 ====================
  
  /**
   * 检查加密是否可用
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.IS_AVAILABLE, async () => {
    return safeStorage.isEncryptionAvailable();
  });
  
  logger.info('SecureStorage IPC handlers registered');
}

module.exports = register;
