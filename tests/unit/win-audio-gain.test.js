// System-loopback volume compensation: the inverse of the endpoint volume,
// capped and margined, with a clip guard for devices that attenuate in
// hardware.

import { describe, it, expect } from 'vitest';
import { compensationGain, makeClipGuard, applyGain } from '../../electron/utils/win-audio-gain.js';

describe('compensationGain', () => {
  it('inverts the endpoint attenuation in dB, minus the safety margin', () => {
    // 8% on the Windows slider measured -38.08 dB on the user's machine.
    expect(compensationGain(-38.08, { marginDb: 0 })).toBeCloseTo(80.2, 0);
    expect(compensationGain(-38.08)).toBeCloseTo(40.2, 0);
    expect(compensationGain(-6.02, { marginDb: 0 })).toBeCloseTo(2, 2);
  });

  it('is unity at or near full volume and for garbage input', () => {
    expect(compensationGain(0)).toBe(1);
    expect(compensationGain(-5)).toBe(1); // inside the margin
    expect(compensationGain(3)).toBe(1);
    expect(compensationGain(NaN)).toBe(1);
    expect(compensationGain(undefined)).toBe(1);
  });

  it('caps the gain so a near-silent slider does not amplify the noise floor', () => {
    expect(compensationGain(-96)).toBeCloseTo(100, 5);
    expect(compensationGain(-60, { capDb: 20 })).toBeCloseTo(10, 5);
  });
});

describe('makeClipGuard', () => {
  it('stays quiet under normal levels', () => {
    const guard = makeClipGuard({ windowSamples: 100 });
    const ok = new Float32Array(100).fill(0.5);
    expect(guard.check(ok)).toBe(false);
    expect(guard.check(ok)).toBe(false);
  });

  it('trips once clipping exceeds the ratio inside a window, and stays tripped', () => {
    const guard = makeClipGuard({ windowSamples: 100, maxRatio: 0.05 });
    const bad = new Float32Array(100).fill(0.2);
    for (let i = 0; i < 10; i++) bad[i] = 1; // 10% clipped
    expect(guard.check(bad)).toBe(true);
    expect(guard.tripped()).toBe(true);
    expect(guard.check(new Float32Array(100))).toBe(true);
  });

  it('evaluates per window, not cumulatively', () => {
    const guard = makeClipGuard({ windowSamples: 100, maxRatio: 0.05 });
    const mild = new Float32Array(50).fill(0.2);
    mild[0] = -1; // 2% of the window
    expect(guard.check(mild)).toBe(false);
    expect(guard.check(mild)).toBe(false); // window closes at 4% — under the ratio
  });
});

describe('applyGain', () => {
  it('scales in place and hard-limits to [-1, 1]', () => {
    const s = new Float32Array([0.1, -0.5, 0.02]);
    applyGain(s, 10);
    expect(s[0]).toBe(1);
    expect(s[1]).toBe(-1);
    expect(s[2]).toBeCloseTo(0.2, 5);
  });

  it('is a no-op at unity', () => {
    const s = new Float32Array([0.3]);
    expect(applyGain(s, 1)).toBe(s);
    expect(s[0]).toBeCloseTo(0.3, 6);
  });
});
