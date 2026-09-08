// The host framework on its own: generic request/reply, default error
// codes, the event stream and the status snapshot. Engine-specific
// behaviour (OCR codes, provider) is covered by tengine-ocr-engine.test.js.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createHostManager, DEFAULT_CODES } = require('../../electron/tengine/host-manager.js');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function fakeChild(script) {
  const child = new EventEmitter();
  child.sent = [];
  child.postMessage = (msg) => {
    child.sent.push(msg);
    const reply = script(msg, child);
    if (reply) setImmediate(() => child.emit('message', reply));
  };
  child.kill = () => setImmediate(() => child.emit('exit', 0));
  return child;
}

function host(script, extra = {}) {
  const events = [];
  const children = [];
  const fork = vi.fn(() => {
    const c = fakeChild(script);
    children.push(c);
    return c;
  });
  const h = createHostManager({ name: 'demo', fork, logger: quiet, workerPath: 'demo.js', onEvent: (e) => events.push(e), ...extra });
  return { h, events, children, fork };
}

describe('tengine host-manager', () => {
  it('sends the adapter-supplied init payload and answers any request type', async () => {
    const { h, children } = host((msg) => {
      if (msg.type === 'init') return { type: 'ready', info: { version: '1' } };
      return { type: 'result', id: msg.id, ok: true, value: { echo: msg.type, n: msg.n } };
    }, { initPayload: () => ({ mode: 'fast' }), serviceName: 'svc-demo' });
    const r = await h.request('anything', { n: 7 });
    expect(r).toEqual({ echo: 'anything', n: 7 });
    expect(children[0].sent[0]).toEqual({ type: 'init', mode: 'fast' });
    expect(h.status()).toMatchObject({ name: 'demo', running: true, ready: true, pending: 0, spawnCount: 1, crashesInWindow: 0, backoffUntil: 0 });
  });

  it('uses the default error codes when the adapter supplies none', async () => {
    const { h } = host((msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      return { type: 'result', id: msg.id, ok: false, error: { message: 'nope' } };
    });
    await expect(h.request('x', {})).rejects.toMatchObject({ code: DEFAULT_CODES.failed, message: 'nope' });
  });

  it('times out a single request without killing the host', async () => {
    const { h, events } = host((msg) => (msg.type === 'init' ? { type: 'ready' } : null), { requestTimeoutMs: 15 });
    await expect(h.request('slow', {})).rejects.toMatchObject({ code: DEFAULT_CODES.requestTimeout });
    expect(h.running()).toBe(true);
    expect(events.find((e) => e.kind === 'timeout')).toMatchObject({ phase: 'request', type: 'slow' });
  });

  it('reports ready timing and the ready message info in the event stream', async () => {
    let t = 100;
    const { h, events } = host((msg) => {
      if (msg.type === 'init') {
        t += 42;
        return { type: 'ready', info: { devices: 2 } };
      }
      return null;
    }, { now: () => t });
    await h.prewarm();
    expect(events.map((e) => e.kind)).toEqual(['spawn', 'ready']);
    expect(events[1]).toMatchObject({ host: 'demo', readyMs: 42, info: { devices: 2 } });
    expect(h.status().readyMs).toBe(42);
  });

  it('post() is a no-op before spawn and delivers afterwards', async () => {
    const { h, children } = host((msg) => (msg.type === 'init' ? { type: 'ready' } : null));
    h.post({ type: 'ping' });
    expect(children).toHaveLength(0);
    await h.prewarm();
    h.post({ type: 'ping' });
    expect(children[0].sent.map((s) => s.type)).toEqual(['init', 'ping']);
  });
});
