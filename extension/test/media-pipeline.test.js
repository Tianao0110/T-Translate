// @vitest-environment node
//
// The media pipeline with the real demuxers and resampler, a fake decoder
// (silence of each packet's length; the real decoderConfig says what is
// supported) and a fake feeder: the container is picked from the first
// bytes, the first block's time becomes mediaStartS, blocks wait for the
// decoder, 48 kHz arrives as 16 kHz, close drains and ends with one 'closed';
// AAC in WebM is reported unsupported, AAC in fMP4 decodes; a direct
// (progressive MP4) stream takes pushes with file offsets.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createMediaPipeline, containerOf } from '../src/offscreen/media-pipeline.js';
import { opusPacketMs } from '../src/offscreen/webm-demux.js';
import { decoderConfig } from '../src/offscreen/decode.js';
import { MSG, encodeBytes, decodeBytes, MAX_MEDIA_PUSH_BYTES } from '../src/shared/messages.js';
import { parseMoov, offsetAt } from '../src/shared/mp4-table.js';

const FIXTURE = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.webm')));
// AAC-LC 48 kHz mono, ftyp + moov (692 bytes), a moof + mdat a second (the second at 9179).
const M4S = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.m4s')));
const AAC_FRAMES = 95;
const FAST = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s-faststart.mp4')));
const LAST = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s-moov-last.mp4')));

function fakeDecoderFactory(log) {
  return async ({ track, onPcm }) => {
    if (!decoderConfig(track)) throw Object.assign(new Error(track.codec), { code: 'unsupported' });
    await new Promise((r) => setTimeout(r, 5)); // isConfigSupported is async
    const queue = [];
    log.created++;
    return {
      decode(block) {
        queue.push(block);
        return true;
      },
      async flush() {
        const frames = (b) => (track.codec === 'A_OPUS' ? (opusPacketMs(b.data) * 48000) / 1000 : 1024);
        for (const b of queue.splice(0)) onPcm({ pcm: new Float32Array(frames(b)), sampleRate: 48000, timeMs: b.timeMs });
      },
      close() {
        log.closed++;
      },
    };
  };
}

function fakeFeederFactory(log) {
  return (opts) => {
    log.opts = opts;
    log.pushed = 0;
    return {
      start: async () => {
        log.started = true;
      },
      push: (pcm) => {
        log.pushed += pcm.length;
        return true;
      },
      stop: async ({ drain }) => {
        log.drain = drain;
        opts.onEvent({ type: 'closed', reason: 'closed' });
        return { fedS: log.pushed / 16000, closed: true };
      },
    };
  };
}

function setup() {
  const log = { created: 0, closed: 0 };
  const events = [];
  const p = createMediaPipeline({
    client: {},
    logger: { warn: () => {} },
    onEvent: (e) => events.push(e),
    createDecoder: fakeDecoderFactory(log),
    createFeeder: fakeFeederFactory(log),
  });
  return { p, log, events };
}

describe('media pipeline', () => {
  it('decodes the fixture into ~1.86 s of 16 kHz audio, mediaStartS from the first block, one closed', async () => {
    const { p, log, events } = setup();
    p.open({ key: 'tab1', lang: 'en', targetLang: 'zh' });
    for (let i = 0; i < FIXTURE.length; i += 1000) p.push({ key: 'tab1', bytes: FIXTURE.subarray(i, i + 1000) });
    const stats = await p.close({ key: 'tab1' });
    expect(log.created).toBe(1);
    expect(log.opts).toMatchObject({ lang: 'en', targetLang: 'zh', mediaStartS: 0 });
    expect(log.drain).toBe(true);
    expect(log.pushed).toBe(31 * 60 * 16);
    expect(stats).toMatchObject({ bytes: FIXTURE.length, blocks: 31, demuxErrors: 0 });
    expect(stats.decodedS).toBeCloseTo(1.86, 5);
    expect(events).toEqual([{ key: 'tab1', event: { type: 'closed', reason: 'closed' } }]);
    expect(p.current()).toBe(null);
    await expect(p.close({ key: 'tab1' })).resolves.toBe(stats);
    expect(() => p.push({ key: 'tab1', bytes: FIXTURE })).toThrow(expect.objectContaining({ code: 'no-stream' }));
  });

  it('a new open replaces the stream in progress without draining it', async () => {
    const { p, log, events } = setup();
    p.open({ key: 'a' });
    p.push({ key: 'a', bytes: FIXTURE });
    p.open({ key: 'b' });
    expect(p.current()).toBe('b');
    await vi.waitFor(() => expect(events.some((e) => e.key === 'a' && e.event.type === 'closed')).toBe(true));
    // 'a' was replaced before its decoder came up: nothing decoded, no session.
    expect(events[0]).toEqual({ key: 'a', event: { type: 'closed', reason: 'no-audio' } });
    await vi.waitFor(() => expect(log.closed).toBe(1));
    expect(() => p.push({ key: 'a', bytes: FIXTURE })).toThrow();
    p.push({ key: 'b', bytes: FIXTURE });
    await p.close({ key: 'b' });
    expect(events.filter((e) => e.event.type === 'closed').map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('AAC in WebM: status unsupported, then closed with that reason; no session opened', async () => {
    const { p, log, events } = setup();
    const aac = Uint8Array.from(FIXTURE);
    const at = Buffer.from(aac).indexOf('A_OPUS');
    aac.set([...'A_AAC\0'].map((c) => c.charCodeAt(0)), at);
    p.open({ key: 'k' });
    p.push({ key: 'k', bytes: aac });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0].event).toEqual({ type: 'status', state: 'unsupported', codec: 'A_AAC' });
    expect(p.push({ key: 'k', bytes: aac })).toEqual({ ended: true });
    await p.close({ key: 'k' });
    expect(log.opts).toBeUndefined();
    expect(events.at(-1).event).toEqual({ type: 'closed', reason: 'unsupported' });
  });

  it('fMP4 / AAC: 95 frames in any cuts → 16 kHz audio, mediaStartS from the first tfdt', async () => {
    const { p, log, events } = setup();
    p.open({ key: 'm', lang: 'zh', targetLang: 'en' });
    for (let i = 0; i < M4S.length; i += 777) p.push({ key: 'm', bytes: M4S.subarray(i, i + 777) });
    const stats = await p.close({ key: 'm' });
    expect(stats).toMatchObject({ container: 'mp4', bytes: M4S.length, blocks: AAC_FRAMES, demuxErrors: 0 });
    expect(stats.decodedS).toBeCloseTo((AAC_FRAMES * 1024) / 48000, 6);
    expect(log.opts).toMatchObject({ lang: 'zh', targetLang: 'en', mediaStartS: 0 });
    expect(log.pushed).toBe(Math.floor((AAC_FRAMES * 1024) / 3));
    expect(events).toEqual([{ key: 'm', event: { type: 'closed', reason: 'closed' } }]);
  });

  it('fMP4 joined mid-video: the init, then fragments from the second; one decoder for a repeated init', async () => {
    const { p, log } = setup();
    p.open({ key: 'j' });
    p.push({ key: 'j', bytes: M4S.subarray(0, 692) });
    p.push({ key: 'j', bytes: M4S.subarray(9179) });
    // the same init again (a player re-appending it), then the whole file
    p.push({ key: 'j', bytes: M4S });
    const stats = await p.close({ key: 'j' });
    expect(log.opts.mediaStartS).toBeCloseTo(48128 / 48000, 9);
    expect(stats.blocks).toBe(48 + AAC_FRAMES);
    expect(log.created).toBe(1);
  });

  it('a new init with another AudioSpecificConfig gets a new decoder', async () => {
    const { p, log } = setup();
    const stereo = Uint8Array.from(M4S);
    const at = Buffer.from(stereo).indexOf(Buffer.from([0x05, 0x80, 0x80, 0x80, 0x05, 0x11, 0x88]));
    stereo[at + 6] = 0x90;
    p.open({ key: 'c' });
    p.push({ key: 'c', bytes: M4S });
    await vi.waitFor(() => expect(log.created).toBe(1));
    p.push({ key: 'c', bytes: stereo });
    await p.close({ key: 'c' });
    expect(log.created).toBe(2);
    expect(log.closed).toBe(2);
  });

  it('picks the container from the first bytes', () => {
    const head = (type) => Uint8Array.from([0, 0, 0, 24, ...[...type].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
    for (const t of ['ftyp', 'moov', 'moof', 'styp', 'sidx']) expect(containerOf(head(t)), t).toBe('mp4');
    expect(containerOf(FIXTURE)).toBe('webm');
    expect(containerOf(Uint8Array.from([0x1f, 0x43, 0xb6, 0x75, 1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toBe('webm');
    expect(containerOf(head('mdat'))).toBe('webm');
  });

  it('direct: the head, then mdat with offsets → ~2 s of 16 kHz audio; source in the stats', async () => {
    const { p, log, events } = setup();
    p.open({ key: 'd', lang: 'en', targetLang: 'zh', source: 'direct' });
    p.push({ key: 'd', bytes: FAST.subarray(0, 1154), offset: 0 });
    for (let i = 1170; i < FAST.length; i += 1000) p.push({ key: 'd', bytes: FAST.subarray(i, i + 1000), offset: i });
    const stats = await p.close({ key: 'd' });
    expect(stats).toMatchObject({ source: 'direct', container: 'mp4', bytes: FAST.length - 16, blocks: AAC_FRAMES, demuxErrors: 0 });
    expect(stats.decodedS).toBeCloseTo((AAC_FRAMES * 1024) / 48000, 6);
    expect(log.opts).toMatchObject({ lang: 'en', targetLang: 'zh', mediaStartS: 0 });
    expect(events).toEqual([{ key: 'd', event: { type: 'closed', reason: 'closed' } }]);
  });

  it('direct, moov at the end: the moov first, mdat from 1 s; mediaStartS from that sample', async () => {
    const { p, log } = setup();
    p.open({ key: 'e', source: 'direct' });
    p.push({ key: 'e', bytes: LAST.subarray(16433), offset: 16433 });
    const from = offsetAt(parseMoov(LAST), 1);
    for (let i = from; i < 16433; i += 4096) p.push({ key: 'e', bytes: LAST.subarray(i, Math.min(i + 4096, 16433)), offset: i });
    const stats = await p.close({ key: 'e' });
    expect(stats.blocks).toBe(AAC_FRAMES - 47);
    expect(log.opts.mediaStartS).toBeCloseTo((47 * 1024) / 48000, 9);
  });

  it('direct pushes need an offset; an unknown source is refused; mse ignores offsets', () => {
    const { p } = setup();
    expect(() => p.open({ key: 'z', source: 'file' })).toThrow(expect.objectContaining({ code: 'bad-request' }));
    p.open({ key: 'd', source: 'direct' });
    expect(() => p.push({ key: 'd', bytes: FAST.subarray(0, 100) })).toThrow(expect.objectContaining({ code: 'bad-request', message: 'offset' }));
    expect(() => p.push({ key: 'd', bytes: FAST.subarray(0, 100), offset: -1 })).toThrow(expect.objectContaining({ code: 'bad-request' }));
    p.open({ key: 'm' });
    expect(p.push({ key: 'm', bytes: M4S, offset: 5 })).toEqual({ ended: false });
  });

  it('a stream with no audio ends with closed/no-audio', async () => {
    const { p, events } = setup();
    p.open({ key: 'x' });
    p.push({ key: 'x', bytes: FIXTURE.subarray(0, 200) });
    await p.close({ key: 'x' });
    expect(events).toEqual([{ key: 'x', event: { type: 'closed', reason: 'no-audio' } }]);
  });
});

describe('media bytes over JSON messages', () => {
  it('base64 round trip, size cap, bad input', () => {
    expect(MSG.MEDIA_PUSH).toBe('media/push');
    expect(decodeBytes(encodeBytes(FIXTURE))).toEqual(FIXTURE);
    expect(decodeBytes(encodeBytes(new Uint8Array(MAX_MEDIA_PUSH_BYTES)))).toHaveLength(MAX_MEDIA_PUSH_BYTES);
    expect(() => decodeBytes(encodeBytes(new Uint8Array(MAX_MEDIA_PUSH_BYTES + 3)))).toThrow(expect.objectContaining({ code: 'too-large' }));
    expect(() => decodeBytes('***')).toThrow(expect.objectContaining({ code: 'bad-bytes' }));
    expect(() => decodeBytes({})).toThrow(expect.objectContaining({ code: 'bad-bytes' }));
  });
});
