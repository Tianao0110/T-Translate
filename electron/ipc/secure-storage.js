// Secure storage IPC: encrypts API keys via Electron safeStorage (DPAPI on Windows).
// Layered defenses: access audit log, anomaly detection, privacy-mode gate.
// No plaintext fallback — refuses to store if encryption is unavailable.
//
// The audit trail and the offline privacy gate live in shared modules
// (utils/secure-audit.js, utils/secure-vault.js) since the main-process
// translation stack decrypts in-process through the same code paths — an
// IPC-local audit would be blind to the stack's traffic.

const { ipcMain, safeStorage } = require('electron');
const { CHANNELS } = require('../shared/channels');
const audit = require('../utils/secure-audit');
const { isDecryptAllowed } = require('../utils/secure-vault');
const logger = require('../utils/logger')('IPC:SecureStorage');

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

  // No access-log query channel: the audit trail exists for the anomaly
  // detector + security alerts, not for UI consumption.

  logger.info('SecureStorage IPC handlers registered (with audit & privacy guard)');
}

module.exports = register;
// Re-exported for floating-window.js and any other main-side consumer so its
// direct safeStorage reads respect the same offline-mode gate.
module.exports.isDecryptAllowed = isDecryptAllowed;
// Test-only surface (tests/unit/secure-audit.test.js): the burst heuristic
// must stay false-positive-free for app-internal bulk sweeps. Kept stable
// across the extraction to utils/secure-audit.js.
module.exports._audit = {
  logAccess: audit.logAccess,
  checkAnomaly: audit.checkAnomaly,
  reset: audit.reset,
};
