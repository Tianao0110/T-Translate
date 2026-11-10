// @vitest-environment node
//
// The service worker's page evidence over fake chrome.tabs and a fake
// offscreen: only top frames on the manifest's hosts may report; events
// build the per-tab evidence (subtitle parts reassembled for listeners),
// stale and malformed ones are dropped, navigation and closing the tab clear
// it; the capture glue opens / pushes / closes the media stream under its key
// and turns pipeline segments and translations into `cues` commands.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPageEvents, matchPattern } from '../src/sw/page-events.js';
import { MSG } from '../src/shared/messages.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const MANIFEST = {
  content_scripts: [
    { matches: ['*://*.youtube.com/*', '*://*.bilibili.com/*'], js: ['content-main.js'], world: 'MAIN' },
    { matches: ['*://*.youtube.com/*', '*://*.bilibili.com/*'], js: ['content-isolated.js'] },
  ],
};
const WATCH = 'https://www.youtube.com/watch?v=UF8uR6Z6KLc';
const tick = () => new Promise((r) => setTimeout(r, 0));

function listenerSet() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...a) => fns.forEach((fn) => fn(...a)) };
}

let tabs;
let offscreen;
let pe;
let heard;
let tabReplies;

beforeEach(() => {
  tabReplies = {};
  tabs = {
    sent: [],
    sendMessage: vi.fn(async (tabId, msg, opts) => {
      tabs.sent.push({ tabId, cmd: msg.payload, frameId: opts?.frameId, type: msg.type });
      const r = tabReplies[msg.payload.cmd];
      return r ? r(msg.payload) : { ok: true, result: { done: true } };
    }),
    onRemoved: listenerSet(),
    onUpdated: listenerSet(),
  };
  offscreen = {
    calls: [],
    fail: {},
    async call(type, payload) {
      offscreen.calls.push({ type, payload });
      if (offscreen.fail[type]) throw Object.assign(new Error(offscreen.fail[type]), { code: offscreen.fail[type] });
      if (type === MSG.MEDIA_OPEN) return { key: payload.key };
      if (type === MSG.MEDIA_PUSH) return { ended: false };
      if (type === MSG.MEDIA_CLOSE) return { bytes: 1, blocks: 1 };
      return null;
    },
  };
  pe = createPageEvents({ runtime: { id: EXT_ID }, tabs, manifest: MANIFEST, toOffscreen: (t, p) => offscreen.call(t, p), bootId: 'boot-1', now: () => 1000 });
  heard = [];
  pe.onPageEvent((e) => heard.push(e));
});

const sender = (tabId = 7, extra = {}) => ({ id: EXT_ID, tab: { id: tabId }, frameId: 0, url: WATCH, ...extra });
const report = (event, { tabId = 7, docId = 'doc-a', navSeq = 0 } = {}) => pe.contentHandlers[MSG.PAGE_EVENT]({ docId, navSeq, event }, sender(tabId));
const nav = (navSeq = 0, mediaId = 'UF8uR6Z6KLc', opts = {}) => report({ type: 'navigated', url: WATCH, mediaId, navSeq, site: 'youtube' }, { navSeq, ...opts });
const mediaSnap = (elId, extra = {}) => ({ elId, tag: 'video', src: 'blob:https://www.youtube.com/a', msId: 1, state: 'playing', currentTime: 12, duration: 900, muted: false, volume: 1, readyState: 4, width: 1280, height: 720, visible: true, pageVisible: true, ...extra });
const stream = (streamId, extra = {}) => ({ streamId, msId: 1, url: 'blob:https://www.youtube.com/a', mime: 'audio/webm; codecs="opus"', kind: 'audio', codec: 'opus', forward: true, alive: true, init: true, inits: 1, chunks: 5, bytes: 50000, firstTimeS: 0, lastTimeS: 60, ...extra });

describe('who may report', () => {
  it('top frames of tabs on the manifest hosts only', () => {
    expect(pe.fromPage({}, sender())).toBe(true);
    expect(pe.fromPage({}, sender(7, { url: 'https://m.youtube.com/watch?v=x' }))).toBe(true);
    expect(pe.fromPage({}, sender(7, { frameId: 3 }))).toBe(false);
    expect(pe.fromPage({}, { id: EXT_ID, frameId: 0, url: WATCH })).toBe(false);
    expect(pe.fromPage({}, sender(7, { url: 'https://evil.example/?u=https://www.youtube.com/' }))).toBe(false);
    expect(pe.fromPage({}, sender(7, { url: `chrome-extension://${EXT_ID}/options.html` }))).toBe(false);
    expect(pe.fromPage({}, sender(7, { id: 'someoneelse' }))).toBe(false);
  });

  it('match patterns', () => {
    const m = matchPattern('*://*.youtube.com/*');
    expect(m('https://youtube.com/')).toBe(true);
    expect(m('http://www.youtube.com/watch?v=1')).toBe(true);
    expect(m('https://www.youtube.com.evil.example/')).toBe(false);
    expect(m('ftp://www.youtube.com/')).toBe(false);
    expect(matchPattern('nonsense')('https://x/')).toBe(false);
  });
});

describe('evidence', () => {
  it('builds up from events and reads back as a copy', () => {
    expect(nav()).toEqual({ boot: 'boot-1' });
    report({ type: 'hooks', hooks: { main: 'ok', fetch: 'ok', xhr: 'ok', mse: 'ok', objectUrl: 'ok', eme: 'ok' } });
    report({ type: 'media', reason: 'play', media: mediaSnap(1), primary: true });
    report({ type: 'media', reason: 'added', media: mediaSnap(2, { tag: 'audio', state: 'idle' }) });
    report({ type: 'media', reason: 'timeupdate', media: mediaSnap(1, { currentTime: 13 }), primary: true });
    report({ type: 'mse-stream', stream: stream(2, { kind: 'video', mime: 'video/mp4', forward: false }), main: false });
    report({ type: 'mse-stream', stream: stream(1), main: true });
    report({ type: 'eme', via: 'request', keySystem: 'com.widevine.alpha' });
    report({ type: 'eme', via: 'encrypted', initDataType: 'cenc' });
    report({ type: 'eme', via: 'request', keySystem: 'org.w3.clearkey' });

    const ev = pe.getTabEvidence(7);
    expect(ev).toMatchObject({ tabId: 7, url: WATCH, site: 'youtube', mediaId: 'UF8uR6Z6KLc', navSeq: 0, hooks: { main: 'ok', mse: 'ok' }, primaryElId: 1 });
    expect(ev.media.map((m) => [m.elId, m.currentTime])).toEqual([
      [1, 13],
      [2, 12],
    ]);
    expect(ev.mse.audio).toEqual({ streamId: 1, mime: 'audio/webm; codecs="opus"', codec: 'opus', forward: true, init: true, chunks: 5, bytes: 50000, firstTimeS: 0, lastTimeS: 60 });
    expect(ev.mse.streams).toHaveLength(2);
    expect(ev.eme).toEqual({ keySystem: 'com.widevine.alpha', keySystems: ['com.widevine.alpha', 'org.w3.clearkey'], seen: ['request', 'encrypted'], at: 1000, count: 3 });
    ev.media.length = 0;
    expect(pe.getTabEvidence(7).media).toHaveLength(2);
    expect(pe.getTabEvidence(99)).toBeNull();
    expect(heard.map((h) => h.event.type)).toEqual(['navigated', 'hooks', 'media', 'media', 'media', 'mse-stream', 'mse-stream', 'eme', 'eme', 'eme']);
  });

  it('subtitle parts are reassembled before listeners hear them; evidence keeps the summary', () => {
    nav();
    const base = { type: 'subtitle-parsed', subId: 1, url: 'https://www.youtube.com/api/timedtext?v=UF8uR6Z6KLc&fmt=json3', format: 'json3', lang: 'en', kind: 'asr', mediaId: 'UF8uR6Z6KLc', cueCount: 3, parts: 2 };
    report({ ...base, part: 1, cues: [{ id: '3', start: 5, end: 6, text: 'c' }] });
    expect(heard.filter((h) => h.event.type === 'subtitle-parsed')).toHaveLength(0);
    report({ ...base, part: 0, cues: [{ id: '1', start: 1, end: 2, text: 'a' }, { id: '2', start: 3, end: 4, text: 'b' }] });
    const got = heard.filter((h) => h.event.subId === 1);
    expect(got).toHaveLength(1);
    expect(got[0].event.cues.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(pe.getTabEvidence(7).subtitles).toEqual([{ type: 'subtitle-parsed', subId: 1, url: base.url, via: 'fetch', status: 0, format: 'json3', lang: 'en', kind: 'asr', mediaId: 'UF8uR6Z6KLc', cueCount: 3, at: 1000 }]);
    report({ ...base, subId: 2, parts: 1, part: 0, cueCount: 1, cues: [{ id: 9, start: 1, end: 2, text: 'one' }] });
    expect(heard.at(-1).event.cues).toEqual([{ id: '9', start: 1, end: 2, text: 'one' }]);
  });

  it('drops malformed and stale events; a new document starts over', () => {
    nav();
    expect(() => report({ type: 'media', media: { elId: 'x' } })).toThrow(expect.objectContaining({ code: 'bad-event' }));
    expect(() => report({ type: 'run', code: '1' })).toThrow(expect.objectContaining({ code: 'bad-event' }));
    expect(() => report({ type: 'subtitle-parsed', subId: 1, url: 'https://x/a.vtt', part: 0, parts: 1, cues: [{ id: '1', start: 'a', end: 2, text: 'x' }] })).toThrow();
    report({ type: 'hooks', hooks: { main: 'ok', mse: 'ok' } });
    report({ type: 'eme', via: 'request', keySystem: 'org.w3.clearkey' });
    report({ type: 'media', reason: 'play', media: mediaSnap(1) });
    nav(1, 'otherVideo1');
    expect(report({ type: 'media', reason: 'late', media: mediaSnap(5) }, { navSeq: 0 })).toEqual({ boot: 'boot-1', stale: true });
    let ev = pe.getTabEvidence(7);
    expect(ev).toMatchObject({ navSeq: 1, mediaId: 'otherVideo1', media: [], subtitles: [], hooks: { main: 'ok' }, eme: { keySystem: 'org.w3.clearkey' } });
    nav(0, 'UF8uR6Z6KLc', { docId: 'doc-b' });
    ev = pe.getTabEvidence(7);
    expect(ev).toMatchObject({ docId: 'doc-b', navSeq: 0, hooks: null, eme: null });
  });

  it('closing the tab or leaving for a page without our scripts forgets it', () => {
    nav();
    nav(0, 'x', { tabId: 8 });
    tabs.onUpdated.fire(7, { url: 'https://www.youtube.com/watch?v=other' });
    expect(pe.getTabEvidence(7)).not.toBeNull();
    tabs.onUpdated.fire(7, { url: 'https://example.com/' });
    tabs.onRemoved.fire(8);
    expect(pe.getTabEvidence(7)).toBeNull();
    expect(pe.getTabEvidence(8)).toBeNull();
    expect(heard.filter((h) => h.event.type === 'forgotten').map((h) => [h.tabId, h.event.reason])).toEqual([
      [7, 'left'],
      [8, 'tab-closed'],
    ]);
  });
});

describe('commands and the capture glue', () => {
  const ext = (type, payload) => pe.extensionHandlers[type](payload);
  const media = (payload, tabId = 7) => pe.contentHandlers[MSG.PAGE_MEDIA](payload, sender(tabId));

  it('relays plain commands to the tab’s top frame and returns its answer', async () => {
    nav();
    tabReplies.query = () => ({ ok: true, result: { mediaId: 'UF8uR6Z6KLc' } });
    tabReplies['yt-reload'] = () => ({ ok: false, error: { code: 'no-player' } });
    await expect(ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'query' } })).resolves.toEqual({ mediaId: 'UF8uR6Z6KLc' });
    await expect(ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'yt-reload' } })).rejects.toMatchObject({ code: 'no-player' });
    await expect(ext(MSG.TAB_COMMAND, { tabId: 'x', command: {} })).rejects.toMatchObject({ code: 'bad-request' });
    expect(tabs.sent.every((s) => s.frameId === 0 && s.type === MSG.PAGE_COMMAND)).toBe(true);
    expect(ext(MSG.TAB_EVIDENCE, { tabId: 7 }).mediaId).toBe('UF8uR6Z6KLc');
  });

  it('capture on: opens the stream, pushes the tab’s bytes in order, sends cues back, closes on off', async () => {
    nav();
    tabReplies['mse-capture'] = (c) => ({ ok: true, result: c.on ? { on: true, streamId: 1, backlogBytes: 900, init: true } : { on: false } });
    const r = await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } });
    expect(r).toEqual({ key: 'tab:7:1', on: true, streamId: 1, backlogBytes: 900, init: true });
    expect(offscreen.calls[0]).toEqual({ type: MSG.MEDIA_OPEN, payload: { key: 'tab:7:1', lang: 'en', targetLang: 'zh' } });

    const replies = await Promise.all([media({ streamId: 1, seq: 0, init: true, timeS: null, bytes: 'AAAA' }), media({ streamId: 1, seq: 1, init: false, timeS: 30, bytes: 'BBBB' })]);
    expect(replies).toEqual([{ accepted: true, ended: false }, { accepted: true, ended: false }]);
    expect(await media({ streamId: 2, seq: 0, bytes: 'CCCC' })).toEqual({ accepted: false, reason: 'other-stream' });
    expect(offscreen.calls.filter((c) => c.type === MSG.MEDIA_PUSH).map((c) => c.payload)).toEqual([
      { key: 'tab:7:1', bytes: 'AAAA' },
      { key: 'tab:7:1', bytes: 'BBBB' },
    ]);

    pe.onMediaEvent({ key: 'tab:7:1', event: { type: 'segment', id: 0, start: 31.2, end: 34, text: 'Hello Stanford.' } });
    pe.onMediaEvent({ key: 'tab:7:1', event: { type: 'translation', id: 0, text: '你好', done: true } });
    pe.onMediaEvent({ key: 'tab:9:1', event: { type: 'segment', id: 0, start: 1, end: 2, text: 'not ours' } });
    await tick();
    expect(tabs.sent.filter((s) => s.cmd.cmd === 'cues').map((s) => s.cmd)).toEqual([
      { cmd: 'cues', op: 'upsert', cue: { id: 'm1-0', start: 31.2, end: 34, text: 'Hello Stanford.' } },
      { cmd: 'cues', op: 'translation', id: 'm1-0', text: '你好', done: true },
    ]);
    expect(pe.getTabEvidence(7).capture).toMatchObject({ on: true, key: 'tab:7:1', streamId: 1, pushes: 2, segments: 1, translations: 1, firstSegmentAt: 1000 });

    const off = await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: false } });
    expect(off).toMatchObject({ on: false, reason: 'command', stats: { bytes: 1, blocks: 1 } });
    expect(offscreen.calls.at(-1)).toEqual({ type: MSG.MEDIA_CLOSE, payload: { key: 'tab:7:1' } });
    expect(tabs.sent.filter((s) => s.cmd.cmd === 'mse-capture').map((s) => s.cmd.on)).toEqual([true, false]);
    expect(await media({ streamId: 1, seq: 2, bytes: 'DDDD' })).toEqual({ accepted: false, reason: 'not-capturing' });
    expect(heard.filter((h) => h.event.type === 'capture-event').map((h) => h.event.event.id)).toEqual(['m1-0', 'm1-0']);
  });

  it('capture on passes fromS to the page; notice actions reach listeners', async () => {
    nav();
    tabReplies['mse-capture'] = (c) => ({ ok: true, result: { on: c.on, streamId: 1 } });
    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true, streamId: 1, fromS: 27.5, lang: 'auto', targetLang: 'ja' } });
    expect(tabs.sent.at(-1).cmd).toEqual({ cmd: 'mse-capture', on: true, streamId: 1, fromS: 27.5 });
    expect(offscreen.calls[0].payload).toEqual({ key: 'tab:7:1', lang: 'auto', targetLang: 'ja' });
    report({ type: 'notice-action', kind: 'listen', action: 'accept' });
    expect(heard.at(-1).event).toEqual({ type: 'notice-action', kind: 'listen', action: 'accept' });
    expect(() => report({ type: 'notice-action', kind: 'listen', action: 'maybe' })).toThrow(expect.objectContaining({ code: 'bad-event' }));
  });

  it('listen on: opens the session under its own key, sends its cues back, closes on off, navigation or the stream ending', async () => {
    nav();
    offscreen.call = async (type, payload) => {
      offscreen.calls.push({ type, payload });
      if (type === MSG.LISTEN_OPEN) return { key: payload.key, id: 's1' };
      if (type === MSG.LISTEN_CLOSE) return { key: payload.key, segments: 1 };
      return null;
    };
    const r = await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'listen', on: true, lang: 'auto', targetLang: 'zh', mediaStartS: 12.5 } });
    expect(r).toEqual({ key: 'tab:7:l1', lang: 'auto', targetLang: 'zh', mediaStartS: 12.5 });
    expect(offscreen.calls[0]).toEqual({ type: MSG.LISTEN_OPEN, payload: { key: 'tab:7:l1', lang: 'auto', targetLang: 'zh', mediaStartS: 12.5 } });
    expect(tabs.sent).toHaveLength(0); // nothing to tell the page
    pe.onMediaEvent({ key: 'tab:7:l1', event: { type: 'status', state: 'listening' } });
    pe.onMediaEvent({ key: 'tab:7:l1', event: { type: 'segment', id: 0, start: 13, end: 15, text: 'Hi' } });
    pe.onMediaEvent({ key: 'tab:7:l1', event: { type: 'translation', id: 0, text: '嗨', done: true } });
    await tick();
    expect(tabs.sent.map((s) => s.cmd)).toEqual([
      { cmd: 'cues', op: 'upsert', cue: { id: 'l1-0', start: 13, end: 15, text: 'Hi' } },
      { cmd: 'cues', op: 'translation', id: 'l1-0', text: '嗨', done: true },
    ]);
    expect(pe.getTabEvidence(7).listen).toMatchObject({ on: true, key: 'tab:7:l1', segments: 1, translations: 1, lastStatus: 'listening' });
    expect(heard.filter((h) => h.event.type === 'capture-event').map((h) => h.event.kind)).toEqual(['listen', 'listen', 'listen']);

    const off = await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'listen', on: false } });
    expect(off).toMatchObject({ on: false, reason: 'command', stats: { segments: 1 } });
    expect(offscreen.calls.at(-1)).toEqual({ type: MSG.LISTEN_CLOSE, payload: { key: 'tab:7:l1' } });

    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'listen', on: true } });
    expect(pe.getTabEvidence(7).listen.key).toBe('tab:7:l2');
    pe.onMediaEvent({ key: 'tab:7:l2', event: { type: 'closed', reason: 'preempted' } });
    expect(pe.getTabEvidence(7).listen).toMatchObject({ on: false, reason: 'preempted' });

    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'listen', on: true } });
    nav(1, 'nextVideo001');
    await tick();
    expect(offscreen.calls.at(-1)).toEqual({ type: MSG.LISTEN_CLOSE, payload: { key: 'tab:7:l3' } });
    expect(pe.getTabEvidence(7).listen).toBeNull();
  });

  it('a reopened capture gets a new key and cue prefix; navigation and the pipeline closing end it', async () => {
    nav();
    tabReplies['mse-capture'] = (c) => ({ ok: true, result: { on: !!c.on, streamId: 1 } });
    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true, lang: 'ja', targetLang: 'en' } });
    expect(offscreen.calls[0].payload).toEqual({ key: 'tab:7:1', lang: 'ja', targetLang: 'en' });
    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } });
    expect(offscreen.calls.map((c) => [c.type, c.payload.key])).toEqual([
      [MSG.MEDIA_OPEN, 'tab:7:1'],
      [MSG.MEDIA_CLOSE, 'tab:7:1'],
      [MSG.MEDIA_OPEN, 'tab:7:2'],
    ]);
    pe.onMediaEvent({ key: 'tab:7:1', event: { type: 'translation', id: 4, text: 'late', done: true } });
    pe.onMediaEvent({ key: 'tab:7:2', event: { type: 'closed', reason: 'no-reply' } });
    await tick();
    expect(tabs.sent.filter((s) => s.cmd.cmd === 'cues').map((s) => s.cmd.id)).toEqual(['m1-4']);
    expect(pe.getTabEvidence(7).capture).toMatchObject({ on: false, reason: 'no-reply', key: 'tab:7:2' });
    expect(tabs.sent.filter((s) => s.cmd.cmd === 'mse-capture').map((s) => s.cmd.on)).toEqual([true, false, true, false]);

    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } });
    nav(1, 'nextVideo01');
    await tick();
    expect(offscreen.calls.at(-1)).toEqual({ type: MSG.MEDIA_CLOSE, payload: { key: 'tab:7:3' } });
  });

  it('a failed open or a refusing tab leaves capture off; a replaced stream stops on its next push', async () => {
    nav();
    offscreen.fail[MSG.MEDIA_OPEN] = 'unreachable';
    await expect(ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } })).rejects.toMatchObject({ code: 'unreachable' });
    expect(pe.getTabEvidence(7).capture).toBeNull();
    delete offscreen.fail[MSG.MEDIA_OPEN];

    tabReplies['mse-capture'] = (c) => (c.on ? { ok: false, error: { code: 'no-stream' } } : { ok: true, result: {} });
    await expect(ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } })).rejects.toMatchObject({ code: 'no-stream' });
    expect(pe.getTabEvidence(7).capture).toMatchObject({ on: false, reason: 'page-refused' });

    tabReplies['mse-capture'] = () => ({ ok: true, result: { streamId: 1 } });
    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } });
    offscreen.fail[MSG.MEDIA_PUSH] = 'no-stream';
    expect(await media({ streamId: 1, seq: 0, bytes: 'AAAA' })).toEqual({ accepted: false, reason: 'no-stream' });
    expect(pe.getTabEvidence(7).capture).toMatchObject({ on: false, reason: 'no-stream' });
    await expect(media({ streamId: 1, seq: 'x', bytes: 1 })).resolves.toEqual({ accepted: false, reason: 'not-capturing' });
  });

  it('the page stopping on its own (overflow) closes the stream', async () => {
    nav();
    tabReplies['mse-capture'] = () => ({ ok: true, result: { streamId: 1 } });
    await ext(MSG.TAB_COMMAND, { tabId: 7, command: { cmd: 'mse-capture', on: true } });
    report({ type: 'capture', on: false, streamId: 1, reason: 'overflow', pushes: 3, bytes: 900 });
    await tick();
    expect(offscreen.calls.at(-1)).toEqual({ type: MSG.MEDIA_CLOSE, payload: { key: 'tab:7:1' } });
    expect(tabs.sent.filter((s) => s.cmd.cmd === 'mse-capture').map((s) => s.cmd.on)).toEqual([true]);
  });
});
