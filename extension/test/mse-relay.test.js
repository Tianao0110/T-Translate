// @vitest-environment node
//
// The isolated world's MSE relay: cluster times sniffed from appends (the
// MediaRecorder fixture and a hand-made mid-stream cluster), the ring that
// holds decodable audio until capture starts (oldest out, governing init
// kept), capture payloads (init first and alone, ≤ maxPush, batched by time
// or size, one in flight), stop / overflow / refusal, and stream choice.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createMseRelay } from '../src/content/mse-relay.js';
import { clusterTimes, timecodeScale } from '../src/content/webm-sniff.js';
import { fragmentTimes, mp4Timescale } from '../src/content/mp4-sniff.js';
import { decodeBytes } from '../src/shared/messages.js';
import { LIMITS } from '../src/content/bridge-protocol.js';

const FIXTURE = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.webm')));
// ftyp + moov, then a moof + mdat per second (tfdt 0, 48128, 96256 at 48 kHz), then mfra.
const M4S = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.m4s')));
const M4S_INIT = M4S.subarray(0, 692);
const M4S_FRAGS = [M4S.subarray(692, 9179), M4S.subarray(9179, 17536), M4S.subarray(17536, 17781)];

// ISO BMFF boxes for the sniffer: a moof with one traf and a tfdt, a moov with traks.
const be = (v, n) => Array.from({ length: n }, (_, i) => Math.floor(v / 256 ** (n - 1 - i)) % 256);
const box = (type, ...kids) => {
  const body = kids.flatMap((k) => [...k]);
  return Uint8Array.from([...be(body.length + 8, 4), ...[...type].map((c) => c.charCodeAt(0)), ...body]);
};
const moofAt = (ticks, version = 0) => box('moof', box('traf', box('tfhd', [0, 2, 0, 0], be(1, 4)), box('tfdt', [version, 0, 0, 0], be(ticks, version ? 8 : 4))));
const trak = (handler, timescale) => box('trak', box('mdia', box('mdhd', [0, 0, 0, 0], be(0, 8), be(timescale, 4), be(0, 4)), box('hdlr', [0, 0, 0, 0], be(0, 4), [...handler].map((c) => c.charCodeAt(0)))));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

// Cluster (unknown size) + Timecode element, then filler.
function cluster(ms, filler = 8) {
  const t = [(ms >>> 24) & 255, (ms >>> 16) & 255, (ms >>> 8) & 255, ms & 255];
  return new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x84, ...t, ...new Array(filler).fill(0x55)]);
}

function setup(opts = {}) {
  const sent = [];
  const ended = [];
  let reply = { ok: true, result: { accepted: true } };
  let gate = null;
  const relay = createMseRelay({
    send: async (p) => {
      sent.push({ ...p, raw: decodeBytes(p.bytes) });
      if (gate) await gate;
      return typeof reply === 'function' ? reply(p) : reply;
    },
    onCaptureEnd: (r) => ended.push(r),
    maxPush: 100,
    batchMs: 40,
    ...opts,
  });
  relay.onMainEvent({ k: 'mse-source', msId: 1, url: 'blob:https://www.youtube.com/a' });
  relay.onMainEvent({ k: 'mse-buffer', sbId: 1, msId: 1, mime: 'audio/webm; codecs="opus"' });
  relay.onMainEvent({ k: 'mse-buffer', sbId: 2, msId: 1, mime: 'video/mp4; codecs="av01.0.08M.08"' });
  let seq = 0;
  const push = (u8, init = false, sbId = 1) => relay.onMainEvent({ k: 'mse-chunk', sbId, seq: seq++, init, size: u8.length, bytes: u8.slice().buffer });
  return {
    relay,
    sent,
    ended,
    push,
    setReply: (r) => (reply = r),
    hold: () => {
      let open;
      gate = new Promise((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

describe('cluster times', () => {
  it('reads the fixture’s one cluster and its scale, past the SeekHead’s Cluster id', () => {
    expect(timecodeScale(FIXTURE)).toBe(1000000);
    expect(clusterTimes(FIXTURE)).toEqual({ first: 0, last: 0 });
  });

  it('reads a mid-stream cluster, scales it, finds none in plain bytes', () => {
    const two = new Uint8Array([...cluster(100000), ...cluster(105500)]);
    expect(clusterTimes(two)).toEqual({ first: 100, last: 105.5 });
    expect(clusterTimes(cluster(2000), 500000)).toEqual({ first: 1, last: 1 });
    expect(clusterTimes(new Uint8Array(64).fill(0x1f))).toBeNull();
  });
});

describe('fMP4 times', () => {
  it('the fixture: the sound track’s timescale, each moof’s tfdt in seconds', () => {
    expect(mp4Timescale(M4S_INIT)).toBe(48000);
    expect(mp4Timescale(M4S_FRAGS[0])).toBeNull();
    expect(fragmentTimes(M4S, 48000)).toEqual({ first: 0, last: 2.005 });
    expect(fragmentTimes(M4S_FRAGS[1], 48000)).toEqual({ first: 1.003, last: 1.003 });
    expect(fragmentTimes(M4S_INIT, 48000)).toBeNull();
    expect(fragmentTimes(M4S_FRAGS[1], null)).toBeNull();
  });

  it('a cut-off append still has its moof’s time; tfdt v0 and v1; the soun trak wins over the first', () => {
    const frag = Uint8Array.from([...moofAt(90000 * 4), ...box('mdat', new Array(500).fill(1))]);
    expect(fragmentTimes(frag.subarray(0, 120), 90000)).toEqual({ first: 4, last: 4 });
    expect(fragmentTimes(moofAt(2 ** 33, 1), 1000)).toEqual({ first: 8589934.592, last: 8589934.592 });
    expect(mp4Timescale(box('moov', trak('vide', 90000), trak('soun', 44100)))).toBe(44100);
    expect(mp4Timescale(box('moov', trak('vide', 90000)))).toBe(90000);
    expect(fragmentTimes(new Uint8Array(64).fill(0x6d), 1000)).toBeNull();
  });
});

describe('MSE relay', () => {
  it('fMP4 / AAC: held and timed by tfdt; fromS skips older fragments, the init still goes first', async () => {
    const { relay, sent } = setup({ maxPush: 4096 });
    relay.onMainEvent({ k: 'mse-buffer', sbId: 3, msId: 1, mime: 'audio/mp4; codecs="mp4a.40.2"' });
    let seq = 0;
    const append = (u8, init = false) => relay.onMainEvent({ k: 'mse-chunk', sbId: 3, seq: seq++, init, size: u8.length, bytes: u8.slice().buffer });
    append(M4S_INIT, true);
    for (const f of M4S_FRAGS) append(f);
    expect(relay.stream(3)).toMatchObject({ kind: 'audio', codec: 'mp4a.40.2', forward: true, inits: 1, chunks: 4, firstTimeS: 0, lastTimeS: 2.005, held: M4S.subarray(0, 17781).length });
    expect(relay.mainStream('blob:https://www.youtube.com/a')).toBe(3);
    // fromS 1 falls inside the first fragment (0–1.003), so it goes too; fromS 1.5 skips it.
    expect(relay.start(3, { fromS: 1 })).toMatchObject({ init: true, backlogBytes: M4S_INIT.length + M4S_FRAGS.reduce((n, f) => n + f.length, 0) });
    await tick(20);
    expect(sent[0]).toMatchObject({ init: true, timeS: null });
    expect(sent[0].raw.length).toBe(692);
    expect(sent[1].timeS).toBe(0);
    expect(new Uint8Array(sent.slice(1).flatMap((p) => [...p.raw]))).toEqual(M4S.subarray(692, 17781));
    relay.stop();
    sent.length = 0;
    relay.onMainEvent({ k: 'mse-buffer', sbId: 4, msId: 1, mime: 'audio/mp4; codecs="mp4a.40.2"' });
    const append4 = (u8, init = false) => relay.onMainEvent({ k: 'mse-chunk', sbId: 4, seq: seq++, init, size: u8.length, bytes: u8.slice().buffer });
    append4(M4S_INIT, true);
    for (const f of M4S_FRAGS) append4(f);
    expect(relay.start(4, { fromS: 1.5 })).toMatchObject({ init: true, backlogBytes: M4S_INIT.length + M4S_FRAGS[1].length + M4S_FRAGS[2].length });
    await tick(20);
    expect(sent.map((p) => [p.init, p.raw.length, p.timeS])).toEqual([
      [true, 692, null],
      [false, 4096, 1.003],
      [false, 4096, null],
      [false, M4S_FRAGS[1].length + M4S_FRAGS[2].length - 8192, 2.005],
    ]);
    expect(new Uint8Array(sent.slice(1).flatMap((p) => [...p.raw]))).toEqual(M4S.subarray(9179, 17781));
  });

  it('counts every stream, holds only decodable audio, tracks cluster times', () => {
    const { relay, push } = setup();
    push(new Uint8Array([...EBML, 0x9f, 1, 2, 3]), true);
    push(cluster(30000));
    push(cluster(35000));
    push(new Uint8Array(300), false, 2);
    const [audio, video] = relay.streams();
    expect(audio).toMatchObject({ streamId: 1, url: 'blob:https://www.youtube.com/a', kind: 'audio', forward: true, init: true, chunks: 3, firstTimeS: 30, lastTimeS: 35 });
    expect(audio.held).toBe(8 + 2 * cluster(0).length);
    expect(video).toMatchObject({ streamId: 2, kind: 'video', forward: false, chunks: 1, bytes: 300, held: 0 });
    expect(relay.mainStream('blob:https://www.youtube.com/a')).toBe(1);
    expect(relay.mainStream('blob:https://elsewhere/b')).toBe(1);
  });

  it('capture sends the init alone first, then the held ring in ≤ maxPush payloads at once', async () => {
    const { relay, sent, push } = setup();
    const init = new Uint8Array([...EBML, ...new Array(36).fill(9)]);
    push(init, true);
    const c1 = cluster(30000, 50);
    const c2 = cluster(31000, 150);
    push(c1);
    push(c2);
    expect(relay.start(1)).toEqual({ streamId: 1, backlogBytes: 40 + c1.length + c2.length, init: true });
    await tick(10);
    expect(sent.map((p) => [p.seq, p.init, p.raw.length, p.timeS])).toEqual([
      [0, true, 40, null],
      [1, false, 100, 30],
      [2, false, 100, null],
      [3, false, c1.length + c2.length - 200, null],
    ]);
    const all = new Uint8Array(sent.slice(1).flatMap((p) => [...p.raw]));
    expect(all).toEqual(new Uint8Array([...c1, ...c2]));
    expect(relay.capture()).toMatchObject({ streamId: 1, pushes: 4, queued: 0 });
  });

  it('live chunks wait up to batchMs or until maxPush; one payload in flight', async () => {
    const { relay, sent, push, hold } = setup();
    push(new Uint8Array([...EBML, 1, 2, 3, 4]), true);
    relay.start(1);
    await tick(5);
    expect(sent).toHaveLength(1);
    push(new Uint8Array(30).fill(1));
    push(new Uint8Array(30).fill(2));
    await tick(10);
    expect(sent).toHaveLength(1);
    await tick(50);
    expect(sent.map((p) => p.raw.length)).toEqual([8, 60]);

    const release = hold();
    push(new Uint8Array(120).fill(3));
    await tick(5);
    expect(sent.map((p) => p.raw.length)).toEqual([8, 60, 100]);
    push(new Uint8Array(10).fill(4));
    await tick(60);
    expect(sent).toHaveLength(3);
    release();
    await tick(60);
    expect(sent.map((p) => p.raw.length)).toEqual([8, 60, 100, 30]);
    expect([...sent[3].raw.slice(0, 20)]).toEqual(new Array(20).fill(3));
  });

  it('a new init segment opens its own payload', async () => {
    const { relay, sent, push } = setup({ batchMs: 1000 });
    push(new Uint8Array([...EBML, 1]), true);
    relay.start(1);
    await tick(5);
    push(new Uint8Array(20).fill(1));
    push(new Uint8Array([...EBML, 2]), true);
    push(new Uint8Array(20).fill(2));
    await tick(5);
    expect(sent.map((p) => [p.init, p.raw.length])).toEqual([
      [true, 5],
      [false, 20],
    ]);
  });

  it('the ring drops the oldest but keeps the init that governs what is left', async () => {
    const { relay, sent, push } = setup({ limits: { ...LIMITS, ringBytes: 100 }, maxPush: 1000 });
    const init = new Uint8Array([...EBML, 7, 7, 7, 7]);
    push(init, true);
    for (let i = 0; i < 5; i++) push(new Uint8Array(40).fill(10 + i));
    expect(relay.stream(1).held).toBe(80);
    relay.start(1);
    await tick(5);
    expect(sent.map((p) => [p.init, p.raw.length, p.raw[0]])).toEqual([
      [true, 8, 0x1a],
      [false, 80, 13],
    ]);
  });

  it('fromS skips held chunks before it, keeping the init that governs the rest', async () => {
    const { relay, sent, push } = setup({ maxPush: 1000 });
    const init1 = new Uint8Array([...EBML, 1, 1, 1, 1]);
    const init2 = new Uint8Array([...EBML, 2, 2, 2, 2]);
    push(init1, true);
    push(cluster(10000, 10));
    push(cluster(20000, 10));
    push(init2, true);
    push(cluster(30000, 10));
    push(cluster(40000, 10));
    // 35 s is inside the cluster that starts at 30: it goes, with the init that governs it.
    expect(relay.start(1, { fromS: 35 })).toMatchObject({ init: true });
    await tick(20);
    expect(sent.map((p) => [p.init, p.raw[4], p.timeS])).toEqual([
      [true, 2, null],
      [false, 0x01, 30],
    ]);
    expect(sent[1].raw.length).toBe(cluster(30000, 10).length + cluster(40000, 10).length); // both held clusters, one payload
    relay.stop();
    sent.length = 0;
    // The last held cluster starts before fromS, so it is the one that may hold it: it goes, the live chunks follow.
    push(cluster(50000, 10));
    const started = relay.start(1, { fromS: 60 });
    expect(started).toMatchObject({ init: true });
    expect(started.backlogBytes).toBeGreaterThan(init2.length);
    push(cluster(61000, 10));
    await tick(150);
    expect(sent.map((p) => [p.init, p.timeS])).toEqual([
      [true, null],
      [false, 50],
    ]);
    expect(sent[1].raw.length).toBe(cluster(50000, 10).length + cluster(61000, 10).length); // the held one and the live one, one payload
    relay.stop();
    sent.length = 0;
    // Nothing older than fromS: the usual ring goes out.
    push(cluster(70000, 10));
    relay.start(1, { fromS: 5 });
    await tick(5);
    expect(sent.map((p) => [p.init, p.timeS])).toEqual([
      [true, null],
      [false, 70],
    ]);
  });

  it('stop drops what is held; the latest init still opens the next capture', async () => {
    const { relay, sent, push } = setup({ maxPush: 1000 });
    push(new Uint8Array([...EBML, 1, 1]), true);
    push(new Uint8Array(50));
    relay.start(1);
    await tick(5);
    expect(relay.stop()).toMatchObject({ streamId: 1, pushes: 2, reason: 'off' });
    push(new Uint8Array(20).fill(5));
    expect(relay.stream(1).held).toBe(20);
    relay.stop();
    expect(relay.stream(1).held).toBe(20); // nothing was capturing
    sent.length = 0;
    relay.start(1);
    await tick(5);
    expect(sent.map((p) => [p.init, p.raw.length])).toEqual([
      [true, 6],
      [false, 20],
    ]);
  });

  it('refusals, a finished pipeline and overflow end the capture', async () => {
    const a = setup();
    a.push(new Uint8Array([...EBML, 1]), true);
    a.setReply({ ok: true, result: { accepted: false, reason: 'not-capturing' } });
    a.relay.start(1);
    await tick(5);
    expect(a.ended).toEqual([{ streamId: 1, pushes: 1, bytes: 5, reason: 'not-capturing' }]);
    expect(a.relay.capture()).toBeNull();

    const b = setup();
    b.push(new Uint8Array([...EBML, 1]), true);
    b.setReply({ ok: true, result: { accepted: true, ended: true } });
    b.relay.start(1);
    await tick(5);
    expect(b.ended[0].reason).toBe('pipeline-ended');

    const c = setup({ limits: { ...LIMITS, ringBytes: 150 } });
    c.push(new Uint8Array([...EBML, 1]), true);
    const release = c.hold();
    c.relay.start(1);
    c.push(new Uint8Array(100));
    c.push(new Uint8Array(100));
    expect(c.ended.map((r) => r.reason)).toEqual(['overflow']);
    release();
  });

  it('refuses streams it cannot forward; a closed source ends its streams', () => {
    const { relay, push, ended } = setup();
    expect(() => relay.start(2)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => relay.start(9)).toThrow(expect.objectContaining({ code: 'no-stream' }));
    push(new Uint8Array([...EBML, 1]), true);
    relay.start(1);
    relay.onMainEvent({ k: 'mse-closed', msId: 1 });
    expect(ended.map((r) => r.reason)).toEqual(['stream-gone']);
    expect(relay.streams().every((s) => !s.alive)).toBe(true);
    expect(relay.mainStream('blob:https://www.youtube.com/a')).toBeNull();
  });

  it('a changeType away from Opus to undecodable audio stops holding; keepAttached forgets detached sources', () => {
    const { relay, push } = setup();
    relay.onMainEvent({ k: 'mse-op', sbId: 1, op: 'changeType', mime: 'audio/mp4; codecs="ac-3"' });
    push(new Uint8Array(40));
    expect(relay.stream(1)).toMatchObject({ forward: false, codec: 'ac-3', held: 0, lastOp: { op: 'changeType' } });
    relay.onMainEvent({ k: 'mse-source', msId: 2, url: 'blob:https://www.youtube.com/b' });
    relay.onMainEvent({ k: 'mse-buffer', sbId: 3, msId: 2, mime: 'audio/webm; codecs="opus"' });
    relay.keepAttached(new Set(['blob:https://www.youtube.com/b']));
    expect(relay.streams().map((s) => s.streamId)).toEqual([3]);
    expect(relay.msIdOf('blob:https://www.youtube.com/b')).toBe(2);
  });
});
