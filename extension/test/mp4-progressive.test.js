// @vitest-environment node
//
// The progressive-MP4 demuxer: both fixtures whole, in 1000-byte cuts with
// and without offsets, from the middle after the head, across a jump, a
// second file's head, bad data reported once; every block is the table's
// sample, byte for byte.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createProgressiveMp4Demuxer } from '../src/offscreen/mp4-progressive.js';
import { parseMoov, probeHead, offsetAt } from '../src/shared/mp4-table.js';

const read = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const FAST = read('tone-2s-faststart.mp4');
const LAST = read('tone-2s-moov-last.mp4');
const FRAMES = 95;
const MOOV_LAST_AT = 16433;

const blocks = (events) => events.filter((e) => e.type === 'block');
const kinds = (events) => events.map((e) => e.type);

function pushAll(d, file, step, { from = 0, to = file.length, offsets = true } = {}) {
  const out = [];
  for (let i = from; i < to; i += step) out.push(...d.push(file.subarray(i, Math.min(i + step, to)), offsets ? { offset: i } : {}));
  return out;
}

// Each block is the sample the table puts at its place.
function expectSamples(file, events, firstIndex = 0) {
  const t = parseMoov(file);
  const got = blocks(events);
  got.forEach((b, k) => {
    const s = t.samples[firstIndex + k];
    expect(b).toMatchObject({ type: 'block', track: 1, keyframe: true, timeMs: s.timeMs });
    expect(b.data).toEqual(file.subarray(s.offset, s.offset + s.size));
  });
  return got;
}

describe('progressive mp4 demuxer', () => {
  for (const [name, file] of [
    ['faststart', FAST],
    ['moov-last', LAST],
  ]) {
    it(`${name}: whole file in one push → one track, 95 blocks`, () => {
      const out = createProgressiveMp4Demuxer().push(file, { offset: 0 });
      expect(out[0]).toEqual({ type: 'track', number: 1, codec: 'mp4a.40.2', channels: 1, sampleRate: 48000, codecPrivate: expect.any(Uint8Array) });
      expect(kinds(out).filter((k) => k !== 'block')).toEqual(['track']);
      expect(expectSamples(file, out)).toHaveLength(FRAMES);
    });

    it(`${name}: 1000-byte cuts, with offsets and without`, () => {
      for (const offsets of [true, false]) {
        const out = pushAll(createProgressiveMp4Demuxer(), file, 1000, { offsets });
        expect(kinds(out).filter((k) => k !== 'block')).toEqual(['track']);
        expect(expectSamples(file, out)).toHaveLength(FRAMES);
      }
    });
  }

  it('faststart: the head, then mdat from 1 s in odd cuts', () => {
    const d = createProgressiveMp4Demuxer();
    const head = probeHead(FAST);
    const moovEnd = head.moov.offset + head.moov.size;
    expect(kinds(d.push(FAST.subarray(0, moovEnd), { offset: 0 }))).toEqual(['track']);
    const from = offsetAt(parseMoov(FAST), 1);
    const out = pushAll(d, FAST, 777, { from });
    expect(expectSamples(FAST, out, 47)).toHaveLength(FRAMES - 47);
    expect(blocks(out)[0].timeMs).toBeCloseTo((47 * 1024 * 1000) / 48000, 6);
  });

  it('moov-last: the moov from the tail first (as the worker sends it), then mdat from the start', () => {
    const d = createProgressiveMp4Demuxer();
    // the moov itself cut in two pushes
    expect(d.push(LAST.subarray(MOOV_LAST_AT, MOOV_LAST_AT + 300), { offset: MOOV_LAST_AT })).toEqual([]);
    expect(kinds(d.push(LAST.subarray(MOOV_LAST_AT + 300), { offset: MOOV_LAST_AT + 300 }))).toEqual(['track']);
    const first = parseMoov(LAST).samples[0].offset;
    const out = pushAll(d, LAST, 4096, { from: first, to: MOOV_LAST_AT });
    expect(expectSamples(LAST, out)).toHaveLength(FRAMES);
  });

  it('a jump: what is whole before it comes out, the cut sample is dropped, then on from the new place', () => {
    const t = parseMoov(FAST);
    const d = createProgressiveMp4Demuxer();
    d.push(FAST.subarray(0, 1154), { offset: 0 });
    const a = t.samples[10].offset;
    // up to the middle of sample 20
    const before = d.push(FAST.subarray(a, t.samples[20].offset + 5), { offset: a });
    expect(expectSamples(FAST, before, 10)).toHaveLength(10);
    const b = t.samples[60].offset;
    const after = pushAll(d, FAST, 1000, { from: b });
    expect(expectSamples(FAST, after, 60)).toHaveLength(FRAMES - 60);
    // a jump back to the middle of a sample: it starts on the next whole one
    const back = d.push(FAST.subarray(t.samples[5].offset + 3, t.samples[9].offset), { offset: t.samples[5].offset + 3 });
    expect(expectSamples(FAST, back, 6)).toHaveLength(3);
  });

  it('a second file’s head rebuilds the table and reports the track again', () => {
    const d = createProgressiveMp4Demuxer();
    const one = d.push(FAST, { offset: 0 });
    const two = pushAll(d, LAST, 5000);
    expect(kinds(one).filter((k) => k === 'track')).toHaveLength(1);
    expect(kinds(two).filter((k) => k === 'track')).toHaveLength(1);
    expect(expectSamples(LAST, two)).toHaveLength(FRAMES);
  });

  it('bad data: mdat before any moov reported once; a broken head; a moov without sound', () => {
    const d = createProgressiveMp4Demuxer();
    const mdat = FAST.subarray(2000, 3000);
    expect(d.push(mdat, { offset: 2000 })).toEqual([{ type: 'error', message: 'mdat bytes before the moov' }]);
    expect(d.push(mdat, { offset: 3000 })).toEqual([]);
    expect(kinds(d.push(FAST.subarray(0, 1154), { offset: 0 }))).toEqual(['track']);

    const junk = Uint8Array.from(FAST.subarray(0, 64));
    junk.set([0, 0, 0, 3], 28); // the moov's size no longer makes a box
    expect(createProgressiveMp4Demuxer().push(junk, { offset: 0 })).toEqual([{ type: 'error', message: 'bad box in the head' }]);

    const cut = Uint8Array.from(FAST.subarray(0, 1154));
    cut.set([...'vide'].map((c) => c.charCodeAt(0)), Buffer.from(cut).indexOf('soun'));
    expect(createProgressiveMp4Demuxer().push(cut, { offset: 0 })).toEqual([{ type: 'error', message: 'no sound track' }]);
  });

  it('flush resets: mdat after it needs a new head', () => {
    const d = createProgressiveMp4Demuxer();
    d.push(FAST.subarray(0, 1154), { offset: 0 });
    expect(d.flush()).toEqual([]);
    expect(kinds(d.push(FAST.subarray(1170, 2000), { offset: 1170 }))).toEqual(['error']);
  });
});
