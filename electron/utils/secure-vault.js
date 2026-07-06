// Main-process decryption facade for the translation stack: one place that
// combines safeStorage decrypt + offline privacy gate + access audit. The
// bulk walk is the former floating-window:get-provider-configs implementation
// promoted to shared code (that IPC channel retires once all windows run on
// the stack); unlike the old handler, every key decrypted here also lands in
// the audit trail (bulk context, so no false alarms).

const { auditAccess } = require('./secure-audit');
const logger = require('./logger')('SecureVault');

// Online-service key prefixes: offline mode blocks their decryption so no
// network credential is even readable while the app promises "no requests".
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

// safeStorage is injectable for tests (vitest externalizes `require('electron')`
// to the real npm package, so the module-level alias mock never reaches CJS
// requires); production callers omit it and get the real Electron API.
function createSecureVault({ store, safeStorage } = {}) {
  const safe = safeStorage || require('electron').safeStorage;
  // Same semantics as the secure-storage IPC decrypt handler: privacy gate,
  // audit, then decrypt; any miss returns null.
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

  // Returns the provider list + configs with secure-storage fields decrypted.
  // ProviderSettings (0.2.6+) writes settings.translation.providers and strips
  // encrypted values from the persisted configs entirely, so walk the
  // __encrypted_provider_* store keys instead of looking for placeholders.
  function bulkDecryptProviderConfigs(context = 'stack-reload') {
    const mainSettings = store.get('settings', {});
    const translation = mainSettings.translation || {};
    const legacy = mainSettings.providers || {}; // pre-0.2.6 top-level bucket
    const useNew = Array.isArray(translation.providers) && translation.providers.length > 0;

    const list = useNew ? translation.providers : (legacy.list || []);
    const configs = JSON.parse(JSON.stringify(
      (useNew ? translation.providerConfigs : legacy.configs) || {}
    ));

    for (const storeKey of Object.keys(store.store)) {
      const m = storeKey.match(/^__encrypted_(provider_([^_]+)_(.+))$/);
      if (!m) continue;
      const [, secureKey, providerId, field] = m;
      // Same offline-mode gate as single-key decrypt
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

    // A surviving placeholder means its encrypted twin is gone — blank it so
    // providers fail the key check instead of sending the literal placeholder.
    for (const config of Object.values(configs)) {
      for (const [key, value] of Object.entries(config)) {
        if (value === '***encrypted***') config[key] = '';
      }
    }

    return { list, configs };
  }

  return { decrypt, bulkDecryptProviderConfigs };
}

module.exports = { createSecureVault, isDecryptAllowed, ONLINE_KEY_PREFIXES };
