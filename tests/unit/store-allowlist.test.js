// The generic store IPC bridge is shared by every window, so its allowlist IS
// the boundary between "a compromised renderer" and the privacy gate. These
// lock the two claims that matter: renderer-persisted keys keep working, and
// 'privacyMode' (read per request by the translation facade and the key
// vault) cannot be touched through the generic bridge in any direction.

import { describe, it, expect } from 'vitest';
import {
  isReadableKey,
  isWritableKey,
  isDeletableKey,
} from '../../electron/ipc/store-allowlist.js';

describe('store allowlist', () => {
  it('privacyMode is untouchable through the generic bridge (read, write, delete)', () => {
    expect(isReadableKey('privacyMode')).toBe(false);
    expect(isWritableKey('privacyMode')).toBe(false);
    expect(isDeletableKey('privacyMode')).toBe(false);
  });

  it('every key renderers actually persist stays allowed', () => {
    // settings sub-keys (SettingsPanel save loop, sync-to-electron mirror, key vault bucket)
    for (const key of [
      'settings.translation.providers',
      'settings.translation.providerConfigs',
      'settings.ocr',
      'settings.document',
      'settings.floatingWindow',
      'settings.aiActions',
      'settings.selection',
      'settings.shortcuts',
      'settings.tts',
      'settings.screenshot',
      'settings.interface',
      'settings.privacy',
    ]) {
      expect(isWritableKey(key), `writable: ${key}`).toBe(true);
    }
    // onboarding state (use-onboarding) reads and writes the whole key
    expect(isReadableKey('onboarding')).toBe(true);
    expect(isWritableKey('onboarding')).toBe(true);
    // settings loads whole ('settings') and per-section
    expect(isReadableKey('settings')).toBe(true);
    expect(isReadableKey('settings.document')).toBe(true);
    // full settings reset (SettingsPanel resetSettings)
    expect(isDeletableKey('settings')).toBe(true);
    expect(isDeletableKey('onboarding')).toBe(true);
    expect(isDeletableKey('floatingWindowLocal.opacity')).toBe(true);
  });

  it('prefix matching does not leak past the dot', () => {
    expect(isWritableKey('settingsEvil')).toBe(false);
    expect(isReadableKey('settingsEvil')).toBe(false);
    expect(isWritableKey('settings')).toBe(false); // whole-key write has no caller
  });

  it('the floating-window opacity override is delete-only (written by its own channel)', () => {
    expect(isWritableKey('floatingWindowLocal.opacity')).toBe(false);
    expect(isReadableKey('floatingWindowLocal')).toBe(false);
  });

  it('non-string keys are rejected everywhere', () => {
    for (const bad of [null, undefined, 42, {}, ['settings.x']]) {
      expect(isReadableKey(bad)).toBe(false);
      expect(isWritableKey(bad)).toBe(false);
      expect(isDeletableKey(bad)).toBe(false);
    }
  });
});
