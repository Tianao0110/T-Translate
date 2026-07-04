// Locks the secure-storage burst heuristic: app-internal bulk sweeps
// (settings-load / stack-reload / ocr-config) must never trip the alarm.
// v0.3.0's multi-window reload broadcasts made that a routine false positive
// (boot + one settings save ≈ 25 decrypts / 12 keys → spurious alert).

import { describe, it, expect, beforeEach } from 'vitest';

const { _audit } = await import('../../electron/ipc/secure-storage.js');

describe('secure-storage access audit', () => {
  beforeEach(() => _audit.reset());

  it('ignores bulk app-internal sweeps (boot + settings save + OCR loads)', () => {
    // settings page load
    for (let i = 0; i < 12; i++) _audit.logAccess(`provider_p${i}_apiKey`, 'settings-load');
    // translation stack reload in three windows
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < 12; i++) _audit.logAccess(`provider_p${i}_apiKey`, 'stack-reload');
    }
    // OCR engine config loads
    for (let i = 0; i < 4; i++) _audit.logAccess(`ocr_key${i}`, 'ocr-config');

    expect(_audit.checkAnomaly().isAnomaly).toBe(false);
  });

  it('still alarms on an un-contexted burst', () => {
    let last;
    for (let i = 0; i < 15; i++) last = _audit.logAccess(`provider_p${i}_apiKey`, 'unknown');
    expect(last.isAnomaly).toBe(true);
    expect(last.count).toBe(15);
    expect(last.uniqueKeys).toBe(15);
  });

  it('bulk records do not push a sub-threshold burst over the line', () => {
    for (let i = 0; i < 14; i++) _audit.logAccess(`k${i}`, 'unknown');
    for (let i = 0; i < 30; i++) _audit.logAccess(`bulk${i}`, 'stack-reload');
    expect(_audit.checkAnomaly().isAnomaly).toBe(false);
    // one more genuine access crosses the threshold on its own merits
    expect(_audit.logAccess('one-more', 'unknown').isAnomaly).toBe(true);
  });

  it('default context counts as non-bulk', () => {
    for (let i = 0; i < 15; i++) _audit.logAccess(`k${i}`);
    expect(_audit.checkAnomaly().isAnomaly).toBe(true);
  });
});
