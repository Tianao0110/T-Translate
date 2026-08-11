// Main-window position persistence + log-file naming.
// Both regressions come from a shape/timezone mismatch between the write side
// and the read side, and both were invisible until the on-disk state was read.
//
// Note: display-helper's screen-dependent functions can't be exercised here —
// vitest externalizes CJS require('electron') to the real npm package, so the
// alias mock never reaches them (same constraint as secure-vault.test.js).
// normalizeWindowPosition is pure, which is the half that carried the bug.

import { describe, it, expect } from 'vitest';
import displayHelper from '../../electron/utils/display-helper.js';
import createLogger from '../../electron/utils/logger.js';

const { normalizeWindowPosition } = displayHelper;
const { localDateStamp } = createLogger;

describe('normalizeWindowPosition', () => {
  // ensureBoundsOnDisplay treats an undefined x or y as "no position info" and
  // recentres on the primary display. Builds up to v0.3.3 stored getPosition()'s
  // [x, y] array and read .x / .y off it — undefined every time, so the main
  // window snapped back to centre on every launch.
  it('reads the legacy [x, y] array written by getPosition()', () => {
    expect(normalizeWindowPosition([256, 58])).toEqual({ x: 256, y: 58 });
  });

  it('reads the { x, y } object written since', () => {
    expect(normalizeWindowPosition({ x: 256, y: 58 })).toEqual({ x: 256, y: 58 });
  });

  it('accepts negative coordinates (monitor left of / above the primary)', () => {
    expect(normalizeWindowPosition([-1920, -40])).toEqual({ x: -1920, y: -40 });
    expect(normalizeWindowPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('drops unusable values instead of passing a partial coordinate through', () => {
    for (const stored of [null, undefined, {}, [], [256], { x: 256 }, { x: 'a', y: 'b' }, 42]) {
      expect(normalizeWindowPosition(stored), String(JSON.stringify(stored))).toEqual({});
    }
  });
});

describe('localDateStamp', () => {
  it('names the log file for the local day, not the UTC day', () => {
    // 23:59 local: toISOString() reports the next day anywhere west of UTC,
    // which put an evening session in tomorrow's file.
    expect(localDateStamp(new Date(2026, 7, 10, 23, 59, 30))).toBe('2026-08-10');
  });

  it('zero-pads month and day', () => {
    expect(localDateStamp(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});
