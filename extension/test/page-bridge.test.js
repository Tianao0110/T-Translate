// @vitest-environment node
// (real MessageChannel ports and ArrayBuffer transfer.)
//
// The page-world ⇄ isolated-world bridge over a fake window that dispatches
// like a browser (async, capture listeners first, stopImmediatePropagation):
// events wait in bounded buffers until the hello, then flush in order; only
// the first hello gets the port and later page listeners never see it;
// messages without the nonce or of the wrong shape are dropped; commands get
// their replies.

import { describe, it, expect, afterEach } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import vm from 'node:vm';
import { createOutbox, acceptHello } from '../src/content/hooks/outbox.js';
import { createBridge } from '../src/content/bridge.js';
import { LIMITS, sanitizeMainEvent } from '../src/content/bridge-protocol.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const opened = [];

function makeChannel() {
  const ch = new MessageChannel();
  ch.port1.unref?.();
  ch.port2.unref?.();
  opened.push(ch.port1, ch.port2);
  return ch;
}

afterEach(() => {
  for (const p of opened.splice(0)) p.close();
});

function fakeWindow() {
  const listeners = [];
  const win = {
    addEventListener(type, fn, capture = false) {
      if (type === 'message') listeners.push({ fn, capture: !!capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex((l) => l.fn === fn && l.capture === !!capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(data, _origin, transfer = []) {
      setTimeout(() => {
        let stopped = false;
        const e = { data: structuredClone(data), source: win, ports: transfer, stopImmediatePropagation: () => (stopped = true) };
        for (const l of [...listeners.filter((x) => x.capture), ...listeners.filter((x) => !x.capture)]) {
          if (stopped) break;
          l.fn(e);
        }
      }, 0);
    },
  };
  return win;
}

const chunk = (seq, size, init = false) => ({ k: 'mse-chunk', sbId: 1, seq, init, size, bytes: new Uint8Array(size).fill(seq & 0xff).buffer });

function isolatedSide(win, opts = {}) {
  const got = [];
  const bridge = createBridge({ win, onEvent: (e) => got.push(e), makeChannel, retryMs: opts.retryMs ?? [], ...opts });
  return { bridge, got };
}

describe('handshake and buffering', () => {
  it('holds events until the hello, then flushes them in order with the nonce', async () => {
    const win = fakeWindow();
    const outbox = createOutbox();
    acceptHello(win, outbox, () => null);
    outbox.push({ k: 'hooks', status: { fetch: 'ok', xhr: 'ok', mse: 'ok', objectUrl: 'ok', eme: 'ok' } });
    outbox.push({ k: 'mse-buffer', sbId: 1, msId: 1, mime: 'audio/webm; codecs="opus"' });
    outbox.push(chunk(0, 100, true));
    outbox.push(chunk(1, 50));
    outbox.push({ k: 'subtitle', via: 'fetch', url: 'https://www.youtube.com/api/timedtext?v=x', status: 200, contentType: 'application/json', text: '{"events":[]}' });
    expect(outbox.connected).toBe(false);
    expect(outbox.held()).toMatchObject({ queued: 5, init: 1, chunk: 1, ringBytes: 50 });

    const { bridge, got } = isolatedSide(win);
    await tick(20);
    expect(bridge.connected).toBe(true);
    expect(got.map((e) => e.k)).toEqual(['hooks', 'mse-buffer', 'mse-chunk', 'mse-chunk', 'subtitle']);
    expect(got[2]).toMatchObject({ init: true, size: 100 });
    expect(new Uint8Array(got[3].bytes)).toEqual(new Uint8Array(50).fill(1));

    outbox.push(chunk(2, 10));
    await tick();
    expect(got.at(-1)).toMatchObject({ k: 'mse-chunk', seq: 2, size: 10 });
    bridge.close();
  });

  it('bounds what waits: oldest chunks and subtitles out, every init kept, the drop reported', async () => {
    const win = fakeWindow();
    const limits = { ...LIMITS, ringBytes: 1000, subtitleQueue: 2, eventQueue: 3 };
    const outbox = createOutbox({ limits });
    acceptHello(win, outbox, () => null);
    outbox.push(chunk(0, 10, true));
    for (let i = 1; i <= 12; i++) outbox.push(chunk(i, 200));
    outbox.push(chunk(13, 10, true));
    for (let i = 0; i < 4; i++) outbox.push({ k: 'subtitle', via: 'xhr', url: `https://e.x/${i}.vtt`, status: 200, contentType: 'text/vtt', text: 'WEBVTT' });
    for (let i = 1; i <= 5; i++) outbox.push({ k: 'mse-closed', msId: i });
    expect(outbox.held()).toMatchObject({ ringBytes: 1000, init: 2, subtitle: 2, event: 3 });
    expect(outbox.dropped()).toEqual({ chunks: 7, bytes: 1400, subtitles: 2, events: 2 });

    const { got } = isolatedSide(win);
    await tick(20);
    expect(got[0]).toEqual({ k: 'dropped', chunks: 7, bytes: 1400, subtitles: 2, events: 2 });
    const seqs = got.filter((e) => e.k === 'mse-chunk').map((e) => e.seq);
    expect(seqs).toEqual([0, 8, 9, 10, 11, 12, 13]);
    expect(got.filter((e) => e.k === 'subtitle').map((e) => e.url)).toEqual(['https://e.x/2.vtt', 'https://e.x/3.vtt']);
    expect(got.filter((e) => e.k === 'mse-closed').map((e) => e.msId)).toEqual([3, 4, 5]);
  });

  it('the first hello wins and is hidden from the page; a later one gets nothing', async () => {
    const win = fakeWindow();
    const outbox = createOutbox();
    acceptHello(win, outbox, () => null);
    const seenByPage = [];
    win.addEventListener('message', (e) => seenByPage.push(e.data));
    const { bridge, got } = isolatedSide(win);
    await tick(20);
    expect(bridge.connected).toBe(true);
    expect(seenByPage).toEqual([]);

    const spoof = makeChannel();
    const spoofGot = [];
    spoof.port1.on('message', (d) => spoofGot.push(d));
    win.postMessage({ tc: 'hello', nonce: 'evil' }, '*', [spoof.port2]);
    await tick(20);
    expect(seenByPage).toEqual([{ tc: 'hello', nonce: 'evil' }]);
    outbox.push({ k: 'mse-closed', msId: 9 });
    await tick();
    expect(spoofGot).toEqual([]);
    expect(got).toEqual([{ k: 'mse-closed', msId: 9 }]);
  });

  it('retries the hello when the page world was not listening yet', async () => {
    const win = fakeWindow();
    const { bridge } = isolatedSide(win, { retryMs: [300] });
    await tick(10);
    const outbox = createOutbox();
    acceptHello(win, outbox, () => null);
    await tick(10);
    expect(bridge.connected).toBe(false);
    await tick(400);
    expect(bridge.connected).toBe(true);
    bridge.close();
  });
});

describe('what the isolated world accepts', () => {
  it('drops messages without the nonce and malformed or oversized events', async () => {
    const win = fakeWindow();
    let port = null;
    win.addEventListener('message', (e) => {
      port = e.ports[0];
    }, true);
    const { bridge, got } = isolatedSide(win, { nonce: () => 'n1' });
    await tick(10);
    port.postMessage({ tc: 'ev', nonce: 'n1', ev: { k: 'welcome' } });
    port.postMessage({ tc: 'ev', nonce: 'other', ev: { k: 'mse-closed', msId: 1 } });
    port.postMessage({ tc: 'ev', nonce: 'n1', ev: { k: 'mse-closed', msId: -1 } });
    port.postMessage({ tc: 'ev', nonce: 'n1', ev: { k: 'subtitle', url: 'https://x/a.vtt', text: 'x'.repeat(LIMITS.subtitleBytes + 1) } });
    port.postMessage({ tc: 'ev', nonce: 'n1', ev: { k: 'mse-chunk', sbId: 1, seq: 0, size: 3, bytes: new ArrayBuffer(4) } });
    port.postMessage({ tc: 'ev', nonce: 'n1', ev: { k: 'eval', code: 'alert(1)' } });
    port.postMessage({ tc: 'ev', nonce: 'n1', ev: { k: 'mse-buffer', sbId: 2, msId: 1, mime: 'audio/webm', extra: { deep: 1 } } });
    await tick(20);
    expect(bridge.connected).toBe(true);
    expect(got).toEqual([{ k: 'mse-buffer', sbId: 2, msId: 1, mime: 'audio/webm' }]);
    expect(bridge.rejected).toBe(4);
    bridge.close();
  });

  it('sanitizer keeps known fields and fixes hook states', () => {
    expect(sanitizeMainEvent({ k: 'hooks', status: { fetch: 'ok', xhr: 'weird' } })).toEqual({ k: 'hooks', status: { fetch: 'ok', xhr: 'failed', mse: 'failed', objectUrl: 'failed', eme: 'failed' } });
    expect(sanitizeMainEvent({ k: 'mse-source', msId: 1, url: 'https://not-a-blob' })).toBeNull();
    expect(sanitizeMainEvent({ k: 'eme', via: 'request', keySystem: 'com.widevine.alpha', junk: 1 })).toEqual({ k: 'eme', via: 'request', keySystem: 'com.widevine.alpha' });
    expect(sanitizeMainEvent({ k: 'mse-op', sbId: 1, op: 'remove', start: 0, end: Infinity })).toEqual({ k: 'mse-op', sbId: 1, op: 'remove', start: 0 });
    expect(sanitizeMainEvent(null)).toBeNull();
  });

  it('an ArrayBuffer from another realm (Firefox: the page’s compartment) is copied into ours; size limits still hold', () => {
    const foreign = vm.runInNewContext('new Uint8Array([7, 8, 9]).buffer');
    expect(foreign instanceof ArrayBuffer).toBe(false);
    const ev = sanitizeMainEvent({ k: 'mse-chunk', sbId: 1, seq: 0, size: 3, bytes: foreign });
    expect(ev.bytes instanceof ArrayBuffer).toBe(true);
    expect([...new Uint8Array(ev.bytes)]).toEqual([7, 8, 9]);
    expect(sanitizeMainEvent({ k: 'mse-chunk', sbId: 1, seq: 0, size: 4, bytes: foreign })).toBeNull();
    // Not a buffer at all: the chunk is still counted, without bytes.
    expect(sanitizeMainEvent({ k: 'mse-chunk', sbId: 1, seq: 0, size: 3, bytes: { [Symbol.toStringTag]: 'ArrayBuffer', byteLength: 3 } })).toMatchObject({ k: 'mse-chunk', size: 3, bytes: null });
  });
});

describe('commands', () => {
  it('run in the page world and resolve or reject with its answer', async () => {
    const win = fakeWindow();
    const outbox = createOutbox();
    acceptHello(win, outbox, async (cmd, args) => {
      if (cmd === 'yt-reload') return { videoId: 'UF8uR6Z6KLc', at: args.at };
      throw Object.assign(new Error('x'), { code: 'no-player' });
    });
    const { bridge } = isolatedSide(win);
    await tick(20);
    await expect(bridge.command('yt-reload', { at: 3 })).resolves.toEqual({ videoId: 'UF8uR6Z6KLc', at: 3 });
    await expect(bridge.command('yt-captions-on')).rejects.toMatchObject({ code: 'no-player' });
    bridge.close();
  });

  it('before the handshake, or with no answer, they fail with a code', async () => {
    const win = fakeWindow();
    const { bridge } = isolatedSide(win);
    await expect(bridge.command('yt-reload')).rejects.toMatchObject({ code: 'no-page-world' });
    let port = null;
    const w2 = fakeWindow();
    w2.addEventListener('message', (e) => (port = e.ports[0]), true);
    const b2 = createBridge({ win: w2, onEvent: () => {}, makeChannel, retryMs: [], nonce: () => 'n' });
    await tick(10);
    port.postMessage({ tc: 'ev', nonce: 'n', ev: { k: 'welcome' } });
    await tick(10);
    await expect(b2.command('yt-reload', {}, 30)).rejects.toMatchObject({ code: 'page-world-timeout' });
    bridge.close();
    b2.close();
  });
});
