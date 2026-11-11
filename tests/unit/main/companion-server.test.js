// @vitest-environment node
// Companion server on an ephemeral port with a fake session and a fake
// translateStream: the three gates, CORS for extensions only, pairing, the
// routes and their error codes, the NDJSON event stream, port fallback.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createCompanionServer } = require('../../../electron/companion/server.js');

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const EXT = `chrome-extension://${'abcdefghijklmnop'.repeat(2)}`;
const CLIENT = { 'x-tt-client': 't-caption/0.1.0' };
const SID = 'sess-1';

function memStore(seed = {}) {
  const data = { ...seed };
  return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => (data[k] = v), data };
}

function fakeSession() {
  const listeners = new Set();
  const s = {
    openResult: { id: SID },
    feedResult: { ok: true },
    backlog: [],
    opened: [],
    fed: [],
    closed: [],
    listeners,
    open: (opts) => {
      s.opened.push(opts);
      return s.openResult;
    },
    feed: (id, samples) => {
      s.fed.push({ id, samples });
      return id === SID ? s.feedResult : { error: 'unknown-session' };
    },
    close: (id) => {
      s.closed.push(id);
      return id === SID ? { ok: true } : { error: 'unknown-session' };
    },
    seekResult: { ok: true, atS: 12.34 },
    seeks: [],
    seek: async (id, opts) => {
      s.seeks.push({ id, ...opts });
      return id === SID ? s.seekResult : { error: 'unknown-session' };
    },
    closeActive() {},
    has: (id) => id === SID,
    subscribe: (id, fn) => {
      listeners.add(fn);
      for (const e of s.backlog) fn(e);
      return () => listeners.delete(fn);
    },
    emit: (evt) => [...listeners].forEach((fn) => fn(evt)),
    status: () => ({ active: false }),
  };
  return s;
}

function request(port, { method = 'GET', path = '/v1/hello', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

let clock;
let store;
let session;
let translateCalls;
let server;
let port;
let token;
const auth = () => ({ ...CLIENT, authorization: `Bearer ${token}` });
const post = (path, json, headers = auth()) => request(port, { method: 'POST', path, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(json) });

async function boot(opts = {}) {
  server = createCompanionServer({
    store,
    session,
    logger,
    version: '9.9.9',
    getPrivacyMode: () => 'offline',
    modelsPresent: () => true,
    now: () => clock,
    portBase: 0,
    heartbeatMs: 20,
    translateStream: async (text, options) => {
      translateCalls.push({ text, options });
      await new Promise((r) => setTimeout(r, 5));
      return text === 'FAIL' ? { success: false, error: 'x' } : { success: true, text: `[${options.targetLang}] ${text}` };
    },
    ...opts,
  });
  port = await server.start();
  token = store.get('companion.token');
}

beforeEach(async () => {
  clock = 1_000_000;
  store = memStore();
  session = fakeSession();
  translateCalls = [];
  await boot();
});

afterEach(async () => {
  await server.stop();
});

describe('gates', () => {
  it('no or wrong client header: 403 unknown-client', async () => {
    for (const headers of [{ authorization: `Bearer ${token}` }, { 'x-tt-client': 'curl/8.0', authorization: `Bearer ${token}` }]) {
      const r = await request(port, { headers });
      expect([r.status, r.json]).toEqual([403, { error: 'unknown-client' }]);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('web page and null origins: 403 with no CORS headers', async () => {
    for (const origin of ['https://www.youtube.com', 'null']) {
      const r = await request(port, { headers: { ...auth(), origin } });
      expect([r.status, r.json]).toEqual([403, { error: 'origin' }]);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('missing or wrong token: 401', async () => {
    expect((await request(port, { headers: CLIENT })).status).toBe(401);
    const r = await request(port, { headers: { ...CLIENT, authorization: `Bearer ${'0'.repeat(64)}` } });
    expect([r.status, r.json]).toEqual([401, { error: 'unauthorized' }]);
  });

  it('extension preflight: 204 with the private-network grant', async () => {
    const r = await request(port, { method: 'OPTIONS', path: '/v1/asr/feed', headers: { origin: EXT, 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe(EXT);
    expect(r.headers['access-control-allow-private-network']).toBe('true');
    expect(r.headers['access-control-allow-headers']).toContain('x-tt-client');
    expect(r.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    expect(r.headers.vary).toBe('Origin');
  });

  it('preflight from anything else: 403, no CORS headers', async () => {
    for (const headers of [{ origin: 'https://example.com' }, {}]) {
      const r = await request(port, { method: 'OPTIONS', path: '/v1/hello', headers });
      expect(r.status).toBe(403);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      expect(r.headers['access-control-allow-private-network']).toBeUndefined();
    }
  });

  it('extension requests get their origin echoed', async () => {
    const r = await request(port, { headers: { ...auth(), origin: EXT } });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(EXT);
    expect(r.headers.vary).toBe('Origin');
  });

  it('unknown route: 404 not-found', async () => {
    const r = await request(port, { path: '/v1/nope', headers: auth() });
    expect([r.status, r.json]).toEqual([404, { error: 'not-found' }]);
  });
});

describe('hello and token', () => {
  it('hello reports app, protocol, privacy and capabilities', async () => {
    const r = await request(port, { headers: auth() });
    expect(r.json).toEqual({ app: 'T-Translate', version: '9.9.9', protocol: 1, privacyMode: 'offline', capabilities: { asr: true, translate: true, listen: true, seek: true } });
  });

  it('the token lives in companion.token and survives a restart', async () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(store.data)).toEqual(['companion.token']);
    await server.stop();
    await boot();
    expect(store.get('companion.token')).toBe(token);
  });

  it('regenerating the token locks the old one out', async () => {
    const old = token;
    server.regenerateToken();
    const fresh = store.get('companion.token');
    expect(fresh).not.toBe(old);
    expect((await request(port, { headers: { ...CLIENT, authorization: `Bearer ${old}` } })).status).toBe(401);
    expect((await request(port, { headers: { ...CLIENT, authorization: `Bearer ${fresh}` } })).status).toBe(200);
  });
});

describe('pairing', () => {
  it('closed by default, one-shot when open', async () => {
    const closed = await request(port, { method: 'POST', path: '/v1/pair', headers: CLIENT });
    expect([closed.status, closed.json]).toEqual([403, { error: 'pairing-closed' }]);
    server.openPairing();
    expect(server.pairingOpen()).toBe(true);
    const ok = await request(port, { method: 'POST', path: '/v1/pair', headers: { ...CLIENT, origin: EXT } });
    expect([ok.status, ok.json]).toEqual([200, { token, port, protocol: 1 }]);
    expect(server.pairingOpen()).toBe(false);
    expect((await request(port, { method: 'POST', path: '/v1/pair', headers: CLIENT })).status).toBe(403);
  });

  it('the window shuts after a minute', async () => {
    server.openPairing();
    clock += 60_001;
    expect(server.pairingOpen()).toBe(false);
    expect((await request(port, { method: 'POST', path: '/v1/pair', headers: CLIENT })).status).toBe(403);
  });

  it('pairing still needs the client header and a clean origin', async () => {
    server.openPairing();
    expect((await request(port, { method: 'POST', path: '/v1/pair', headers: {} })).status).toBe(403);
    expect((await request(port, { method: 'POST', path: '/v1/pair', headers: { ...CLIENT, origin: 'https://evil.example' } })).status).toBe(403);
    expect(server.pairingOpen()).toBe(true);
  });
});

describe('asr sessions', () => {
  it('open passes the body through and returns the id', async () => {
    const r = await post('/v1/asr/open', { mode: 'feed', lang: 'en', targetLang: 'zh', mediaStartS: 100 });
    expect([r.status, r.json]).toEqual([200, { id: SID }]);
    expect(session.opened[0]).toEqual({ mode: 'feed', lang: 'en', targetLang: 'zh', mediaStartS: 100 });
  });

  it('open maps busy / no-model / bad-request', async () => {
    session.openResult = { error: 'busy', owner: 'window' };
    let r = await post('/v1/asr/open', { mode: 'feed' });
    expect([r.status, r.json]).toEqual([409, { error: 'busy', owner: 'window' }]);
    session.openResult = { error: 'no-model' };
    expect((await post('/v1/asr/open', { mode: 'feed' })).status).toBe(503);
    session.openResult = { error: 'bad-request' };
    expect((await post('/v1/asr/open', { mode: 'x' })).status).toBe(400);
    r = await request(port, { method: 'POST', path: '/v1/asr/open', headers: auth(), body: '{nope' });
    expect([r.status, r.json]).toEqual([400, { error: 'bad-json' }]);
  });

  it('listen/open is always system mode', async () => {
    await post('/v1/listen/open', { mode: 'feed', lang: 'zh' });
    expect(session.opened[0]).toMatchObject({ mode: 'system', lang: 'zh' });
  });

  it('close: 204, unknown id 404', async () => {
    expect((await post('/v1/asr/close', { id: SID })).status).toBe(204);
    expect((await post('/v1/asr/close', { id: 'x' })).status).toBe(404);
    expect(session.closed).toEqual([SID, 'x']);
  });

  it('seek: 200 with the cut, 404 / 400 / 503 from the session; the id and mediaStartS go through', async () => {
    const r = await post('/v1/asr/seek', { id: SID, mediaStartS: 95.5 });
    expect([r.status, r.json]).toEqual([200, { atS: 12.34 }]);
    expect(session.seeks[0]).toEqual({ id: SID, mediaStartS: 95.5 });
    const u = await post('/v1/asr/seek', { id: 'x', mediaStartS: 1 });
    expect([u.status, u.json]).toEqual([404, { error: 'unknown-session' }]);
    for (const [error, status] of [['bad-request', 400], ['not-ready', 503]]) {
      session.seekResult = { error };
      const e = await post('/v1/asr/seek', { id: SID, mediaStartS: 1 });
      expect([e.status, e.json]).toEqual([status, { error }]);
    }
    expect((await post('/v1/asr/seek', { id: 7 })).status).toBe(404);
    expect(session.seeks.at(-1)).toEqual({ id: '', mediaStartS: undefined });
  });

  it('a seek leaves the feed sequence of the session as it was', async () => {
    const feed = (seq) => request(port, { method: 'POST', path: '/v1/asr/feed', headers: { ...auth(), 'content-type': 'application/octet-stream', 'x-session-id': SID, 'x-seq': String(seq) }, body: Buffer.from(new Float32Array(4).buffer) });
    await post('/v1/asr/open', { mode: 'feed' });
    expect((await feed(0)).status).toBe(204);
    expect((await feed(1)).status).toBe(204);
    expect((await post('/v1/asr/seek', { id: SID, mediaStartS: 50 })).status).toBe(200);
    expect((await feed(1)).json).toEqual({ error: 'stale-seq', expected: 2 });
    expect((await feed(2)).status).toBe(204);
  });
});

describe('feed', () => {
  const pcmBody = (values) => Buffer.from(new Float32Array(values).buffer);
  const feed = (body, extra = {}) => request(port, { method: 'POST', path: '/v1/asr/feed', headers: { ...auth(), 'content-type': 'application/octet-stream', 'x-session-id': SID, ...extra }, body });

  it('raw float32 little-endian in, 204 out', async () => {
    const r = await feed(pcmBody([0.5, -0.25, NaN, 1]), { 'x-seq': '0' });
    expect(r.status).toBe(204);
    expect(Array.from(session.fed[0].samples)).toEqual([0.5, -0.25, 0, 1]);
  });

  it('over 1 MB: 413 and nothing fed', async () => {
    const r = await feed(Buffer.alloc(1024 * 1024 + 4));
    expect(r.status).toBe(413);
    expect(session.fed).toHaveLength(0);
  });

  it('a bad body or header: 400', async () => {
    expect((await feed(Buffer.alloc(6))).status).toBe(400);
    expect((await feed(Buffer.alloc(0))).status).toBe(400);
    expect((await feed(pcmBody([0]), { 'x-seq': 'abc' })).status).toBe(400);
    const r = await request(port, { method: 'POST', path: '/v1/asr/feed', headers: auth(), body: pcmBody([0]) });
    expect(r.status).toBe(400);
  });

  it('session errors map to 404 / 409 / 503 / 429', async () => {
    expect((await feed(pcmBody([0]), { 'x-session-id': 'other' })).status).toBe(404);
    session.feedResult = { error: 'wrong-mode' };
    expect((await feed(pcmBody([0]))).status).toBe(409);
    session.feedResult = { error: 'not-ready' };
    expect((await feed(pcmBody([0]))).status).toBe(503);
    session.feedResult = { error: 'backpressure', retryAfterMs: 1000 };
    const r = await feed(pcmBody([0]));
    expect([r.status, r.json, r.headers['retry-after']]).toEqual([429, { error: 'backpressure', retryAfterMs: 1000 }, '1']);
  });

  it('more than 20 a second: 429 rate', async () => {
    for (let i = 0; i < 20; i++) expect((await feed(pcmBody([0]))).status).toBe(204);
    const r = await feed(pcmBody([0]));
    expect([r.status, r.json, r.headers['retry-after']]).toEqual([429, { error: 'rate' }, '1']);
    clock += 1000;
    expect((await feed(pcmBody([0]))).status).toBe(204);
  });

  it('a repeated x-seq is refused, a gap is not', async () => {
    await post('/v1/asr/open', { mode: 'feed' });
    expect((await feed(pcmBody([0]), { 'x-seq': '5' })).status).toBe(204);
    const r = await feed(pcmBody([0]), { 'x-seq': '5' });
    expect([r.status, r.json]).toEqual([409, { error: 'stale-seq', expected: 6 }]);
    expect((await feed(pcmBody([0]), { 'x-seq': '9' })).status).toBe(204);
    expect(session.fed).toHaveLength(2);
  });
});

describe('events stream', () => {
  function openStream(id = SID) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: `/v1/asr/events?id=${id}`, headers: auth(), agent: false }, (res) => {
        let buf = '';
        const lines = [];
        const waiters = [];
        res.setEncoding('utf8');
        res.on('data', (c) => {
          buf += c;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            lines.push(JSON.parse(buf.slice(0, i)));
            buf = buf.slice(i + 1);
          }
          waiters.splice(0).forEach((w) => w());
        });
        const ended = new Promise((r) => res.on('end', r));
        const until = async (pred) => {
          while (!pred(lines)) await new Promise((r) => waiters.push(r));
        };
        resolve({ res, req, lines, ended, until });
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('backlog first, live events, heartbeats, end after closed', async () => {
    session.backlog = [{ type: 'status', state: 'listening' }];
    const s = await openStream();
    expect(s.res.statusCode).toBe(200);
    expect(s.res.headers['content-type']).toContain('application/x-ndjson');
    expect(s.res.headers['transfer-encoding']).toBe('chunked');
    await s.until((l) => l.length >= 1);
    session.emit({ type: 'segment', id: 1, start: 100, end: 101, text: 'hi', lang: 'en' });
    await s.until((l) => l.some((e) => e.type === 'segment'));
    await s.until((l) => l.some((e) => Object.keys(e).length === 0));
    session.emit({ type: 'closed', reason: 'stopped' });
    await s.ended;
    const real = s.lines.filter((e) => Object.keys(e).length);
    expect(real).toEqual([
      { type: 'status', state: 'listening' },
      { type: 'segment', id: 1, start: 100, end: 101, text: 'hi', lang: 'en' },
      { type: 'closed', reason: 'stopped' },
    ]);
    expect(session.listeners.size).toBe(0);
  });

  it('a closed event in the backlog ends the stream at once', async () => {
    session.backlog = [{ type: 'closed', reason: 'engine-dead' }];
    const s = await openStream();
    await s.ended;
    expect(s.lines).toEqual([{ type: 'closed', reason: 'engine-dead' }]);
  });

  it('unknown id: 404', async () => {
    const r = await request(port, { path: '/v1/asr/events?id=nope', headers: auth() });
    expect(r.status).toBe(404);
  });

  it('a client hanging up unsubscribes', async () => {
    const s = await openStream();
    expect(session.listeners.size).toBe(1);
    s.req.destroy();
    for (let i = 0; i < 50 && session.listeners.size; i++) await new Promise((r) => setTimeout(r, 10));
    expect(session.listeners.size).toBe(0);
  });

  it('stopping the server ends open streams', async () => {
    const s = await openStream();
    await server.stop();
    await s.ended;
    expect(session.listeners.size).toBe(0);
  });
});

describe('translate', () => {
  it('translates each item in order, two at a time, failures per item', async () => {
    let inFlight = 0;
    let peak = 0;
    await server.stop();
    await boot({
      translateStream: async (text, options, onChunk, extra) => {
        translateCalls.push({ text, options, extra });
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return text === 'FAIL' ? { success: false } : { success: true, text: `<${text}>` };
      },
    });
    const items = [{ id: 'a', text: 'one' }, { id: 2, text: 'FAIL' }, { id: 'c', text: 'three' }, { id: 'd', text: '  ' }, { id: 'e', text: 'five' }];
    const r = await post('/v1/translate', { items, target: 'zh' });
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([{ id: 'a', text: '<one>' }, { id: 2, error: 'translate-failed' }, { id: 'c', text: '<three>' }, { id: 'd', text: '' }, { id: 'e', text: '<five>' }]);
    expect(peak).toBe(2);
    expect(translateCalls[0].options).toEqual({ sourceLang: 'auto', targetLang: 'zh' });
    expect(translateCalls[0].extra.noCache).toBe(false);
  });

  it('passes the source language through', async () => {
    await post('/v1/translate', { items: [{ id: 1, text: 'x' }], source: 'en', target: 'ja' });
    expect(translateCalls[0].options).toEqual({ sourceLang: 'en', targetLang: 'ja' });
  });

  it('limits: 400 past 50 items or 2000 chars, 400 without a target, 413 past 64 KB', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: i, text: 'x' }));
    expect((await post('/v1/translate', { items: many, target: 'zh' })).status).toBe(400);
    expect((await post('/v1/translate', { items: [{ id: 1, text: 'x'.repeat(2001) }], target: 'zh' })).status).toBe(400);
    expect((await post('/v1/translate', { items: [{ id: 1, text: 'x' }] })).status).toBe(400);
    expect((await post('/v1/translate', { items: [] , target: 'zh' })).status).toBe(400);
    expect((await post('/v1/translate', { items: [{ id: 1, text: 'x'.repeat(70000) }], target: 'zh' })).status).toBe(413);
    expect(translateCalls).toHaveLength(0);
  });

  it('no stack: 503', async () => {
    await server.stop();
    await boot({ translateStream: null });
    const r = await post('/v1/translate', { items: [{ id: 1, text: 'x' }], target: 'zh' });
    expect([r.status, r.json]).toEqual([503, { error: 'no-translator' }]);
    expect((await request(port, { headers: auth() })).json.capabilities.translate).toBe(false);
  });
});

describe('initCompanion', () => {
  it('runs the server while settings.companion.enabled is on', async () => {
    const { initCompanion } = require('../../../electron/companion/index.js');
    const data = {};
    let changed = null;
    const st = {
      get: (k, d) => (k in data ? data[k] : d),
      set: (k, v) => (data[k] = v),
      onDidChange: (key, fn) => {
        changed = fn;
        return () => (changed = null);
      },
    };
    const engine = { getInfo: () => ({ modelName: 'm' }), currentOwner: () => null, startSession: () => ({ ok: false, busy: 'window' }), stopSession() {}, feedPcm() {} };
    const pushes = [];
    const flip = async (on) => {
      data['settings.companion.enabled'] = on;
      changed(on);
      await c.ready();
    };
    const c = initCompanion({ store: st, engineManager: engine, logger, version: '1', onStatus: (s) => pushes.push(s), serverOptions: { portBase: 0 } });
    await c.ready();
    expect(c.status()).toEqual({ enabled: false, running: false, port: null, pairingOpen: false, session: { active: false, id: null, mode: null, state: null, aheadS: 0 } });

    await flip(true);
    expect(c.status()).toMatchObject({ enabled: true, running: true });
    expect(c.status().port).toBeGreaterThan(0);
    expect(c.openPairing().pairingOpen).toBe(true);
    expect(pushes.at(-1)).toMatchObject({ running: true, pairingOpen: true });

    await flip(false);
    expect(c.status()).toMatchObject({ running: false, port: null, pairingOpen: false });
    await flip(true);
    expect(c.status().running).toBe(true);
    await c.stop();
    expect(c.status().running).toBe(false);
    expect(changed).toBeNull();
  });
});

describe('ports', () => {
  it('walks past a taken port', async () => {
    const blocker = net.createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = blocker.address().port;
    const other = createCompanionServer({ store, session, logger, portBase: taken, portSpan: 3 });
    try {
      const got = await other.start();
      expect(got).toBeGreaterThan(taken);
      expect(got).toBeLessThanOrEqual(taken + 2);
    } finally {
      await other.stop();
      blocker.close();
    }
  });

  it('stop frees the port', async () => {
    const was = port;
    await server.stop();
    expect(server.running()).toBe(false);
    await expect(request(was, { headers: auth() })).rejects.toThrow();
  });
});
