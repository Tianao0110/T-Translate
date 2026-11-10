// @vitest-environment node
//
// The streaming WebM demuxer: the MediaRecorder fixture pushed whole, byte by
// byte and in random cuts; unknown-size Segment / Cluster (MSE); a new init
// segment mid-stream; bad data; lacing; BlockGroup; other tracks skipped.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWebmDemuxer, opusPacketMs } from '../src/offscreen/webm-demux.js';

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.webm'));

// ---- a tiny EBML writer ----
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const idBytes = (id) => {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
};
const sizeBytes = (n) => {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = [];
      let v = n;
      for (let i = 0; i < len; i++) {
        out.unshift(v % 256);
        v = Math.floor(v / 256);
      }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
  throw new Error('too big');
};
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const el = (id, ...kids) => {
  const body = cat(...kids);
  return cat(idBytes(id), sizeBytes(body.length), body);
};
const open = (id, ...kids) => cat(idBytes(id), UNKNOWN_SIZE, ...kids);
const uint = (id, v) => el(id, idBytes(v).length ? idBytes(v) : [0]);
const str = (id, s) => el(id, [...s].map((c) => c.charCodeAt(0)));
const f32 = (id, v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v);
  return el(id, b);
};

const EBML = el(0x1a45dfa3, str(0x4282, 'webm'));
const OPUS_HEAD = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];
const audioTrack = (number = 1, codec = 'A_OPUS', extra = []) =>
  el(0xae, uint(0xd7, number), str(0x86, codec), el(0x63a2, OPUS_HEAD), el(0xe1, f32(0xb5, 48000), uint(0x9f, 2)), ...extra);
const tracks = (...entries) => el(0x1654ae6b, ...entries);
const info = (scale = 1000000) => el(0x1549a966, uint(0x2ad7b1, scale));
// A 20 ms Opus packet (TOC config 1, code 0) of n bytes.
const packet = (n, fill = 1) => [0x08, ...new Array(n - 1).fill(fill)];
const simpleBlock = (track, rel, payload, flags = 0x80) => el(0xa3, sizeBytes(track), [(rel >> 8) & 0xff, rel & 0xff, flags], payload);
const cluster = (time, ...blocks) => el(0x1f43b675, uint(0xe7, time), ...blocks);
const openCluster = (time, ...blocks) => open(0x1f43b675, uint(0xe7, time), ...blocks);

function run(bytes, cuts) {
  const d = createWebmDemuxer();
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
  events.map((e) => (e.type === 'block' ? `b${e.track}@${e.timeMs}:${e.data.length}:${e.data.reduce((a, b) => (a * 31 + b) >>> 0, 0)}` : e.type === 'track' ? `t${e.number}:${e.codec}:${e.channels}:${e.sampleRate}:${e.codecPrivate?.length}` : `e:${e.message}`));
const blocks = (events) => events.filter((e) => e.type === 'block');

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('MediaRecorder fixture', () => {
  const whole = run(FIXTURE);

  it('reports one Opus track and the blocks of ~2 s', () => {
    const tr = whole.filter((e) => e.type === 'track');
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ number: 1, codec: 'A_OPUS', channels: 2, sampleRate: 48000 });
    expect(String.fromCharCode(...tr[0].codecPrivate.subarray(0, 8))).toBe('OpusHead');
    const bl = blocks(whole);
    expect(bl).toHaveLength(31);
    expect(bl[0].timeMs).toBe(0);
    expect(bl.every((b, i) => b.keyframe && b.track === 1 && (i === 0 || b.timeMs > bl[i - 1].timeMs))).toBe(true);
    const totalMs = bl.at(-1).timeMs + opusPacketMs(bl.at(-1).data);
    expect(totalMs).toBeGreaterThan(1700);
    expect(totalMs).toBeLessThan(2200);
    expect(whole.some((e) => e.type === 'error')).toBe(false);
  });

  it('byte by byte and random cuts give the same events', () => {
    const want = summary(whole);
    expect(summary(run(FIXTURE, () => 1))).toEqual(want);
    for (const seed of [1, 7, 42]) {
      const rnd = lcg(seed);
      expect(summary(run(FIXTURE, () => 1 + Math.floor(rnd() * 700))), `seed ${seed}`).toEqual(want);
    }
  });

  it('the same stream with unknown-size Segment and Clusters (MSE style) parses the same', () => {
    const patched = Uint8Array.from(FIXTURE);
    let patches = 0;
    for (let i = 0; i + 12 <= patched.length; i++) {
      const isSegment = patched[i] === 0x18 && patched[i + 1] === 0x53 && patched[i + 2] === 0x80 && patched[i + 3] === 0x67;
      const isCluster = patched[i] === 0x1f && patched[i + 1] === 0x43 && patched[i + 2] === 0xb6 && patched[i + 3] === 0x75;
      if ((isSegment || isCluster) && patched[i + 4] === 0x01) {
        patched.set(UNKNOWN_SIZE, i + 4);
        patches++;
      }
    }
    expect(patches).toBeGreaterThanOrEqual(2);
    expect(summary(run(patched))).toEqual(summary(whole));
    expect(summary(run(patched, () => 3))).toEqual(summary(whole));
  });
});

describe('hand-built streams', () => {
  it('unknown-size Segment and Clusters end at the next Cluster, Cues or a new init segment', () => {
    const init = cat(EBML, open(0x18538067, info(), tracks(audioTrack())));
    const stream = cat(
      init,
      openCluster(1000, simpleBlock(1, 0, packet(30)), simpleBlock(1, 20, packet(31))),
      openCluster(1040, simpleBlock(1, 0, packet(32))),
      el(0x1c53bb6b, el(0xbb, uint(0xb3, 0))),
      // quality switch: a new init segment with another OpusHead, then clusters again
      EBML,
      open(0x18538067, info(), tracks(el(0xae, uint(0xd7, 1), str(0x86, 'A_OPUS'), el(0x63a2, [...OPUS_HEAD.slice(0, 18), 9]), el(0xe1, uint(0x9f, 2))))),
      openCluster(1060, simpleBlock(1, 0, packet(33)))
    );
    const ev = run(stream);
    expect(summary(ev).map((s) => s.split(':').slice(0, 2).join(':'))).toEqual([
      't1:A_OPUS', 'b1@1000:30', 'b1@1020:31', 'b1@1040:32', 't1:A_OPUS', 'b1@1060:33',
    ]);
    expect(summary(run(stream, () => 5))).toEqual(summary(ev));
  });

  it('TimecodeScale scales the block times', () => {
    const ev = run(cat(EBML, open(0x18538067, info(500000), tracks(audioTrack()), cluster(2000, simpleBlock(1, -10, packet(5))))));
    expect(blocks(ev)[0].timeMs).toBe(995);
  });

  it('skips other tracks (video) and non-audio codecs without reporting them', () => {
    const video = el(0xae, uint(0xd7, 2), str(0x86, 'V_VP9'));
    const stream = cat(EBML, el(0x18538067, info(), tracks(video, audioTrack(1)), cluster(0, simpleBlock(2, 0, new Array(5000).fill(7)), simpleBlock(1, 0, packet(10)), simpleBlock(2, 33, new Array(4000).fill(7)))));
    const ev = run(stream, () => 100);
    expect(ev.filter((e) => e.type === 'track').map((e) => e.number)).toEqual([1]);
    expect(blocks(ev).map((b) => [b.track, b.data.length])).toEqual([[1, 10]]);
  });

  it('BlockGroup: Block is emitted when the group closes, ReferenceBlock clears keyframe', () => {
    const group = (rel, ref) => el(0xa0, el(0xa1, sizeBytes(1), [0, rel, 0], packet(8)), ...(ref ? [el(0xfb, [0xec])] : []));
    const ev = run(cat(EBML, el(0x18538067, tracks(audioTrack()), cluster(0, group(0, false), group(20, true)))));
    expect(blocks(ev).map((b) => [b.timeMs, b.keyframe])).toEqual([[0, true], [20, false]]);
  });
});

describe('lacing', () => {
  const head = cat(EBML, el(0x18538067, tracks(audioTrack(1), el(0xae, uint(0xd7, 2), str(0x86, 'A_AAC'), uint(0x23e383, 21333333)))));
  const sizesOf = (ev, track = 1) => blocks(ev).filter((b) => b.track === track).map((b) => [b.timeMs, b.data.length]);

  it('Xiph lacing splits frames (sizes ≥ 255 included) and steps time by each Opus packet', () => {
    const frames = [packet(300), packet(2, 9), packet(40)];
    const lace = [2, 255, 45, 2];
    const ev = run(cat(head, cluster(100, simpleBlock(1, 0, [lace, ...frames].flat(), 0x80 | 0x02))));
    expect(sizesOf(ev)).toEqual([[100, 300], [120, 2], [140, 40]]);
    expect(blocks(ev)[1].data[1]).toBe(9);
  });

  it('EBML lacing uses signed size differences; fixed lacing splits evenly', () => {
    // sizes 10, 12, 7: first 10 as a vint, then +2 as a signed 1-byte vint (63 + 2), the last implied
    const ebml = [2, 0x80 | 10, 0x80 | 65, ...packet(10), ...packet(12), ...packet(7)];
    const fixed = [2, ...packet(6), ...packet(6), ...packet(6)];
    const ev = run(cat(head, cluster(0, simpleBlock(1, 0, ebml, 0x80 | 0x06), simpleBlock(1, 100, fixed, 0x80 | 0x04))));
    expect(sizesOf(ev)).toEqual([[0, 10], [20, 12], [40, 7], [100, 6], [120, 6], [140, 6]]);
  });

  it('non-Opus laced frames step by DefaultDuration', () => {
    const ev = run(cat(head, cluster(0, simpleBlock(2, 0, [1, ...new Array(8).fill(1)], 0x80 | 0x04))));
    expect(sizesOf(ev, 2).map(([t]) => Math.round(t * 1000) / 1000)).toEqual([0, 21.333]);
  });

  it('lace sizes that overrun the block report one error and the stream goes on', () => {
    const ev = run(cat(head, cluster(0, simpleBlock(1, 0, [1, 200, ...packet(10)], 0x80 | 0x02), simpleBlock(1, 20, packet(10)))));
    expect(ev.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(sizesOf(ev)).toEqual([[20, 10]]);
  });
});

describe('bad data', () => {
  const good = cat(EBML, open(0x18538067, info(), tracks(audioTrack())));
  const c1 = cluster(0, simpleBlock(1, 0, packet(20)));
  const c2 = cluster(40, simpleBlock(1, 0, packet(21)), simpleBlock(1, 20, packet(22)));

  it('garbage between clusters: one error, then resync on the next Cluster', () => {
    const rnd = lcg(3);
    const junk = Uint8Array.from({ length: 300 }, () => Math.floor(rnd() * 256)).map((b) => (b === 0x1f || b === 0x1a ? 0 : b));
    for (const cuts of [null, () => 1, () => 17]) {
      const ev = run(cat(good, c1, [0x00, ...junk], c2), cuts);
      expect(ev.filter((e) => e.type === 'error')).toHaveLength(1);
      expect(blocks(ev).map((b) => b.timeMs)).toEqual([0, 40, 60]);
    }
  });

  it('a known-size cluster cut short (MSE abort) ends where the next Cluster starts', () => {
    const second = simpleBlock(1, 20, packet(23));
    const full = cluster(0, simpleBlock(1, 0, packet(20)), second);
    const cut = full.subarray(0, full.length - second.length);
    for (const cuts of [null, () => 4]) {
      const ev = run(cat(good, cut, c2), cuts);
      expect(blocks(ev).map((b) => b.timeMs)).toEqual([0, 40, 60]);
      expect(ev.some((e) => e.type === 'error')).toBe(false);
    }
  });

  it('pure noise never throws and reports at most once', () => {
    const rnd = lcg(11);
    const noise = Uint8Array.from({ length: 20000 }, () => Math.floor(rnd() * 256));
    let ev;
    expect(() => {
      ev = run(noise, () => 333);
    }).not.toThrow();
    expect(ev.filter((e) => e.type === 'error').length).toBeLessThanOrEqual(1);
  });

  it('a zeroed block header in the fixture: one error, the blocks before it kept, no throw', () => {
    const starts = [];
    for (let i = 0; i + 3 < FIXTURE.length; i++) if (FIXTURE[i] === 0xa3 && FIXTURE[i + 1] === 0x41 && FIXTURE[i + 2] === 0x6b) starts.push(i);
    const broken = Uint8Array.from(FIXTURE);
    broken.fill(0x00, starts[10], starts[10] + 40);
    const ev = run(broken, () => 512);
    expect(ev.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(blocks(ev)).toHaveLength(10); // one Cluster in this file: nothing to resync onto after the damage
  });
});

describe('opusPacketMs', () => {
  it('reads frame size and count from the TOC', () => {
    expect(opusPacketMs(Uint8Array.of(0x08))).toBe(20); // SILK 20 ms, 1 frame
    expect(opusPacketMs(Uint8Array.of((19 << 3) | 1))).toBe(40); // CELT 20 ms, 2 frames
    expect(opusPacketMs(Uint8Array.of((11 << 3) | 3, 1))).toBe(60); // SILK 60 ms, 1 frame (code 3)
    expect(opusPacketMs(Uint8Array.of((16 << 3) | 3, 3))).toBe(7.5); // CELT 2.5 ms × 3
  });
});
