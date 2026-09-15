// The main-process model manager with a fake adapter and a fake pack
// scanner: which file gets loaded, when a load is skipped, the idle unload,
// the developer door, the GPU self-test branches, and the trial log that
// only an unlisted model gets.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const manager = require('../../electron/managers/llm-manager.js');

const PACK = { id: 'qwen3-1.7b', role: 'general', default: true, file: 'Q.gguf', ctx: 4096, template: 'qwen3' };

function fakeAdapter() {
  let provider = 'cpu';
  let loaded = null;
  const a = {
    calls: [],
    provider: () => provider,
    setProvider: (p) => {
      provider = p;
    },
    loaded: () => loaded,
    runtime: () => ({ build: 'b10853' }),
    status: () => ({ lastHealth: null, lastRequest: null }),
    load: vi.fn(async (file, options) => {
      a.calls.push(['load', file, options]);
      loaded = { file, provider, device: { name: 'CPU' }, fallback: null, loadMs: 10, info: { name: 'Q' } };
      return loaded.info;
    }),
    unload: vi.fn(async () => {
      a.calls.push(['unload']);
      loaded = null;
    }),
    generate: vi.fn((req, onToken) => {
      a.calls.push(['generate', req]);
      if (onToken) onToken('你好');
      return { reqId: 'g1', promise: Promise.resolve({ text: '你好', stop: 'eog', genTokens: 2, tokPerSec: 50, firstMs: 20 }), cancel: vi.fn() };
    }),
    probe: vi.fn(async (file) => {
      a.calls.push(['probe', file]);
      loaded = null;
      return { verdict: 'usable', steps: [{ name: 'metadata', ok: true, ms: 1 }], meta: { arch: 'x' }, budget: null, generate: { tokPerSec: 9 } };
    }),
    health: vi.fn(async (payload) => {
      a.calls.push(['health', payload]);
      loaded = { file: payload.file, provider, device: null, fallback: null, loadMs: 5, info: null };
      return { ok: true, provider, fallback: null, tokPerSec: 33 };
    }),
    crash() {
      loaded = null;
    },
  };
  return a;
}

const VPACK = { id: 'paddleocr-vl-1.6', role: 'vision', default: false, name: 'Eyes', file: 'V.gguf', ctx: 4096, template: 'auto', visionFamily: 'paddleocr' };

function fakePacks({ ready = true, unlisted = [], door = () => false, dir = 'C:/models/llm-models', vision = false } = {}) {
  let last = null;
  const visionRow = { ...VPACK, status: vision ? 'ready' : 'missing', path: vision ? `${dir}/V.gguf` : null, mmprojPath: vision ? `${dir}/V-mmproj.gguf` : null, files: [] };
  const visionTarget = () => (vision ? { pack: VPACK, path: `${dir}/V.gguf`, mmproj: `${dir}/V-mmproj.gguf`, trial: false } : null);
  return {
    dir: () => dir,
    scan: vi.fn(async () => {
      last = { dir, packs: [{ ...PACK, status: ready ? 'ready' : 'missing', path: ready ? `${dir}/Q.gguf` : null }, visionRow], unlisted: unlisted.map((f) => ({ file: f, path: `${dir}/${f}` })), allowUnlisted: door() };
      return last;
    }),
    scanning: () => false,
    status: () => last,
    resolvePack: (id) => (id === PACK.id && ready ? { pack: PACK, path: `${dir}/Q.gguf`, trial: false } : id === VPACK.id ? visionTarget() : null),
    resolveDefault: () => (ready ? { pack: PACK, path: `${dir}/Q.gguf`, trial: false } : null),
    resolveVision: visionTarget,
    resolveUnlisted: (name) => (door() && unlisted.includes(name) ? { pack: null, path: `${dir}/${name}`, trial: true } : null),
  };
}

function fakeStore(values = {}) {
  const data = { ...values };
  return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; } };
}

function tengineBus() {
  const listeners = new Set();
  return { on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, emit: (e) => listeners.forEach((fn) => fn(e)) };
}

let logsDir;
beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-llm-manager-'));
});
afterEach(() => {
  manager.reset();
  vi.useRealTimers();
  fs.rmSync(logsDir, { recursive: true, force: true });
});

function boot({ adapter = fakeAdapter(), packs = fakePacks(), store = fakeStore(), bus = tengineBus(), timers, visionAdapter = null } = {}) {
  manager.init({ store, tengine: bus, adapter, visionAdapter, packs, logsDir, logger: null, ...(timers ? { timers } : {}) });
  return { adapter, packs, store, bus, visionAdapter };
}

describe('llm manager', () => {
  it('loads the default pack once and reuses it on the same provider', async () => {
    const { adapter } = boot();
    const first = await manager.ensureLoaded();
    expect(first.reloaded).toBe(true);
    expect(adapter.load).toHaveBeenCalledWith('C:/models/llm-models/Q.gguf', { nCtx: 4096, nBatch: 512, template: 'qwen3' }, { onProgress: null });
    const second = await manager.ensureLoaded();
    expect(second.reloaded).toBe(false);
    expect(adapter.load).toHaveBeenCalledTimes(1);
    adapter.setProvider('gpu');
    const third = await manager.ensureLoaded();
    expect(third.reloaded).toBe(true);
  });

  it('reports a missing model as LLM_MODEL_MISSING', async () => {
    boot({ packs: fakePacks({ ready: false }) });
    await expect(manager.ensureLoaded()).rejects.toMatchObject({ code: 'LLM_MODEL_MISSING' });
    await expect(manager.ensureLoaded({ packId: 'nope' })).rejects.toMatchObject({ code: 'LLM_MODEL_MISSING' });
  });

  it('generate streams through the adapter and writes no trial log for a whitelisted model', async () => {
    const { adapter } = boot();
    const chunks = [];
    const g = await manager.generate({ kind: 'translate', system: 'S', user: 'U', maxTokens: 20 }, (t) => chunks.push(t));
    const r = await g.promise;
    expect(r.text).toBe('你好');
    expect(chunks).toEqual(['你好']);
    expect(g.trial).toBe(false);
    expect(adapter.generate.mock.calls[0][0]).toEqual({ kind: 'translate', maxTokens: 20, sampler: {}, system: 'S', user: 'U' });
    expect(fs.readdirSync(logsDir).filter((f) => f.startsWith('tengine-trial-'))).toEqual([]);
    expect(manager.status()).toMatchObject({ resident: { file: 'Q.gguf', trial: false }, inflight: 0, provider: 'cpu' });
  });

  it('unloads after five idle minutes and not while a request is in flight', async () => {
    vi.useFakeTimers();
    const { adapter } = boot({ timers: { set: setTimeout, clear: clearTimeout } });
    const g = await manager.generate({ user: 'U' });
    await g.promise;
    await vi.advanceTimersByTimeAsync(manager.IDLE_UNLOAD_MS - 1000);
    expect(adapter.unload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(adapter.unload).toHaveBeenCalledTimes(1);
    expect(adapter.loaded()).toBeNull();
  });

  it('the developer door gates unlisted files, probes them and logs the trial', async () => {
    const store = fakeStore({ 'settings.llm.allowUnlistedModels': false });
    const door = () => store.get('settings.llm.allowUnlistedModels', false) === true;
    const { adapter } = boot({ store, packs: fakePacks({ unlisted: ['S.gguf'], door }) });
    await expect(manager.generate({ file: 'S.gguf', user: 'U' })).rejects.toMatchObject({ code: 'LLM_MODEL_NOT_ALLOWED' });
    store.set('settings.llm.allowUnlistedModels', true);
    const g = await manager.generate({ file: 'S.gguf', user: 'U' });
    await g.promise;
    expect(g.trial).toBe(true);
    expect(adapter.load).toHaveBeenCalledWith('C:/models/llm-models/S.gguf', { nCtx: 4096, nBatch: 512, template: 'auto' }, { onProgress: null });
    const files = fs.readdirSync(logsDir).filter((f) => f.startsWith('tengine-trial-S-'));
    expect(files).toHaveLength(1);
    const rows = fs.readFileSync(path.join(logsDir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows[0]).toMatchObject({ kind: 'request', model: 'S.gguf', genTokens: 2 });
    expect(rows[0].text).toBeUndefined();

    const report = await manager.probe('S.gguf');
    expect(report.verdict).toBe('usable');
    const after = fs.readFileSync(path.join(logsDir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(after.at(-1)).toMatchObject({ kind: 'probe', verdict: 'usable' });
    expect(manager.trialReport('S.gguf')).toMatchObject({ requests: 1, probes: 1 });
  });

  it('a folder file chosen in settings is used while the door is open, the whitelist otherwise', async () => {
    const store = fakeStore({ 'settings.llm.allowUnlistedModels': true, 'settings.llm.pack': 'unlisted:Hy-MT-9B.gguf' });
    const door = () => store.get('settings.llm.allowUnlistedModels', false) === true;
    const { adapter } = boot({ store, packs: fakePacks({ unlisted: ['Hy-MT-9B.gguf'], door }) });
    await manager.rescan();
    expect(manager.selected()).toEqual({ id: 'unlisted:Hy-MT-9B.gguf', file: 'Hy-MT-9B.gguf', role: 'mt', name: 'Hy-MT-9B', status: 'ready', trial: true });
    const g = await manager.generate({ user: 'U' });
    await g.promise;
    expect(g.trial).toBe(true);
    expect(adapter.load.mock.calls[0][0]).toBe('C:/models/llm-models/Hy-MT-9B.gguf');
    store.set('settings.llm.allowUnlistedModels', false);
    expect(manager.selected()).toMatchObject({ id: 'qwen3-1.7b', role: 'general', trial: false });
    const g2 = await manager.generate({ user: 'U' });
    await g2.promise;
    expect(adapter.load.mock.calls[1][0]).toBe('C:/models/llm-models/Q.gguf');
  });

  it('forwards llm engine events into the trial log and forgets the model on exit', async () => {
    const store = fakeStore({ 'settings.llm.allowUnlistedModels': true });
    const { bus, adapter } = boot({ store, packs: fakePacks({ unlisted: ['S.gguf'], door: () => true }) });
    await manager.ensureLoaded({ file: 'S.gguf' });
    bus.emit({ engine: 'llm', host: 'llm', kind: 'stall', at: 1, phase: 'stream' });
    bus.emit({ engine: 'ocr', host: 'ocr', kind: 'stall', at: 1 });
    adapter.crash();
    bus.emit({ engine: 'llm', host: 'llm', kind: 'exit', at: 2, code: 3221225477, expected: false });
    const file = fs.readdirSync(logsDir).find((f) => f.startsWith('tengine-trial-S-'));
    const rows = fs.readFileSync(path.join(logsDir, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((r) => r.kind)).toEqual(['stall', 'exit']);
    expect(manager.status().resident).toBeNull();
    const again = await manager.ensureLoaded({ file: 'S.gguf' });
    expect(again.reloaded).toBe(true);
  });

  it('P6: three stalls make generate step aside until the host restarts', async () => {
    const { bus, adapter } = boot();
    await manager.ensureLoaded();
    for (let i = 0; i < 3; i++) bus.emit({ engine: 'llm', host: 'llm', kind: 'request', at: i, stop: 'stall', genTokens: 0 });
    expect(manager.status().policy).toMatchObject({ unhealthy: true, consecutiveStalls: 3 });
    await expect(manager.generate({ user: 'U' })).rejects.toMatchObject({ code: 'LLM_UNHEALTHY' });
    expect(adapter.generate).not.toHaveBeenCalled();
    adapter.crash();
    bus.emit({ engine: 'llm', host: 'llm', kind: 'exit', at: 9, code: 1, expected: false });
    const g = await manager.generate({ user: 'U' });
    await g.promise;
    expect(adapter.generate).toHaveBeenCalledTimes(1);
  });

  it('self-test: pending without a model, a timed health check with one', async () => {
    boot({ packs: fakePacks({ ready: false }) });
    expect(await manager.selfTest()).toEqual({ ok: true, provider: 'cpu', fallback: null, pending: true });
    manager.reset();
    const { adapter } = boot();
    adapter.setProvider('gpu');
    const r = await manager.selfTest();
    expect(adapter.health).toHaveBeenCalledWith({ file: 'C:/models/llm-models/Q.gguf', options: { nCtx: 4096, nBatch: 512, template: 'qwen3' } });
    expect(r).toEqual({ ok: true, provider: 'webgpu', fallback: null, tokPerSec: 33 });
    const kept = await manager.ensureLoaded();
    expect(kept.reloaded).toBe(false);
  });
});

describe('the vision slot', () => {
  it('loads the vision pack with its mmproj on the vision host (GPU), without touching the text slot', async () => {
    const visionAdapter = fakeAdapter();
    visionAdapter.setProvider('gpu');
    const { adapter } = boot({ packs: fakePacks({ vision: true }), visionAdapter });
    const r = await manager.recognize({ image: Buffer.from('png') });
    expect((await r.promise).text).toBe('你好');
    expect(visionAdapter.load).toHaveBeenCalledWith('C:/models/llm-models/V.gguf', { nCtx: 4096, nBatch: 2048, template: 'auto', mmproj: 'C:/models/llm-models/V-mmproj.gguf', visionFamily: 'paddleocr' });
    expect(visionAdapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ocr', task: 'Spotting' }));
    expect(visionAdapter.generate.mock.calls[0][0].image).toEqual(Buffer.from('png'));
    expect(adapter.load).not.toHaveBeenCalled();
    await (await manager.recognize({ image: Buffer.from('png') })).promise;
    expect(visionAdapter.load).toHaveBeenCalledTimes(1);
    expect(manager.status().vision).toMatchObject({ available: true, usable: true, pack: { id: 'paddleocr-vl-1.6', status: 'ready' }, resident: { file: 'V.gguf' }, inflight: 0 });
  });

  it('never runs on the CPU: refuses before loading and reports unusable', async () => {
    const visionAdapter = fakeAdapter();
    boot({ packs: fakePacks({ vision: true }), visionAdapter });
    await expect(manager.recognize({ image: Buffer.from('a') })).rejects.toMatchObject({ code: 'LLM_VISION_NEEDS_GPU' });
    expect(visionAdapter.load).not.toHaveBeenCalled();
    expect(manager.status().vision).toMatchObject({ usable: false, provider: 'cpu' });
    visionAdapter.setProvider('gpu');
    await (await manager.recognize({ image: Buffer.from('a') })).promise;
    expect(visionAdapter.load).toHaveBeenCalledTimes(1);
    expect(manager.status().vision.usable).toBe(true);
  });

  it('refuses without a vision pack or a vision host, and tells the GPU switch it is pending', async () => {
    const off = fakeAdapter();
    off.setProvider('gpu');
    boot({ packs: fakePacks({ vision: false }), visionAdapter: off });
    await expect(manager.recognize({ image: Buffer.from('a') })).rejects.toMatchObject({ code: 'LLM_VISION_MISSING' });
    expect(await manager.visionSelfTest()).toEqual({ ok: true, provider: 'cpu', fallback: null, pending: true });
    manager.reset();
    boot({ packs: fakePacks({ vision: true }) });
    await expect(manager.recognize({ image: Buffer.from('a') })).rejects.toMatchObject({ code: 'LLM_VISION_UNAVAILABLE' });
    expect(manager.status().vision).toEqual({ available: false });
  });

  it('runs the GPU self-test on the vision pack and keeps it resident', async () => {
    const visionAdapter = fakeAdapter();
    boot({ packs: fakePacks({ vision: true }), visionAdapter });
    visionAdapter.setProvider('gpu');
    const r = await manager.visionSelfTest();
    expect(visionAdapter.health).toHaveBeenCalledWith({ file: 'C:/models/llm-models/V.gguf', options: expect.objectContaining({ mmproj: 'C:/models/llm-models/V-mmproj.gguf', visionFamily: 'paddleocr' }) });
    expect(r).toMatchObject({ ok: true, provider: 'webgpu', fallback: null, tokPerSec: 33 });
    expect(manager.status().vision.resident.file).toBe('V.gguf');
  });

  it('idles the vision model out on its own timer, alongside the text model', async () => {
    vi.useFakeTimers();
    const visionAdapter = fakeAdapter();
    visionAdapter.setProvider('gpu');
    const { adapter } = boot({ packs: fakePacks({ vision: true }), visionAdapter, timers: { set: setTimeout, clear: clearTimeout } });
    await (await manager.generate({ user: 'U' })).promise;
    await (await manager.recognize({ image: Buffer.from('a') })).promise;
    expect(adapter.loaded()).toBeTruthy();
    expect(visionAdapter.loaded()).toBeTruthy();
    await vi.advanceTimersByTimeAsync(manager.IDLE_UNLOAD_MS + 1000);
    expect(visionAdapter.unload).toHaveBeenCalledTimes(1);
    expect(adapter.unload).toHaveBeenCalledTimes(1);
  });

  it('drops the vision residency when its host exits, leaving the text slot alone', async () => {
    const visionAdapter = fakeAdapter();
    visionAdapter.setProvider('gpu');
    const { adapter, bus } = boot({ packs: fakePacks({ vision: true }), visionAdapter });
    await (await manager.generate({ user: 'U' })).promise;
    await (await manager.recognize({ image: Buffer.from('a') })).promise;
    visionAdapter.crash();
    bus.emit({ engine: 'llm-vision', host: 'llm-vision', kind: 'exit', at: 1, code: 3221225477 });
    await (await manager.recognize({ image: Buffer.from('a') })).promise;
    expect(visionAdapter.load).toHaveBeenCalledTimes(2);
    expect(adapter.load).toHaveBeenCalledTimes(1);
    expect(await manager.unloadVision('manual')).toBe(true);
    expect(adapter.loaded()).toBeTruthy();
  });
});
