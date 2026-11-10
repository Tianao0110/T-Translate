// @vitest-environment node
//
// The media pipeline with the real demuxer and resampler, a fake decoder
// (silence of each packet's length) and a fake feeder: the first block's time
// becomes mediaStartS, blocks wait for the decoder, 48 kHz arrives as 16 kHz,
// close drains and ends with one 'closed'; AAC is reported unsupported.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createMediaPipeline } from '../src/offscreen/media-pipeline.js';
import { opusPacketMs } from '../src/offscreen/webm-demux.js';
import { MSG, encodeBytes, decodeBytes, MAX_MEDIA_PUSH_BYTES } from '../src/shared/messages.js';

const FIXTURE = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'tone-2s.webm')));

function fakeDecoderFactory(log) {
  return async ({ track, onPcm }) => {
    if (track.codec !== 'A_OPUS') throw Object.assign(new Error(track.codec), { code: 'unsupported' });
    await new Promise((r) => setTimeout(r, 5)); // isConfigSupported is async
    const queue = [];
    log.created++;
    return {
      decode(block) {
        queue.push(block);
        return true;
      },
      async flush() {
        for (const b of queue.splice(0)) onPcm({ pcm: new Float32Array((opusPacketMs(b.data) * 48000) / 1000), sampleRate: 48000, timeMs: b.timeMs });
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

  it('AAC: status unsupported, then closed with that reason; no session opened', async () => {
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
