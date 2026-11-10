// @vitest-environment node
//
// The feeder against a fake companion client and a fake clock: one-second
// chunks with rising seq, a backpressured chunk resent as is, suspension
// after 60 s of waiting without a final, the 90 s queue cap, and stop()
// padding the tail, closing and waiting for 'closed'.

import { describe, it, expect, vi } from 'vitest';
import { createAudioFeeder } from '../src/offscreen/audio-feeder.js';
import { FEED_CHUNK_SAMPLES as CHUNK } from '../src/shared/protocol.js';

function fakeClient(reply = () => ({ ok: true })) {
  const calls = { open: [], feed: [], close: [] };
  let onEvent = null;
  const client = {
    calls,
    stopped: false,
    openAsr: async (opts) => {
      calls.open.push(opts);
      return { id: 'asr-1' };
    },
    subscribe: (id, fn) => {
      onEvent = fn;
      return { stop: () => (client.stopped = true) };
    },
    feed: async (id, pcm, seq) => {
      calls.feed.push({ id, seq, pcm: Float32Array.from(pcm) });
      return reply(calls.feed.length, seq);
    },
    closeAsr: async (id) => {
      calls.close.push(id);
      setTimeout(() => onEvent?.({ type: 'closed', reason: 'closed' }), 0);
      return true;
    },
    emit: (evt) => onEvent(evt),
  };
  return client;
}

function clock() {
  const c = { t: 1000, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.sleeps.push(ms);
    c.t += ms;
  };
  return c;
}

const filled = (n, v) => new Float32Array(n).fill(v);
const quiet = { warn: () => {}, debug: () => {} };

function feederWith(client, opts = {}) {
  const c = clock();
  const events = [];
  const feeder = createAudioFeeder({ client, lang: 'en', targetLang: 'zh', mediaStartS: 12.5, onEvent: (e) => events.push(e), logger: quiet, now: c.now, sleep: c.sleep, closeWaitMs: 200, ...opts });
  return { feeder, events, c };
}

describe('audio feeder', () => {
  it('opens a feed session, posts one-second chunks in order, pads the tail on stop and waits for closed', async () => {
    const client = fakeClient();
    const { feeder, events } = feederWith(client);
    // A ramp, so order and seams are visible in the posted samples.
    const ramp = Float32Array.from({ length: 2.5 * CHUNK }, (_, i) => i / 1e5);
    feeder.push(ramp.subarray(0, 7000));
    await feeder.start();
    feeder.push(ramp.subarray(7000, 27000));
    feeder.push(ramp.subarray(27000));
    await vi.waitFor(() => expect(client.calls.feed).toHaveLength(2));

    expect(client.calls.open).toEqual([{ mode: 'feed', lang: 'en', targetLang: 'zh', mediaStartS: 12.5 }]);
    expect(client.calls.feed.map((f) => [f.id, f.seq, f.pcm.length])).toEqual([['asr-1', 0, CHUNK], ['asr-1', 1, CHUNK]]);
    expect(client.calls.feed[1].pcm).toEqual(ramp.subarray(CHUNK, 2 * CHUNK));

    client.emit({ type: 'segment', id: 'g1', start: 12.5, end: 14, text: 'hi' });
    const stats = await feeder.stop();
    const last = client.calls.feed[2];
    expect(last.seq).toBe(2);
    expect(last.pcm.subarray(0, CHUNK / 2)).toEqual(ramp.subarray(2 * CHUNK));
    expect(last.pcm.subarray(CHUNK / 2).every((v) => v === 0)).toBe(true);
    expect(client.calls.close).toEqual(['asr-1']);
    expect(client.stopped).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['segment', 'closed']);
    expect(stats).toMatchObject({ state: 'closed', fedChunks: 3, fedS: 3, waits: 0, closed: true });
    expect(feeder.push(filled(10, 1))).toBe(false);
  });

  it('a 429 / not-ready reply waits as told and resends the same chunk with the same seq', async () => {
    const replies = [{ wait: 1000, reason: 'backpressure' }, { wait: 300, reason: 'not-ready' }];
    const client = fakeClient((n) => replies[n - 1] || { ok: true });
    const { feeder, c } = feederWith(client);
    await feeder.start();
    feeder.push(filled(CHUNK, 0.1));
    feeder.push(filled(CHUNK, 0.2));
    await vi.waitFor(() => expect(client.calls.feed).toHaveLength(4));
    expect(client.calls.feed.map((f) => [f.seq, f.pcm[0]])).toEqual([[0, 0.1], [0, 0.1], [0, 0.1], [1, 0.2]].map(([s, v]) => [s, Math.fround(v)]));
    expect(c.sleeps).toEqual([1000, 300]);
    expect(feeder.stats()).toMatchObject({ waits: 2, waitReasons: { backpressure: 1, 'not-ready': 1 } });
    await feeder.stop();
  });

  it('60 s of waiting with no final suspends; a final in between restarts the clock; resume() goes on', async () => {
    let wait = true;
    const client = fakeClient((n) => {
      if (n === 30) client.emit({ type: 'segment', id: 'g', start: 0, end: 1, text: 'x' });
      return wait ? { wait: 1000, reason: 'backpressure' } : { ok: true };
    });
    const { feeder, events } = feederWith(client);
    await feeder.start();
    feeder.push(filled(CHUNK, 0.5));
    await vi.waitFor(() => expect(events.some((e) => e.type === 'suspended')).toBe(true));
    // The final at the 30th try pushed the 60 s window out to the 90th.
    expect(client.calls.feed.length).toBe(90);
    expect(feeder.state).toBe('suspended');
    expect(events.filter((e) => e.type === 'suspended')).toHaveLength(1);

    wait = false;
    feeder.push(filled(CHUNK, 0.7));
    feeder.resume();
    await vi.waitFor(() => expect(feeder.stats().fedChunks).toBe(2));
    const tail = client.calls.feed.slice(-2).map((f) => [f.seq, f.pcm[0]]);
    expect(tail).toEqual([[0, 0.5], [1, Math.fround(0.7)]]);
    await feeder.stop();
  });

  it('keeps at most maxQueueS of audio waiting: the oldest goes, with a dropped event', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const client = fakeClient();
    const feed = client.feed;
    client.feed = async (...a) => {
      if (client.calls.feed.length === 0) {
        const r = feed(...a);
        await gate;
        return r;
      }
      return feed(...a);
    };
    const { feeder, events } = feederWith(client, { maxQueueS: 3 });
    await feeder.start();
    for (let k = 0; k < 6; k++) feeder.push(filled(CHUNK, k));
    expect(events.filter((e) => e.type === 'dropped').map((e) => e.seconds)).toEqual([1, 1]);
    release();
    await vi.waitFor(() => expect(client.calls.feed).toHaveLength(4));
    expect(client.calls.feed.map((f) => [f.seq, f.pcm[0]])).toEqual([[0, 0], [1, 3], [2, 4], [3, 5]]);
    expect(feeder.stats().droppedS).toBe(2);
    await feeder.stop();
  });

  it('a closed from the app (preempted) stops feeding; stop() then does not close again', async () => {
    const client = fakeClient();
    const { feeder, events } = feederWith(client);
    await feeder.start();
    client.emit({ type: 'closed', reason: 'preempted' });
    expect(feeder.push(filled(CHUNK, 1))).toBe(false);
    const stats = await feeder.stop();
    expect(client.calls.feed).toHaveLength(0);
    expect(client.calls.close).toHaveLength(0);
    expect(stats.closed).toBe(true);
    expect(events).toEqual([{ type: 'closed', reason: 'preempted' }]);
  });

  it('a feed error stops the pump with an error event; network failures are retried', async () => {
    const client = fakeClient((n) => {
      if (n === 1) throw new TypeError('Failed to fetch');
      throw Object.assign(new Error('bad-pcm'), { code: 'bad-pcm' });
    });
    const { feeder, events, c } = feederWith(client);
    await feeder.start();
    feeder.push(filled(CHUNK, 1));
    await vi.waitFor(() => expect(feeder.state).toBe('failed'));
    expect(c.sleeps).toEqual([1000]);
    expect(events).toEqual([{ type: 'error', code: 'bad-pcm' }]);
    await feeder.stop();
    expect(client.calls.close).toEqual(['asr-1']);
  });

  it('stop() before start() (stream closed while the previous one wound down): no session is opened', async () => {
    const client = fakeClient();
    const { feeder } = feederWith(client);
    feeder.push(filled(CHUNK, 1));
    expect((await feeder.stop()).state).toBe('closed');
    await expect(feeder.start()).rejects.toMatchObject({ code: 'stopped' });
    expect(client.calls.open).toHaveLength(0);
  });

  it('a failed open rejects start() and stop() still resolves', async () => {
    const client = fakeClient();
    client.openAsr = async () => {
      throw Object.assign(new Error('busy'), { code: 'busy' });
    };
    const { feeder } = feederWith(client);
    await expect(feeder.start()).rejects.toMatchObject({ code: 'busy' });
    expect(feeder.push(filled(10, 1))).toBe(false);
    expect((await feeder.stop()).state).toBe('closed');
  });
});
