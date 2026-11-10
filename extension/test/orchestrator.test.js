// @vitest-environment node
//
// The per-tab orchestrator over fake page-events, arbiter and prefs: which
// tier starts from which evidence, the grace before deciding, the upgrade to
// site captions and their translation order and cache, pause / hidden /
// other-tab stops, the DRM notice and the listen session, no-speech parking,
// retries after a lost session, seeks, and the off / offline gates.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOrchestrator, mediaEligible, siteKeyOf, sameLang, coverageOf, coveredAt, coveredEdge } from '../src/sw/session-orchestrator.js';

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const after = async (ms) => {
  await flush();
  vi.advanceTimersByTime(ms);
  await flush();
};

function fakePageEvents() {
  const listeners = new Set();
  const evidence = new Map();
  const commands = [];
  const replies = {};
  let gen = 0;
  return {
    commands,
    evidence,
    getTabEvidence: (id) => evidence.get(id) ?? null,
    onPageEvent: (fn) => listeners.add(fn),
    command: vi.fn(async (tabId, command) => {
      commands.push({ tabId, ...command });
      const r = replies[command.cmd];
      if (r) return typeof r === 'function' ? r(command, tabId) : r;
      if (command.cmd === 'mse-capture' && command.on) return { key: `tab:${tabId}:${++gen}`, init: true, backlogBytes: 1 };
      if (command.cmd === 'listen' && command.on) return { key: `tab:${tabId}:l${++gen}` };
      return {};
    }),
    emit: (tabId, event) => listeners.forEach((fn) => fn({ tabId, event })),
    reply: (cmd, r) => (replies[cmd] = r),
    of: (cmd) => commands.filter((c) => c.cmd === cmd),
  };
}

const snap = (extra = {}) => ({ elId: 1, tag: 'video', src: 'blob:https://www.youtube.com/a', msId: 1, state: 'playing', currentTime: 30, duration: 900, live: false, muted: false, volume: 1, readyState: 4, width: 1280, height: 720, visible: true, pageVisible: true, ...extra });
const audioStream = { streamId: 1, mime: 'audio/webm; codecs="opus"', codec: 'opus', forward: true, init: true, chunks: 5, bytes: 50000, firstTimeS: 0, lastTimeS: 60 };
const evidenceOf = (tabId, extra = {}) => ({
  tabId,
  url: 'https://www.youtube.com/watch?v=vid00000001',
  site: 'youtube',
  mediaId: 'vid00000001',
  navSeq: 0,
  hooks: { main: 'ok', fetch: 'ok', xhr: 'ok', mse: 'ok', objectUrl: 'ok', eme: 'ok' },
  media: [],
  primaryElId: 1,
  subtitles: [],
  mse: { audio: audioStream, streams: [audioStream] },
  eme: null,
  capture: null,
  listen: null,
  ...extra,
});
const cuesOf = (n, step = 10) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, start: i * step, end: i * step + step - 1, text: `line ${i}` }));

let pe;
let arbiter;
let prefs;
let translate;
let states;
let orch;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  pe = fakePageEvents();
  arbiter = { focusedTab: 7, visibleTabs: new Set([7]), focused: () => arbiter.focusedTab, visible: () => [arbiter.focusedTab, ...arbiter.visibleTabs].filter((t, i, a) => t !== null && a.indexOf(t) === i), isVisible: (t) => arbiter.visibleTabs.has(t) };
  const listeners = new Set();
  prefs = { p: { enabled: true, autoListen: false, display: 'bilingual', mode: 'track', targetLang: 'zh', sourceLang: 'auto', siteOff: {} }, get: () => prefs.p, onChange: (fn) => listeners.add(fn), change(patch) {
    prefs.p = { ...prefs.p, ...patch };
    listeners.forEach((fn) => fn(prefs.p));
  } };
  translate = vi.fn(async (items) => items.map((it) => ({ id: it.id, text: `[zh] ${it.text}` })));
  states = [];
  orch = createOrchestrator({ pageEvents: pe, arbiter, prefs, translate, onState: (tabId, state, detail) => states.push({ tabId, state, detail }), logger: { warn: () => {}, debug: () => {} } });
  orch.setCompanion({ status: 'ready' });
});
afterEach(() => vi.useRealTimers());

// A tab whose video starts playing now.
async function playing(tabId = 7, { evidence = {}, media = {} } = {}) {
  pe.evidence.set(tabId, evidenceOf(tabId, evidence));
  pe.emit(tabId, { type: 'navigated', url: 'https://www.youtube.com/watch?v=vid00000001', mediaId: 'vid00000001', navSeq: 0, site: 'youtube' });
  pe.emit(tabId, { type: 'media', reason: 'play', media: snap(media), primary: true });
  await flush();
}
const lastState = (tabId = 7) => states.filter((s) => s.tabId === tabId).at(-1)?.state;

describe('helpers', () => {
  it('mediaEligible wants a playing, audible, shown, long enough video', () => {
    expect(mediaEligible(snap())).toBe(true);
    expect(mediaEligible(snap({ state: 'seeking' }))).toBe(true);
    expect(mediaEligible(snap({ state: 'paused' }))).toBe(false);
    expect(mediaEligible(snap({ muted: true }))).toBe(false);
    expect(mediaEligible(snap({ volume: 0 }))).toBe(false);
    expect(mediaEligible(snap({ duration: 4 }))).toBe(false);
    expect(mediaEligible(snap({ duration: 6 }))).toBe(true);
    expect(mediaEligible(snap({ duration: null, live: true }))).toBe(true);
    expect(mediaEligible(snap({ pageVisible: false }))).toBe(false);
    expect(mediaEligible(snap({ width: 120, height: 80 }))).toBe(false);
    expect(mediaEligible(snap({ tag: 'audio' }))).toBe(false);
    expect(mediaEligible(snap({ readyState: 1 }))).toBe(false);
  });

  it('siteKeyOf and sameLang', () => {
    expect(siteKeyOf({ site: 'youtube', url: 'https://www.youtube.com/' })).toBe('youtube');
    expect(siteKeyOf({ site: 'generic', url: 'https://www.example.org/v' })).toBe('example.org');
    expect(siteKeyOf({})).toBe('generic');
    expect(sameLang('zh-CN', 'zh')).toBe(true);
    expect(sameLang('zh-TW', 'zh')).toBe(false);
    expect(sameLang('en-US', 'en')).toBe(true);
    expect(sameLang('', 'zh')).toBe(false);
  });
});

describe('tier 2: decodable audio', () => {
  it('waits the decide grace, then captures from a little before the playhead with the prefs’ languages', async () => {
    await playing();
    expect(lastState()).toBe('waiting');
    expect(pe.of('mse-capture')).toHaveLength(0);
    await after(2000);
    const on = pe.of('mse-capture');
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ tabId: 7, on: true, streamId: 1, lang: 'auto', targetLang: 'zh' });
    expect(on[0].fromS).toBeCloseTo(32 - 5, 0);
    expect(pe.commands.slice(0, 2).map((c) => [c.cmd, c.value])).toEqual([
      ['display', 'bilingual'],
      ['mode', 'track'],
    ]);
    expect(lastState()).toBe('captions');
    expect(orch.stateOf(7)).toMatchObject({ state: 'captions', run: { tier: 2, kind: 'capture' }, active: true });
  });

  it('an empty site caption response ends the wait at once', async () => {
    pe.evidence.set(7, evidenceOf(7));
    pe.emit(7, { type: 'navigated', url: 'https://www.youtube.com/watch?v=vid00000001', mediaId: 'vid00000001', navSeq: 0, site: 'youtube' });
    pe.emit(7, { type: 'subtitle-parsed', url: 'https://www.youtube.com/api/timedtext?v=vid00000001', cueCount: 0, cues: [], mediaId: 'vid00000001', lang: 'en' });
    pe.emit(7, { type: 'media', reason: 'play', media: snap(), primary: true });
    await flush();
    expect(pe.of('mse-capture')).toHaveLength(1);
  });

  it('pausing stops capture after the grace; playing again restarts it', async () => {
    await playing();
    await after(2000);
    pe.emit(7, { type: 'media', reason: 'pause', media: snap({ state: 'paused', currentTime: 40 }), primary: true });
    await after(4000);
    expect(pe.of('mse-capture')).toHaveLength(1);
    await after(1500);
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: false });
    expect(lastState()).toBe('idle');
    pe.emit(7, { type: 'media', reason: 'play', media: snap({ currentTime: 40 }), primary: true });
    await flush();
    const again = pe.of('mse-capture').at(-1);
    expect(again).toMatchObject({ on: true });
    expect(again.fromS).toBeCloseTo(35, 0);
  });

  it('a short pause changes nothing', async () => {
    await playing();
    await after(2000);
    pe.emit(7, { type: 'media', reason: 'pause', media: snap({ state: 'paused' }), primary: true });
    await after(2000);
    pe.emit(7, { type: 'media', reason: 'play', media: snap(), primary: true });
    await after(5000);
    expect(pe.of('mse-capture')).toHaveLength(1);
  });

  it('a hidden page stops at once; a seek restarts with a new start', async () => {
    await playing();
    await after(2000);
    pe.emit(7, { type: 'media', reason: 'seeked', media: snap({ currentTime: 300 }), primary: true });
    await flush();
    const caps = pe.of('mse-capture');
    expect(caps.map((c) => c.on)).toEqual([true, false, true]);
    expect(caps[2].fromS).toBeCloseTo(295, 0);
    pe.emit(7, { type: 'media', reason: 'visibility', media: snap({ currentTime: 310, pageVisible: false }), primary: true });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: false });
    expect(lastState()).toBe('idle');
  });

  it('60 s without a final parks the video; a new video is tried afresh', async () => {
    await playing();
    await after(2000);
    const key = pe.of('mse-capture')[0] && (await pe.command.mock.results[2].value).key;
    pe.emit(7, { type: 'capture-event', kind: 'capture', key, event: { type: 'suspended' } });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: false });
    expect(lastState()).toBe('suspended');
    pe.emit(7, { type: 'media', reason: 'timeupdate', media: snap({ currentTime: 90 }), primary: true });
    await after(5000);
    expect(pe.of('mse-capture')).toHaveLength(2);
    pe.evidence.set(7, evidenceOf(7, { mediaId: 'vid00000002', url: 'https://www.youtube.com/watch?v=vid00000002' }));
    pe.emit(7, { type: 'navigated', url: 'https://www.youtube.com/watch?v=vid00000002', mediaId: 'vid00000002', navSeq: 1, site: 'youtube' });
    pe.emit(7, { type: 'media', reason: 'play', media: snap({ currentTime: 1 }), primary: true });
    await after(2000);
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: true });
  });

  it('a session the app took away is retried later; three failures give up', async () => {
    // The key the n-th successful mse-capture on got.
    const openKey = async (n) => {
      const calls = pe.command.mock.calls.map((c, i) => [c[1], i]).filter(([c]) => c.cmd === 'mse-capture' && c.on);
      return (await pe.command.mock.results[calls[n][1]].value).key;
    };
    await playing();
    await after(2000);
    pe.emit(7, { type: 'capture-event', kind: 'capture', key: await openKey(0), event: { type: 'closed', reason: 'preempted' } });
    await flush();
    expect(lastState()).toBe('idle');
    await after(2500);
    expect(pe.of('mse-capture')).toHaveLength(1);
    await after(1000);
    expect(pe.of('mse-capture')).toHaveLength(2);
    // From now on opening fails.
    pe.reply('mse-capture', (c) => {
      if (c.on) throw Object.assign(new Error('busy'), { code: 'busy' });
      return {};
    });
    pe.emit(7, { type: 'capture-event', kind: 'capture', key: await openKey(1), event: { type: 'closed', reason: 'preempted' } });
    for (let i = 0; i < 3; i++) await after(15500);
    const tries = pe.of('mse-capture').filter((c) => c.on).length;
    expect(tries).toBe(5);
    await after(60000);
    expect(pe.of('mse-capture').filter((c) => c.on).length).toBe(tries);
    expect(orch.stateOf(7).failures).toBe(3);
  });
});

describe('tier 1: site captions', () => {
  it('cues for the video upgrade a running capture; translation goes around the playhead first and is cached', async () => {
    await playing();
    await after(2000);
    const cues = cuesOf(120); // 0 … 1199 s
    pe.emit(7, { type: 'subtitle-parsed', url: 'https://www.youtube.com/api/timedtext?v=vid00000001&lang=en', cueCount: cues.length, cues, mediaId: 'vid00000001', lang: 'en', kind: 'asr' });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: false });
    expect(pe.of('site-captions').at(-1)).toMatchObject({ value: 'hide' });
    expect(pe.of('cues').find((c) => c.op === 'set').cues).toHaveLength(120);
    expect(lastState()).toBe('captions');
    expect(orch.stateOf(7).run).toMatchObject({ tier: 1, kind: 'site' });
    // Around t ≈ 32 s: cues within ±120 s, then onwards.
    const first = translate.mock.calls[0];
    expect(first[1]).toEqual({ source: 'en', target: 'zh' });
    const ids = first[0].map((i) => i.id);
    expect(ids[0]).toBe('c0');
    expect(ids).toContain('c15');
    expect(ids).not.toContain('c16');
    await flush();
    const sent = pe.of('cues').filter((c) => c.op === 'translation');
    expect(sent[0].translations[0]).toEqual({ id: 'c0', text: '[zh] line 0', done: true });
    const total = () => pe.of('cues').filter((c) => c.op === 'translation').flatMap((c) => c.translations).length;
    for (let i = 0; i < 10 && total() < 120; i++) await flush();
    expect(total()).toBe(120);
    expect(translate.mock.calls.every((c) => c[0].length <= 50)).toBe(true);

    // Same video again (navigation back): the cache answers before any request.
    const calls = translate.mock.calls.length;
    pe.emit(7, { type: 'navigated', url: 'https://www.youtube.com/watch?v=vid00000001', mediaId: 'vid00000001', navSeq: 1, site: 'youtube' });
    pe.emit(7, { type: 'subtitle-parsed', url: 'https://www.youtube.com/api/timedtext?v=vid00000001&lang=en', cueCount: cues.length, cues, mediaId: 'vid00000001', lang: 'en', kind: 'asr' });
    pe.emit(7, { type: 'media', reason: 'play', media: snap({ currentTime: 500 }), primary: true });
    await flush();
    expect(translate.mock.calls.length).toBe(calls);
    expect(pe.of('cues').filter((c) => c.op === 'translation').at(-1).translations).toHaveLength(120);
  });

  it('captions already in the target language are shown untranslated', async () => {
    await playing();
    pe.emit(7, { type: 'subtitle-parsed', url: 'https://x/zh.vtt', cueCount: 2, cues: cuesOf(2), mediaId: 'vid00000001', lang: 'zh-Hans' });
    await flush();
    expect(pe.of('cues').find((c) => c.op === 'set')).toBeTruthy();
    expect(translate).not.toHaveBeenCalled();
  });

  it('a translator that fails is retried after a while', async () => {
    translate.mockRejectedValueOnce(Object.assign(new Error('no-translator'), { code: 'no-translator' }));
    await playing();
    pe.emit(7, { type: 'subtitle-parsed', url: 'https://x/en.vtt', cueCount: 2, cues: cuesOf(2), mediaId: 'vid00000001', lang: 'en' });
    await flush();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(orch.stateOf(7).translateError).toBe('no-translator');
    await after(30000);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(orch.stateOf(7).translateError).toBeNull();
  });
});

describe('tier 3: DRM and no audio', () => {
  it('DRM shows the notice; accepting opens a listen session at the playhead; pausing closes it, playing reopens', async () => {
    await playing(7, { evidence: { eme: { keySystem: 'com.widevine.alpha' }, mse: { audio: null, streams: [] } } });
    expect(pe.of('notice').at(-1)).toMatchObject({ kind: 'listen' });
    expect(lastState()).toBe('prompt');
    expect(pe.of('listen')).toHaveLength(0);
    pe.emit(7, { type: 'notice-action', kind: 'listen', action: 'accept' });
    await flush();
    const on = pe.of('listen').at(-1);
    expect(on).toMatchObject({ on: true, lang: 'auto', targetLang: 'zh' });
    expect(on.mediaStartS).toBeCloseTo(30, 0);
    expect(lastState()).toBe('listening');
    pe.emit(7, { type: 'media', reason: 'pause', media: snap({ state: 'paused', currentTime: 50 }), primary: true });
    await flush();
    expect(pe.of('listen').at(-1)).toMatchObject({ on: false });
    pe.emit(7, { type: 'media', reason: 'play', media: snap({ currentTime: 50 }), primary: true });
    await flush();
    expect(pe.of('listen').at(-1)).toMatchObject({ on: true });
    expect(pe.of('listen').at(-1).mediaStartS).toBeCloseTo(50, 0);
    expect(pe.of('notice').filter((n) => n.kind === 'listen')).toHaveLength(1);
  });

  it('dismissing keeps the page quiet for that video; autoListen skips the notice', async () => {
    await playing(7, { evidence: { eme: { keySystem: 'com.widevine.alpha' }, mse: { audio: null, streams: [] } } });
    pe.emit(7, { type: 'notice-action', kind: 'listen', action: 'dismiss' });
    await flush();
    pe.emit(7, { type: 'media', reason: 'timeupdate', media: snap({ currentTime: 31 }), primary: true });
    await flush();
    expect(pe.of('notice')).toHaveLength(1);
    expect(pe.of('listen')).toHaveLength(0);
    expect(lastState()).toBe('idle');
    prefs.change({ autoListen: true });
    await flush();
    expect(pe.of('listen').at(-1)).toMatchObject({ on: true });
  });

  it('no hooks in the page means the notice too; DRM appearing mid-capture switches over', async () => {
    await playing(7, { evidence: { hooks: { main: 'missing' }, mse: { audio: null, streams: [] } }, media: { src: 'https://cdn.example/video.mp4' } });
    expect(pe.of('notice').at(-1)).toMatchObject({ kind: 'listen' });
    pe.commands.length = 0;
    await playing(8);
    arbiter.focusedTab = 8;
    arbiter.visibleTabs = new Set([8]);
    orch.evaluate();
    await after(2000);
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ tabId: 8, on: true });
    pe.evidence.get(8).eme = { keySystem: 'com.widevine.alpha' };
    pe.emit(8, { type: 'eme', via: 'request', keySystem: 'com.widevine.alpha' });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ tabId: 8, on: false });
    expect(pe.of('notice').at(-1)).toMatchObject({ tabId: 8, kind: 'listen' });
  });
});

describe('one tab at a time and the gates', () => {
  it('the focused window’s tab wins; the other stops; the old one resumes when it is back', async () => {
    await playing(7);
    await playing(8);
    arbiter.visibleTabs = new Set([7, 8]);
    await after(2000);
    expect(pe.of('mse-capture').map((c) => [c.tabId, c.on])).toEqual([[7, true]]);
    arbiter.focusedTab = 8;
    orch.evaluate();
    await flush();
    expect(pe.of('mse-capture').slice(1).map((c) => [c.tabId, c.on])).toEqual([
      [7, false],
      [8, true],
    ]);
    expect(lastState(7)).toBe('idle');
    expect(lastState(8)).toBe('captions');
    arbiter.focusedTab = 7;
    orch.evaluate();
    await flush();
    expect(pe.of('mse-capture').slice(3).map((c) => [c.tabId, c.on])).toEqual([
      [8, false],
      [7, true],
    ]);
  });

  it('a tab nobody looks at never starts; a paused tab yields to a playing one', async () => {
    arbiter.visibleTabs = new Set();
    await playing(7);
    await after(3000);
    expect(pe.of('mse-capture')).toHaveLength(0);
    expect(lastState()).toBe('idle');
  });

  it('site switched off, extension disabled, channel offline', async () => {
    prefs.p.siteOff = { youtube: true };
    await playing();
    await after(3000);
    expect(pe.of('mse-capture')).toHaveLength(0);
    expect(lastState()).toBe('off');
    prefs.change({ siteOff: {} });
    await after(2000);
    expect(pe.of('mse-capture')).toHaveLength(1);
    prefs.change({ enabled: false });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: false });
    expect(lastState()).toBe('off');
    prefs.change({ enabled: true });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: true });
    orch.setCompanion({ status: 'offline' });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: false });
    orch.setCompanion({ status: 'ready' });
    await flush();
    expect(pe.of('mse-capture').at(-1)).toMatchObject({ on: true });
  });

  it('a stream that went away is decided on again at once; a page that could not keep up waits', async () => {
    await playing();
    await after(2000);
    pe.emit(7, { type: 'capture', on: false, streamId: 1, reason: 'stream-gone', pushes: 3, bytes: 100 });
    await flush();
    expect(pe.of('mse-capture').filter((c) => c.on)).toHaveLength(2);
    pe.emit(7, { type: 'capture', on: false, streamId: 1, reason: 'overflow', pushes: 3, bytes: 100 });
    await after(1000);
    expect(pe.of('mse-capture').filter((c) => c.on)).toHaveLength(2);
    await after(15000);
    expect(pe.of('mse-capture').filter((c) => c.on)).toHaveLength(3);
    expect(orch.stateOf(7).history.map((h) => h.state)).toEqual(['waiting', 'captions', 'idle', 'captions', 'idle', 'captions']);
  });

  it('display and mode preferences reach a running tab; a closed tab is forgotten', async () => {
    await playing();
    await after(2000);
    prefs.change({ display: 'translation', mode: 'overlay' });
    await flush();
    expect(pe.of('display').at(-1)).toMatchObject({ value: 'translation' });
    expect(pe.of('mode').at(-1)).toMatchObject({ value: 'overlay' });
    pe.emit(7, { type: 'forgotten', reason: 'tab-closed' });
    await flush();
    expect(orch.stateOf(7)).toBeNull();
    expect(states.at(-1)).toEqual({ tabId: 7, state: null, detail: undefined });
    expect(orch.active()).toBeNull();
  });
});

describe('the subtitle cache', () => {
  const KEY = 'youtube:vid00000001';
  const record = (over = {}) => ({ cues: cuesOf(6).map((c) => ({ ...c, translation: `[zh] ${c.text}` })), tier: 2, lang: 'en', target: 'zh', ...over });
  let store;
  let memory;
  const fakeCache = () => {
    const c = { records: new Map() };
    c.get = vi.fn(async (k) => c.records.get(k) ?? null);
    c.put = vi.fn(async (k, r) => c.records.set(k, r));
    return c;
  };
  // A fresh orchestrator over fresh page-events, with the two caches.
  function withCache({ record: rec = null, privacyMode = null } = {}) {
    pe = fakePageEvents();
    store = fakeCache();
    memory = fakeCache();
    if (rec) store.records.set(KEY, rec);
    states = [];
    orch = createOrchestrator({ pageEvents: pe, arbiter, prefs, translate, onState: (tabId, state, detail) => states.push({ tabId, state, detail }), logger: { warn: () => {}, debug: () => {} }, cache: store, memoryCache: memory });
    orch.setCompanion({ status: 'ready', privacyMode });
  }
  const segment = (key, id, start, end, text) => pe.emit(7, { type: 'capture-event', kind: 'capture', key, event: { type: 'segment', id, start, end, text } });
  const translated = (key, id, text) => pe.emit(7, { type: 'capture-event', kind: 'capture', key, event: { type: 'translation', id, text, done: true } });
  const sets = () => pe.of('cues').filter((c) => c.op === 'set');
  const batches = () => pe.of('cues').filter((c) => c.op === 'translation');

  it('coverage helpers: stretches across small gaps, the tail of one, the edge being left', () => {
    const stretches = coverageOf([{ start: 40, end: 45 }, { start: 0, end: 4 }, { start: 5, end: 9 }, { start: 30, end: 34 }]);
    expect(stretches).toEqual([{ start: 0, end: 9 }, { start: 30, end: 45 }]); // 9 → 30 is a real gap, 34 → 40 is not
    expect(coveredAt(stretches, 3)).toEqual({ start: 0, end: 9 });
    expect(coveredAt(stretches, 7.5)).toBeNull(); // the last 2 s do not count
    expect(coveredAt(stretches, 12)).toBeNull();
    expect(coveredAt(stretches, 29.5)).toEqual({ start: 30, end: 45 });
    expect(coveredEdge(stretches, 8)).toBe(9);
    expect(coveredEdge(stretches, 50)).toBe(45);
    expect(coveredEdge([], 40)).toBe(0);
    expect(coverageOf([{ start: 5, end: 9 }])).toEqual([{ start: 0, end: 9 }]); // a quiet head counts as covered
  });

  it('a cached video shows its cues at once, channel or not; the stored translations follow once served; nothing is recognized inside the covered stretch', async () => {
    withCache({ record: record() }); // covers 0–59
    orch.setCompanion({ status: 'unpaired' });
    await playing(7, { media: { currentTime: 20 } });
    await flush();
    expect(store.get).toHaveBeenCalledWith(KEY);
    expect(sets()).toHaveLength(1);
    expect(sets()[0].cues).toHaveLength(6);
    expect(sets()[0].cues[0]).toEqual({ id: 'c0', start: 0, end: 9, text: 'line 0' });
    expect(pe.of('site-captions')[0]).toMatchObject({ value: 'hide' });
    expect(orch.stateOf(7)).toMatchObject({ state: 'captions', run: null, block: 'offline', cached: { count: 6, tier: 2, covered: true } });
    expect(batches()).toHaveLength(0);
    orch.setCompanion({ status: 'ready' });
    await flush();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].translations).toHaveLength(6);
    expect(batches()[0].translations[0]).toEqual({ id: 'c0', text: '[zh] line 0', done: true });
    expect(translate).not.toHaveBeenCalled();
    await after(3000);
    expect(pe.of('mse-capture')).toHaveLength(0);
    expect(lastState()).toBe('captions');
  });

  it('past the covered stretch recognition starts at its edge; a seek back inside stops it, a seek beyond starts again', async () => {
    withCache({ record: record() }); // covers 0–59
    await playing(7, { media: { currentTime: 57.5 } });
    await after(2000);
    const on = pe.of('mse-capture').filter((c) => c.on);
    expect(on).toHaveLength(1);
    expect(on[0].fromS).toBe(59);
    const key = 'tab:7:1';
    segment(key, 'm1-0', 60, 64, 'sixty');
    pe.emit(7, { type: 'media', reason: 'seeked', media: snap({ currentTime: 10 }), primary: true });
    await flush();
    expect(pe.of('mse-capture').filter((c) => !c.on)).toHaveLength(1);
    expect(orch.stateOf(7)).toMatchObject({ state: 'captions', run: null, cached: { covered: true } });
    await after(5000);
    expect(pe.of('mse-capture').filter((c) => c.on)).toHaveLength(1);
    pe.emit(7, { type: 'media', reason: 'seeked', media: snap({ currentTime: 100 }), primary: true });
    await after(100);
    const again = pe.of('mse-capture').filter((c) => c.on);
    expect(again).toHaveLength(2);
    expect(again[1].fromS).toBeCloseTo(95, 0);
  });

  it('what runs is written back merged with the record, under ids a later run cannot reuse; a translation after the write still lands', async () => {
    withCache({ record: record({ cues: cuesOf(2) }) }); // covers 0–19, no translations
    await playing(7, { media: { currentTime: 30 } });
    await after(2000);
    const key = 'tab:7:1';
    segment(key, 'm1-0', 32, 35, 'a');
    translated(key, 'm1-0', '[zh] a');
    segment(key, 'm1-1', 36, 40, 'b');
    expect(store.put).not.toHaveBeenCalled();
    await after(30000);
    expect(store.put).toHaveBeenCalledTimes(1);
    const [k, rec] = store.put.mock.calls[0];
    expect(k).toBe(KEY);
    expect(rec).toMatchObject({ tier: 2, lang: 'en', target: 'zh' }); // the record's language stays
    // The record's own cues had no translations: translateCached filled them in meanwhile.
    expect(rec.cues.map((c) => [c.text, c.translation])).toEqual([['line 0', '[zh] line 0'], ['line 1', '[zh] line 1'], ['a', '[zh] a'], ['b', null]]);
    expect(rec.cues[2].id).toMatch(/^c[0-9a-z]+-m1-0$/);
    translated(key, 'm1-1', '[zh] b');
    await after(30000);
    expect(store.put).toHaveBeenCalledTimes(2);
    expect(store.put.mock.calls[1][1].cues[3]).toMatchObject({ text: 'b', translation: '[zh] b' });
    // The pause grace stops the run; a final flushed after the stop still joins the record.
    pe.emit(7, { type: 'media', reason: 'pause', media: snap({ currentTime: 41, state: 'paused' }), primary: true });
    await after(5000);
    expect(orch.stateOf(7)).toMatchObject({ run: null, cached: { count: 4, covered: false } });
    segment(key, 'm1-2', 40, 43, 'late');
    await after(30000);
    expect(store.put).toHaveBeenCalledTimes(3);
    expect(store.put.mock.calls[2][1].cues.map((c) => c.text)).toEqual(['line 0', 'line 1', 'a', 'b', 'late']);
    // Playing on from 44 restarts at the record's edge, 43.
    pe.emit(7, { type: 'media', reason: 'play', media: snap({ currentTime: 44 }), primary: true });
    await after(2000);
    const on = pe.of('mse-capture').filter((c) => c.on);
    expect(on).toHaveLength(2);
    expect(on[1].fromS).toBeCloseTo(43, 0);
  });

  it('secure mode and incognito tabs keep records in memory only', async () => {
    withCache({ privacyMode: 'secure' });
    await playing(7, { media: { currentTime: 30 } });
    await after(2000);
    segment('tab:7:1', 'm1-0', 32, 35, 'a');
    await after(30000);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
    expect(memory.get).toHaveBeenCalledWith(KEY);
    expect(memory.put).toHaveBeenCalledTimes(1);

    withCache();
    await playing(7, { evidence: { incognito: true }, media: { currentTime: 30 } });
    await after(2000);
    segment('tab:7:1', 'm1-0', 32, 35, 'a');
    await after(30000);
    expect(store.get).not.toHaveBeenCalled();
    expect(memory.get).toHaveBeenCalledWith(KEY);
    expect(memory.put).toHaveBeenCalledTimes(1);
  });

  it('a record for another target shows its originals and is translated again; the write carries the new target', async () => {
    withCache({ record: record({ target: 'en', cues: cuesOf(6).map((c) => ({ ...c, translation: `[en] ${c.text}` })) }) });
    await playing(7, { media: { currentTime: 20 } });
    await flush();
    expect(sets()).toHaveLength(1);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][1]).toEqual({ source: 'en', target: 'zh' });
    expect(batches()).toHaveLength(1);
    expect(batches()[0].translations[0]).toEqual({ id: 'c0', text: '[zh] line 0', done: true });
    await after(30000);
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put.mock.calls[0][1]).toMatchObject({ tier: 2, lang: 'en', target: 'zh' });
    expect(store.put.mock.calls[0][1].cues[5].translation).toBe('[zh] line 5');
  });

  it('site captions replace the record and carry their translations', async () => {
    withCache({ record: record() });
    await playing(7, { media: { currentTime: 20 } });
    await flush();
    const siteCues = cuesOf(3, 100).map((c, i) => ({ ...c, id: `s${i}` }));
    pe.emit(7, { type: 'subtitle-parsed', url: 'https://www.youtube.com/api/timedtext?v=vid00000001', cueCount: 3, cues: siteCues, lang: 'en', kind: '', mediaId: 'vid00000001' });
    await flush();
    expect(sets()).toHaveLength(2);
    expect(sets()[1].cues.map((c) => c.id)).toEqual(['s0', 's1', 's2']);
    expect(orch.stateOf(7)).toMatchObject({ state: 'captions', run: { tier: 1 } });
    await after(30000);
    expect(store.put).toHaveBeenCalledTimes(1);
    const rec = store.put.mock.calls[0][1];
    expect(rec).toMatchObject({ tier: 1, lang: 'en', target: 'zh' });
    expect(rec.cues.map((c) => [c.id, c.translation])).toEqual([['s0', '[zh] line 0'], ['s1', '[zh] line 1'], ['s2', '[zh] line 2']]);
  });
});
