// The LLM engine adapter on the host framework with a fake host: init
// payload, progress and token routing by reqId, cancel, the stall event,
// crash bookkeeping, provider mapping, health and probe records, and the
// rule that events carry numbers, never text.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createLlmEngine, toProvider } = require('../../electron/tengine/engines/llm.js');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

// script(msg) returns one reply, an array of replies (sent in order), or
// nothing. crash() ends the process like a native fault would.
function fakeChild(script) {
  const child = new EventEmitter();
  child.sent = [];
  child.postMessage = (msg) => {
    child.sent.push(msg);
    const reply = script(msg, child);
    const list = Array.isArray(reply) ? reply : reply ? [reply] : [];
    let i = 0;
    const next = () => {
      if (i >= list.length) return;
      const m = list[i++];
      child.emit('message', m);
      setImmediate(next);
    };
    if (list.length) setImmediate(next);
  };
  child.kill = () => setImmediate(() => child.emit('exit', 0));
  child.crash = () => child.emit('exit', 3221225477);
  return child;
}

const INFO = { name: 'Qwen3', arch: 'qwen3', provider: 'cpu', device: { name: 'CPU' }, fallback: null, loadMs: 300, ctxMs: 40, sizeBytes: 1834426016, nCtx: 4096, hasThinking: true };
const RESULT = { text: '你好', stop: 'eog', promptTokens: 80, reusedTokens: 50, genTokens: 2, promptMs: 60, firstMs: 70, totalMs: 90, tokPerSec: 100, thinkLeak: 0 };

const stockHost = (msg) => {
  switch (msg.type) {
    case 'init':
      return { type: 'ready', info: { build: 'b10853', version: '0.4.0-dev', gpuOffload: true, devices: [{ name: 'CPU', typeName: 'cpu', memory: { free: 1, total: 2 } }] } };
    case 'load-model':
      return [
        { type: 'progress', id: msg.id, reqId: msg.reqId, value: 0.5 },
        { type: 'progress', id: msg.id, reqId: msg.reqId, value: 1 },
        { type: 'result', id: msg.id, ok: true, value: INFO },
      ];
    case 'generate':
      return [
        { type: 'token', id: msg.id, reqId: msg.reqId, text: '你' },
        { type: 'token', id: msg.id, reqId: msg.reqId, text: '好' },
        { type: 'result', id: msg.id, ok: true, value: RESULT },
      ];
    case 'health':
      return { type: 'result', id: msg.id, ok: true, value: { ok: true, provider: 'gpu', device: { name: 'Vulkan0' }, fallback: null, loadMs: 500, firstMs: 40, tokPerSec: 200, genTokens: 3, stop: 'eog' } };
    case 'probe':
      return { type: 'result', id: msg.id, ok: true, value: { report: { file: msg.file, verdict: 'usable', steps: [{ name: 'metadata', ok: true, ms: 27 }], meta: { arch: 'qwen3', quant: 'Q8_0' }, generate: { tokPerSec: 20 } } } };
    case 'unload-model':
      return { type: 'result', id: msg.id, ok: true, value: {} };
    case 'metrics':
      return { type: 'result', id: msg.id, ok: true, value: { rss: 100 } };
    default:
      return null;
  }
};

function engine(script = stockHost, extra = {}) {
  const children = [];
  const events = [];
  let t = 1000;
  const now = () => t;
  const fork = vi.fn(() => {
    const c = fakeChild(script);
    children.push(c);
    return c;
  });
  const e = createLlmEngine({ fork, logger: quiet, workerPath: 'llm-host.js', runtimeDir: 'C:/rt', onEvent: (ev) => events.push(ev), now, ...extra });
  return { e, fork, children, events, child: () => children.at(-1), tick: (ms) => { t += ms; } };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('tengine llm engine', () => {
  it('inits the host with the runtime dir and watchdog limits, keeps the ready info', async () => {
    const { e, child } = engine();
    await e.host.spawn();
    expect(child().sent[0]).toEqual({ type: 'init', runtimeDir: 'C:/rt', firstTokenMs: 60000, stallMs: 15000 });
    await settle();
    expect(e.runtime().build).toBe('b10853');
    expect(e.status().runtime.devices[0].name).toBe('CPU');
  });

  it('loads a model, routes progress, records numbers only', async () => {
    const { e, events, child } = engine();
    const progress = [];
    const info = await e.load('C:/m/q.gguf', { nCtx: 4096 }, { onProgress: (v) => progress.push(v) });
    expect(info.name).toBe('Qwen3');
    const sent = child().sent.find((m) => m.type === 'load-model');
    expect(sent.file).toBe('C:/m/q.gguf');
    expect(sent.options).toEqual({ nCtx: 4096, provider: 'cpu' });
    expect(sent.reqId).toMatch(/^l\d+$/);
    expect(progress).toEqual([0.5, 1]);
    const loaded = events.find((ev) => ev.kind === 'model-loaded');
    expect(loaded).toMatchObject({ engine: 'llm', file: 'C:/m/q.gguf', provider: 'cpu', device: 'CPU', loadMs: 300, arch: 'qwen3' });
    expect(JSON.stringify(loaded)).not.toContain('text');
    expect(e.loaded().file).toBe('C:/m/q.gguf');
  });

  it('streams tokens to the caller and emits a request record without the text', async () => {
    const { e, events } = engine();
    const chunks = [];
    const g = e.generate({ system: 'S', user: 'U', maxTokens: 10 }, (t) => chunks.push(t));
    const r = await g.promise;
    expect(chunks).toEqual(['你', '好']);
    expect(r.text).toBe('你好');
    const rec = events.find((ev) => ev.kind === 'request');
    expect(rec).toMatchObject({ engine: 'llm', promptTokens: 80, reusedTokens: 50, genTokens: 2, stop: 'eog', thinkLeak: 0, provider: 'cpu' });
    expect(rec.text).toBeUndefined();
    expect(e.status().lastRequest.genTokens).toBe(2);
  });

  it('cancel posts the request id to the host', async () => {
    const { e, child } = engine();
    const g = e.generate({ user: 'U' });
    await settle();
    g.cancel();
    expect(child().sent.at(-1)).toEqual({ type: 'cancel', reqId: g.reqId });
    await g.promise;
  });

  it('forwards a stall from the host watchdog as an event', async () => {
    const { e, events } = engine((msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'generate') {
        return [
          { type: 'stall', id: msg.id, reqId: msg.reqId, phase: 'stream' },
          { type: 'result', id: msg.id, ok: true, value: { ...RESULT, stop: 'stall' } },
        ];
      }
      return null;
    });
    const r = await e.generate({ user: 'U' }).promise;
    expect(r.stop).toBe('stall');
    expect(events.find((ev) => ev.kind === 'stall')).toMatchObject({ engine: 'llm', phase: 'stream' });
  });

  it('a crash rejects the request, forgets the model and reports the exit', async () => {
    const { e, events, child } = engine((msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'load-model') return { type: 'result', id: msg.id, ok: true, value: INFO };
      return null;
    });
    await e.load('C:/m/q.gguf');
    expect(e.loaded()).not.toBeNull();
    const g = e.generate({ user: 'U' });
    await settle();
    child().crash();
    await expect(g.promise).rejects.toMatchObject({ code: 'LLM_HOST_CRASHED' });
    expect(e.loaded()).toBeNull();
    expect(events.find((ev) => ev.kind === 'exit')).toMatchObject({ engine: 'llm', expected: false });
    expect(events.find((ev) => ev.kind === 'request-failed')).toMatchObject({ code: 'LLM_HOST_CRASHED' });
  });

  it('maps every GPU spelling to gpu and sends it with the next load', async () => {
    expect(toProvider('webgpu')).toBe('gpu');
    expect(toProvider('vulkan')).toBe('gpu');
    expect(toProvider('cpu')).toBe('cpu');
    expect(toProvider(undefined)).toBe('cpu');
    const { e, child } = engine();
    e.setProvider('webgpu');
    await e.load('C:/m/q.gguf');
    expect(child().sent.find((m) => m.type === 'load-model').options.provider).toBe('gpu');
    expect(e.status().provider).toBe('gpu');
  });

  it('records health results and failures', async () => {
    const { e, events } = engine();
    e.setProvider('gpu');
    const r = await e.health({ file: 'C:/m/q.gguf' });
    expect(r.ok).toBe(true);
    expect(e.status().lastHealth).toMatchObject({ ok: true, provider: 'gpu', device: 'Vulkan0', tokPerSec: 200 });
    expect(e.loaded()).toMatchObject({ file: 'C:/m/q.gguf', provider: 'gpu' });
    expect(events.find((ev) => ev.kind === 'health')).toMatchObject({ ok: true });

    const bad = engine((msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'health') return { type: 'result', id: msg.id, ok: false, error: { message: 'no vulkan', code: 'LLM_MODEL_LOAD_FAILED' } };
      return null;
    });
    await expect(bad.e.health({ file: 'C:/m/q.gguf' })).rejects.toMatchObject({ code: 'LLM_MODEL_LOAD_FAILED' });
    expect(bad.e.status().lastHealth).toMatchObject({ ok: false, fallback: 'no vulkan', code: 'LLM_MODEL_LOAD_FAILED' });
  });

  it('probe returns the report, drops the resident model and emits a summary', async () => {
    const { e, events } = engine();
    await e.load('C:/m/q.gguf');
    const report = await e.probe('C:/m/new.gguf');
    expect(report.verdict).toBe('usable');
    expect(e.loaded()).toBeNull();
    expect(events.find((ev) => ev.kind === 'probe')).toMatchObject({ file: 'C:/m/new.gguf', verdict: 'usable', arch: 'qwen3', quant: 'Q8_0', tokPerSec: 20 });
  });

  it('unload and metrics go through the host; unload without a host is a no-op', async () => {
    const { e, child } = engine();
    await e.unload();
    expect(child).toBeTruthy();
    await e.load('C:/m/q.gguf');
    await e.unload();
    expect(e.loaded()).toBeNull();
    expect(child().sent.some((m) => m.type === 'unload-model')).toBe(true);
    expect(await e.metrics()).toEqual({ rss: 100 });
  });
});
