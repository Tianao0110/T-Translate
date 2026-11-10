// @vitest-environment-options { "url": "https://www.youtube.com/watch?v=UF8uR6Z6KLc" }
//
// The isolated-world page agent with a fake chrome.runtime and a fake bridge
// on a YouTube URL: what it reports (navigation, hooks, media, parsed
// subtitles, MSE streams), its PAGE_COMMANDs reaching the caption renderer
// (real renderer over a fake TextTrack), site captions, capture forwarding
// as PAGE_MEDIA, page-world commands, navigation clearing the page, a new
// service worker getting everything again, and the missing-page-world report.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPageAgent, splitCues } from '../src/content/page-agent.js';
import { createCaptionRenderer } from '../src/content/caption-renderer.js';
import { MSG, decodeBytes } from '../src/shared/messages.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const JSON3 = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello' }] }, { tStartMs: 3000, dDurationMs: 1500, segs: [{ utf8: 'Stanford' }] }] });
const TIMEDTEXT = 'https://www.youtube.com/api/timedtext?v=UF8uR6Z6KLc&lang=en&kind=asr&fmt=json3&pot=abc';
const EBML = [0x1a, 0x45, 0xdf, 0xa3, 0x9f];

function fakeRuntime() {
  const listeners = new Set();
  const rt = {
    id: EXT_ID,
    sent: [],
    boot: 'boot-1',
    mediaReply: { ok: true, result: { accepted: true, ended: false } },
    onMessage: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    async sendMessage(msg) {
      rt.sent.push(msg);
      if (msg.type === MSG.PAGE_EVENT) return { ok: true, result: { boot: rt.boot } };
      if (msg.type === MSG.PAGE_MEDIA) return rt.mediaReply;
      return undefined;
    },
    // A PAGE_COMMAND from the worker (no sender.tab).
    command(payload, sender = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/sw.js` }) {
      return new Promise((resolve) => {
        for (const fn of listeners) fn({ type: MSG.PAGE_COMMAND, payload }, sender, resolve);
      });
    },
    events: (type) => rt.sent.filter((m) => m.type === MSG.PAGE_EVENT && (!type || m.payload.event.type === type)).map((m) => m.payload.event),
  };
  return rt;
}

function fakeTrackFactory() {
  const tracks = [];
  const addTextTrack = (v, kind, label, language) => {
    const list = [];
    const t = { kind, label, language, mode: 'disabled', list, get cues() { return list.slice(); }, addCue: (c) => list.push(c), removeCue: (c) => list.splice(list.indexOf(c), 1) };
    tracks.push(t);
    return t;
  };
  const createCue = (startTime, endTime, text) => ({ startTime, endTime, text, id: '' });
  return { tracks, makeRenderer: (opts) => createCaptionRenderer({ ...opts, addTextTrack, createCue }) };
}

function mountVideo({ playing = true, w = 1280, h = 720 } = {}) {
  const v = document.createElement('video');
  Object.defineProperty(v, 'paused', { configurable: true, get: () => !playing });
  Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(v, 'duration', { configurable: true, value: 900 });
  v.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h });
  v.src = 'blob:https://www.youtube.com/ms-a';
  document.body.append(v);
  return v;
}

let agent;
function start(opts = {}) {
  const runtime = fakeRuntime();
  const bridge = { connected: true, command: vi.fn(async (cmd, args) => ({ ran: cmd, args })), close: vi.fn(), onEvent: null };
  const { tracks, makeRenderer } = fakeTrackFactory();
  agent = createPageAgent({
    runtime,
    makeBridge: ({ onEvent }) => {
      bridge.onEvent = onEvent;
      return bridge;
    },
    makeRenderer,
    statsMs: 0,
    ...opts,
  });
  return { runtime, bridge, tracks, main: (ev) => bridge.onEvent(ev) };
}

afterEach(() => {
  agent?.shutdown();
  agent = null;
  document.body.innerHTML = '';
  history.replaceState(null, '', '/watch?v=UF8uR6Z6KLc');
});

describe('reports', () => {
  it('navigation first, then hooks, media and parsed subtitles', async () => {
    mountVideo();
    const { runtime, main } = start();
    await tick();
    expect(runtime.events('navigated')).toEqual([{ type: 'navigated', url: 'https://www.youtube.com/watch?v=UF8uR6Z6KLc', mediaId: 'UF8uR6Z6KLc', navSeq: 0, site: 'youtube', resync: false }]);
    const [added] = runtime.events('media');
    expect(added).toMatchObject({ reason: 'added', media: { elId: 1, tag: 'video', state: 'playing', duration: 900, width: 1280, height: 720, src: 'blob:https://www.youtube.com/ms-a' } });

    main({ k: 'hooks', status: { fetch: 'ok', xhr: 'ok', mse: 'ok', objectUrl: 'ok', eme: 'ok' } });
    main({ k: 'subtitle', via: 'xhr', url: TIMEDTEXT, status: 200, contentType: 'application/json', text: JSON3 });
    await tick();
    expect(runtime.events('hooks')).toEqual([{ type: 'hooks', hooks: { main: 'ok', fetch: 'ok', xhr: 'ok', mse: 'ok', objectUrl: 'ok', eme: 'ok' } }]);
    const [sub] = runtime.events('subtitle-parsed');
    expect(sub).toMatchObject({ subId: 1, url: TIMEDTEXT, via: 'xhr', format: 'json3', lang: 'en', kind: 'asr', mediaId: 'UF8uR6Z6KLc', cueCount: 2, part: 0, parts: 1 });
    expect(sub.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 3, 'Hello'],
      [3, 4.5, 'Stanford'],
    ]);
    expect(runtime.sent.every((m) => m.payload.docId === agent.docId)).toBe(true);
  });

  it('unreadable subtitles are reported with no cues; long lists are split to fit', async () => {
    const { runtime, main } = start();
    main({ k: 'subtitle', via: 'fetch', url: 'https://www.youtube.com/api/timedtext?v=UF8uR6Z6KLc&fmt=srv3', status: 200, contentType: 'text/xml', text: '<timedtext format="3"></timedtext>' });
    await tick();
    expect(runtime.events('subtitle-parsed')[0]).toMatchObject({ format: null, cueCount: 0, parts: 1, cues: [] });
    const cues = Array.from({ length: 50 }, (_, i) => ({ id: String(i), start: i, end: i + 1, text: 'x'.repeat(40) }));
    const parts = splitCues(cues, 1000);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.flat()).toEqual(cues);
    expect(parts.every((p) => JSON.stringify(p).length <= 1000)).toBe(true);
    expect(splitCues([])).toEqual([[]]);
  });

  it('MSE streams are reported, the one feeding the primary video marked main', async () => {
    mountVideo();
    const { runtime, main } = start();
    main({ k: 'mse-source', msId: 1, url: 'blob:https://www.youtube.com/ms-a' });
    main({ k: 'mse-buffer', sbId: 1, msId: 1, mime: 'video/mp4; codecs="av01"' });
    main({ k: 'mse-buffer', sbId: 2, msId: 1, mime: 'audio/webm; codecs="opus"' });
    main({ k: 'mse-chunk', sbId: 2, seq: 0, init: true, size: 5, bytes: new Uint8Array(EBML).buffer });
    await tick(5);
    const last = new Map(runtime.events('mse-stream').map((e) => [e.stream.streamId, e]));
    expect(last.get(2)).toMatchObject({ main: true, stream: { kind: 'audio', forward: true, init: true, chunks: 1, url: 'blob:https://www.youtube.com/ms-a' } });
    expect(last.get(1)).toMatchObject({ main: false, stream: { kind: 'video' } });
  });

  it('without the page world, says so', async () => {
    const { runtime } = start({ makeBridge: () => ({ connected: false, command: vi.fn(), close: vi.fn() }), hooksTimeoutMs: 5 });
    await tick(20);
    expect(runtime.events('hooks')).toEqual([{ type: 'hooks', hooks: { main: 'missing' } }]);
  });

  it('a new service worker (another boot id) gets the whole page again', async () => {
    mountVideo();
    const { runtime, main } = start();
    main({ k: 'hooks', status: { fetch: 'ok', xhr: 'ok', mse: 'ok', objectUrl: 'ok', eme: 'ok' } });
    main({ k: 'eme', via: 'request', keySystem: 'com.widevine.alpha' });
    await tick();
    runtime.sent.length = 0;
    runtime.boot = 'boot-2';
    main({ k: 'mse-closed', msId: 5 });
    main({ k: 'subtitle', via: 'xhr', url: TIMEDTEXT, status: 200, contentType: 'application/json', text: JSON3 });
    await tick(5);
    const types = runtime.events().map((e) => e.type);
    expect(types[0]).toBe('subtitle-parsed');
    expect(types.slice(1)).toEqual(expect.arrayContaining(['navigated', 'hooks', 'media', 'subtitle-parsed', 'eme']));
    expect(runtime.events('navigated')[0].resync).toBe(true);
  });
});

describe('commands', () => {
  it('only the extension’s worker may command', async () => {
    mountVideo();
    const { runtime } = start();
    expect(await runtime.command({ cmd: 'query' }, { id: EXT_ID, tab: { id: 1 }, url: 'https://www.youtube.com/' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await runtime.command({ cmd: 'nope' })).toMatchObject({ ok: false, error: { code: 'unknown-command' } });
  });

  it('cues, translations, display and mode go to the renderer on the primary video', async () => {
    mountVideo({ playing: false, w: 200, h: 100 });
    const big = mountVideo();
    const { runtime, tracks } = start();
    const r = await runtime.command({ cmd: 'cues', op: 'set', cues: [{ id: '1', start: 1, end: 3, text: 'Hello' }, { id: '2', start: 3, end: 5, text: 'Fish & chips' }, { id: 'bad', start: 'x' }] });
    expect(r).toEqual({ ok: true, result: { cues: 2, mode: 'track', display: 'bilingual' } });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].mode).toBe('showing');
    await runtime.command({ cmd: 'cues', op: 'translation', id: '2', text: '炸鱼薯条', done: true });
    await runtime.command({ cmd: 'cues', op: 'upsert', cue: { id: 'm1-0', start: 6, end: 8, text: 'Live' } });
    expect(tracks[0].list.map((c) => c.text)).toEqual(['Hello', 'Fish &amp; chips\n炸鱼薯条', 'Live']);
    await runtime.command({ cmd: 'display', value: 'translation' });
    expect(tracks[0].list[1].text).toBe('炸鱼薯条');
    expect(await runtime.command({ cmd: 'display', value: 'loud' })).toMatchObject({ ok: false, error: { code: 'bad-command' } });
    const q = await runtime.command({ cmd: 'query' });
    expect(q.result).toMatchObject({ mediaId: 'UF8uR6Z6KLc', site: 'youtube', bridge: true, renderer: { cues: 3, mode: 'track', display: 'translation' }, view: { display: 'translation', mode: 'track' } });
    expect(q.result.primary).toBe(2);
    expect(big.textTracks).toBeDefined();
  });

  it('the notice shows on the primary video with the locale’s words; its buttons report back; navigation removes it', async () => {
    mountVideo();
    const notices = [];
    const makeNotice = (opts) => {
      const n = { opts, shown: null, visible: false, kind: null, destroyed: false, show(s) {
        n.shown = s;
        n.visible = true;
        n.kind = s.kind;
      }, hide() {
        n.visible = false;
        n.kind = null;
      }, destroy() {
        n.destroyed = true;
      } };
      notices.push(n);
      return n;
    };
    const i18n = { getMessage: (k) => ({ noticeListen: '读不到音频', noticeListenButton: '开始听译', noticeDismiss: '关闭' })[k] || '' };
    const { runtime } = start({ makeNotice, i18n });
    expect(await runtime.command({ cmd: 'notice', kind: 'listen' })).toEqual({ ok: true, result: { kind: 'listen' } });
    expect(notices).toHaveLength(1);
    expect(notices[0].shown).toEqual({ kind: 'listen', text: '读不到音频', button: '开始听译', dismissTitle: '关闭' });
    expect((await runtime.command({ cmd: 'query' })).result.notice).toBe('listen');
    notices[0].opts.onAccept('listen');
    notices[0].opts.onDismiss('listen');
    await tick();
    expect(runtime.events('notice-action')).toEqual([
      { type: 'notice-action', kind: 'listen', action: 'accept' },
      { type: 'notice-action', kind: 'listen', action: 'dismiss' },
    ]);
    expect(await runtime.command({ cmd: 'notice', kind: null })).toEqual({ ok: true, result: { kind: null } });
    expect(notices[0].visible).toBe(false);
    expect(await runtime.command({ cmd: 'notice', kind: 'dance' })).toMatchObject({ ok: false, error: { code: 'bad-command' } });
    await runtime.command({ cmd: 'notice', kind: 'listen' });
    history.pushState(null, '', '/watch?v=nextVideo01');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await tick();
    expect(notices[0].destroyed).toBe(true);
  });

  it('mse-capture passes fromS on; a visibility change reports the primary video', async () => {
    mountVideo();
    const { runtime, main } = start();
    main({ k: 'mse-source', msId: 1, url: 'blob:https://www.youtube.com/ms-a' });
    main({ k: 'mse-buffer', sbId: 3, msId: 1, mime: 'audio/webm; codecs="opus"' });
    main({ k: 'mse-chunk', sbId: 3, seq: 0, init: true, size: 5, bytes: new Uint8Array(EBML).buffer });
    main({ k: 'mse-chunk', sbId: 3, seq: 1, init: false, size: 3, bytes: new Uint8Array([1, 2, 3]).buffer });
    const on = await runtime.command({ cmd: 'mse-capture', on: true, fromS: 100 });
    // The held chunk has no cluster time, so it is kept; the backlog is init + chunk.
    expect(on).toEqual({ ok: true, result: { on: true, streamId: 3, backlogBytes: 8, init: true } });
    runtime.sent.length = 0;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(runtime.events('media')).toEqual([expect.objectContaining({ type: 'media', reason: 'visibility', primary: true, media: expect.objectContaining({ pageVisible: false }) })]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('a video-less page refuses cues; site captions hide and show', async () => {
    const { runtime } = start();
    expect(await runtime.command({ cmd: 'cues', op: 'set', cues: [] })).toMatchObject({ ok: false, error: { code: 'no-video' } });
    expect(await runtime.command({ cmd: 'site-captions', value: 'hide' })).toEqual({ ok: true, result: { siteCaptions: 'hide', applied: true } });
    expect([...document.querySelectorAll('style')].some((s) => s.textContent.includes('ytp-caption-window-container'))).toBe(true);
    await runtime.command({ cmd: 'site-captions', value: 'show' });
    expect([...document.querySelectorAll('style')].some((s) => s.textContent.includes('ytp-caption-window-container'))).toBe(false);
  });

  it('page-world actions go over the bridge', async () => {
    const { runtime, bridge } = start();
    expect(await runtime.command({ cmd: 'yt-captions-on', args: { waitMs: 100 } })).toEqual({ ok: true, result: { ran: 'yt-captions-on', args: { waitMs: 100 } } });
    expect(bridge.command).toHaveBeenCalledWith('yt-captions-on', { waitMs: 100 }, 20000);
  });

  it('mse-capture forwards the main audio stream as PAGE_MEDIA, init first; off stops it', async () => {
    mountVideo();
    const { runtime, main } = start();
    expect(await runtime.command({ cmd: 'mse-capture', on: true })).toMatchObject({ ok: false, error: { code: 'no-stream' } });
    main({ k: 'mse-source', msId: 1, url: 'blob:https://www.youtube.com/ms-a' });
    main({ k: 'mse-buffer', sbId: 3, msId: 1, mime: 'audio/webm; codecs="opus"' });
    main({ k: 'mse-chunk', sbId: 3, seq: 0, init: true, size: 5, bytes: new Uint8Array(EBML).buffer });
    main({ k: 'mse-chunk', sbId: 3, seq: 1, init: false, size: 3, bytes: new Uint8Array([1, 2, 3]).buffer });
    const on = await runtime.command({ cmd: 'mse-capture', on: true });
    expect(on).toEqual({ ok: true, result: { on: true, streamId: 3, backlogBytes: 8, init: true } });
    await tick(5);
    const pushes = runtime.sent.filter((m) => m.type === MSG.PAGE_MEDIA).map((m) => m.payload);
    expect(pushes.map((p) => [p.streamId, p.seq, p.init, [...decodeBytes(p.bytes)]])).toEqual([
      [3, 0, true, EBML],
      [3, 1, false, [1, 2, 3]],
    ]);
    expect((await runtime.command({ cmd: 'mse-capture', on: false })).result).toMatchObject({ on: false, streamId: 3, pushes: 2, reason: 'off' });

    runtime.mediaReply = { ok: true, result: { accepted: false, reason: 'not-capturing' } };
    await runtime.command({ cmd: 'mse-capture', on: true });
    await tick(5);
    expect(runtime.events('capture')).toEqual([{ type: 'capture', on: false, streamId: 3, pushes: 1, bytes: 5, reason: 'not-capturing' }]);
  });
});

describe('navigation', () => {
  it('clears the page: new navSeq and media id, renderer gone, site captions back, the new video’s captions kept', async () => {
    mountVideo();
    const { runtime, main, tracks } = start();
    await runtime.command({ cmd: 'cues', op: 'set', cues: [{ id: '1', start: 1, end: 2, text: 'old' }] });
    await runtime.command({ cmd: 'site-captions', value: 'hide' });
    main({ k: 'subtitle', via: 'xhr', url: TIMEDTEXT, status: 200, contentType: 'application/json', text: JSON3 });
    main({ k: 'subtitle', via: 'xhr', url: 'https://www.youtube.com/api/timedtext?v=nextVideo01&lang=en&fmt=json3', status: 200, contentType: 'application/json', text: JSON3 });
    await tick();
    runtime.sent.length = 0;

    history.pushState(null, '', '/watch?v=nextVideo01');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await tick();
    expect(runtime.events('navigated')).toEqual([{ type: 'navigated', url: 'https://www.youtube.com/watch?v=nextVideo01', mediaId: 'nextVideo01', navSeq: 1, site: 'youtube', resync: false }]);
    expect(runtime.sent.filter((m) => m.type === MSG.PAGE_EVENT).every((m) => m.payload.navSeq === 1)).toBe(true);
    expect(runtime.events('subtitle-parsed').map((e) => e.mediaId)).toEqual(['nextVideo01']);
    expect(tracks[0].list).toEqual([]);
    expect([...document.querySelectorAll('style')].some((s) => s.textContent.includes('ytp-caption'))).toBe(false);
    const q = (await runtime.command({ cmd: 'query' })).result;
    expect(q).toMatchObject({ navSeq: 1, mediaId: 'nextVideo01', renderer: null, view: { siteCaptions: 'show' } });
    expect(q.subtitles).toHaveLength(1);
  });
});
