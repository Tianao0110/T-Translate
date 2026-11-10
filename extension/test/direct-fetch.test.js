// @vitest-environment node
//
// The direct fetcher over a fake range server and a fake offscreen: the head
// probe, the moov from the head or the tail, the stream opened as 'direct'
// with the moov bytes and then the audio bytes at their offsets, from fromS,
// at most aheadS past the reported playhead, video gaps skipped; 416 / 403 /
// 200 / network errors as fetch-failed; the permission check; close aborts
// the request in flight; a new open stops the last.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createDirectFetch, hostPattern } from '../src/sw/direct-fetch.js';
import { MSG, decodeBytes } from '../src/shared/messages.js';
import { parseMoov, offsetAt } from '../src/shared/mp4-table.js';
import { handBuilt } from './lib/progressive-mp4.js';

const read = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const FAST = read('tone-2s-faststart.mp4');
const LAST = read('tone-2s-moov-last.mp4');
const URL_ = 'https://cdn.example/v/clip.mp4?sig=1';
const FRAME_S = 1024 / 48000;

const idle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

function response(status, body = new Uint8Array(0), contentRange = null) {
  return {
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-range' ? contentRange : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    body: { cancel: async () => {} },
  };
}

// Serves file by range; srv.hook(start, init) may answer instead (a response, or a promise).
function rangeServer(file) {
  const srv = {
    requests: [],
    hook: null,
    fetchFn: vi.fn(async (url, init) => {
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      const start = Number(a);
      const end = Math.min(Number(b), file.length - 1);
      srv.requests.push({ url, start, end: Number(b) + 1, credentials: init.credentials, redirect: init.redirect });
      if (init.signal?.aborted) throw abortError();
      const hooked = srv.hook?.(start, init);
      if (hooked) return hooked;
      if (start >= file.length) return response(416);
      return response(206, file.slice(start, end + 1), `bytes ${start}-${end}/${file.length}`);
    }),
  };
  return srv;
}

let off;
let events;
let allowed;
const permissions = { contains: vi.fn(async () => allowed) };

beforeEach(() => {
  allowed = true;
  events = [];
  off = {
    calls: [],
    ended: false,
    async call(type, payload) {
      off.calls.push({ type, ...payload, ...(payload.bytes !== undefined && { bytes: decodeBytes(payload.bytes) }) });
      if (type === MSG.MEDIA_OPEN) return { key: payload.key };
      if (type === MSG.MEDIA_PUSH) return { ended: off.ended };
      if (type === MSG.MEDIA_CLOSE) return { source: 'direct', blocks: 9 };
      return null;
    },
  };
});

function make(file, opts = {}) {
  const srv = rangeServer(file);
  const d = createDirectFetch({ fetchFn: srv.fetchFn, toOffscreen: (t, p) => off.call(t, p), permissions, onEvent: (e) => events.push(e), now: () => 5, logger: { warn: () => {} }, ...opts });
  return { srv, d };
}

const pushes = () => off.calls.filter((c) => c.type === MSG.MEDIA_PUSH);
// The pushed bytes, at their offsets, are the file's.
function expectFileBytes(file) {
  for (const p of pushes()) expect(p.bytes).toEqual(file.subarray(p.offset, p.offset + p.bytes.length));
}

describe('direct fetch', () => {
  it('faststart: probes the head, opens a direct stream with ftyp + moov, then fetches the audio to the end', async () => {
    const { srv, d } = make(FAST, { headBytes: 4096 });
    const r = await d.open({ key: 'k1', url: URL_, lang: 'en', targetLang: 'zh' });
    expect(r).toMatchObject({ key: 'k1', fromS: 0, startS: 0, moovAt: 'head', codec: 'mp4a.40.2', samples: 95 });
    expect(r.durationS).toBeCloseTo(2.0213, 3);
    expect(permissions.contains).toHaveBeenCalledWith({ origins: ['https://cdn.example/*'] });
    await idle();
    expect(srv.requests.map((q) => [q.start, q.end])).toEqual([
      [0, 4096],
      [1170, FAST.length],
    ]);
    expect(srv.requests.every((q) => q.url === URL_ && q.credentials === 'include' && q.redirect === 'follow')).toBe(true);
    expect(off.calls[0]).toEqual({ type: MSG.MEDIA_OPEN, key: 'k1', lang: 'en', targetLang: 'zh', source: 'direct' });
    expect(pushes().map((p) => [p.offset, p.bytes.length])).toEqual([
      [0, 1154],
      [1170, FAST.length - 1170],
    ]);
    expectFileBytes(FAST);
    expect(events).toEqual([{ key: 'k1', event: { type: 'status', state: 'fetch-end' } }]);
    expect(d.stats('k1')).toMatchObject({ requests: 2, bytes: 4096 + FAST.length - 1170, done: true, moovAt: 'head', error: null });
  });

  it('moov at the end: the tail from where mdat ends, the moov pushed first, then mdat from its first sample', async () => {
    const { srv, d } = make(LAST, { headBytes: 4096 });
    expect(await d.open({ key: 'k', url: URL_ })).toMatchObject({ moovAt: 'tail', samples: 95 });
    await idle();
    expect(srv.requests.map((q) => [q.start, q.end])).toEqual([
      [0, 4096],
      [16433, LAST.length], // clipped to the file's size from Content-Range
      [44, 16433],
    ]);
    expect(pushes().map((p) => p.offset)).toEqual([16433, 44]);
    expect(pushes()[0].bytes.length).toBe(LAST.length - 16433);
    expectFileBytes(LAST);
  });

  it('a moov larger than the head: the rest fetched before the stream opens', async () => {
    const { srv, d } = make(FAST, { headBytes: 600 });
    await d.open({ key: 'k', url: URL_ });
    expect(srv.requests.slice(0, 2).map((q) => [q.start, q.end])).toEqual([
      [0, 600],
      [600, 1154],
    ]);
    expect(pushes()[0]).toMatchObject({ offset: 0 });
    expect(pushes()[0].bytes).toEqual(FAST.subarray(0, 1154));
  });

  it('from fromS: the first audio range starts at that sample; chunkBytes caps each request', async () => {
    const { srv, d } = make(FAST, { chunkBytes: 3000 });
    const from = offsetAt(parseMoov(FAST), 1);
    expect((await d.open({ key: 'k', url: URL_, fromS: 1 })).startS).toBeCloseTo(47 * FRAME_S, 9);
    await idle();
    const data = srv.requests.slice(1);
    expect(data[0].start).toBe(from);
    for (let i = 1; i < data.length; i++) expect(data[i].start).toBe(data[i - 1].end);
    expect(data.every((q) => q.end - q.start <= 3000)).toBe(true);
    expect(data.at(-1).end).toBe(FAST.length);
    expectFileBytes(FAST);
  });

  it('stays at most aheadS past the playhead; position() lets it go on; refills only once the lead is short', async () => {
    const { srv, d } = make(FAST, { aheadS: 0.5 });
    await d.open({ key: 'k', url: URL_ });
    await idle();
    let s = d.stats('k');
    expect(s.fetchedToS).toBeGreaterThanOrEqual(0.5);
    expect(s.aheadS).toBeLessThanOrEqual(0.5 + FRAME_S);
    const n = srv.requests.length;
    // lead 0.5 - 0.3 is short by more than the refill margin (0.125 s here)
    d.position('k', 0.3);
    await idle();
    s = d.stats('k');
    expect(srv.requests.length).toBe(n + 1);
    expect(s.fetchedToS).toBeGreaterThanOrEqual(0.8);
    expect(s.aheadS).toBeLessThanOrEqual(0.5 + FRAME_S);
    // a nudge inside the margin fetches nothing
    d.position('k', 0.35);
    await idle();
    expect(srv.requests.length).toBe(n + 1);
    d.position('k', 1.9);
    await idle();
    s = d.stats('k');
    expect(s).toMatchObject({ done: true, playS: 1.9 });
    expect(s.maxAheadS).toBeLessThanOrEqual(0.5 + FRAME_S);
    expect(events.at(-1).event).toEqual({ type: 'status', state: 'fetch-end' });
    expectFileBytes(FAST);
  });

  it('video bytes between audio chunks: a gap over gapBytes is skipped, a small one fetched through', async () => {
    const { file, c1, c2 } = handBuilt({ gap: 100 });
    const a = make(file, { gapBytes: 50 });
    await a.d.open({ key: 'a', url: URL_ });
    await idle();
    // head, the moov from the tail, then the audio
    expect(a.srv.requests.slice(2).map((q) => [q.start, q.end])).toEqual([
      [c1, c1 + 33],
      [c2, c2 + 27],
    ]);
    expectFileBytes(file);
    off.calls = [];
    const b = make(file, { gapBytes: 200 });
    await b.d.open({ key: 'b', url: URL_ });
    await idle();
    expect(b.srv.requests.slice(2).map((q) => [q.start, q.end])).toEqual([[c1, c2 + 27]]);
  });

  it('a failing range after open: fetch-failed with the status, fetching stops, the stream stays open', async () => {
    for (const [status, hook] of [
      [416, () => response(416)],
      [403, () => response(403)],
      [200, () => response(200, FAST, null)],
      [0, () => Promise.reject(new TypeError('Failed to fetch'))],
    ]) {
      events = [];
      off.calls = [];
      const { srv, d } = make(FAST, { chunkBytes: 4000 });
      srv.hook = (start) => (start >= 5000 ? hook() : null);
      await d.open({ key: `k${status}`, url: URL_ });
      await idle();
      expect(events, String(status)).toEqual([{ key: `k${status}`, event: { type: 'error', code: 'fetch-failed', status } }]);
      expect(d.stats(`k${status}`)).toMatchObject({ done: false, reason: 'fetch-failed', error: { code: 'fetch-failed', status } });
      expect(off.calls.some((c) => c.type === MSG.MEDIA_CLOSE)).toBe(false);
      expect(d.current()).toBe(`k${status}`);
    }
  });

  it('open fails on the head or the moov: the code, no stream left open', async () => {
    const forbidden = make(FAST);
    forbidden.srv.hook = () => response(403);
    await expect(forbidden.d.open({ key: 'a', url: URL_ })).rejects.toMatchObject({ code: 'fetch-failed', message: 'HTTP 403' });
    expect(off.calls).toEqual([]);
    expect(forbidden.d.current()).toBe(null);

    const junk = make(new Uint8Array(4096));
    await expect(junk.d.open({ key: 'b', url: URL_ })).rejects.toMatchObject({ code: 'no-moov' });
    // mdat says it runs past the end of the file
    await expect(make(handBuilt().file.slice(0, 150)).d.open({ key: 'c', url: URL_ })).rejects.toMatchObject({ code: 'no-moov' });
    const offline = make(FAST);
    off.call = async (type) => {
      if (type === MSG.MEDIA_OPEN) throw Object.assign(new Error('offline'), { code: 'offline' });
      return null;
    };
    await expect(offline.d.open({ key: 'd', url: URL_ })).rejects.toMatchObject({ code: 'offline' });
  });

  it('permission and URL checks before any request', async () => {
    allowed = false;
    const { srv, d } = make(FAST);
    await expect(d.open({ key: 'k', url: 'http://media.example:8080/a.mp4' })).rejects.toMatchObject({ code: 'no-permission', message: 'http://media.example/*' });
    allowed = true;
    await expect(d.open({ key: 'k', url: 'blob:https://x.example/1' })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(d.open({ key: 'k', url: 'nonsense' })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(d.open({ key: '', url: URL_ })).rejects.toMatchObject({ code: 'bad-request' });
    expect(srv.requests).toEqual([]);
    expect(hostPattern('https://[::1]:9000/x.mp4')).toBe('https://[::1]/*');
  });

  it('close aborts the request in flight, closes the stream, resolves its stats with the fetch counters', async () => {
    const { srv, d } = make(FAST);
    let aborted = false;
    srv.hook = (start, init) =>
      start > 1000
        ? new Promise((_, reject) =>
            init.signal.addEventListener('abort', () => {
              aborted = true;
              reject(abortError());
            })
          )
        : null;
    await d.open({ key: 'k', url: URL_ });
    await idle();
    expect(srv.requests).toHaveLength(2);
    const r = await d.close({ key: 'k' });
    expect(aborted).toBe(true);
    expect(r).toMatchObject({ source: 'direct', blocks: 9, fetch: { requests: 2, reason: 'closed', done: false, error: null } });
    expect(off.calls.at(-1)).toEqual({ type: MSG.MEDIA_CLOSE, key: 'k' });
    expect(events).toEqual([]);
    expect(d.current()).toBe(null);
    await expect(d.close({ key: 'k' })).resolves.toBe(r);
    expect(await d.close({ key: 'nope' })).toBe(null);
    expect(d.position('k', 1)).toBe(null);
  });

  it('a new open stops the last one’s fetching; the pipeline saying ended stops it too', async () => {
    const { srv, d } = make(FAST, { aheadS: 0.5 });
    await d.open({ key: 'a', url: URL_ });
    await idle();
    await d.open({ key: 'b', url: URL_ });
    expect(d.current()).toBe('b');
    expect(d.stats('a')).toMatchObject({ reason: 'replaced' });
    const before = srv.requests.length;
    d.position('a', 1.5);
    await idle();
    expect(srv.requests.length).toBe(before);

    off.ended = true;
    d.position('b', 1.5);
    await idle();
    expect(d.stats('b')).toMatchObject({ reason: 'pipeline-ended', done: false });
    const n = srv.requests.length;
    d.position('b', 1.9);
    await idle();
    expect(srv.requests.length).toBe(n);
  });
});
