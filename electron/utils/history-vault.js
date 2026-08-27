// Encrypted-at-rest vault for the translation-store persist blob (history,
// favorites, statistics, secure-mode stash). DPAPI via Electron safeStorage —
// same key story as the API-key vault: ciphertext is bound to the Windows
// user account, no key material of our own.
//
// Dependency-injected fs/safeStorage/path so the vault is testable outside
// Electron (secure-vault pattern).

const nodeFs = require('fs');
const nodePath = require('path');

function createHistoryVault({ filePath, fs = nodeFs, path = nodePath, safeStorage, logger = console }) {
  if (!filePath) throw new Error('history-vault: filePath is required');

  function available() {
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  function status() {
    let exists = false;
    let fileSize = 0;
    try {
      const st = fs.statSync(filePath);
      exists = st.isFile();
      fileSize = st.size;
    } catch {
      // absent — normal before first save
    }
    return { available: available(), exists, fileSize };
  }

  // Returns the decrypted JSON string, or null (no vault / unreadable).
  // A file that exists but cannot be decrypted is evidence of corruption or a
  // foreign-account copy: keep it under a .corrupt-<ts> name instead of
  // overwriting, and start fresh.
  function load() {
    if (!available()) return null;
    let buf;
    try {
      buf = fs.readFileSync(filePath);
    } catch {
      return null;
    }
    try {
      return safeStorage.decryptString(buf);
    } catch (err) {
      const quarantine = `${filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(filePath, quarantine);
        logger.error?.(`history-vault: decrypt failed (${err.message}) — quarantined to ${path.basename(quarantine)}`);
      } catch {
        logger.error?.(`history-vault: decrypt failed and quarantine failed (${err.message})`);
      }
      return null;
    }
  }

  // Atomic save: write ciphertext to a temp sibling, then rename over.
  function save(jsonString) {
    if (typeof jsonString !== 'string' || !jsonString) {
      return { success: false, reason: 'empty' };
    }
    if (!available()) return { success: false, reason: 'unavailable' };
    try {
      const cipher = safeStorage.encryptString(jsonString);
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, cipher);
      fs.renameSync(tmp, filePath);
      return { success: true };
    } catch (err) {
      logger.error?.(`history-vault: save failed: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  function clear() {
    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      // Already gone counts as cleared.
      if (err.code === 'ENOENT') return { success: true };
      logger.error?.(`history-vault: clear failed: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  return { status, load, save, clear };
}

module.exports = { createHistoryVault };
