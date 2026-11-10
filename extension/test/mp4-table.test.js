// @vitest-environment node
//
// The progressive-MP4 sample table: both ffmpeg fixtures (moov before and
// after mdat) give the same 95 AAC frames, offsets and times rising, inside
// mdat; offsetAt and probeHead; a moov read alone from the file's tail; a
// hand-built file with a video track, chunks split by video bytes, two stsc
// runs, stz2, co64 and an edit list; what is refused.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMoov, probeHead, offsetAt, indexAtTime, indexAtOffset, topBoxes } from '../src/shared/mp4-table.js';
import { handBuilt, SIZES, moovOf, videoTrak } from './lib/progressive-mp4.js';

const read = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const FAST = read('tone-2s-faststart.mp4');
const LAST = read('tone-2s-moov-last.mp4');
const FRAMES = 95;
const FRAME_MS = (1024 / 48000) * 1000;

describe('mp4 sample table', () => {
  it('faststart fixture: the AAC track, 95 frames rising in offset and time, inside mdat', () => {
    const t = parseMoov(FAST);
    expect(t.track).toMatchObject({ number: 1, codec: 'mp4a.40.2', channels: 1, sampleRate: 48000, timescale: 48000 });
    expect([...t.track.codecPrivate]).toEqual([0x11, 0x88, 0x56, 0xe5, 0x00]);
    expect(t.track.editOffsetMs).toBeCloseTo(FRAME_MS, 6); // ffmpeg's 1024-sample priming
    expect(t.samples).toHaveLength(FRAMES);
    // 2 s plus the priming; the last frame's stts delta is the remainder.
    expect(t.durationMs).toBeCloseTo(((96000 + 1024) / 48000) * 1000, 6);
    expect(t.mdat).toEqual({ offset: 1162, end: FAST.length });
    for (let i = 1; i < FRAMES; i++) {
      expect(t.samples[i].offset).toBe(t.samples[i - 1].offset + t.samples[i - 1].size);
      expect(t.samples[i].timeMs).toBeCloseTo(i * FRAME_MS, 6);
    }
    expect(t.samples[0].offset).toBe(1170);
    const last = t.samples.at(-1);
    expect(last.offset + last.size).toBe(t.mdat.end);
    const total = t.samples.reduce((a, s) => a + s.size, 0);
    expect(t.bytesPerSecond).toBe(Math.round(total / (t.durationMs / 1000)));
  });

  it('moov-last fixture: the same frames, mdat right after ftyp + free', () => {
    const a = parseMoov(FAST);
    const b = parseMoov(LAST);
    expect(b.track).toEqual(a.track);
    expect(b.mdat).toEqual({ offset: 36, end: 16433 });
    const shift = a.samples[0].offset - b.samples[0].offset;
    expect(b.samples.map((s) => [s.offset + shift, s.size, s.timeMs])).toEqual(a.samples.map((s) => [s.offset, s.size, s.timeMs]));
  });

  it('a moov fetched alone from the tail: base is its file offset, offsets stay absolute', () => {
    const at = 16433;
    const t = parseMoov(LAST.subarray(at), { base: at });
    expect(t.samples).toEqual(parseMoov(LAST).samples);
    expect(t.mdat).toBe(null);
  });

  it('offsetAt / indexAtTime / indexAtOffset', () => {
    const t = parseMoov(FAST);
    expect(offsetAt(t, 0)).toBe(1170);
    expect(offsetAt(t, -5)).toBe(1170);
    // 1 s falls inside frame 46; the first frame at or after it is 47.
    expect(indexAtTime(t, 1000)).toBe(47);
    expect(offsetAt(t, 1)).toBe(t.samples[47].offset);
    expect(offsetAt(t, 2.1)).toBe(null);
    expect(indexAtOffset(t, 0)).toBe(0);
    expect(indexAtOffset(t, t.samples[10].offset)).toBe(10);
    expect(indexAtOffset(t, t.samples[10].offset + 1)).toBe(11);
    expect(indexAtOffset(t, FAST.length)).toBe(FRAMES);
  });

  it('probeHead: moov first, mdat first (the moov where mdat ends), neither', () => {
    const fast = probeHead(FAST.subarray(0, 4096));
    expect(fast.where).toBe('head');
    expect(fast.moov).toEqual({ type: 'moov', offset: 28, size: 1126 });
    expect(fast.boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'free', 'mdat']);
    // A moov bigger than the bytes read is still found by its header.
    expect(probeHead(FAST.subarray(0, 100)).moov).toEqual({ type: 'moov', offset: 28, size: 1126 });

    const last = probeHead(LAST.subarray(0, 4096));
    expect(last).toMatchObject({ where: 'tail', moov: null, mdat: { type: 'mdat', offset: 36, size: 16397 }, moovOffset: 16433 });
    expect(topBoxes(LAST.subarray(16433))[0]).toMatchObject({ type: 'moov', size: LAST.length - 16433 });

    expect(probeHead(FAST.subarray(0, 20)).where).toBe(null);
    const toEnd = Uint8Array.from(LAST.subarray(0, 64));
    toEnd.set([0, 0, 0, 0], 36); // mdat size 0: runs to the end of the file
    expect(probeHead(toEnd)).toMatchObject({ where: null, moovOffset: null });
    expect(probeHead(new Uint8Array(64)).boxes).toEqual([]);
  });

  it('hand-built: the video track skipped, chunks around video bytes, two stsc runs, an edit list', () => {
    const { file, c1, c2 } = handBuilt();
    const t = parseMoov(file);
    expect(t.track).toMatchObject({ number: 2, codec: 'mp4a.40.2', sampleRate: 48000 });
    expect(t.track.editOffsetMs).toBeCloseTo(FRAME_MS, 6);
    expect(t.samples.map((s) => s.offset)).toEqual([c1, c1 + 10, c1 + 21, c2, c2 + 13]);
    expect(t.samples.map((s) => s.size)).toEqual(SIZES);
    expect(t.samples.map((s) => s.timeMs)).toEqual([0, 1, 2, 3, 4].map((i) => (i * 1024 * 1000) / 48000));
    expect(t.mdat).toEqual({ offset: 16, end: 16 + 8 + 33 + 100 + 27 });
    for (const s of t.samples) expect(file[s.offset]).toBe(t.samples.indexOf(s) + 1);
  });

  it('stz2 and co64 read the same table', () => {
    const plain = parseMoov(handBuilt().file).samples;
    expect(parseMoov(handBuilt({ wide: true }).file).samples).toEqual(plain);
    expect(parseMoov(handBuilt({ compact: true }).file).samples).toEqual(plain);
  });

  it('refuses no moov, a cut moov, a moov without a sound track', () => {
    expect(() => parseMoov(LAST.subarray(0, 4096))).toThrow('no complete moov');
    expect(() => parseMoov(FAST.subarray(0, 600))).toThrow('no complete moov');
    expect(() => parseMoov(moovOf(videoTrak(1)))).toThrow('no sound track');
  });
});
