// The companion client against a fake server: pairing scan, hello, token
// death, translate batching, feed replies and the NDJSON event stream with
// heartbeat, reconnect and 'closed'.

import { describe, it, expect } from 'vitest';
import { createCompanionClient, ClientError } from '../src/offscreen/companion-client.js';
import { PORT_BASE, portRange, createLineSplitter, backoffMs, batches } from '../src/shared/protocol.js';

const memStorage = () => {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, raw: m };
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const empty = (status, headers = {}) => new Response(null, { status, headers });
const refuse = () => { throw new TypeError('fetch failed'); };

// routes: { 'POST http://127.0.0.1:38424/v1/pair': (init, url) => Response }
function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    calls.push({ key, init });
    const route = routes[key] || routes[`${init.method || 'GET'} *`];
    if (!route) return refuse();
    return route(init, url);
  };
}

const stream = (lines) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const l of lines) controller.enqueue(new TextEncoder().encode(l));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'application/x-ndjson' } }
  );

describe('protocol helpers', () => {
  it('tries the preferred port first, then the whole range', () => {
    const r = portRange(38425);
    expect(r[0]).toBe(38425);
    expect(r).toHaveLength(10);
    expect(new Set(r).size).toBe(10);
    expect(portRange()[0]).toBe(PORT_BASE);
  });

  it('splits NDJSON across chunk boundaries', () => {
    const s = createLineSplitter();
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\n\n{}\n')).toEqual(['{"b":2}', '{}']);
    expect(s.flush()).toEqual([]);
  });

  it('backs off and batches', () => {
    expect([0, 1, 2, 5, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 30000, 30000]);
    expect(batches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe('pairing and hello', () => {
  it('scans the range, stores the pairing and reports ready', async () => {
    const storage = memStorage();
    const calls = [];
    const fetch = fakeFetch(
      {
        [`POST http://127.0.0.1:${PORT_BASE + 1}/v1/pair`]: () => json(200, { token: 'a'.repeat(64), port: PORT_BASE + 1, protocol: 1 }),
        [`GET http://127.0.0.1:${PORT_BASE + 1}/v1/hello`]: (init) =>
          init.headers.authorization === `Bearer ${'a'.repeat(64)}` && init.headers['x-tt-client'] === 't-caption/0.5.8'
            ? json(200, { app: 'T-Translate', version: '0.5.8', protocol: 1, privacyMode: 'standard', capabilities: { asr: true } })
            : json(401, { error: 'unauthorized' }),
      },
      calls
    );
    const states = [];
    const client = createCompanionClient({ version: '0.5.8', storage, fetch, onState: (s) => states.push(s.status) });
    const hello = await client.pair();
    expect(hello.app).toBe('T-Translate');
    expect(storage.raw.get('pairing')).toEqual({ port: PORT_BASE + 1, token: 'a'.repeat(64), protocol: 1 });
    expect(client.getState()).toMatchObject({ status: 'ready', port: PORT_BASE + 1, capabilities: { asr: true } });
    expect(calls[0].key).toBe(`POST http://127.0.0.1:${PORT_BASE}/v1/pair`);
    expect(states).toEqual(['offline', 'ready']);
  });

  it('a 401 drops the pairing', async () => {
    const storage = memStorage();
    await storage.set('pairing', { port: PORT_BASE, token: 'old', protocol: 1 });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch: fakeFetch({ 'GET *': () => json(401, { error: 'unauthorized' }) }) });
    await client.load();
    expect(client.getState().status).toBe('offline');
    await expect(client.hello()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(client.isPaired()).toBe(false);
    expect(storage.raw.get('pairing')).toBeNull();
  });

  it('a protocol mismatch is reported, not swallowed', async () => {
    const storage = memStorage();
    await storage.set('pairing', { port: PORT_BASE, token: 't', protocol: 1 });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch: fakeFetch({ 'GET *': () => json(200, { protocol: 2 }) }) });
    await client.load();
    await expect(client.hello()).rejects.toMatchObject({ code: 'protocol-mismatch' });
    expect(client.getState()).toMatchObject({ status: 'offline', protocol: 2, lastError: 'protocol-mismatch' });
  });

  it('connect finds the app on another port with the same token', async () => {
    const storage = memStorage();
    await storage.set('pairing', { port: PORT_BASE, token: 't', protocol: 1 });
    const fetch = fakeFetch({
      [`GET http://127.0.0.1:${PORT_BASE + 2}/v1/hello`]: () => json(200, { protocol: 1, app: 'T-Translate' }),
    });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch });
    await client.load();
    await client.connect();
    expect(client.getState()).toMatchObject({ status: 'ready', port: PORT_BASE + 2 });
    expect(storage.raw.get('pairing').port).toBe(PORT_BASE + 2);
  });
});

describe('translate and feed', () => {
  const paired = async () => {
    const storage = memStorage();
    await storage.set('pairing', { port: PORT_BASE, token: 't', protocol: 1 });
    return storage;
  };

  it('batches translate items by 50 and keeps order', async () => {
    const storage = await paired();
    const seen = [];
    const fetch = fakeFetch({
      [`POST http://127.0.0.1:${PORT_BASE}/v1/translate`]: (init) => {
        const b = JSON.parse(init.body);
        seen.push(b.items.length);
        expect(b.target).toBe('zh');
        return json(200, { items: b.items.map((it) => ({ id: it.id, text: `[译] ${it.text}` })) });
      },
    });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch });
    await client.load();
    const items = Array.from({ length: 120 }, (_, i) => ({ id: i, text: `s${i}` }));
    const out = await client.translate(items, { target: 'zh' });
    expect(seen).toEqual([50, 50, 20]);
    expect(out).toHaveLength(120);
    expect(out[119]).toEqual({ id: 119, text: '[译] s119' });
  });

  it('maps feed replies', async () => {
    const storage = await paired();
    let n = 0;
    const replies = [
      () => empty(204),
      () => json(429, { error: 'backpressure', retryAfterMs: 1000 }, { 'retry-after': '1' }),
      () => json(503, { error: 'not-ready' }),
      () => json(409, { error: 'stale-seq', expected: 4 }),
      () => json(404, { error: 'unknown-session' }),
    ];
    const fetch = fakeFetch({ [`POST http://127.0.0.1:${PORT_BASE}/v1/asr/feed`]: (init) => {
      expect(init.headers['x-session-id']).toBe('s1');
      expect(init.body.byteLength).toBe(16000 * 4);
      return replies[n++]();
    } });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch });
    await client.load();
    const pcm = new Float32Array(16000);
    expect(await client.feed('s1', pcm, 1)).toEqual({ ok: true });
    expect(await client.feed('s1', pcm, 2)).toEqual({ wait: 1000, reason: 'backpressure' });
    expect(await client.feed('s1', pcm, 3)).toEqual({ wait: 300, reason: 'not-ready' });
    expect(await client.feed('s1', pcm, 3)).toMatchObject({ ok: true, stale: true, expected: 4 });
    await expect(client.feed('s1', pcm, 5)).rejects.toBeInstanceOf(ClientError);
  });

  it('openAsr reports busy with the owner', async () => {
    const storage = await paired();
    const fetch = fakeFetch({ [`POST http://127.0.0.1:${PORT_BASE}/v1/asr/open`]: () => json(409, { error: 'busy', owner: 'window' }) });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch });
    await client.load();
    await expect(client.openAsr({ lang: 'en' })).rejects.toMatchObject({ code: 'busy', detail: 'window' });
  });

  it('seekAsr posts the id and the new start, resolves the cut, throws the server’s code', async () => {
    const storage = await paired();
    const bodies = [];
    const replies = [() => json(200, { atS: 41.25 }), () => json(503, { error: 'not-ready' }), () => json(404, { error: 'unknown-session' }), () => json(404, {})];
    const fetch = fakeFetch({ [`POST http://127.0.0.1:${PORT_BASE}/v1/asr/seek`]: (init) => (bodies.push(JSON.parse(init.body)), replies[bodies.length - 1]()) });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch });
    await client.load();
    expect(await client.seekAsr('s1', { mediaStartS: 95.5 })).toEqual({ atS: 41.25 });
    expect(bodies[0]).toEqual({ id: 's1', mediaStartS: 95.5 });
    await expect(client.seekAsr('s1', { mediaStartS: 1 })).rejects.toMatchObject({ code: 'not-ready', status: 503 });
    await expect(client.seekAsr('s1', { mediaStartS: 1 })).rejects.toMatchObject({ code: 'unknown-session', status: 404 });
    await expect(client.seekAsr('s1', { mediaStartS: 1 })).rejects.toMatchObject({ code: 'seek-failed', status: 404 });
  });
});

describe('event stream', () => {
  it('delivers events, skips heartbeats, reconnects after a cut and stops at closed', async () => {
    const storage = memStorage();
    await storage.set('pairing', { port: PORT_BASE, token: 't', protocol: 1 });
    let opened = 0;
    const fetch = fakeFetch({
      [`GET http://127.0.0.1:${PORT_BASE}/v1/asr/events?id=s1`]: () => {
        opened += 1;
        if (opened === 1) return stream(['{"type":"status","state":"listening"}\n{}\n{"type":"segment","id":1,"start":1.5,"end":2.5,"te', 'xt":"hi"}\n']);
        return stream(['{"type":"translation","id":1,"text":"嗨","done":true}\n', '{"type":"closed","reason":"closed"}\n']);
      },
    });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch, reconnectDelay: () => 0, streamSilenceMs: 5000 });
    await client.load();
    const events = [];
    const done = new Promise((resolve) => {
      client.subscribe('s1', (evt) => {
        events.push(evt);
        if (evt.type === 'closed') resolve();
      });
    });
    await done;
    expect(opened).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['status', 'segment', 'translation', 'closed']);
    expect(events[1]).toMatchObject({ id: 1, start: 1.5, text: 'hi' });
  });

  it('a silent stream is dropped and reopened', async () => {
    const storage = memStorage();
    await storage.set('pairing', { port: PORT_BASE, token: 't', protocol: 1 });
    let opened = 0;
    const fetch = fakeFetch({
      'GET *': () => {
        opened += 1;
        if (opened === 1) return new Response(new ReadableStream({ start() {} }), { status: 200 }); // never writes
        return stream(['{"type":"closed","reason":"closed"}\n']);
      },
    });
    const client = createCompanionClient({ version: '0.5.8', storage, fetch, reconnectDelay: () => 0, streamSilenceMs: 50 });
    await client.load();
    const reason = await new Promise((resolve) => client.subscribe('s1', (evt) => evt.type === 'closed' && resolve(evt.reason)));
    expect(reason).toBe('closed');
    expect(opened).toBe(2);
  });
});
