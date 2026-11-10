// @vitest-environment-options { "url": "https://www.bilibili.com/video/BV1GJ411x7h7/" }
//
// The page agent on a Bilibili URL: a captured subtitle list is not a
// subtitle but leads to one fetch of its body (human-made before AI,
// without cookies, only hdslb.com subtitle URLs), reported like a captured
// one with the list's language; once per list and body URL; a failed fetch
// stays quiet; a part switch is a navigation that resets all of it, except
// a list that came just before it (Bilibili asks for it on the click).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPageAgent } from '../src/content/page-agent.js';
import { MSG } from '../src/shared/messages.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const LIST_URL = 'https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&bvid=BV1GJ411x7h7&w_rid=a&wts=1';
const AI_URL = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=x';
const HUMAN_URL = 'https://i0.hdslb.com/bfs/subtitle/2.json';
const BODY = JSON.stringify({ body: [{ from: 1, to: 2.5, content: '你好' }, { from: 3, to: 4, content: '世界' }] });
const listOf = (subs) => JSON.stringify({ code: 0, data: { bvid: 'BV1GJ411x7h7', subtitle: { subtitles: subs } } });

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

const response = (text, { status = 200, type = 'application/json' } = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': type }), text: async () => text });

let agent;
function start(fetchFn, opts = {}) {
  const runtime = fakeRuntime();
  const bridge = { connected: true, command: vi.fn(), close: vi.fn(), onEvent: null };
  agent = createPageAgent({
    runtime,
    makeBridge: ({ onEvent }) => {
      bridge.onEvent = onEvent;
      return bridge;
    },
    fetchFn,
    statsMs: 0,
    ...opts,
  });
  return { runtime, main: (ev) => bridge.onEvent(ev) };
}

afterEach(() => {
  agent?.shutdown();
  agent = null;
  history.replaceState(null, '', '/video/BV1GJ411x7h7/');
});

describe('Bilibili subtitle lists', () => {
  it('a list fetches the human-made body once, without cookies, and reports it with the list’s language', async () => {
    const fetchFn = vi.fn(async () => response(BODY));
    const { runtime, main } = start(fetchFn);
    await tick();
    expect(runtime.events('navigated')[0]).toMatchObject({ site: 'bilibili', mediaId: 'BV1GJ411x7h7' });
    const list = listOf([
      { lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=x', ai_type: 1 },
      { lan: 'en-US', subtitle_url: HUMAN_URL, ai_type: 0 },
    ]);
    main({ k: 'subtitle', via: 'fetch', url: LIST_URL, status: 200, contentType: 'application/json', text: list });
    main({ k: 'subtitle', via: 'fetch', url: LIST_URL, status: 200, contentType: 'application/json', text: list });
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(HUMAN_URL);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    const subs = runtime.events('subtitle-parsed');
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ url: HUMAN_URL, via: 'fetch', format: 'bcc', lang: 'en-US', kind: '', mediaId: null, cueCount: 2 });
    expect(subs[0].cues.map((c) => c.text)).toEqual(['你好', '世界']);
    const q = (await runtime.command({ cmd: 'query' })).result;
    expect(q.lists).toEqual([{ url: 'https://api.bilibili.com/x/player/wbi/v2', entries: 2, picked: HUMAN_URL, status: 'ok' }]);
    expect(q.subtitles).toHaveLength(1);
  });

  it('only AI subtitles: the AI one, kind asr, language without the ai- prefix', async () => {
    const fetchFn = vi.fn(async () => response(BODY));
    const { runtime, main } = start(fetchFn);
    main({ k: 'subtitle', via: 'xhr', url: LIST_URL, status: 200, contentType: 'application/json', text: listOf([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1?auth_key=x', ai_type: 1 }]) });
    await tick();
    expect(fetchFn.mock.calls[0][0]).toBe(AI_URL);
    expect(runtime.events('subtitle-parsed')[0]).toMatchObject({ url: AI_URL, lang: 'zh', kind: 'asr', cueCount: 2 });
  });

  it('a body the player already fetched, an empty list, a foreign URL or a failed fetch: nothing fetched or reported again', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => response('', { status: 404 }));
    const { runtime, main } = start(fetchFn);
    main({ k: 'subtitle', via: 'fetch', url: HUMAN_URL, status: 200, contentType: 'application/json', text: BODY });
    main({ k: 'subtitle', via: 'fetch', url: `${LIST_URL}&n=1`, status: 200, contentType: 'application/json', text: listOf([{ lan: 'zh', subtitle_url: HUMAN_URL }]) });
    main({ k: 'subtitle', via: 'fetch', url: `${LIST_URL}&n=2`, status: 200, contentType: 'application/json', text: JSON.stringify({ code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } }) });
    main({ k: 'subtitle', via: 'fetch', url: `${LIST_URL}&n=3`, status: 200, contentType: 'application/json', text: listOf([{ lan: 'zh', subtitle_url: 'https://evil.example/bfs/subtitle/x.json' }]) });
    main({ k: 'subtitle', via: 'fetch', url: `${LIST_URL}&n=4`, status: 200, contentType: 'application/json', text: listOf([{ lan: 'zh', subtitle_url: '//i0.hdslb.com/bfs/subtitle/9.json' }]) });
    await tick();
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['https://i0.hdslb.com/bfs/subtitle/9.json']);
    expect(runtime.events('subtitle-parsed').map((s) => s.url)).toEqual([HUMAN_URL]);
    const q = (await runtime.command({ cmd: 'query' })).result;
    expect(q.lists.map((l) => [l.entries, l.status])).toEqual([[1, 'had'], [0, 'none'], [1, 'refused'], [1, 'failed']]);
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  it('a part switch long after the list resets it; a body still on its way then is dropped', async () => {
    let t = 1000;
    let release;
    const fetchFn = vi.fn(() => new Promise((r) => (release = () => r(response(BODY)))));
    const { runtime, main } = start(fetchFn, { now: () => t });
    const list = listOf([{ lan: 'zh-CN', subtitle_url: HUMAN_URL }]);
    main({ k: 'subtitle', via: 'fetch', url: LIST_URL, status: 200, contentType: 'application/json', text: list });
    await tick();
    t += 10000;
    history.pushState(null, '', '/video/BV1GJ411x7h7/?p=2');
    agent.onNavigate();
    release();
    await tick();
    expect(runtime.events('navigated').map((e) => e.mediaId)).toEqual(['BV1GJ411x7h7', 'BV1GJ411x7h7:p2']);
    expect(runtime.events('subtitle-parsed')).toEqual([]);
    main({ k: 'subtitle', via: 'fetch', url: LIST_URL, status: 200, contentType: 'application/json', text: list });
    release();
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(runtime.events('subtitle-parsed')).toHaveLength(1);
    expect((await runtime.command({ cmd: 'query' })).result).toMatchObject({ navSeq: 1, mediaId: 'BV1GJ411x7h7:p2', lists: [{ status: 'ok' }] });
  });

  it('a list that came just before the part switch (Bilibili asks on the click) goes with the new part', async () => {
    let t = 1000;
    let release;
    const fetchFn = vi.fn(() => new Promise((r) => (release = () => r(response(BODY)))));
    const { runtime, main } = start(fetchFn, { now: () => t });
    // Part 1's body arrived long ago and stays behind.
    main({ k: 'subtitle', via: 'fetch', url: 'https://i0.hdslb.com/bfs/subtitle/p1.json', status: 200, contentType: 'application/json', text: BODY });
    t += 10000;
    main({ k: 'subtitle', via: 'xhr', url: LIST_URL, status: 200, contentType: 'application/json', text: listOf([{ lan: 'zh-CN', subtitle_url: HUMAN_URL }]) });
    await tick();
    t += 600;
    history.pushState(null, '', '/video/BV1GJ411x7h7/?p=2');
    agent.onNavigate();
    release();
    await tick();
    const after = runtime.sent.filter((m) => m.type === MSG.PAGE_EVENT && m.payload.navSeq === 1 && m.payload.event.type === 'subtitle-parsed').map((m) => m.payload.event.url);
    expect(after).toEqual([HUMAN_URL]);
    const q = (await runtime.command({ cmd: 'query' })).result;
    expect(q.subtitles.map((s) => s.url)).toEqual([HUMAN_URL]);
    expect(q.lists).toEqual([{ url: 'https://api.bilibili.com/x/player/wbi/v2', entries: 1, picked: HUMAN_URL, status: 'ok' }]);
    // The player asking for the same list again in the new part fetches nothing more.
    main({ k: 'subtitle', via: 'xhr', url: LIST_URL, status: 200, contentType: 'application/json', text: listOf([{ lan: 'zh-CN', subtitle_url: HUMAN_URL }]) });
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
