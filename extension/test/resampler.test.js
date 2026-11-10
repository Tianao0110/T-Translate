// @vitest-environment node
//
// The resampler to 16 kHz: a sine keeps its frequency and level, cutting the
// input anywhere gives the same output (phase carried, no seams), and the
// 3:1 average damps what would alias. Plus mixToMono on a fake AudioData.

import { describe, it, expect } from 'vitest';
import { createResampler, mixToMono } from '../src/offscreen/decode.js';

const sine = (rate, hz, seconds, amp = 0.5, phase = 0) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin(phase + (2 * Math.PI * hz * i) / rate));

// Amplitude of one frequency (Goertzel), normalized so a sine of amplitude A reads A.
function goertzel(x, rate, hz) {
  const w = (2 * Math.PI * hz) / rate;
  const k = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (const v of x) {
    const s = v + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2)) / x.length;
}

const crossings = (x) => {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
  return n;
};

function runCut(r, x, sizes) {
  const parts = [];
  for (let i = 0, k = 0; i < x.length; k++) {
    const n = sizes[k % sizes.length];
    parts.push(r.push(x.subarray(i, i + n)));
    i += n;
  }
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('createResampler', () => {
  it('48 kHz → 16 kHz keeps a 440 Hz sine: length, frequency, level', () => {
    const out = createResampler(48000, 16000).push(sine(48000, 440, 1));
    expect(out).toHaveLength(16000);
    expect(crossings(out)).toBeGreaterThanOrEqual(878);
    expect(crossings(out)).toBeLessThanOrEqual(881);
    expect(goertzel(out, 16000, 440)).toBeCloseTo(0.5, 2);
  });

  it('48 kHz → 16 kHz: any cutting of the input gives the identical output', () => {
    const x = sine(48000, 1000, 0.5);
    const whole = createResampler(48000).push(x);
    for (const sizes of [[1], [7, 4801, 2], [960], [1000, 1]]) {
      expect(runCut(createResampler(48000), x, sizes)).toEqual(whole);
    }
  });

  it('the 3:1 average damps a tone above the new Nyquist (14 kHz would fold to 2 kHz)', () => {
    const out = createResampler(48000).push(sine(48000, 14000, 1));
    expect(goertzel(out, 16000, 2000)).toBeLessThan(0.5 * 0.25);
  });

  it('44.1 kHz → 16 kHz (linear): frequency kept, cuts match whole, no jump at the seams', () => {
    const x = sine(44100, 440, 1);
    const whole = createResampler(44100).push(x);
    expect(Math.abs(whole.length - 16000)).toBeLessThanOrEqual(1);
    expect(goertzel(whole, 16000, 440)).toBeCloseTo(0.5, 2);
    const cut = runCut(createResampler(44100), x, [1, 333, 4410, 2]);
    expect(cut.length).toBe(whole.length);
    let maxDiff = 0;
    for (let i = 0; i < cut.length; i++) maxDiff = Math.max(maxDiff, Math.abs(cut[i] - whole[i]));
    expect(maxDiff).toBeLessThan(1e-5);
    // The largest sample-to-sample step a 440 Hz sine of 0.5 can make at 16 kHz, plus slack.
    const limit = 0.5 * ((2 * Math.PI * 440) / 16000) * 1.05;
    for (let i = 1; i < cut.length; i++) expect(Math.abs(cut[i] - cut[i - 1])).toBeLessThan(limit);
  });

  it('8 kHz → 16 kHz upsamples; equal rates pass through', () => {
    const up = createResampler(8000).push(sine(8000, 440, 1));
    expect(Math.abs(up.length - 16000)).toBeLessThanOrEqual(2);
    expect(goertzel(up, 16000, 440)).toBeCloseTo(0.5, 2);
    const same = Float32Array.of(0.1, 0.2);
    expect(createResampler(16000).push(same)).toEqual(same);
  });
});

describe('mixToMono', () => {
  const fakeAudio = (planes) => ({
    numberOfFrames: planes[0].length,
    numberOfChannels: planes.length,
    copyTo(dest, { planeIndex, format }) {
      expect(format).toBe('f32-planar');
      dest.set(planes[planeIndex]);
    },
  });

  it('averages the planes', () => {
    expect(mixToMono(fakeAudio([Float32Array.of(1, 0.5), Float32Array.of(0, -0.5)]))).toEqual(Float32Array.of(0.5, 0));
    expect(mixToMono(fakeAudio([Float32Array.of(0.25)]))).toEqual(Float32Array.of(0.25));
  });
});
