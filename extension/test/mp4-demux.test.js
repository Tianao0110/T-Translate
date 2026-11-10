// @vitest-environment node
//
// The streaming fMP4 demuxer: the ffmpeg fixture (AAC-LC, empty moov, a
// moof + mdat a second) pushed whole, byte by byte and in random cuts, with
// continuous times over ~2 s; hand-built streams for the addressing modes
// (default-base-is-moof, base_data_offset from the file start and mid-stream,
// implicit), trex / tfhd defaults, a video traf next to the audio one,
// boxes to skip, bad data and resync, a new init segment; the
// AudioSpecificConfig reader.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createMp4Demuxer, parseAudioSpecificConfig } from '../src/offscreen/mp4-demux.js';

const FIXTURE = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.m4s')));

// ---- a tiny ISO BMFF writer ----
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const be = (v, n) => Array.from({ length: n }, (_, i) => Math.floor(v / 256 ** (n - 1 - i)) % 256);
const fourcc = (t) => [...t].map((c) => c.charCodeAt(0));
const box = (type, ...kids) => {
  const body = cat(...kids);
  return cat(be(body.length + 8, 4), fourcc(type), body);
};
const full = (type, version, flags, ...kids) => box(type, [version, ...be(flags, 3)], ...kids);

const ASC_LC_48K_MONO = [0x11, 0x88];
function esds(asc, oti = 0x40) {
  const dsi = [0x05, asc.length, ...asc];
  const dcd = [0x04, 13 + dsi.length, oti, 0x15, 0, 0, 0, ...be(64000, 4), ...be(64000, 4), ...dsi];
  const es = [0x03, 3 + dcd.length + 3, 0, 1, 0, ...dcd, 0x06, 1, 2];
  return full('esds', 0, 0, es);
}
const mp4a = (channels, rate, ...kids) => box('mp4a', new Array(6).fill(0), be(1, 2), new Array(8).fill(0), be(channels, 2), be(16, 2), be(0, 4), be(rate * 65536, 4), ...kids);
function trak(id, handler, timescale, entry) {
  return box(
    'trak',
    full('tkhd', 0, 3, be(0, 8), be(id, 4), new Array(68).fill(0)),
    box(
      'mdia',
      full('mdhd', 0, 0, be(0, 8), be(timescale, 4), be(0, 4), be(0, 4)),
      full('hdlr', 0, 0, be(0, 4), fourcc(handler), new Array(13).fill(0)),
      box('minf', box('stbl', full('stsd', 0, 0, be(1, 4), entry)))
    )
  );
}
const trex = (id, duration, size) => full('trex', 0, 0, be(id, 4), be(1, 4), be(duration, 4), be(size, 4), be(0, 4));
const aacTrak = (id = 1, timescale = 48000, asc = ASC_LC_48K_MONO) => trak(id, 'soun', timescale, mp4a(1, 48000, esds(asc)));
const videoTrak = (id) => trak(id, 'vide', 90000, box('avc1', new Array(78).fill(0)));
const init = (traks, trexes = []) => cat(box('ftyp', fourcc('iso6'), be(0, 4)), box('moov', full('mvhd', 0, 0, new Array(96).fill(0)), ...traks, box('mvex', ...trexes)));

// A traf: tfhd (flags, bdo / defaults), tfdt, one trun with per-sample sizes and durations as asked.
function traf({ id, base = 'moof', bdo = 0, time = null, sizes, durations = null, defDur = null, defSize = null, dataOffset = 0 }) {
  let flags = base === 'moof' ? 0x20000 : base === 'bdo' ? 0x1 : 0;
  const tfhd = [be(id, 4)];
  if (base === 'bdo') tfhd.push(be(bdo, 8));
  if (defDur !== null) {
    flags |= 0x8;
    tfhd.push(be(defDur, 4));
  }
  if (defSize !== null) {
    flags |= 0x10;
    tfhd.push(be(defSize, 4));
  }
  const tf = 0x1 | (durations ? 0x100 : 0) | (defSize === null ? 0x200 : 0);
  const rows = sizes.map((s, i) => [...(durations ? be(durations[i], 4) : []), ...(defSize === null ? be(s, 4) : [])]);
  return box(
    'traf',
    full('tfhd', 0, flags, ...tfhd),
    ...(time === null ? [] : [full('tfdt', 1, 0, be(time, 8))]),
    full('trun', 0, tf, be(sizes.length, 4), be(dataOffset, 4), ...rows)
  );
}
const sample = (n, fill) => new Array(n).fill(fill);

// A moof + mdat whose trafs' data offsets point into the mdat, back to back;
// at is where the moof sits in the file (for base_data_offset).
function fragment(trafs, payload, at = 0) {
  const build = (offsets) => box('moof', full('mfhd', 0, 0, be(1, 4)), ...trafs.map((t, i) => traf({ ...t, dataOffset: offsets[i] })));
  let pos = build(trafs.map(() => 0)).length + 8; // first payload byte, from the moof start
  const offsets = trafs.map((t, i) => {
    // implicit: the first traf counts from the moof, later ones from the previous traf's data end
    const from = t.base === 'bdo' ? t.bdo - at : t.base === 'none' && i > 0 ? pos : 0;
    const o = pos - from;
    pos += t.sizes.reduce((a, b) => a + b, 0);
    return o;
  });
  return cat(build(offsets), box('mdat', payload));
}

function run(bytes, cuts) {
  const d = createMp4Demuxer();
  const events = [];
  if (!cuts) events.push(...d.push(bytes));
  else for (let i = 0, k = 0; i < bytes.length; k++) {
    const n = cuts(k);
    events.push(...d.push(bytes.subarray(i, i + n)));
    i += n;
  }
  events.push(...d.flush());
  return events;
}

const summary = (events) =>
  events.map((e) => (e.type === 'block' ? `b${e.track}@${Math.round(e.timeMs * 1000) / 1000}:${e.data.length}:${e.data.reduce((a, b) => (a * 31 + b) >>> 0, 0)}` : e.type === 'track' ? `t${e.number}:${e.codec}:${e.channels}:${e.sampleRate}:${e.codecPrivate?.length}` : `e:${e.message}`));
const blocks = (events) => events.filter((e) => e.type === 'block');

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('ffmpeg fixture', () => {
  const whole = run(FIXTURE);

  it('reports one AAC-LC track and 95 frames over ~2 s, back to back', () => {
    const tr = whole.filter((e) => e.type === 'track');
    expect(tr).toEqual([{ type: 'track', number: 1, codec: 'mp4a.40.2', channels: 1, sampleRate: 48000, codecPrivate: expect.any(Uint8Array) }]);
    expect([...tr[0].codecPrivate.subarray(0, 2)]).toEqual(ASC_LC_48K_MONO);
    const bl = blocks(whole);
    expect(bl).toHaveLength(95);
    expect(bl.every((b, i) => b.keyframe && b.track === 1 && Math.abs(b.timeMs - (i * 1024) / 48) < 1e-9)).toBe(true);
    expect((bl.at(-1).timeMs + 1024 / 48) / 1000).toBeCloseTo(2.027, 3);
    expect(bl.reduce((n, b) => n + b.data.length, 0)).toBe(8191 + 8061 + 137);
    expect(whole.some((e) => e.type === 'error')).toBe(false);
  });

  it('byte by byte and random cuts give the same events', () => {
    const want = summary(whole);
    expect(summary(run(FIXTURE, () => 1))).toEqual(want);
    for (const seed of [1, 7, 42]) {
      const rnd = lcg(seed);
      expect(summary(run(FIXTURE, () => 1 + Math.floor(rnd() * 3000))), `seed ${seed}`).toEqual(want);
    }
  });

  it('a second init segment re-sends the track; times follow the new fragments', () => {
    const ev = run(cat(FIXTURE, FIXTURE), () => 4096);
    expect(ev.filter((e) => e.type === 'track')).toHaveLength(2);
    const bl = blocks(ev);
    expect(bl).toHaveLength(190);
    expect(bl[95].timeMs).toBe(0);
    expect(summary(ev.slice(96))).toEqual(summary(whole));
  });

  it('garbage between fragments: one error, resync on the next moof, nothing lost after it', () => {
    const at = 9179; // the second moof
    const junk = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xff);
    const ev = run(cat(FIXTURE.subarray(0, at), junk, FIXTURE.subarray(at)), () => 333);
    expect(ev.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(summary(blocks(ev))).toEqual(summary(blocks(whole)));
  });

  it('a stream joined mid-way (init, then the second fragment on) starts at its tfdt', () => {
    const ev = run(cat(FIXTURE.subarray(0, 692), FIXTURE.subarray(9179)));
    const bl = blocks(ev);
    expect(bl).toHaveLength(48);
    expect(bl[0].timeMs).toBeCloseTo((47 * 1024) / 48, 9);
  });
});

describe('hand-built streams', () => {
  const head = init([aacTrak(1)], [trex(1, 1024, 0)]);

  it('default-base-is-moof with trex durations; styp, sidx, emsg, free and a small unknown box are skipped', () => {
    const skip = cat(box('styp', fourcc('msdh')), full('sidx', 0, 0, new Array(24).fill(0)), full('emsg', 0, 0, fourcc('urn'), [0]), box('free', [1, 2, 3]), box('xyzw', new Array(50).fill(9)));
    const stream = cat(head, skip, fragment([{ id: 1, time: 96000, sizes: [5, 6] }], cat(sample(5, 1), sample(6, 2))), skip, fragment([{ id: 1, sizes: [7] }], sample(7, 3)));
    const ev = run(stream);
    expect(ev.filter((e) => e.type === 'error')).toEqual([]);
    // the second moof has no tfdt: it carries on from the first
    expect(blocks(ev).map((b) => [b.timeMs, b.data.length, b.data[0]])).toEqual([[2000, 5, 1], [2000 + 1024 / 48, 6, 2], [2000 + 2048 / 48, 7, 3]]);
    expect(summary(run(stream, () => 3))).toEqual(summary(ev));
  });

  it('base_data_offset from the file start, and the same fragment mid-stream (offsets rebased on the mdat)', () => {
    const payload = cat(sample(4, 7), sample(9, 8));
    const frag = (at) => fragment([{ id: 1, base: 'bdo', bdo: 1000, time: 48000, sizes: [4, 9], durations: [1024, 2048] }], payload, at);
    const right = cat(head, frag(head.length));
    const ev = run(right);
    expect(blocks(ev).map((b) => [b.timeMs, b.data.length, b.data[0]])).toEqual([[1000, 4, 7], [1000 + 1024 / 48, 9, 8]]);
    // Offsets written for a file where this fragment sat 5 MB in.
    const elsewhere = run(cat(head, frag(5e6)));
    expect(summary(blocks(elsewhere))).toEqual(summary(blocks(ev)));
    expect(elsewhere.some((e) => e.type === 'error')).toBe(false);
  });

  it('implicit base: the audio traf after a video traf reads its data after the video’s', () => {
    const stream = cat(
      init([videoTrak(1), aacTrak(2)]),
      fragment(
        [
          { id: 1, base: 'none', time: 0, sizes: [100, 120] },
          { id: 2, base: 'none', time: 480, sizes: [3, 4], defDur: 1024 },
        ],
        cat(sample(220, 0xee), sample(3, 5), sample(4, 6))
      )
    );
    const ev = run(stream, () => 17);
    expect(ev.filter((e) => e.type === 'track').map((e) => e.number)).toEqual([2]);
    expect(blocks(ev).map((b) => [b.track, b.timeMs, b.data.length, b.data[0]])).toEqual([[2, 10, 3, 5], [2, 10 + 1024 / 48, 4, 6]]);
  });

  it('tfhd default size; a moof with only other tracks lets its mdat be skipped unread', () => {
    const stream = cat(
      init([videoTrak(1), aacTrak(2)]),
      fragment([{ id: 1, time: 0, sizes: [50000] }], sample(50000, 1)),
      fragment([{ id: 2, time: 0, sizes: [6, 6, 6], defSize: 6, defDur: 1024 }], sample(18, 4))
    );
    const ev = run(stream, () => 1000);
    expect(blocks(ev).map((b) => [b.timeMs, b.data.length])).toEqual([[0, 6], [1024 / 48, 6], [2048 / 48, 6]]);
  });

  it('a sample past its mdat, a broken moof and an unknown large box each report and the stream goes on', () => {
    const good = fragment([{ id: 1, time: 0, sizes: [4] }], sample(4, 1));
    const short = cat(fragment([{ id: 1, time: 0, sizes: [40] }], sample(40, 2)).subarray(0, -30));
    // patch the short mdat's size to what is left
    const cut = short.length - 10 - 8;
    short.set(be(18, 4), cut);
    const broken = box('moof', full('mfhd', 0, 0, be(1, 4)), box('traf', box('tfdt', [1, 0, 0, 0])));
    const big = cat(be(5 * 1024 * 1024, 4), fourcc('zzzz'), new Array(64).fill(0));
    const ev = run(cat(head, short, good, broken, good, big, good));
    expect(ev.filter((e) => e.type === 'error').map((e) => e.message)).toEqual(['1 samples outside their mdat', 'traf without tfhd', 'unknown large box zzzz']);
    expect(blocks(ev)).toHaveLength(3);
  });

  it('a new init with another config re-sends the track; non-AAC entries come out under their own name', () => {
    const he = [0x2b, 0x11, 0x88]; // AOT 5, 24 kHz core, stereo, 48 kHz extension
    const ac3 = init([trak(1, 'soun', 48000, box('ac-3', new Array(28).fill(0)))]);
    const ev = run(cat(head, init([aacTrak(1, 48000, he)]), ac3));
    expect(summary(ev)).toEqual(['t1:mp4a.40.2:1:48000:2', 't1:mp4a.40.5:1:48000:3', 't1:ac-3:1:48000:undefined']);
  });

  it('an mp4a without esds has no config (the decoder refuses it)', () => {
    const ev = run(init([trak(1, 'soun', 44100, mp4a(2, 44100))]));
    expect(ev).toEqual([{ type: 'track', number: 1, codec: 'mp4a', channels: 2, sampleRate: 44100, codecPrivate: null }]);
  });
});

describe('AudioSpecificConfig', () => {
  it('reads LC, explicit HE-AAC and the escape for object types past 31', () => {
    expect(parseAudioSpecificConfig(Uint8Array.from(ASC_LC_48K_MONO))).toEqual({ objectType: 2, sampleRate: 48000, channels: 1 });
    expect(parseAudioSpecificConfig(Uint8Array.from([0x2b, 0x11, 0x88]))).toEqual({ objectType: 5, sampleRate: 24000, channels: 2 });
    // AOT 31 + 6 bits (42 = USAC), freq index 4 (44.1 kHz), 2 channels
    expect(parseAudioSpecificConfig(Uint8Array.from([0xf9, 0x48, 0x40]))).toEqual({ objectType: 42, sampleRate: 44100, channels: 2 });
    expect(() => parseAudioSpecificConfig(Uint8Array.from([0x11]))).toThrow('short');
  });
});
