// ocr-host-manager with a fake fork: spawn on first request, reply
// matching, crash rejection + respawn, ready timeout, and crash backoff.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createOcrHostManager } = require('../../electron/managers/ocr-host-manager.js');

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

function manager(script, extra = {}) {
  const children = [];
  const fork = vi.fn(() => {
    const c = fakeChild(script);
    children.push(c);
    return c;
  });
  const m = createOcrHostManager({ fork, logger: quiet, workerPath: 'host.js', ...extra });
  return { m, fork, children };
}

describe('ocr-host-manager', () => {
  it('spawns once, sends init with the provider, and matches replies to requests', async () => {
    const { m, fork, children } = manager(readyThenEcho);
    expect(m.running()).toBe(false);
    const [a, b] = await Promise.all([m.recognize({ packId: 'base' }), m.recognize({ packId: 'ko' })]);
    expect(a.text).toBe('seen:base');
    expect(b.text).toBe('seen:ko');
    expect(fork).toHaveBeenCalledTimes(1);
    expect(children[0].sent[0]).toEqual({ type: 'init', provider: 'cpu' });
    expect(m.pendingCount()).toBe(0);
  });

  it('surfaces host-side errors with their code', async () => {
    const { m } = manager(readyThenEcho);
    await expect(m.health({ packId: 'base' })).rejects.toMatchObject({ code: 'LOAD_FAILED', message: 'bad model' });
  });

  it('rejects in-flight requests when the host dies and respawns on the next call', async () => {
    let crashed = false;
    const { m, fork } = manager((msg, child) => {
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
  });

  it('stops respawning after repeated crashes until the backoff passes', async () => {
    let t = 1000;
    const { m, fork } = manager((msg, child) => {
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
    t += 61000;
    await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_CRASHED' });
    expect(fork).toHaveBeenCalledTimes(4);
  });

  it('times out a host that never says ready', async () => {
    const { m } = manager(() => null, { readyTimeoutMs: 20 });
    await expect(m.recognize({ packId: 'base' })).rejects.toMatchObject({ code: 'OCR_HOST_TIMEOUT' });
    expect(m.running()).toBe(false);
  });

  it('forwards provider and eviction to a running host, and shutdown ends it', async () => {
    const { m, children } = manager(readyThenEcho);
    await m.recognize({ packId: 'base' });
    m.setProvider('webgpu');
    m.evict('ko');
    const types = children[0].sent.map((s) => s.type);
    expect(types).toEqual(['init', 'recognize', 'set-provider', 'evict']);
    expect(children[0].sent[2]).toEqual({ type: 'set-provider', provider: 'webgpu' });
    m.shutdown();
    expect(m.running()).toBe(false);
    expect(children[0].sent.at(-1)).toEqual({ type: 'shutdown' });
  });
});
