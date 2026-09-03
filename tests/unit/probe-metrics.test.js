// Pure probe metrics: repeat marking, record shapes, and the silence /
// no-speech watchdog that backs the probe's quality hints.

import { describe, it, expect } from 'vitest';
import {
  makeRepeatTracker,
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
  makeVadThresholdPolicy,
  isNegligibleFinal,
  makeAgc,
  pickCutWindow,
  makeTtsGate,
} from '../../electron/services/audio-engine/probe-metrics.js';

describe('makeTtsGate', () => {
  it('blocks while on and for the tail after off, then reopens', () => {
    const gate = makeTtsGate({ tailMs: 300 });
    expect(gate.blocked(1000)).toBe(false);
    gate.set(true, 1000);
    expect(gate.blocked(1000)).toBe(true);
    expect(gate.blocked(5000)).toBe(true); // no timeout while a window is still playing
    gate.set(false, 5000);
    expect(gate.blocked(5100)).toBe(true); // tail: last syllables still in the loopback buffer
    expect(gate.blocked(5299)).toBe(true);
    expect(gate.blocked(5300)).toBe(false);
    expect(gate.isOn()).toBe(false);
  });

  it('a repeated off does not restart the tail', () => {
    const gate = makeTtsGate({ tailMs: 300 });
    gate.set(true, 0);
    gate.set(false, 100);
    gate.set(false, 1000);
    expect(gate.blocked(1050)).toBe(false);
  });
});

describe('makeRepeatTracker', () => {
  it('marks consecutive identical text as repeated (record only)', () => {
    const isRepeat = makeRepeatTracker();
    expect(isRepeat('Hello world')).toBe(false);
    expect(isRepeat('hello   WORLD')).toBe(true); // case/whitespace-insensitive
    expect(isRepeat('something else')).toBe(false);
    expect(isRepeat('Hello world')).toBe(false); // not consecutive anymore
  });

  it('never marks empty text', () => {
    const isRepeat = makeRepeatTracker();
    expect(isRepeat('')).toBe(false);
    expect(isRepeat('')).toBe(false);
    expect(isRepeat('a')).toBe(false);
    expect(isRepeat('a')).toBe(true);
  });
});

describe('segmentRecord', () => {
  it('computes rtf from decode time over segment duration', () => {
    const rec = segmentRecord({
      segStartS: 1.234,
      segDurS: 4,
      decodeMs: 100,
      lang: '<|en|>',
      event: '<|Speech|>',
      text: 'hi',
      repeated: false,
    });
    expect(rec.type).toBe('segment');
    expect(rec.rtf).toBe(0.025);
    expect(rec.textLen).toBe(2);
    expect(rec.text).toBe('hi');
    expect(rec.repeated).toBe(false);
  });

  it('leaves rtf null for zero-length segments', () => {
    const rec = segmentRecord({ segStartS: 0, segDurS: 0, decodeMs: 5, text: 'x' });
    expect(rec.rtf).toBeNull();
  });
});

describe('eventRecord / metricsRecord', () => {
  it('shapes an event with optional detail', () => {
    expect(eventRecord('device-lost').kind).toBe('device-lost');
    expect(eventRecord('device-lost').detail).toBeUndefined();
    expect(eventRecord('x', 'why').detail).toBe('why');
  });

  it('rounds metrics fields', () => {
    const rec = metricsRecord({ rssMb: 371.7, cpuPct: 6.789, audioInS: 12.345, segments: 3 });
    expect(rec.rssMb).toBe(372);
    expect(rec.cpuPct).toBe(6.79);
    expect(rec.audioInS).toBe(12.35);
    expect(rec.segments).toBe(3);
  });
});

describe('makeSignalWatchdog', () => {
  const opts = { silenceRms: 1e-5, noAudioAfterMs: 5000, noSpeechAfterMs: 30000 };

  it('is quiet before start', () => {
    const wd = makeSignalWatchdog(opts);
    expect(wd.hint(99999)).toBeNull();
  });

  it('raises no-audio after sustained silence', () => {
    const wd = makeSignalWatchdog(opts);
    wd.start(0);
    wd.onChunk(0, 1000);
    expect(wd.hint(4000)).toBeNull();
    expect(wd.hint(5000)).toBe('no-audio');
  });

  it('clears no-audio once sound returns', () => {
    const wd = makeSignalWatchdog(opts);
    wd.start(0);
    expect(wd.hint(6000)).toBe('no-audio');
    wd.onChunk(0.01, 6500);
    expect(wd.hint(7000)).toBeNull();
  });

  it('raises no-speech when there is sound but never a segment', () => {
    const wd = makeSignalWatchdog(opts);
    wd.start(0);
    wd.onChunk(0.01, 29000); // keeps audio "recent" at every probe below
    expect(wd.hint(29500)).toBeNull();
    wd.onChunk(0.01, 30500);
    expect(wd.hint(31000)).toBe('no-speech');
  });

  it('segments hold no-speech back', () => {
    const wd = makeSignalWatchdog(opts);
    wd.start(0);
    wd.onChunk(0.01, 30500);
    wd.onSegment(15000);
    expect(wd.hint(31000)).toBeNull(); // only 16s since last segment
    wd.onChunk(0.01, 45500);
    expect(wd.hint(46000)).toBe('no-speech'); // 31s since last segment
  });
});

describe('makeVadThresholdPolicy', () => {
  it('drops to the music threshold once BGM dominates the last three finals', () => {
    const p = makeVadThresholdPolicy();
    expect(p.onFinal('<|Speech|>')).toBeNull();
    expect(p.onFinal('<|BGM|>')).toBeNull(); // window not full yet
    expect(p.onFinal('<|BGM|>')).toBe(0.3);
    expect(p.current()).toBe(0.3);
    expect(p.onFinal('<|BGM|>')).toBeNull(); // already there
  });

  it('returns to the speech threshold only after three speech finals in a row', () => {
    const p = makeVadThresholdPolicy();
    ['<|BGM|>', '<|BGM|>', '<|BGM|>'].forEach((e) => p.onFinal(e));
    expect(p.onFinal('<|Speech|>')).toBeNull();
    expect(p.onFinal('<|Speech|>')).toBeNull(); // one BGM still in the window
    expect(p.onFinal('<|Speech|>')).toBe(0.5);
  });

  it('treats missing or other event tags as speech', () => {
    const p = makeVadThresholdPolicy();
    expect(p.onFinal(undefined)).toBeNull();
    expect(p.onFinal('<|Applause|>')).toBeNull();
    expect(p.onFinal('<|BGM|>')).toBeNull();
    expect(p.current()).toBe(0.5);
  });
});

describe('metricsRecord extras', () => {
  it('carries the VAD threshold and endpoint volume when given', () => {
    const rec = metricsRecord({ rssMb: 1, cpuPct: 0, audioInS: 0, segments: 0, vadThreshold: 0.3, endpointDb: -38.079 });
    expect(rec.vadThreshold).toBe(0.3);
    expect(rec.endpointDb).toBe(-38.08);
    const bare = metricsRecord({ rssMb: 1, cpuPct: 0, audioInS: 0, segments: 0, endpointDb: null });
    expect(bare.vadThreshold).toBeUndefined();
    expect(bare.endpointDb).toBeUndefined();
  });
});

describe('makeVadThresholdPolicy.hold', () => {
  it('drops to the music threshold at once and stays there whatever the finals say', () => {
    const p = makeVadThresholdPolicy();
    expect(p.hold()).toBe(0.3);
    expect(p.current()).toBe(0.3);
    ['<|Speech|>', '<|Speech|>', '<|Speech|>', '<|Speech|>'].forEach((e) => expect(p.onFinal(e)).toBeNull());
    expect(p.current()).toBe(0.3);
  });

  it('is a no-op when already relaxed', () => {
    const p = makeVadThresholdPolicy();
    ['<|BGM|>', '<|BGM|>', '<|BGM|>'].forEach((e) => p.onFinal(e));
    expect(p.hold()).toBeNull();
  });
});

describe('isNegligibleFinal', () => {
  it('drops one- or two-character CJK fragments and tiny Latin scraps', () => {
    expect(isNegligibleFinal('如。')).toBe(true);
    expect(isNegligibleFinal('嗯嗯')).toBe(true);
    expect(isNegligibleFinal('Oh.')).toBe(true);
    expect(isNegligibleFinal('')).toBe(true);
  });

  it('keeps anything that could be a line', () => {
    expect(isNegligibleFinal('我往前')).toBe(false);
    expect(isNegligibleFinal('You know')).toBe(false);
    expect(isNegligibleFinal('Yeah!')).toBe(false);
  });
});

describe('makeSignalWatchdog.onSpeech', () => {
  it('an open VAD segment counts as activity, so a long first sentence is not "no speech"', () => {
    const wd = makeSignalWatchdog({ silenceRms: 1e-5, noAudioAfterMs: 5000, noSpeechAfterMs: 12000 });
    wd.start(0);
    wd.onChunk(0.1, 13000);
    wd.onSpeech(12500); // VAD has been open, no final yet
    expect(wd.hint(13000)).toBeNull();
    wd.onChunk(0.1, 25000);
    expect(wd.hint(25000)).toBe('no-speech'); // nothing opened or landed for 12.5s
  });
});

describe('makeAgc', () => {
  const sine = (amp, n = 512) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / 16000));
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

  it('lifts a quiet source toward the target and reports the gain', () => {
    const agc = makeAgc();
    let out;
    for (let i = 0; i < 20; i++) out = agc.process(sine(0.004)); // rms ~0.0028
    expect(agc.gain()).toBeGreaterThan(10);
    expect(rms(out)).toBeGreaterThan(0.03);
  });

  it('leaves a healthy or loud source alone (boost only)', () => {
    const agc = makeAgc();
    const loud = sine(0.5);
    const before = rms(loud);
    for (let i = 0; i < 5; i++) agc.process(sine(0.5));
    expect(agc.gain()).toBe(1);
    expect(rms(agc.process(loud))).toBeCloseTo(before, 6);
  });

  it('never exceeds the cap, and digital silence does not move the envelope', () => {
    const agc = makeAgc({ capDb: 30 });
    const g0 = agc.gain();
    for (let i = 0; i < 50; i++) agc.process(sine(0.0001)); // below the gate
    expect(agc.gain()).toBe(g0);
    for (let i = 0; i < 50; i++) agc.process(sine(0.001));
    expect(agc.gain()).toBeLessThanOrEqual(Math.pow(10, 30 / 20) + 1e-6);
    expect(agc.gain()).toBeGreaterThan(20);
  });

  it('reset returns to the quiet-start gain', () => {
    const agc = makeAgc();
    const g0 = agc.gain();
    expect(g0).toBeCloseTo(10, 6); // target 0.05 over an envelope opened at 10x the gate
    for (let i = 0; i < 20; i++) agc.process(sine(0.002));
    expect(agc.gain()).toBeGreaterThan(g0);
    agc.reset();
    expect(agc.gain()).toBe(g0);
  });
});

describe('pickCutWindow', () => {
  it('picks the quietest window inside the lookback, leaving the minimum tail', () => {
    const rms = new Array(60).fill(0.2);
    rms[40] = 0.01; // a between-words dip
    expect(pickCutWindow(rms, { lookback: 30, minTail: 8 })).toBe(40);
  });

  it('never cuts inside the protected tail even if that is the quietest spot', () => {
    const rms = new Array(60).fill(0.2);
    rms[57] = 0.001;
    rms[45] = 0.05;
    expect(pickCutWindow(rms, { lookback: 30, minTail: 8 })).toBe(45);
  });

  it('gives up on a segment too short to choose from', () => {
    expect(pickCutWindow([0.1, 0.2, 0.05], { lookback: 30, minTail: 8 })).toBe(-1);
  });
});
