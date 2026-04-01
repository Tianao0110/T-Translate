// electron/ipc/secure-storage.js
// 安全存储 IPC handlers（加密 API Key 等敏感信息）
// 使用 Electron 的 safeStorage API
//
// 安全特性：
// - 访问审计日志：每次解密操作记录时间、来源、key
// - 频率异常检测：短时间内大量解密触发告警
// - 隐私模式联动：离线/严格模式下拒绝解密在线 API Key
// - 无明文回退：加密不可用时拒绝存储而非降级为 Base64

const { ipcMain, safeStorage, BrowserWindow } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:SecureStorage');

// ==================== 访问审计系统 ====================

const accessLog = {
  records: [],
  maxRecords: 200,
  
  // 异常检测参数
  alertThreshold: 15,      // 60秒内超过15次解密视为异常
  alertWindowMs: 60000,    // 检测窗口60秒
  lastAlertTime: 0,        // 上次告警时间
  alertCooldownMs: 300000, // 告警冷却5分钟
};

/**
 * 记录一次解密访问并检测异常
 */
function logAccess(key, context = 'unknown') {
  accessLog.records.push({
    key,
    timestamp: Date.now(),
    context,
  });
  
  if (accessLog.records.length > accessLog.maxRecords) {
    accessLog.records = accessLog.records.slice(-accessLog.maxRecords);
  }
  
  return checkAnomaly();
}

/**
 * 异常检测：短时间内大量解密
 */
function checkAnomaly() {
  const now = Date.now();
  const windowStart = now - accessLog.alertWindowMs;
  const recent = accessLog.records.filter(r => r.timestamp > windowStart);
  
  if (recent.length >= accessLog.alertThreshold) {
    const uniqueKeys = new Set(recent.map(r => r.key));
    return {
      isAnomaly: true,
      count: recent.length,
      uniqueKeys: uniqueKeys.size,
      window: accessLog.alertWindowMs / 1000,
    };
  }
  
  return { isAnomaly: false };
}

/**
 * 向所有窗口发送安全告警
 */
function sendSecurityAlert(anomaly) {
  const now = Date.now();
  if (now - accessLog.lastAlertTime < accessLog.alertCooldownMs) return;
  accessLog.lastAlertTime = now;
  
  logger.warn(`SECURITY ALERT: ${anomaly.count} decrypt ops in ${anomaly.window}s (${anomaly.uniqueKeys} unique keys)`);
  
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('security-alert', {
        type: 'suspicious-key-access',
        count: anomaly.count,
        uniqueKeys: anomaly.uniqueKeys,
        timestamp: now,
      });
    }
  }
}

// ==================== 隐私模式联动 ====================

const ONLINE_KEY_PREFIXES = [
  'provider_openai_',
  'provider_anthropic_',
  'provider_deepl_',
  'provider_gemini_',
  'provider_deepseek_',
  'provider_google-translate_',
  'provider_microsoft-translator_',
  'provider_baidu-translate_',
];

/**
 * 检查当前隐私模式是否允许解密此key
 */
function isDecryptAllowed(key, store) {
  const privacyMode = store.get('privacyMode', 'standard');
  
  // 标准/无痕模式：允许
  if (privacyMode === 'standard' || privacyMode === 'secure') {
    return { allowed: true };
  }
  
  // 离线/严格模式：禁止在线API Key解密
  const isOnlineKey = ONLINE_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
  if (isOnlineKey) {
    return {
      allowed: false,
      reason: `Privacy mode "${privacyMode}" blocks online API key decryption`,
    };
  }
  
  return { allowed: true };
}

// ==================== IPC Handlers ====================

function register(ctx) {
  const { store } = ctx;
  
  /**
   * 加密并存储（无明文回退）
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.ENCRYPT, async (event, key, value) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        logger.error('Encryption not available - refusing plaintext storage');
        return { 
          success: false, 
          encrypted: false, 
          error: 'System encryption (DPAPI) is not available. Cannot securely store API keys.',
        };
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
  
  /**
   * 解密读取（带审计 + 隐私模式检查）
   * @param {string} key - 密钥名
   * @param {object} options - { context: 'settings-load' | 'translate' | undefined }
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.DECRYPT, async (event, key, options = {}) => {
    try {
      // 1. 隐私模式检查
      const privacyCheck = isDecryptAllowed(key, store);
      if (!privacyCheck.allowed) {
        logger.info(`Decrypt blocked by privacy mode: ${key}`);
        return null;
      }
      
      // 2. 访问审计 + 异常检测（设置页批量加载跳过告警）
      const context = options?.context || 'unknown';
      const anomaly = logAccess(key, context);
      if (anomaly.isAnomaly && context !== 'settings-load') {
        sendSecurityAlert(anomaly);
      }
      
      // 3. 解密
      const stored = store.get(`__encrypted_${key}`);
      if (!stored) return null;
      
      if (!safeStorage.isEncryptionAvailable()) {
        logger.error('Encryption not available - cannot decrypt');
        return null;
      }
      
      const buffer = Buffer.from(stored, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      logger.error('Decrypt failed:', error);
      return null;
    }
  });
  
  /**
   * 删除
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
  
  /**
   * 加密是否可用
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.IS_AVAILABLE, async () => {
    return safeStorage.isEncryptionAvailable();
  });
  
  /**
   * 获取审计日志（脱敏后）
   */
  ipcMain.handle(CHANNELS.SECURE_STORAGE.GET_ACCESS_LOG, async () => {
    return {
      records: accessLog.records.slice(-50).map(r => ({
        key: r.key.replace(/^provider_/, '').replace(/_apiKey$|_secretKey$/, '_***'),
        timestamp: r.timestamp,
        context: r.context,
      })),
      totalCount: accessLog.records.length,
    };
  });
  
  logger.info('SecureStorage IPC handlers registered (with audit & privacy guard)');
}

module.exports = register;
