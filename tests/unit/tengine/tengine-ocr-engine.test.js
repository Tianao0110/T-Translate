// The OCR engine adapter on the T-Engine host framework, with a fake fork:
// spawn on first request, reply matching, crash rejection + respawn, ready
// timeout, crash backoff, provider/eviction forwarding, health bookkeeping.
// Error codes are the pre-T-Engine ones callers switch on.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createOcrEngine } = require('../../../electron/tengine/engines/ocr.js');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

// A scripted host: `script(msg)` returns the reply (or nothing) for each
// message; `crash()` ends the process like a native fault would.
function fakeChild(script) {
  const child = new EventEmitter();
  child.sent = [];
  child.postMessage = (msg) => {
    child.sent.push(msg);
    const reply = script(msg, child);
    if (reply) setImmediate(() => child.emit('message', reply));
  };
  child.kill = () => setImmediate(() => child.emit('exit', 0));
  child.crash = () => child.emit('exit', 3221225477);
  return child;
}

const readyThenEcho = (msg) => {
  if (msg.type === 'init') return { type: 'ready' };
  if (msg.type === 'recognize') return { type: 'result', id: msg.id, ok: true, value: { text: `seen:${msg.packId}` } };
  if (msg.type === 'health') return { type: 'result', id: msg.id, ok: false, error: { message: 'bad model', code: 'LOAD_FAILED' } };
  return null;
};

function engine(script, extra = {}) {
  const children = [];
  const events = [];
  const fork = vi.fn(() => {
    const c = fakeChild(script);
    children.push(c);
    return c;
  });
  const m = createOcrEngine({ fork, logger: quiet, workerPath: 'host.js', onEvent: (e) => events.push(e), ...extra });
  return { m, fork, children, events };
}

describe('tengine ocr engine', () => {
  it('spawns once, sends init with the provider, and matches replies to requests', async () => {
    const { m, fork, children } = engine(readyThenEcho);
    expect(m.running()).toBe(false);
    const [a, b] = await Promise.all([m.recognize({ packId: 'base' }), m.recognize({ packId: 'ko' })]);
    expect(a.text).toBe('seen:base');
    expect(b.text).toBe('seen:ko');
    expect(fork).toHaveBeenCalledTimes(1);
    expect(children[0].sent[0]).toEqual({ type: 'init', provider: 'cpu' });
    expect(m.host.pendingCount()).toBe(0);
  });

  it('surfaces host-side errors with their code and records the failed health', async () => {
    const { m } = engine(readyThenEcho);
    await expect(m.health({ packId: 'base' })).rejects.toMatchObject({ code: 'LOAD_FAILED', message: 'bad model' });
    expect(m.status().lastHealth).toMatchObject({ ok: false, code: 'LOAD_FAILED', provider: 'cpu' });
  });

  it('rejects in-flight requests when the host dies and respawns on the next call', async () => {
    let crashed = false;
    const { m, fork, events } = engine((msg, child) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'recognize' && !crashed) {
        crashed = true;
        setImmediate(() => child.crash());
        return null;
      }
      return { type: 'result', id: msg.id, ok: true, value: { text: 'ok' } };
    });
    await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_CRASHED' });
    expect(m.running()).toBe(false);
    const again = await m.recognize({ packId: 'base' });
    expect(again.text).toBe('ok');
    expect(fork).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.kind)).toEqual(['spawn', 'ready', 'exit', 'spawn', 'ready']);
    expect(events[2]).toMatchObject({ host: 'ocr', expected: false, crashesInWindow: 1 });
  });

  it('stops respawning after repeated crashes until the backoff passes', async () => {
    let t = 1000;
    const { m, fork, events } = engine((msg, child) => {
      if (msg.type === 'init') {
        setImmediate(() => child.crash());
        return null;
      }
      return null;
    }, { now: () => t, readyTimeoutMs: 50 });
    for (let i = 0; i < 3; i++) {
      await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_CRASHED' });
    }
    await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_UNAVAILABLE' });
    expect(fork).toHaveBeenCalledTimes(3);
    expect(events.some((e) => e.kind === 'backoff')).toBe(true);
    expect(m.status().host.backoffUntil).toBeGreaterThan(t);
    t += 61000;
    await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_CRASHED' });
    expect(fork).toHaveBeenCalledTimes(4);
  });

  it('times out a host that never says ready', async () => {
    const { m, events } = engine(() => null, { readyTimeoutMs: 20 });
    await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_TIMEOUT' });
    expect(m.running()).toBe(false);
    expect(events.find((e) => e.kind === 'timeout')).toMatchObject({ phase: 'ready' });
  });

  it('forwards provider and eviction to a running host, and shutdown ends it', async () => {
    const { m, children } = engine(readyThenEcho);
    await m.recognize({ packId: 'base' });
    m.setProvider('webgpu');
    m.evict('ko');
    const types = children[0].sent.map((s) => s.type);
    expect(types).toEqual(['init', 'recognize', 'set-provider', 'evict']);
    expect(children[0].sent[2]).toEqual({ type: 'set-provider', provider: 'webgpu' });
    expect(m.status()).toMatchObject({ id: 'ocr', provider: 'webgpu', host: { running: true, ready: true, spawnCount: 1 } });
    m.shutdown();
    expect(m.running()).toBe(false);
    expect(children[0].sent.at(-1)).toEqual({ type: 'shutdown' });
  });

  it('carries a provider set before the first spawn into init', async () => {
    const { m, children } = engine(readyThenEcho);
    m.setProvider('webgpu');
    await m.recognize({ packId: 'base' });
    expect(children[0].sent[0]).toEqual({ type: 'init', provider: 'webgpu' });
  });
});

// Idle shutdown: the host goes after a quiet spell and the next request
// brings it back; a request in flight or a fresh one keeps it alive.
function manualTimers() {
  const list = [];
  return {
    list,
    live: () => list.filter((t) => !t.cleared && !t.fired),
    set: (fn, ms) => { const t = { fn, ms }; list.push(t); return t; },
    clear: (t) => { if (t) t.cleared = true; },
    fireAll() { for (const t of this.live()) { t.fired = true; t.fn(); } },
  };
}

describe('tengine ocr engine idle shutdown', () => {
  it('shuts the host down after the idle spell and respawns on the next request', async () => {
    const timers = manualTimers();
    const { m, fork, children } = engine(readyThenEcho, { timers, idleShutdownMs: 1000 });
    await m.recognize({ packId: 'base' });
    expect(timers.live()).toHaveLength(1);
    expect(timers.live()[0].ms).toBe(1000);
    timers.fireAll();
    expect(m.running()).toBe(false);
    expect(children[0].sent.at(-1)).toEqual({ type: 'shutdown' });
    expect((await m.recognize({ packId: 'base' })).text).toBe('seen:base');
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('a new request cancels the pending shutdown and re-arms it when done', async () => {
    const timers = manualTimers();
    const { m } = engine(readyThenEcho, { timers, idleShutdownMs: 1000 });
    await m.recognize({ packId: 'base' });
    const first = timers.live()[0];
    await m.recognize({ packId: 'ko' });
    expect(first.cleared).toBe(true);
    expect(timers.live()).toHaveLength(1);
    expect(m.running()).toBe(true);
  });

  it('never arms while a request is still running', async () => {
    const timers = manualTimers();
    let hold;
    const script = (msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'recognize') { hold = () => ({ type: 'result', id: msg.id, ok: true, value: { text: 'late' } }); }
      return null;
    };
    const { m, children } = engine(script, { timers, idleShutdownMs: 1000 });
    const pending = m.recognize({ packId: 'base' });
    await new Promise((r) => setTimeout(r, 5));
    expect(timers.live()).toHaveLength(0);
    children[0].emit('message', hold());
    expect((await pending).text).toBe('late');
    expect(timers.live()).toHaveLength(1);
  });

  it('a prewarmed host that is never used still goes idle', async () => {
    const timers = manualTimers();
    const { m } = engine(readyThenEcho, { timers, idleShutdownMs: 1000 });
    await m.prewarm();
    expect(m.running()).toBe(true);
    timers.fireAll();
    expect(m.running()).toBe(false);
  });
});
