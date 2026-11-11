// @vitest-environment node
// audio-engine-manager's seekSession over a fake T-Engine audio adapter: the
// worker's asr-seeked / asr-seek-failed answer requests in order, a
// timed-out request still takes its late answer, a stop or a worker exit
// fails what waits, and the translation context breaks at the first final
// from the cut on (not at the answer).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const LISTEN = path.resolve(__dirname, '../../../electron/listen');

function fakeModule(file, exports) {
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const engineListeners = new Set();
const adapter = {
  live: false,
  posted: [],
  listeners: new Set(),
  subscribe: (fn) => (adapter.listeners.add(fn), () => adapter.listeners.delete(fn)),
  setProvider() {},
  spawn: async () => {
    adapter.live = true;
  },
  running: () => adapter.live,
  startAsr() {},
  stopAsr() {},
  post: (msg) => adapter.posted.push(msg),
  expectExit() {},
  kill() {},
  discard() {},
  ttsLoadedPack: () => null,
  provider: () => 'cpu',
};
const fromWorker = (msg) => [...adapter.listeners].forEach((fn) => fn(msg));
const exitWorker = () => {
  adapter.live = false;
  for (const fn of [...engineListeners]) fn({ engine: 'audio', kind: 'exit', code: 1, everReady: true });
};

let manager;
const prompts = [];

beforeAll(() => {
  fakeModule(require.resolve('electron', { paths: [LISTEN] }), { app: { getPath: () => path.join(LISTEN, 'no-such-dir'), getVersion: () => '0.0.0', isPackaged: false } });
  fakeModule(require.resolve(path.join(LISTEN, '../tengine')), { get: () => ({ get: () => adapter, on: (fn) => (engineListeners.add(fn), () => engineListeners.delete(fn)) }) });
  fakeModule(require.resolve(path.join(LISTEN, '../llm/llm-manager')), { asrStatus: () => ({ usable: false }) });
  fakeModule(require.resolve(path.join(LISTEN, 'asr-models')), { locateAsrModels: () => ({ modelName: 'fake', modelPath: 'm', tokensPath: 't', vadPath: 'v', baseDir: 'b' }) });
  fakeModule(require.resolve(path.join(LISTEN, '../packs/model-root')), { modelDir: () => 'models', modelDirs: () => ['models'] });
  manager = require(path.join(LISTEN, 'audio-engine-manager.js'));
  // Secure mode: no session log and no subtitle file on disk.
  const store = { get: (k, d) => (k === 'privacyMode' ? 'secure' : d), onDidChange: () => () => {} };
  manager.init({ store, getWindow: () => null });
  manager.configureTranslation({
    translateStream: async (text, opts) => {
      prompts.push({ text, prompt: opts.systemPrompt.content });
      return { success: true, text: `T(${text})` };
    },
  });
});

let sink;

beforeEach(() => {
  adapter.live = false;
  adapter.posted = [];
  prompts.length = 0;
  sink = { states: [], segments: [], status: (s) => sink.states.push(s), segment: (r) => sink.segments.push(r), translation() {} };
  manager.startSession({ owner: 'companion', sink, language: 'en', targetLang: 'zh', source: { mode: 'off' } });
  fromWorker({ type: 'asr-ready', loadMs: 1 });
});

afterEach(() => {
  vi.useRealTimers();
  manager.stopSession('test');
  fromWorker({ type: 'asr-stopped' });
  exitWorker();
});

const seg = (segStartS, text) => ({ type: 'segment', rec: { segStartS, segDurS: 1, lang: '<|en|>', text } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('seekSession', () => {
  it('not running yet: not-ready without asking the worker', async () => {
    manager.stopSession('test');
    expect(await manager.seekSession()).toEqual({ ok: false, error: 'not-ready' });
    expect(adapter.posted.filter((m) => m.type === 'asr-seek')).toHaveLength(0);
  });

  it('answers requests in the order sent: the cut, then the worker’s reason', async () => {
    expect(sink.states).toContain('listening');
    const a = manager.seekSession();
    const b = manager.seekSession();
    expect(adapter.posted.filter((m) => m.type === 'asr-seek')).toHaveLength(2);
    fromWorker({ type: 'asr-seeked', atS: 9.5 });
    fromWorker({ type: 'asr-seek-failed', reason: 'not-live' });
    expect(await a).toEqual({ ok: true, atS: 9.5 });
    expect(await b).toEqual({ ok: false, error: 'not-live' });
  });

  it('times out after 3 s; the late answer is that request’s, not the next one’s', async () => {
    vi.useFakeTimers();
    const a = manager.seekSession();
    vi.advanceTimersByTime(3000);
    expect(await a).toEqual({ ok: false, error: 'timeout' });
    const b = manager.seekSession();
    let bDone = null;
    b.then((r) => (bDone = r));
    fromWorker({ type: 'asr-seeked', atS: 1 });
    await Promise.resolve();
    expect(bDone).toBeNull();
    fromWorker({ type: 'asr-seeked', atS: 2 });
    expect(await b).toEqual({ ok: true, atS: 2 });
  });

  it('a stop or the worker going away fails what waits', async () => {
    const a = manager.seekSession();
    manager.stopSession('companion-close');
    expect(await a).toEqual({ ok: false, error: 'stopped' });
  });

  it('the worker exiting mid-request: stopped', async () => {
    const a = manager.seekSession();
    exitWorker();
    expect(await a).toEqual({ ok: false, error: 'stopped' });
  });

  it('the translation context breaks at the first final from the cut on, not at the answer', async () => {
    fromWorker(seg(1, 'one'));
    fromWorker(seg(3, 'two'));
    const a = manager.seekSession();
    fromWorker({ type: 'asr-seeked', atS: 5 });
    await a;
    fromWorker(seg(4.2, 'flushed')); // decoded after the answer, from before the cut
    fromWorker(seg(5.1, 'after'));
    fromWorker(seg(7, 'later'));
    await tick();
    const prompt = (text) => prompts.find((p) => p.text === text).prompt;
    expect(prompt('flushed')).toContain('- two');
    expect(prompt('after')).not.toContain('- flushed');
    expect(prompt('after')).not.toContain('- two');
    expect(prompt('later')).toContain('- after');
    expect(prompt('later')).not.toContain('- flushed');
    expect(sink.segments.map((r) => r.text)).toEqual(['one', 'two', 'flushed', 'after', 'later']);
  });
});
