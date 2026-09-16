// Main-process decryption facade: safeStorage decrypt + offline gate + access
// audit (secure-audit.js) in one place, for the stack and the IPC handlers.
// Which keys offline mode blocks and why: docs/design/main-process.md §7.

const { auditAccess } = require('./secure-audit');
const logger = require('../platform/logger')('SecureVault');

// Secret fields of settings.ocr; mirror of OCR_SECRET_FIELDS in
// src/ocr/ocr-key-vault.js (the renderer encrypt side).
const OCR_SECRET_FIELDS = [
  'ocrspaceKey',
  'googleVisionKey',
  'azureKey',
  'baiduApiKey',
  'baiduSecretKey',
];

// Online-service key prefixes: offline mode blocks their decryption.
const ONLINE_KEY_PREFIXES = [
  'provider_openai_',
  'provider_anthropic_',
  'provider_deepl_',
  'provider_gemini_',
  'provider_deepseek_',
  'provider_google-translate_',
  'provider_microsoft-translator_',
  'provider_baidu-translate_',
  'ocr_',
  'tts_endpoint_',
];

function isDecryptAllowed(key, store) {
  const privacyMode = store.get('privacyMode', 'standard');

  if (privacyMode === 'standard' || privacyMode === 'secure') {
    return { allowed: true };
  }

  const isOnlineKey = ONLINE_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
  if (isOnlineKey) {
    return {
      allowed: false,
      reason: `Privacy mode "${privacyMode}" blocks online API key decryption`,
    };
  }

  return { allowed: true };
}

// safeStorage is injectable for tests.
function createSecureVault({ store, safeStorage } = {}) {
  const safe = safeStorage || require('electron').safeStorage;
  // Privacy gate, audit, then decrypt; any miss returns null.
  function decrypt(key, context = 'unknown') {
    try {
      if (!isDecryptAllowed(key, store).allowed) {
        logger.info(`Decrypt blocked by privacy mode: ${key}`);
        return null;
      }

      auditAccess(key, context);

      const stored = store.get(`__encrypted_${key}`);
      if (!stored) return null;

      if (!safe.isEncryptionAvailable()) {
        logger.error('Encryption not available - cannot decrypt');
        return null;
      }

      return safe.decryptString(Buffer.from(stored, 'base64'));
    } catch (error) {
      logger.error('Decrypt failed:', error?.message || error);
      return null;
    }
  }

  // The provider list + configs with the vaulted fields decrypted (walks
  // the __encrypted_provider_* store keys).
  function bulkDecryptProviderConfigs(context = 'stack-reload') {
    const mainSettings = store.get('settings', {});
    const translation = mainSettings.translation || {};
    const legacy = mainSettings.providers || {};
    const useNew = Array.isArray(translation.providers) && translation.providers.length > 0;

    const list = useNew ? translation.providers : (legacy.list || []);
    const configs = JSON.parse(JSON.stringify(
      (useNew ? translation.providerConfigs : legacy.configs) || {}
    ));

    for (const storeKey of Object.keys(store.store)) {
      const m = storeKey.match(/^__encrypted_(provider_([^_]+)_(.+))$/);
      if (!m) continue;
      const [, secureKey, providerId, field] = m;
      if (!isDecryptAllowed(secureKey, store).allowed) continue;
      auditAccess(secureKey, context);
      try {
        const buffer = Buffer.from(store.store[storeKey], 'base64');
        configs[providerId] = configs[providerId] || {};
        configs[providerId][field] = safe.isEncryptionAvailable()
          ? safe.decryptString(buffer)
          : buffer.toString('utf-8');
      } catch (e) {
        logger.error(`Failed to decrypt ${storeKey}:`, e?.message || e);
      }
    }

    // A surviving placeholder means its encrypted twin is gone: blank it.
    for (const config of Object.values(configs)) {
      for (const [key, value] of Object.entries(config)) {
        if (value === '***encrypted***') config[key] = '';
      }
    }

    return { list, configs };
  }

  // settings.ocr with the vaulted secrets merged in; an existing bucket
  // value (legacy plaintext) wins.
  function decryptOcrBucket(context = 'ocr-config') {
    const merged = { ...(store.get('settings.ocr') || {}) };
    for (const field of OCR_SECRET_FIELDS) {
      if (merged[field]) continue;
      const value = decrypt(`ocr_${field}`, context);
      if (value) merged[field] = value;
    }
    return merged;
  }

  return { decrypt, bulkDecryptProviderConfigs, decryptOcrBucket };
}

module.exports = { createSecureVault, isDecryptAllowed, };
