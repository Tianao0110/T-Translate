// The audio host adapter with a fake worker: init payload (GPU flag),
// message fan-out to the manager, ASR phase tracking and the model-load
// timer, exit classification, sherpa's stderr fallback note, and the voice
// self-test flow.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAudioEngine } = require('../../electron/tengine/engines/audio.js');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function fakeChild(script) {
  const child = new EventEmitter();
  child.sent = [];
  child.stderr = new EventEmitter();
  child.postMessage = (msg) => {
    child.sent.push(msg);
    const reply = script(msg, child);
    if (reply) setImmediate(() => child.emit('message', reply));
  };
  child.kill = () => setImmediate(() => child.emit('exit', 0));
  child.crash = (code = 3221225477) => child.emit('exit', code);
  return child;
}

const ack = (msg) => (msg.type === 'init' ? { type: 'ready' } : null);

function engine(script = ack, extra = {}) {
  const children = [];
  const events = [];
  const fork = vi.fn(() => {
    const c = fakeChild(script);
    children.push(c);
    return c;
  });
  const a = createAudioEngine({ fork, logger: quiet, workerPath: 'worker.js', onEvent: (e) => events.push(e), settleMs: 1, ...extra });
  return { a, fork, children, events, child: () => children.at(-1) };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('tengine audio engine', () => {
  it('spawns with the caller init plus the GPU flag and fans messages out', async () => {
    const { a, child } = engine();
    const seen = [];
    a.subscribe((m) => seen.push(m.type));
    a.setProvider('webgpu');
    await a.spawn({ init: { models: { asr: null }, meta: { model: 'tts-only' } } });
    expect(child().sent[0]).toEqual({ type: 'init', models: { asr: null }, meta: { model: 'tts-only' }, gpu: true });
    await tick();
    expect(seen).toEqual(['ready']);
    expect(a.status()).toMatchObject({ id: 'audio', provider: 'webgpu', asr: { phase: 'idle', everReady: false }, host: { running: true, ready: true } });
  });

  it('tracks the ASR phase and reports asr-ready', async () => {
    const { a, child, events } = engine();
    await a.spawn({ init: {} });
    a.startAsr('zh');
    expect(child().sent.at(-1)).toEqual({ type: 'asr-start', language: 'zh' });
    expect(a.asrPhase()).toBe('loading');
    child().emit('message', { type: 'asr-ready', loadMs: 1234 });
    expect(a.asrPhase()).toBe('running');
    expect(a.asrEverReady()).toBe(true);
    expect(events.find((e) => e.kind === 'asr-ready')).toMatchObject({ engine: 'audio', loadMs: 1234 });
    a.stopAsr();
    expect(a.asrPhase()).toBe('stopping');
    child().emit('message', { type: 'asr-stopped' });
    expect(a.asrPhase()).toBe('idle');
  });

  it('kills a process whose model load never finishes and says so', async () => {
    const { a, events } = engine(ack, { modelLoadTimeoutMs: 20 });
    await a.spawn({ init: {} });
    a.startAsr('');
    await new Promise((r) => setTimeout(r, 40));
    await tick();
    expect(events.find((e) => e.kind === 'timeout')).toMatchObject({ phase: 'model-load' });
    const exit = events.find((e) => e.kind === 'exit');
    expect(exit).toMatchObject({ engine: 'audio', phase: 'model-load', everReady: false, expected: true });
    expect(a.running()).toBe(false);
  });

  it('classifies a crash during a session as session, and never backs off', async () => {
    const { a, child, events, fork } = engine();
    for (let i = 0; i < 4; i++) {
      await a.spawn({ init: {} });
      a.startAsr('');
      child().emit('message', { type: 'asr-ready', loadMs: 1 });
      child().crash();
      await tick();
    }
    const exits = events.filter((e) => e.kind === 'exit');
    expect(exits).toHaveLength(4);
    expect(exits[0]).toMatchObject({ phase: 'session', everReady: true, expected: false });
    expect(fork).toHaveBeenCalledTimes(4);
    expect(a.status().host.backoffUntil).toBe(0);
  });

  it('scrapes sherpa fallback from stderr and clears it on a provider change', async () => {
    const { a, child, events } = engine();
    await a.spawn({ init: {} });
    child().stderr.emit('data', Buffer.from('OfflineTts: WebGPU is not available. Fallback to cpu!\n'));
    expect(a.providerNote()).toMatch(/Fallback to cpu/);
    expect(events.find((e) => e.kind === 'fallback')).toMatchObject({ engine: 'tts' });
    expect(a.setProvider('webgpu')).toBe(true);
    expect(a.providerNote()).toBeNull();
    expect(child().sent.at(-1)).toEqual({ type: 'tts-set-provider', provider: 'webgpu' });
    expect(a.setProvider('webgpu')).toBe(false);
  });

  it('health loads the voice, waits for tts-ready and reads the fallback note', async () => {
    const script = (msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'tts-load') return { type: 'tts-ready', packId: msg.pack.id, loadMs: 5 };
      return null;
    };
    const { a } = engine(script);
    expect(await a.health({ pack: { id: 'kokoro' } })).toMatchObject({ ok: false, error: 'not-running' });
    await a.spawn({ init: {} });
    a.setProvider('webgpu');
    const r = await a.health({ pack: { id: 'kokoro' } });
    expect(r).toMatchObject({ ok: true, provider: 'webgpu', fallback: null, packId: 'kokoro' });
    expect(a.ttsLoadedPack()).toBe('kokoro');
    expect(a.status().lastHealth).toMatchObject({ ok: true });
  });

  it('health reports a load failure and a timeout without throwing', async () => {
    const failing = (msg) => {
      if (msg.type === 'init') return { type: 'ready' };
      if (msg.type === 'tts-load') return { type: 'tts-error', packId: msg.pack.id, message: 'no such voice' };
      return null;
    };
    const { a } = engine(failing);
    await a.spawn({ init: {} });
    expect(await a.health({ pack: { id: 'x' } })).toMatchObject({ ok: false, error: 'no such voice', code: 'TTS_LOAD_FAILED' });
    const silent = engine(ack, { ttsLoadTimeoutMs: 15 });
    await silent.a.spawn({ init: {} });
    expect(await silent.a.health({ pack: { id: 'y' } })).toMatchObject({ ok: false, error: 'tts-load-timeout' });
  });

  it('discard drops the process without an exit verdict and ignores its late exit', async () => {
    const { a, child, events } = engine();
    await a.spawn({ init: {} });
    const old = child();
    a.discard('listen-start');
    expect(a.running()).toBe(false);
    old.emit('exit', 0);
    await tick();
    expect(events.map((e) => e.kind)).toEqual(['spawn', 'ready', 'discard']);
    expect(events.at(-1)).toMatchObject({ engine: 'audio', reason: 'listen-start', phase: 'idle' });
  });
});
