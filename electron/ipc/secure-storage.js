// Secure storage IPC: API keys through Electron safeStorage (DPAPI), with
// the access audit, anomaly detection and privacy-mode gate of
// security/secure-vault.js and security/secure-audit.js. No plaintext
// fallback.

const { ipcMain, safeStorage } = require('electron');
const { CHANNELS } = require('../shared/channels');
const audit = require('../security/secure-audit');
const { isDecryptAllowed } = require('../security/secure-vault');
const logger = require('../platform/logger')('IPC:SecureStorage');

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

  // options.context: recognized bulk contexts (BULK_CONTEXTS) are logged for
  // the audit trail but never counted toward the burst alarm.
  ipcMain.handle(CHANNELS.SECURE_STORAGE.DECRYPT, async (event, key, options = {}) => {
    try {
      const privacyCheck = isDecryptAllowed(key, store);
      if (!privacyCheck.allowed) {
        logger.info(`Decrypt blocked by privacy mode: ${key}`);
        return null;
      }

      audit.auditAccess(key, options?.context || 'unknown');

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

  // No access-log query channel; the audit trail is not for UI consumption.

  logger.info('SecureStorage IPC handlers registered (with audit & privacy guard)');
}

module.exports = register;
// Re-exported for main-side consumers (floating-window.js), same offline gate.
module.exports.isDecryptAllowed = isDecryptAllowed;
// Test-only surface (tests/unit/main/secure-audit.test.js).
module.exports._audit = {
  logAccess: audit.logAccess,
  checkAnomaly: audit.checkAnomaly,
  reset: audit.reset,
};
