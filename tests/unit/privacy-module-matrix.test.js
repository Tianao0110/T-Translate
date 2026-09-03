// The privacy page's per-module table must cover every module in every mode
// and state the decisions the code enforces.

import { describe, it, expect } from 'vitest';
import { PRIVACY_MODULES, PRIVACY_MODE_ORDER, MODULE_STATE, moduleState } from '../../src/utils/privacy-module-matrix.js';
import zh from '../../src/i18n/locales/zh.js';
import en from '../../src/i18n/locales/en.js';

describe('privacy module matrix', () => {
  it('has a state for every module in every mode', () => {
    for (const m of PRIVACY_MODULES) {
      for (const mode of PRIVACY_MODE_ORDER) {
        expect(['on', 'part', 'off']).toContain(moduleState(m, mode));
      }
    }
    expect(Object.keys(MODULE_STATE).sort()).toEqual([...PRIVACY_MODULES].sort());
  });

  it('states the enforced decisions: offline never reaches the network, incognito writes nothing', () => {
    expect(moduleState('downloads', 'offline')).toBe('off');
    expect(moduleState('updates', 'offline')).toBe('off');
    expect(moduleState('speak', 'offline')).toBe('part'); // external server blocked
    expect(moduleState('history', 'secure')).toBe('off');
    expect(moduleState('listen', 'secure')).toBe('off'); // stays disabled until the incognito audit
    expect(moduleState('listen', 'offline')).toBe('on'); // models are local
  });

  it('both locales carry a name, a per-mode line, and a short reason for every restricted cell', () => {
    for (const locale of [zh, en]) {
      for (const m of PRIVACY_MODULES) {
        const entry = locale.privacy.modules[m];
        expect(typeof entry.name).toBe('string');
        for (const mode of PRIVACY_MODE_ORDER) {
          expect(typeof entry[mode]).toBe('string');
          if (moduleState(m, mode) !== 'on') expect(typeof entry[`${mode}Short`]).toBe('string');
        }
      }
    }
  });
});
