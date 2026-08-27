// Pure probe metrics: repeat marking, record shapes, and the silence /
// no-speech watchdog that backs the probe's quality hints.

import { describe, it, expect } from 'vitest';
import {
  makeRepeatTracker,
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
} from '../../electron/services/asr-probe/probe-metrics.js';

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
