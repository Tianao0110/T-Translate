// Secure storage IPC: encrypts API keys via Electron safeStorage (DPAPI on Windows).
// Layered defenses: access audit log, anomaly detection, privacy-mode gate.
// No plaintext fallback — refuses to store if encryption is unavailable.

const { ipcMain, safeStorage, BrowserWindow } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:SecureStorage');

// ===== Access audit =====

const accessLog = {
  records: [],
  maxRecords: 200,

  alertThreshold: 15,      // >15 decrypts in window => suspicious
  alertWindowMs: 60000,
  lastAlertTime: 0,
  alertCooldownMs: 300000, // throttle alerts to 1 per 5 min
};

function logAccess(key, context = 'unknown') {
  accessLog.records.push({ key, timestamp: Date.now(), context });

  if (accessLog.records.length > accessLog.maxRecords) {
    accessLog.records = accessLog.records.slice(-accessLog.maxRecords);
  }

  return checkAnomaly();
}

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

// ===== Privacy-mode gate =====

const ONLINE_KEY_PREFIXES = [
  'provider_openai_',
  'provider_anthropic_',
  'provider_deepl_',
  'provider_gemini_',
  'provider_deepseek_',
  'provider_google-translate_',
  'provider_microsoft-translator_',
  'provider_baidu-translate_',
  // All vaulted OCR keys belong to online engines (ocr-key-vault.js);
  // offline mode's allowed engines are local-only and need no keys.
  'ocr_',
];

function isDecryptAllowed(key, store) {
  const privacyMode = store.get('privacyMode', 'standard');

  if (privacyMode === 'standard' || privacyMode === 'secure') {
    return { allowed: true };
  }

  // offline/strict: block online API keys to prevent network leakage
  const isOnlineKey = ONLINE_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
  if (isOnlineKey) {
    return {
      allowed: false,
      reason: `Privacy mode "${privacyMode}" blocks online API key decryption`,
    };
  }

  return { allowed: true };
}

// ===== IPC handlers =====

function register(ctx) {
  const { store } = ctx;

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

  // options.context: 'settings-load' suppresses anomaly alert during batch load
  ipcMain.handle(CHANNELS.SECURE_STORAGE.DECRYPT, async (event, key, options = {}) => {
    try {
      const privacyCheck = isDecryptAllowed(key, store);
      if (!privacyCheck.allowed) {
        logger.info(`Decrypt blocked by privacy mode: ${key}`);
        return null;
      }

      const context = options?.context || 'unknown';
      const anomaly = logAccess(key, context);
      if (anomaly.isAnomaly && context !== 'settings-load') {
        sendSecurityAlert(anomaly);
      }

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

  ipcMain.handle(CHANNELS.SECURE_STORAGE.IS_AVAILABLE, async () => {
    return safeStorage.isEncryptionAvailable();
  });

  // No access-log query channel: the audit trail (accessLog above) exists for
  // the anomaly detector + security alerts, not for UI consumption.

  logger.info('SecureStorage IPC handlers registered (with audit & privacy guard)');
}

module.exports = register;
// Shared with floating-window.js so its direct safeStorage reads respect the
// same offline-mode gate instead of maintaining a second prefix list.
module.exports.isDecryptAllowed = isDecryptAllowed;
