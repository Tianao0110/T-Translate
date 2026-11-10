// @vitest-environment node
// Companion session on a fake audio-engine-manager: open / busy / no-model,
// sink events into an ordered queue with backlog, media times, the feed
// budget, close vs. preemption, the restart rebase and the idle close.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createCompanionSession } = require('../../../electron/companion/session.js');

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

// Mirrors the manager's owner / sink contract (audio-engine-manager.js).
function fakeEngine() {
  const e = { owner: null, sink: null, started: [], stopped: [], fed: 0, startResult: null };
  e.startSession = (opts) => {
    e.started.push(opts);
    if (e.startResult) return e.startResult(opts);
    if (e.owner) return { ok: false, busy: e.owner };
    e.owner = 'companion';
    e.sink = opts.sink;
    opts.sink.status('loading');
    return { ok: true };
  };
  e.currentOwner = () => e.owner;
  e.stopSession = (reason) => e.stopped.push(reason);
  e.feedPcm = (samples) => {
    e.fed += samples.length;
  };
  e.listening = () => e.sink.status('listening');
  // The manager's last status, then finishSession(), maybe with a queued window start.
  e.end = (state = 'stopped', next = null) => {
    const sink = e.sink;
    sink.status(state);
    e.sink = null;
    e.owner = next;
  };
  return e;
}

function setup(opts = {}) {
  const engine = fakeEngine();
  const session = createCompanionSession({ engineManager: engine, logger, idleCloseMs: 0, ...opts });
  return { engine, session };
}

function collect(session, id) {
  const events = [];
  const unsub = session.subscribe(id, (e) => events.push(e));
  return { events, unsub };
}

afterEach(() => vi.useRealTimers());

describe('open', () => {
  it('starts a companion-owned engine session with the right source', () => {
    const { engine, session } = setup();
    const r = session.open({ mode: 'feed', lang: 'en', targetLang: 'zh', mediaStartS: 100 });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    const opts = engine.started[0];
    expect(opts).toMatchObject({ owner: 'companion', language: 'en', targetLang: 'zh', source: { mode: 'off' } });
    expect(Object.keys(opts.sink).sort()).toEqual(['segment', 'status', 'translation']);
    expect(session.status()).toMatchObject({ active: true, id: r.id, mode: 'feed', state: 'loading' });
  });

  it('system mode captures the system sound', () => {
    const { engine, session } = setup();
    session.open({ mode: 'system' });
    expect(engine.started[0].source).toEqual({ mode: 'system' });
  });

  it('refuses bad arguments', () => {
    const { engine, session } = setup();
    for (const args of [{}, { mode: 'off' }, { mode: 'feed', lang: 'en us' }, { mode: 'feed', targetLang: 1 }, { mode: 'feed', mediaStartS: -1 }, { mode: 'feed', mediaStartS: NaN }, { mode: 'feed', mediaStartS: '5' }]) {
      expect(session.open(args)).toEqual({ error: 'bad-request' });
    }
    expect(engine.started).toHaveLength(0);
  });

  it('one companion session at a time; the manager says who else is busy', () => {
    const { engine, session } = setup();
    session.open({ mode: 'feed' });
    expect(session.open({ mode: 'feed' })).toEqual({ error: 'busy', owner: 'companion' });
    engine.end('stopped');

    const other = setup();
    other.engine.owner = 'window';
    expect(other.session.open({ mode: 'feed' })).toEqual({ error: 'busy', owner: 'window' });
    expect(other.session.status().active).toBe(false);
  });

  it('no model: error out and leave nothing active', () => {
    const { engine, session } = setup();
    engine.startResult = (opts) => {
      opts.sink.status('no-model');
      return { ok: false, error: 'no-model' };
    };
    expect(session.open({ mode: 'feed' })).toEqual({ error: 'no-model' });
    expect(session.status().active).toBe(false);
  });
});

describe('events', () => {
  it('replays the backlog in order, then goes live', () => {
    const { engine, session } = setup();
    const { id } = session.open({ mode: 'feed', mediaStartS: 100 });
    engine.listening();
    engine.sink.status('metrics', { rssMb: 1 });
    engine.sink.segment({ id: 7, segStartS: 1.5, segDurS: 2, text: 'hello', lang: '<|en|>' });
    const { events } = collect(session, id);
    expect(events).toEqual([
      { type: 'status', state: 'loading' },
      { type: 'status', state: 'listening' },
      { type: 'segment', id: 7, start: 101.5, end: 103.5, text: 'hello', lang: 'en' },
    ]);
    engine.sink.translation({ id: 7, text: 'pending', done: false });
    engine.sink.translation({ id: 7, text: '你好', done: true });
    engine.sink.status('capture-error', 'device gone');
    expect(events.slice(3)).toEqual([
      { type: 'translation', id: 7, text: 'pending', done: false },
      { type: 'translation', id: 7, text: '你好', done: true },
      { type: 'status', state: 'capture-error', detail: 'device gone' },
    ]);
  });

  it('keeps only the newest maxBacklog events', () => {
    const { engine, session } = setup({ maxBacklog: 3 });
    const { id } = session.open({ mode: 'feed' });
    for (let i = 1; i <= 5; i++) engine.sink.segment({ id: i, segStartS: i, segDurS: 1, text: `s${i}`, lang: '' });
    const { events } = collect(session, id);
    expect(events.map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it('unknown id gets no subscription', () => {
    const { session } = setup();
    expect(session.subscribe('nope', () => {})).toBeNull();
    expect(session.has('nope')).toBe(false);
  });
});

describe('feed', () => {
  it('gates on id, mode and readiness', () => {
    const { engine, session } = setup();
    const { id } = session.open({ mode: 'feed' });
    const pcm = new Float32Array(1600);
    expect(session.feed('other', pcm)).toEqual({ error: 'unknown-session' });
    expect(session.feed(id, pcm)).toEqual({ error: 'not-ready' });
    engine.listening();
    expect(session.feed(id, pcm)).toEqual({ ok: true });
    expect(engine.fed).toBe(1600);
    engine.sink.status('hint-no-speech');
    expect(session.feed(id, pcm)).toEqual({ ok: true });
    engine.end('stopped');

    const sys = setup();
    const s = sys.session.open({ mode: 'system' });
    sys.engine.listening();
    expect(sys.session.feed(s.id, pcm)).toEqual({ error: 'wrong-mode' });
  });

  it('backpressure until a final catches up', () => {
    const { engine, session } = setup({ maxAheadS: 1 });
    const { id } = session.open({ mode: 'feed' });
    engine.listening();
    expect(session.feed(id, new Float32Array(16000))).toEqual({ ok: true });
    expect(session.feed(id, new Float32Array(1))).toEqual({ error: 'backpressure', retryAfterMs: 1000 });
    expect(session.status().aheadS).toBe(1);
    engine.sink.segment({ id: 1, segStartS: 0, segDurS: 0.5, text: 'a', lang: '' });
    expect(session.feed(id, new Float32Array(8000))).toEqual({ ok: true });
    expect(engine.fed).toBe(24000);
  });
});

describe('close', () => {
  it('stops the engine and ends with closed/stopped', async () => {
    const { engine, session } = setup();
    const { id } = session.open({ mode: 'feed' });
    const { events } = collect(session, id);
    expect(session.close(id)).toEqual({ ok: true });
    expect(engine.stopped).toEqual(['companion-close']);
    engine.end('stopped');
    expect(session.status().active).toBe(false);
    await tick();
    expect(events.slice(-2)).toEqual([{ type: 'status', state: 'stopped' }, { type: 'closed', reason: 'stopped' }]);
    expect(session.close(id)).toEqual({ ok: true });
    expect(session.close('nope')).toEqual({ error: 'unknown-session' });
  });

  it('a window start queued behind it reads as preempted', async () => {
    const { engine, session } = setup();
    const { id } = session.open({ mode: 'system' });
    const { events } = collect(session, id);
    engine.end('stopped', 'window');
    await tick();
    expect(events.at(-1)).toEqual({ type: 'closed', reason: 'preempted' });
  });

  it('engine failures close with the status name', async () => {
    for (const state of ['engine-dead', 'model-load-failed']) {
      const { engine, session } = setup();
      const { id } = session.open({ mode: 'feed' });
      const { events } = collect(session, id);
      engine.end(state);
      await tick();
      expect(events.at(-1)).toEqual({ type: 'closed', reason: state });
    }
  });

  it('never stops an engine session it does not own', () => {
    const { engine, session } = setup();
    const { id } = session.open({ mode: 'feed' });
    engine.owner = 'window';
    session.close(id);
    session.closeActive('x');
    expect(engine.stopped).toEqual([]);
  });

  it('a late subscriber still gets the end, every time', async () => {
    const { engine, session } = setup();
    const { id } = session.open({ mode: 'feed' });
    engine.end('engine-dead');
    await tick();
    const first = collect(session, id).events;
    expect(first.at(-1)).toEqual({ type: 'closed', reason: 'engine-dead' });
    expect(collect(session, id).events).toEqual([{ type: 'closed', reason: 'engine-dead' }]);
    expect(session.feed(id, new Float32Array(1))).toEqual({ error: 'unknown-session' });
  });
});

it('a restarted worker keeps the media timeline going', () => {
  const { engine, session } = setup();
  const { id } = session.open({ mode: 'feed', mediaStartS: 10 });
  engine.listening();
  session.feed(id, new Float32Array(16000 * 3));
  engine.sink.status('engine-restarting');
  expect(session.feed(id, new Float32Array(1))).toEqual({ error: 'not-ready' });
  engine.sink.status('loading');
  engine.listening();
  const { events } = collect(session, id);
  engine.sink.segment({ id: 2, segStartS: 0.5, segDurS: 1, text: 'b', lang: '' });
  expect(events.at(-1)).toMatchObject({ type: 'segment', start: 13.5, end: 14.5 });
});

it('closes a session nobody reads or feeds', () => {
  vi.useFakeTimers();
  const { engine, session } = setup({ idleCloseMs: 1000 });
  const { id } = session.open({ mode: 'system' });
  vi.advanceTimersByTime(900);
  const { unsub } = collect(session, id);
  vi.advanceTimersByTime(5000);
  expect(engine.stopped).toEqual([]);
  unsub();
  vi.advanceTimersByTime(1000);
  expect(engine.stopped).toEqual(['companion-idle']);
});

describe('reopening while the last session is still stopping', () => {
  it('a session told to close frees the slot: the next open queues in the engine instead of busy, both stay findable', async () => {
    const { engine, session } = setup();
    const a = session.open({ mode: 'feed' });
    const { events: ea } = collect(session, a.id);
    expect(session.close(a.id)).toEqual({ ok: true });
    expect(engine.stopped).toEqual(['companion-close']);
    // The manager queues the start behind the worker that is going (audio-engine-manager.js).
    engine.startResult = () => ({ ok: true, queued: true });
    const b = session.open({ mode: 'feed', mediaStartS: 95 });
    expect(b.id).toBeTruthy();
    const { events: eb } = collect(session, b.id);
    expect(session.status()).toMatchObject({ active: true, id: b.id, state: 'starting' });
    expect(session.has(a.id)).toBe(true);
    expect(session.open({ mode: 'feed' })).toEqual({ error: 'busy', owner: 'companion' }); // b is not stopping
    engine.end('stopped'); // a's last status
    await tick();
    await tick();
    expect(ea.at(-1)).toMatchObject({ type: 'closed' });
    expect(eb).toEqual([]);
    expect(session.status()).toMatchObject({ active: true, id: b.id });
  });
});
