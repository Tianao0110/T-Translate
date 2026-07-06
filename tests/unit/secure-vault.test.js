// SecureVault: the main-process decryption facade the translation stack uses.
// Locks three things: the bulk provider-config walk (promoted from the old
// floating-window handler), the offline privacy gate, and audit continuity —
// in-process decryption must land in the same trail as IPC decryption, with
// bulk contexts exempt from the burst alarm (design §3.7).

import { describe, it, expect, beforeEach } from 'vitest';
import { safeStorage } from '../mocks/electron.js';

const { createSecureVault } = await import('../../electron/utils/secure-vault.js');
const { _audit } = await import('../../electron/ipc/secure-storage.js');

const b64enc = (plain) => Buffer.from(`enc:${plain}`, 'utf8').toString('base64');
// Vault takes safeStorage via injection — vitest externalizes CJS
// require('electron') to the real npm package, so the alias mock only reaches
// ESM imports like this one.
const makeVault = (store) => createSecureVault({ store, safeStorage });

function fakeStore(overrides = {}) {
  const data = {
    privacyMode: 'standard',
    settings: {
      translation: {
        providers: [{ id: 'openai', enabled: true, priority: 1 }],
        providerConfigs: {
          openai: { model: 'gpt-4o-mini', apiKey: '***encrypted***' },
        },
      },
    },
    ['__encrypted_provider_openai_apiKey']: b64enc('sk-live-123'),
    ['__encrypted_provider_deepl_apiKey']: b64enc('dk-456'),
    ...overrides,
  };
  return {
    get: (key, dflt) => (key in data ? data[key] : dflt),
    store: data,
  };
}

beforeEach(() => _audit.reset());

describe('secure-vault', () => {
  it('bulk walk decrypts vault keys into configs and blanks stale placeholders', () => {
    const vault = makeVault(fakeStore());
    const { list, configs } = vault.bulkDecryptProviderConfigs('stack-reload');

    expect(list).toEqual([{ id: 'openai', enabled: true, priority: 1 }]);
    expect(configs.openai.apiKey).toBe('sk-live-123');
    expect(configs.openai.model).toBe('gpt-4o-mini');
    expect(configs.deepl.apiKey).toBe('dk-456');
    expect(JSON.stringify(configs)).not.toContain('***encrypted***');
  });

  it('offline mode refuses online keys — placeholder blanked, nothing decrypted', () => {
    const vault = makeVault(fakeStore({ privacyMode: 'offline' }));
    const { configs } = vault.bulkDecryptProviderConfigs('stack-reload');

    // Gate skipped decryption; the surviving placeholder is blanked so the
    // provider fails its key check instead of sending the literal marker.
    expect(configs.openai.apiKey).toBe('');
    expect(configs.deepl).toBeUndefined();
  });

  it('in-process decryption lands in the shared audit trail without tripping the bulk alarm', () => {
    const store = fakeStore();
    const vault = makeVault(store);

    // A whole bulk sweep: recorded, but exempt from the burst alarm
    for (let i = 0; i < 10; i++) vault.bulkDecryptProviderConfigs('stack-reload');
    expect(_audit.checkAnomaly().isAnomaly).toBe(false);

    // Un-contexted single decrypts still count toward the alarm
    _audit.reset();
    let last;
    for (let i = 0; i < 15; i++) last = _audit.logAccess(`k${i}`, 'unknown');
    expect(last.isAnomaly).toBe(true);
  });

  it('single decrypt returns plaintext and respects the offline gate', () => {
    const vault = makeVault(fakeStore());
    expect(vault.decrypt('provider_openai_apiKey', 'stack-reload')).toBe('sk-live-123');

    const offlineVault = makeVault(fakeStore({ privacyMode: 'offline' }));
    expect(offlineVault.decrypt('provider_openai_apiKey', 'stack-reload')).toBeNull();
  });
});
