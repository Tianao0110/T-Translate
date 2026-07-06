// Shared persistence for translation-provider settings. Both ProviderSettings
// (when mounted) and SettingsPanel's unified save go through here, so a save
// triggered from any tab writes provider data completely instead of the old
// activeSection-routed path that silently dropped it.

import stackClient from '../../services/stack-client.js';
import createLogger from '../../utils/logger.js';

const logger = createLogger('ProviderSettings');

export const secureStorage = {
  async get(key, context) {
    if (window.electron?.secureStorage) {
      const value = await window.electron.secureStorage.decrypt(key, context ? { context } : undefined);
      if (value) return value;

      // One-shot migration: pull legacy plaintext from localStorage into
      // safeStorage, then erase the plaintext. If migration fails we still
      // wipe the legacy entry so plaintext never lingers.
      const legacy = localStorage.getItem(`__secure_${key}`);
      if (legacy) {
        try {
          const migrated = decodeURIComponent(atob(legacy));
          await window.electron.secureStorage.encrypt(key, migrated);
          localStorage.removeItem(`__secure_${key}`);
          logger.info(`Migrated key from localStorage to safeStorage: ${key}`);
          return migrated;
        } catch { /* fall through */ }
        localStorage.removeItem(`__secure_${key}`);
      }
      return null;
    }
    return null;
  },
  async set(key, value) {
    if (window.electron?.secureStorage) {
      return await window.electron.secureStorage.encrypt(key, value);
    }
    // Refuse to fall back to plaintext localStorage — secrets must stay encrypted.
    logger.warn('secureStorage unavailable, refusing to store key:', key);
    return false;
  },
};

// Encrypts secret fields, strips them from the persisted config, writes both
// dot-paths, and reloads the (main-window) translation service. All-or-nothing:
// if any encrypt fails we abort before touching disk so a key can never be
// silently dropped while the save reports success.
// Returns { ok, sanitizedConfigs }.
export async function persistProviderData({ providers, providerConfigs, allProvidersMeta }) {
  const sanitized = {};
  const encryptQueue = [];   // { key, value } to commit after all succeed
  const deleteQueue = [];    // vault keys to remove (cleared fields)

  for (const meta of allProvidersMeta) {
    sanitized[meta.id] = { ...providerConfigs[meta.id] };
    if (!meta.configSchema) continue;

    for (const [key, field] of Object.entries(meta.configSchema)) {
      if (!field.encrypted) continue;
      const vaultKey = `provider_${meta.id}_${key}`;
      const value = sanitized[meta.id][key];
      if (value) {
        encryptQueue.push({ vaultKey, value });
      } else {
        deleteQueue.push(vaultKey);
      }
      // Never leave a secret (or placeholder) in the persisted config.
      delete sanitized[meta.id][key];
    }
  }

  // Pre-flight: encrypt everything before any disk mutation.
  for (const { vaultKey, value } of encryptQueue) {
    const res = await secureStorage.set(vaultKey, value);
    if (res === false || res?.success === false) {
      logger.error('Encrypt failed, aborting provider save:', vaultKey);
      return { ok: false, sanitizedConfigs: null };
    }
  }
  for (const vaultKey of deleteQueue) {
    await window.electron?.secureStorage?.delete?.(vaultKey);
  }

  if (window.electron?.store) {
    await window.electron.store.set('settings.translation.providers', providers);
    await window.electron.store.set('settings.translation.providerConfigs', sanitized);
  }

  // Main-process stack re-reads store + vault itself — no plaintext configs
  // travel back over IPC for the reload.
  await stackClient.reload();

  // Dual-notify transition (until the floating/selection windows switch to the
  // stack too): the legacy broadcast still drives their old renderer-side
  // reload AND their non-stack settings sync. Do not remove before batch 3.
  if (window.electron?.floatingWindow?.notifySettingsChanged) {
    await window.electron.floatingWindow.notifySettingsChanged();
  }

  return { ok: true, sanitizedConfigs: sanitized };
}
