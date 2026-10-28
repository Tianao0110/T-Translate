// applyTimeZoneFallback with a fake env and registry: TZ is pinned only when
// ICU could not resolve the Windows zone and the id is in the table.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { applyTimeZoneFallback, readWindowsZoneId } = require('../../../electron/platform/time-zone.js');

const run = (overrides = {}) => {
  const env = overrides.env || {};
  let reads = 0;
  const result = applyTimeZoneFallback({
    env,
    platform: 'win32',
    resolvedZone: undefined,
    readZoneId: () => { reads += 1; return 'Alberta Standard Time'; },
    ...overrides,
  });
  return { env, result, reads };
};

describe('applyTimeZoneFallback', () => {
  it('pins TZ for a Windows id ICU does not know', () => {
    const { env, result } = run();
    expect(env.TZ).toBe('America/Edmonton');
    expect(result).toEqual({ windowsId: 'Alberta Standard Time', zone: 'America/Edmonton' });
  });

  it('leaves a zone ICU resolved alone without reading the registry', () => {
    let reads = 0;
    const env = {};
    const result = applyTimeZoneFallback({
      env, platform: 'win32', resolvedZone: 'America/Edmonton', readZoneId: () => { reads += 1; return 'x'; },
    });
    expect(result).toBeNull();
    expect(env.TZ).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('respects a TZ the user already set', () => {
    const { env, result, reads } = run({ env: { TZ: 'Asia/Shanghai' } });
    expect(env.TZ).toBe('Asia/Shanghai');
    expect(result).toBeNull();
    expect(reads).toBe(0);
  });

  it('reports an unmapped id without touching TZ', () => {
    const { env, result } = run({ readZoneId: () => 'Future Standard Time' });
    expect(env.TZ).toBeUndefined();
    expect(result).toEqual({ windowsId: 'Future Standard Time', zone: null });
  });

  it('does nothing off Windows', () => {
    const { env, result } = run({ platform: 'linux' });
    expect(result).toBeNull();
    expect(env.TZ).toBeUndefined();
  });
});

describe('readWindowsZoneId', () => {
  it('parses the reg.exe output', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation\r\n'
      + '    TimeZoneKeyName    REG_SZ    Alberta Standard Time\r\n\r\n';
    expect(readWindowsZoneId(() => out)).toBe('Alberta Standard Time');
  });

  it('returns null when reg.exe fails', () => {
    expect(readWindowsZoneId(() => { throw new Error('denied'); })).toBeNull();
  });
});
