// @vitest-environment-options { "url": "https://www.netflix.com/watch/81234567?trackId=14277281" }
//
// Netflix: the adapter (media id, the manifest's text tracks in every
// downloadable shape, WebVTT added to the manifest request without touching
// the page's object, the track list sent once the player says the audio's
// language, tracks ranked audio language first and forced ones last, files
// no list named are strays, the player action), and the page agent fetching
// the best track of a list and pausing per line through the player.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPageAgent } from '../src/content/page-agent.js';
import { createCaptionRenderer } from '../src/content/caption-renderer.js';
import { siteFor, netflix } from '../src/content/sites/index.js';
import { listUrl, tracksOf } from '../src/content/sites/netflix.js';
import { MSG } from '../src/shared/messages.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const EN = 'https://ipv4-c001-yyz001-ix.1.oca.nflxvideo.net/?o=1&v=1&e=1&t=en';
const EN_CC = 'https://ipv4-c002-yyz001-ix.1.oca.nflxvideo.net/?o=1&v=1&e=1&t=encc';
const JA_FORCED = 'https://ipv4-c003-yyz001-ix.1.oca.nflxvideo.net/?o=1&v=1&e=1&t=jaf';
const ZH = 'https://ipv4-c004-yyz001-ix.1.oca.nflxvideo.net/?o=1&v=1&e=1&t=zh';
const MANIFEST = {
  movieId: 81234567,
  viewableType: 'EPISODE',
  textTracks: [
    { isNoneTrack: true, language: 'none' },
    { language: 'en', rawTrackType: 'subtitles', downloadables: { 'webvtt-lssdh-ios8': { urls: [{ cdn_id: 1, url: EN }] } } },
    { language: 'en', rawTrackType: 'closedcaptions', ttDownloadables: { 'webvtt-lssdh-ios8': { downloadUrls: { 2: EN_CC } } } },
    { language: 'ja', rawTrackType: 'subtitles', isForcedNarrative: true, downloadables: { 'dfxp-ls-sdh': { urls: { a: { url: JA_FORCED } } } } },
    { language: 'zh-Hans', rawTrackType: 'subtitles', downloadables: { 'webvtt-lssdh-ios8': { urls: [{ url: 'http://insecure.example/' }, { url: ZH }] } } },
    { language: 'fr', rawTrackType: 'subtitles', downloadables: { 'nflx-cmisc': { urls: [{ url: 'https://images.example/' }] } } },
  ],
};
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello there\n\n00:00:03.000 --> 00:00:05.000\nGeneral Kenobi\n';

function fakePlayer({ ready = true, audio = 'en', text = null } = {}) {
  const p = { ready, calls: [], isReady: () => p.ready, getAudioTrack: () => ({ bcp47: audio }), getTimedTextTrack: () => text, seek: (ms) => p.calls.push(['seek', ms]), pause: () => p.calls.push(['pause']), play: () => p.calls.push(['play']) };
  return p;
}

// A page world with its own JSON and the player API, for installMain.
function fakeWin(player) {
  return {
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => ['motion-billboard-1', 'watch-abc'], getVideoPlayerBySessionId: (id) => (id === 'watch-abc' ? player : null) } }) } } } },
  };
}

describe('the Netflix adapter', () => {
  it('netflix.com and its subdomains; the media id is the /watch/ id', () => {
    expect(siteFor('www.netflix.com')).toBe(netflix);
    expect(siteFor('netflix.com')).toBe(netflix);
    expect(siteFor('notnetflix.com')).not.toBe(netflix);
    expect(netflix.mediaId('https://www.netflix.com/watch/81234567?trackId=1')).toBe('81234567');
    expect(netflix.mediaId('https://www.netflix.com/browse')).toBeNull();
  });

  it('reads the text tracks in each downloadable shape, the first https URL, WebVTT before TTML', () => {
    expect(tracksOf(MANIFEST)).toEqual([
      { lang: 'en', kind: '', url: EN },
      { lang: 'en', kind: 'cc', url: EN_CC },
      { lang: 'ja', kind: 'forced', url: JA_FORCED },
      { lang: 'zh-Hans', kind: '', url: ZH },
    ]);
    expect(tracksOf({ timedtexttracks: [{ language: 'de', ttDownloadables: { 'imsc1.1': { downloadUrls: { 1: 'https://de.example/' } } } }] })).toEqual([{ lang: 'de', kind: '', url: 'https://de.example/' }]);
    expect(tracksOf({})).toEqual([]);
  });

  it('ranks the audio’s language first, plain before CC, the shown track next, forced ones last; strays elsewhere', () => {
    const tracks = tracksOf(MANIFEST);
    const ja = netflix.listSubtitles(JSON.stringify({ movieId: '81234567', audio: 'ja', selected: { lang: 'zh-Hans', kind: '' }, tracks }));
    expect(ja.map((s) => s.url)).toEqual([ZH, EN_CC, EN, JA_FORCED]);
    const zh = netflix.listSubtitles(JSON.stringify({ movieId: '81234567', audio: 'cmn', tracks }));
    expect(zh[0].url).toBe(ZH);
    const en = netflix.listSubtitles({ movieId: 81234567, audio: 'en-US', tracks });
    expect(en.map((s) => [s.lang, s.kind])).toEqual([
      ['en', ''],
      ['en', 'cc'],
      ['zh-Hans', ''],
      ['ja', 'forced'],
    ]);
    expect(en.every((s) => s.ai === false)).toBe(true);
    expect(netflix.listSubtitles('not json')).toEqual([]);
    expect(netflix.subtitleInfo(listUrl('81234567', 'en'))).toEqual({ list: true });
    expect(netflix.subtitleInfo(EN_CC)).toEqual({ lang: 'en', kind: 'cc', mediaId: '81234567' });
    expect(netflix.subtitleInfo('https://ipv4-c009.oca.nflxvideo.net/?o=1&player=own')).toEqual({ stray: true });
    expect(netflix.isSubtitleRequest(EN)).toBe(true);
    expect(netflix.isSubtitleRequest('https://ipv4-c009.oca.nflxvideo.net/?o=1&video=1')).toBe(false);
  });

  it('adds WebVTT to a manifest request on a copy; sends the tracks once the player tells the audio', async () => {
    const player = fakePlayer({ ready: false, audio: 'en', text: { bcp47: 'zh-Hans', rawTrackType: 'SUBTITLES', isNoneTrack: false } });
    const win = fakeWin(player);
    const emitted = [];
    netflix.installMain(win, { emit: (ev) => emitted.push(ev) });
    const request = { version: 2, params: { profiles: ['heaac-2-dash', 'imsc1.1'], showAllSubDubTracks: false } };
    const sent = JSON.parse(win.JSON.stringify(request));
    expect(sent.params.profiles).toEqual(['heaac-2-dash', 'imsc1.1', 'webvtt-lssdh-ios8']);
    expect(request.params.profiles).toEqual(['heaac-2-dash', 'imsc1.1']);
    expect(win.JSON.stringify({ params: { profiles: ['a', 'webvtt-lssdh-ios8'] } })).toBe('{"params":{"profiles":["a","webvtt-lssdh-ios8"]}}');
    expect(win.JSON.stringify([1, 2], null, 0)).toBe('[1,2]');
    expect(win.JSON.parse('{"a":1}')).toEqual({ a: 1 });
    expect(win.JSON.parse(JSON.stringify({ result: MANIFEST })).result.movieId).toBe(81234567);
    await tick(50);
    expect(emitted).toHaveLength(0);
    player.ready = true;
    await tick(400);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ k: 'subtitle', via: 'fetch', url: listUrl('81234567', 'en'), contentType: 'application/json' });
    expect(JSON.parse(emitted[0].text)).toMatchObject({ movieId: '81234567', audio: 'en', selected: { lang: 'zh-Hans', kind: '' } });
  });

  it('the player action pauses; anything else is refused; without a player it says so', () => {
    const player = fakePlayer();
    const win = fakeWin(player);
    expect(netflix.mainActions.player({ win, op: 'pause' })).toEqual({ op: 'pause' });
    expect(player.calls).toEqual([['pause']]);
    expect(() => netflix.mainActions.player({ win, op: 'seek', s: 3 })).toThrow(expect.objectContaining({ code: 'bad-command' }));
    expect(() => netflix.mainActions.player({ win: {}, op: 'pause' })).toThrow(expect.objectContaining({ code: 'no-player' }));
  });
});

function fakeRuntime() {
  const listeners = new Set();
  const rt = {
    id: EXT_ID,
    sent: [],
    onMessage: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    async sendMessage(msg) {
      rt.sent.push(msg);
      return msg.type === MSG.PAGE_EVENT ? { ok: true, result: { boot: 'b' } } : undefined;
    },
    command: (payload) =>
      new Promise((resolve) => {
        for (const fn of listeners) fn({ type: MSG.PAGE_COMMAND, payload }, { id: EXT_ID, url: `chrome-extension://${EXT_ID}/sw.js` }, resolve);
      }),
    events: (type) => rt.sent.filter((m) => m.type === MSG.PAGE_EVENT && m.payload.event.type === type).map((m) => m.payload.event),
  };
  return rt;
}

const response = (text, type = 'text/vtt') => ({ ok: true, status: 200, headers: new Headers({ 'content-type': type }), text: async () => text });

function mountVideo() {
  const v = document.createElement('video');
  Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
  Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(v, 'duration', { configurable: true, value: 1500 });
  Object.defineProperty(v, 'currentTime', { value: 4, writable: true, configurable: true });
  v.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 });
  v.src = 'blob:https://www.netflix.com/ms-1';
  document.body.append(v);
  return v;
}

let agent;
afterEach(() => {
  agent?.shutdown();
  agent = null;
  document.body.innerHTML = '';
});

describe('the page agent on Netflix', () => {
  it('fetches the best track of a list without cookies; the player’s own files are strays; pause per line goes through the player', async () => {
    const v = mountVideo();
    const fetchFn = vi.fn(async () => response(VTT));
    const runtime = fakeRuntime();
    const bridge = { connected: true, command: vi.fn(async () => ({ op: 'pause' })), close: vi.fn(), onEvent: null };
    const addTextTrack = () => {
      const list = [];
      return { mode: 'disabled', list, get cues() { return list.slice(); }, addCue: (c) => list.push(c), removeCue: (c) => list.splice(list.indexOf(c), 1) };
    };
    agent = createPageAgent({
      runtime,
      makeBridge: ({ onEvent }) => {
        bridge.onEvent = onEvent;
        return bridge;
      },
      makeRenderer: (opts) => createCaptionRenderer({ ...opts, addTextTrack, createCue: (startTime, endTime, text) => ({ startTime, endTime, text, id: '' }) }),
      fetchFn,
      statsMs: 0,
    });
    await tick();
    expect(runtime.events('navigated')[0]).toMatchObject({ site: 'netflix', mediaId: '81234567' });
    const list = JSON.stringify({ movieId: '81234567', audio: 'en', selected: null, tracks: tracksOf(MANIFEST) });
    bridge.onEvent({ k: 'subtitle', via: 'fetch', url: listUrl('81234567', 'en'), status: 200, contentType: 'application/json', text: list });
    bridge.onEvent({ k: 'subtitle', via: 'fetch', url: 'https://ipv4-c009.oca.nflxvideo.net/?o=1&player=own', status: 200, contentType: 'application/ttml+xml', text: '<tt/>' });
    await tick(20);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(EN);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    const subs = runtime.events('subtitle-parsed');
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ url: EN, format: 'vtt', lang: 'en', mediaId: '81234567', cueCount: 2 });
    await runtime.command({ cmd: 'cues', op: 'set', cues: [{ id: '1', start: 1, end: 2.5, text: 'Hello there' }, { id: '2', start: 3, end: 5, text: 'General Kenobi' }] });
    expect(await runtime.command({ cmd: 'auto-pause', value: true })).toEqual({ ok: true, result: { autoPause: true } });
    // Playing past the end of the second line: the player pauses, not the video.
    v.currentTime = 4.9;
    v.dispatchEvent(new Event('timeupdate'));
    v.currentTime = 5.05;
    v.dispatchEvent(new Event('timeupdate'));
    expect(bridge.command).toHaveBeenCalledWith('player', { op: 'pause' }, 5000);
  });
});
