// @vitest-environment-options { "url": "https://www.tiktok.com/foryou" }
//
// The page agent on TikTok's feed, where videos change under one URL: the
// next video playing is a navigation (new navSeq and media id, the capture
// stopped, the renderer rebuilt on the new video without the old cues); a
// paused video keeps being the primary over the one preloaded below it; a
// video with no player wrapper changes nothing; subtitle files count only
// once item data claims them, and the next video's prefetched file stays
// with it across the switch.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPageAgent } from '../src/content/page-agent.js';
import { createCaptionRenderer } from '../src/content/caption-renderer.js';
import { MSG } from '../src/shared/messages.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const A = '7656927541181123861';
const B = '7683631118070926610';
const FTYP = [0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70];
const vttUrl = (file) => `https://v16-webapp.tiktok.com/${'0'.repeat(32)}/6af607bd/video/tos/alisg/tos-alisg-pv-0037/${file}/?a=1988&mime_type=video_mp4`;
const LIST = 'https://www.tiktok.com/api/recommend/item_list/?aid=1988&count=9';
const [FILE_A, FILE_B, FILE_X] = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
const VTT = 'WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nHello there\n\n00:00:02.000 --> 00:00:03.500\nSecond line\n';
const itemList = JSON.stringify({ itemList: [A, B].map((id, i) => ({ id, video: { duration: 30, subtitleInfos: [{ Format: 'webvtt', LanguageCodeName: 'eng-US', Source: 'ASR', Url: vttUrl([FILE_A, FILE_B][i]) }] } })) });

function fakeRuntime() {
  const listeners = new Set();
  const rt = {
    id: EXT_ID,
    sent: [],
    onMessage: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    async sendMessage(msg) {
      rt.sent.push(msg);
      if (msg.type === MSG.PAGE_EVENT) return { ok: true, result: { boot: 'b' } };
      if (msg.type === MSG.PAGE_MEDIA) return { ok: true, result: { accepted: true, ended: false } };
      return undefined;
    },
    command: (payload) =>
      new Promise((resolve) => {
        for (const fn of listeners) fn({ type: MSG.PAGE_COMMAND, payload }, { id: EXT_ID, url: `chrome-extension://${EXT_ID}/sw.js` }, resolve);
      }),
    events: (type) => rt.sent.filter((m) => m.type === MSG.PAGE_EVENT && m.payload.event.type === type).map((m) => ({ ...m.payload.event, navSeq: m.payload.navSeq })),
  };
  return rt;
}

function fakeTrackFactory() {
  const tracks = [];
  const addTextTrack = (video, kind, label, language) => {
    const list = [];
    const t = { video, kind, label, language, mode: 'disabled', list, get cues() { return list.slice(); }, addCue: (c) => list.push(c), removeCue: (c) => list.splice(list.indexOf(c), 1) };
    tracks.push(t);
    return t;
  };
  const createCue = (startTime, endTime, text) => ({ startTime, endTime, text, id: '' });
  return { tracks, makeRenderer: (opts) => createCaptionRenderer({ ...opts, addTextTrack: (k, l, g) => addTextTrack(opts.video, k, l, g), createCue }) };
}

// A feed video in its player wrapper; top is its box's top (the viewport is 1024x768).
function feedVideo(item, { playing = false, top = 0, w = 433, h = 769, wrapper = true } = {}) {
  const st = { playing, top };
  const v = document.createElement('video');
  Object.defineProperty(v, 'paused', { configurable: true, get: () => !st.playing });
  Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(v, 'duration', { configurable: true, value: 30 });
  v.getBoundingClientRect = () => ({ x: 0, y: st.top, left: 0, top: st.top, right: w, bottom: st.top + h, width: w, height: h });
  v.src = `blob:https://www.tiktok.com/ms-${item || 'x'}`;
  const box = document.createElement('div');
  if (wrapper) box.id = `xgwrapper-0-${item}`;
  box.append(v);
  document.body.append(box);
  return {
    v,
    play() {
      st.playing = true;
      v.dispatchEvent(new Event('play'));
    },
    pause() {
      st.playing = false;
      v.dispatchEvent(new Event('pause'));
    },
    moveTo(t) {
      st.top = t;
    },
  };
}

let agent;
function start() {
  const runtime = fakeRuntime();
  const bridge = { connected: true, command: vi.fn(), close: vi.fn(), onEvent: null };
  const { tracks, makeRenderer } = fakeTrackFactory();
  agent = createPageAgent({
    runtime,
    makeBridge: ({ onEvent }) => {
      bridge.onEvent = onEvent;
      return bridge;
    },
    makeRenderer,
    statsMs: 0,
  });
  return { runtime, tracks, main: (ev) => bridge.onEvent(ev) };
}

const query = async (runtime) => (await runtime.command({ cmd: 'query' })).result;

afterEach(() => {
  agent?.shutdown();
  agent = null;
  document.body.innerHTML = '';
  history.replaceState(null, '', '/foryou');
});

describe('TikTok feed', () => {
  it('the next video playing is a navigation: new navSeq and media id, capture stopped, the renderer rebuilt without the old cues', async () => {
    const a = feedVideo(A, { playing: true, top: 0 });
    const b = feedVideo(B, { top: 785 });
    const { runtime, tracks, main } = start();
    await tick();
    expect(runtime.events('navigated')).toMatchObject([{ mediaId: null, navSeq: 0 }]);
    expect(runtime.events('media-id')).toEqual([{ type: 'media-id', mediaId: A, navSeq: 0 }]);

    // Each video has its own MediaSource with an audio SourceBuffer.
    main({ k: 'mse-source', msId: 1, url: a.v.src });
    main({ k: 'mse-buffer', sbId: 1, msId: 1, mime: 'video/mp4; codecs="mp4a.40.29"' });
    main({ k: 'mse-chunk', sbId: 1, seq: 0, init: true, size: FTYP.length, bytes: new Uint8Array(FTYP).buffer });
    main({ k: 'mse-source', msId: 2, url: b.v.src });
    main({ k: 'mse-buffer', sbId: 2, msId: 2, mime: 'video/mp4; codecs="mp4a.40.5"' });
    main({ k: 'mse-chunk', sbId: 2, seq: 0, init: true, size: FTYP.length, bytes: new Uint8Array(FTYP).buffer });
    await tick(5);
    expect((await runtime.command({ cmd: 'mse-capture', on: true })).result).toMatchObject({ on: true, streamId: 1 });
    await runtime.command({ cmd: 'cues', op: 'set', cues: [{ id: '1', start: 0, end: 2, text: 'old video' }] });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].video).toBe(a.v);
    runtime.sent.length = 0;

    // ArrowDown: the feed scrolls, the next video plays, the old one pauses.
    a.moveTo(-769);
    b.moveTo(0);
    b.play();
    a.pause();
    await tick(5);
    expect(runtime.events('navigated')).toEqual([{ type: 'navigated', url: 'https://www.tiktok.com/foryou', mediaId: B, navSeq: 1, site: 'tiktok', resync: false }]);
    expect(runtime.sent.filter((m) => m.type === MSG.PAGE_EVENT).every((m) => m.payload.navSeq === 1)).toBe(true);
    const streams = new Map(runtime.events('mse-stream').map((e) => [e.stream.streamId, e.main]));
    expect(streams.get(2)).toBe(true);
    expect(streams.get(1)).toBe(false);
    let q = await query(runtime);
    expect(q).toMatchObject({ navSeq: 1, mediaId: B, capture: null, renderer: null });
    expect(q.primary).toBe(q.media.find((m) => m.src === b.v.src).elId);
    expect(tracks[0].list).toEqual([]);
    expect(tracks.some((t) => t.video === b.v)).toBe(false);

    // The worker's next cues go on the new video's own track.
    await runtime.command({ cmd: 'cues', op: 'set', cues: [{ id: '1', start: 0, end: 2, text: 'new video' }] });
    expect(tracks.at(-1).video).toBe(b.v);
    expect(tracks.at(-1).list.map((c) => c.text)).toEqual(['new video']);
    expect((await runtime.command({ cmd: 'mse-capture', on: true })).result).toMatchObject({ on: true, streamId: 2 });

    // Back to the first video (ArrowUp) is another navigation.
    b.moveTo(785);
    a.moveTo(0);
    a.play();
    b.pause();
    await tick(5);
    q = await query(runtime);
    expect(q).toMatchObject({ navSeq: 2, mediaId: A });
  });

  it('a paused video stays primary over the one preloaded below it; a video with no wrapper changes nothing', async () => {
    // Found in this order (the next one first, as after scrolling back up).
    const b = feedVideo(B, { top: 785 });
    const a = feedVideo(A, { playing: true, top: 0 });
    const { runtime } = start();
    await tick();
    const idOf = (q, v) => q.media.find((m) => m.src === v.src).elId;
    a.pause();
    await tick();
    let q = await query(runtime);
    expect(q).toMatchObject({ navSeq: 0, mediaId: A });
    expect(q.primary).toBe(idOf(q, a.v));

    const badge = feedVideo('', { playing: false, top: 10, w: 50, h: 50, wrapper: false });
    badge.play();
    await tick();
    q = await query(runtime);
    expect(q.primary).toBe(idOf(q, badge.v));
    expect(q).toMatchObject({ navSeq: 0, mediaId: A });
    badge.pause();
    a.play();
    await tick();
    expect(await query(runtime)).toMatchObject({ navSeq: 0, mediaId: A });
    expect(runtime.events('navigated')).toHaveLength(1);
    expect(b.v.paused).toBe(true);
  });

  it('a player moved to another item (the feed reuses them) is known again under its id and becomes primary when it plays', async () => {
    const C = '7704437998909164823';
    const a = feedVideo(A, { top: -769 });
    const b = feedVideo(B, { playing: true, top: 0 });
    const { runtime } = start();
    await tick();
    expect(await query(runtime)).toMatchObject({ mediaId: B, navSeq: 0 });
    const elA = (await query(runtime)).media.find((m) => m.src === a.v.src).elId;
    a.v.parentElement.remove();
    await tick();
    expect(runtime.events('media-removed')).toEqual([{ type: 'media-removed', elId: elA, navSeq: 0 }]);
    const wrap = document.createElement('div');
    wrap.id = `xgwrapper-0-${C}`;
    a.v.src = `blob:https://www.tiktok.com/ms-${C}`;
    wrap.append(a.v);
    document.body.append(wrap);
    await tick();
    expect(runtime.events('media').filter((e) => e.reason === 'added' && e.media.elId === elA)).toHaveLength(2);
    a.moveTo(0);
    b.moveTo(-769);
    a.play();
    b.pause();
    await tick(5);
    const q = await query(runtime);
    expect(q).toMatchObject({ mediaId: C, navSeq: 1, primary: elA });
  });

  it('subtitle files count once item data claims them; the next video’s prefetched file goes with it', async () => {
    const a = feedVideo(A, { playing: true, top: 0 });
    const b = feedVideo(B, { top: 785 });
    const { runtime, main } = start();
    await tick();
    const sub = (file) => ({ k: 'subtitle', via: 'xhr', url: vttUrl(file), status: 200, contentType: 'video/mp4', text: VTT });
    main(sub(FILE_X)); // before any item data: a stray
    main({ k: 'subtitle', via: 'fetch', url: LIST, status: 200, contentType: 'application/json', text: itemList });
    main(sub(FILE_A));
    main(sub(FILE_B)); // prefetched for the next video
    main(sub(FILE_X)); // no item claims it
    await tick();
    const parsed = runtime.events('subtitle-parsed');
    expect(parsed.map((s) => [s.url, s.mediaId, s.lang, s.kind, s.format, s.cueCount])).toEqual([
      [vttUrl(FILE_A), A, 'en-US', 'asr', 'vtt', 2],
      [vttUrl(FILE_B), B, 'en-US', 'asr', 'vtt', 2],
    ]);
    runtime.sent.length = 0;

    a.moveTo(-769);
    b.moveTo(0);
    b.play();
    a.pause();
    await tick(5);
    expect(runtime.events('navigated')).toMatchObject([{ mediaId: B, navSeq: 1 }]);
    expect(runtime.events('subtitle-parsed').map((s) => [s.mediaId, s.navSeq])).toEqual([[B, 1]]);
  });

  it('a video kept transparent (a canvas draws it) gets the overlay; opaque again, the track', async () => {
    const a = feedVideo(A, { playing: true, top: 0 });
    let opacity = 0;
    a.v.checkVisibility = (o = {}) => !(o.opacityProperty && opacity === 0);
    const { runtime } = start();
    await tick();
    await runtime.command({ cmd: 'cues', op: 'set', cues: [{ id: '1', start: 0, end: 2, text: 'hello' }] });
    let q = await query(runtime);
    expect(q.renderer).toMatchObject({ mode: 'overlay' });
    expect(q.view.mode).toBe('track');
    expect(a.v.parentElement.querySelector('.tc-cap-host')).not.toBeNull();
    opacity = 1;
    a.v.dispatchEvent(new Event('timeupdate'));
    await tick();
    q = await query(runtime);
    expect(q.renderer).toMatchObject({ mode: 'track', cues: 1 });
    // The overlay chosen in prefs stays, whatever the video.
    await runtime.command({ cmd: 'mode', value: 'overlay' });
    opacity = 0;
    a.v.dispatchEvent(new Event('timeupdate'));
    await tick();
    expect((await query(runtime)).renderer.mode).toBe('overlay');
  });

  it('a video page takes the media id from its URL; another video page is a navigation', async () => {
    history.replaceState(null, '', `/@someone/video/${A}`);
    const a = feedVideo(B, { playing: true, top: 0 });
    const { runtime } = start();
    await tick();
    expect(runtime.events('navigated')).toMatchObject([{ mediaId: A, navSeq: 0 }]);
    a.pause();
    a.play();
    await tick();
    expect(runtime.events('media-id')).toEqual([]);
    history.pushState(null, '', `/@someone/video/${B}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await tick();
    expect(runtime.events('navigated').at(-1)).toMatchObject({ url: `https://www.tiktok.com/@someone/video/${B}`, mediaId: B, navSeq: 1 });
  });
});
