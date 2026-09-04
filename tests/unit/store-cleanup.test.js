// pruneRetiredSettings on a fake store: dead keys go, live ones stay, and a
// second pass finds nothing to do.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pruneRetiredSettings, RETIRED_SETTINGS_KEYS } = require('../../electron/utils/store-cleanup.js');

function fakeStore(entries) {
  const map = new Map(Object.entries(entries));
  return {
    has: (k) => map.has(k),
    delete: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

describe('pruneRetiredSettings', () => {
  it('removes only the retired keys and reports how many', () => {
    const store = fakeStore({
      'settings.providers': {},
      'settings.connection': { endpoint: 'http://localhost:1234' },
      'settings.theme': 'light',
      'settings.translation': { targetLanguage: 'zh' },
      'settings.interface': { theme: 'light' },
      privacyMode: 'standard',
    });
    expect(pruneRetiredSettings(store)).toBe(3);
    expect(store.keys()).toEqual(['settings.translation', 'settings.interface', 'privacyMode']);
  });

  it('is a no-op on a clean store', () => {
    const store = fakeStore({ 'settings.translation': {} });
    expect(pruneRetiredSettings(store)).toBe(0);
    expect(store.keys()).toEqual(['settings.translation']);
  });

  it('never lists a bucket the app still writes', () => {
    for (const live of ['settings.translation', 'settings.ocr', 'settings.interface', 'settings.tts', 'settings.floatingWindow', 'settings.privacy']) {
      expect(RETIRED_SETTINGS_KEYS).not.toContain(live);
    }
  });
});
