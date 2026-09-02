// 48 kHz stereo → 16 kHz mono FIR decimator for the process-loopback path.

import { describe, it, expect } from 'vitest';
import { makeDownmixDecimator } from '../../electron/utils/win-audio-resample.js';

function stereoSine(freq, seconds, rate = 48000, amp = 0.5) {
  const n = Math.floor(seconds * rate);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = amp * Math.sin((2 * Math.PI * freq * i) / rate);
    out[i * 2] = v;
    out[i * 2 + 1] = v;
  }
  return out;
}
const rms = (arr, skip = 0) => {
  let s = 0;
  for (let i = skip; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / Math.max(1, arr.length - skip));
};

describe('makeDownmixDecimator', () => {
  it('emits one output sample per three input frames', () => {
    const d = makeDownmixDecimator();
    const out = d.process(stereoSine(1000, 0.1));
    expect(out.length).toBeGreaterThan(4800 / 3 - 30);
    expect(out.length).toBeLessThanOrEqual(4800 / 3);
  });

  it('passes a 1 kHz tone at unity gain', () => {
    const d = makeDownmixDecimator();
    const out = d.process(stereoSine(1000, 0.5));
    expect(rms(out, 100)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('rejects content above the output Nyquist instead of aliasing it', () => {
    const d = makeDownmixDecimator();
    const out = d.process(stereoSine(11000, 0.5));
    expect(rms(out, 100)).toBeLessThan(0.02);
  });

  it('is continuous across packet boundaries', () => {
    const whole = makeDownmixDecimator().process(stereoSine(1000, 0.2));
    const d = makeDownmixDecimator();
    const src = stereoSine(1000, 0.2);
    const a = d.process(src.subarray(0, 1920 * 2)); // 20ms packet, then the rest
    const b = d.process(src.subarray(1920 * 2));
    const joined = new Float32Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);
    expect(joined.length).toBe(whole.length);
    let maxDiff = 0;
    for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - joined[i]));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('downmixes stereo to the channel average', () => {
    const d = makeDownmixDecimator();
    const inter = new Float32Array(48000);
    for (let i = 0; i < 24000; i++) {
      inter[i * 2] = 0.8;
      inter[i * 2 + 1] = 0.2;
    }
    const out = d.process(inter);
    expect(out[out.length - 1]).toBeCloseTo(0.5, 3);
  });
});
