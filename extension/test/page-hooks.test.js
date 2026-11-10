// Page-world hooks over fake fetch / XMLHttpRequest / MediaSource /
// SourceBuffer / EME: the page sees the same results, exceptions, names and
// promises as without them; subtitle responses, audio appends, MSE ops and
// EME use are reported, video bytes are not copied.

import { describe, it, expect, vi } from 'vitest';
import { installNetHooks, isGenericSubtitle } from '../src/content/hooks/net.js';
import { installMseHooks } from '../src/content/hooks/mse.js';
import { installEmeHooks } from '../src/content/hooks/eme.js';
import { classifyMime, isInitSegment } from '../src/content/bridge-protocol.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const PAGE = 'https://www.youtube.com/watch?v=UF8uR6Z6KLc';
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';

// A fresh class per window: hooks patch its prototype.
const makeXHR = () => class FakeXHR {
  constructor() {
    this.listeners = {};
    this.responseType = '';
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  send() {}
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  getResponseHeader(name) {
    return this.headers?.[name.toLowerCase()] ?? null;
  }
  respond(status, headers, body) {
    Object.assign(this, { status, headers, responseURL: new URL(this.url, PAGE).href });
    if (this.responseType === '' || this.responseType === 'text') this.responseText = body;
    else this.response = body;
    for (const fn of this.listeners.load || []) fn.call(this, { type: 'load' });
  }
};

function netWindow(responder) {
  const calls = [];
  async function fakeFetch(input) {
    calls.push(input);
    return responder(input);
  }
  return { win: { location: { href: PAGE }, fetch: fakeFetch, XMLHttpRequest: makeXHR() }, calls, fakeFetch };
}

describe('subtitle rules', () => {
  it('match by content type, timedtext path and file extension', () => {
    expect(isGenericSubtitle('https://cdn.example.com/a', 'text/vtt; charset=utf-8')).toBe(true);
    expect(isGenericSubtitle('https://cdn.example.com/a', 'application/ttml+xml')).toBe(true);
    expect(isGenericSubtitle('https://cdn.example.com/a', 'application/x-subrip')).toBe(true);
    expect(isGenericSubtitle('https://www.youtube.com/api/timedtext?v=x&fmt=json3', 'application/json')).toBe(true);
    expect(isGenericSubtitle('https://cdn.example.com/s/en.vtt?sig=1', '')).toBe(true);
    expect(isGenericSubtitle('https://cdn.example.com/s/en.DFXP', '')).toBe(true);
    expect(isGenericSubtitle('https://cdn.example.com/videoplayback?sabr=1', 'application/vnd.yt-ump')).toBe(false);
    expect(isGenericSubtitle('not a url', '')).toBe(false);
  });
});

describe('fetch hook', () => {
  it('is transparent: same promise, name, length, result and rejection', async () => {
    const original = vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    Object.defineProperty(original, 'name', { value: 'fetch' });
    const win = { location: { href: PAGE }, fetch: original, XMLHttpRequest: makeXHR() };
    const desc = Object.getOwnPropertyDescriptor(win, 'fetch');
    const reports = [];
    expect(installNetHooks(win, { emit: (e) => reports.push(e) })).toEqual({ fetch: 'ok', xhr: 'ok' });
    expect(win.fetch).not.toBe(original);
    expect(win.fetch.name).toBe('fetch');
    expect(win.fetch.length).toBe(original.length);
    expect(Object.getOwnPropertyDescriptor(win, 'fetch')).toMatchObject({ writable: desc.writable, enumerable: desc.enumerable, configurable: desc.configurable });
    const p = win.fetch('/x');
    expect(p).toBeInstanceOf(Promise);
    expect(await (await p).text()).toBe('ok');
    expect(original).toHaveBeenCalledWith('/x');

    original.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(win.fetch('/y')).rejects.toThrow('Failed to fetch');
    original.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    expect(() => win.fetch('/z')).toThrow('sync');
    await flush();
    expect(reports).toEqual([]);
  });

  it('copies a matching response the page still reads in full', async () => {
    const { win } = netWindow(() => new Response(VTT, { headers: { 'content-type': 'text/vtt' } }));
    const reports = [];
    installNetHooks(win, { emit: (e) => reports.push(e) });
    const res = await win.fetch('/subs/en.vtt');
    expect(await res.text()).toBe(VTT);
    await flush();
    expect(reports).toEqual([{ k: 'subtitle', via: 'fetch', url: 'https://www.youtube.com/subs/en.vtt', status: 200, contentType: 'text/vtt', text: VTT }]);
  });

  it('asks the site adapter, and leaves other responses alone (no clone)', async () => {
    const { win } = netWindow((input) => new Response(String(input), { headers: { 'content-type': 'application/json' } }));
    const reports = [];
    const isSubtitle = vi.fn((url) => url.includes('/player/subs'));
    installNetHooks(win, { isSubtitle, emit: (e) => reports.push(e) });
    const clone = vi.spyOn(Response.prototype, 'clone');
    await win.fetch('/api/other');
    await win.fetch(new Request('https://api.example.com/player/subs?id=1'));
    await flush();
    expect(clone).toHaveBeenCalledTimes(1);
    clone.mockRestore();
    expect(reports.map((r) => r.url)).toEqual(['https://api.example.com/player/subs?id=1']);
  });

  it('skips bodies over the cap, by length header or by reading', async () => {
    const big = 'x'.repeat(5000);
    const { win } = netWindow((input) =>
      String(input).includes('len') ? new Response(big, { headers: { 'content-type': 'text/vtt', 'content-length': '5000' } }) : new Response(big, { headers: { 'content-type': 'text/vtt' } })
    );
    const reports = [];
    installNetHooks(win, { emit: (e) => reports.push(e), cap: 1000 });
    const a = await win.fetch('/len.vtt');
    const b = await win.fetch('/stream.vtt');
    expect((await a.text()).length).toBe(5000);
    expect((await b.text()).length).toBe(5000);
    await flush();
    expect(reports).toEqual([]);
  });

  it('a body the page already used, or an opaque response, is skipped quietly', async () => {
    const { win } = netWindow(() => {
      const r = new Response(VTT, { headers: { 'content-type': 'text/vtt' } });
      Object.defineProperty(r, 'clone', { value: () => { throw new TypeError('body used'); } });
      return r;
    });
    const reports = [];
    installNetHooks(win, { emit: (e) => reports.push(e) });
    const res = await win.fetch('/a.vtt');
    expect(await res.text()).toBe(VTT);
    await flush();
    expect(reports).toEqual([]);
  });
});

describe('XMLHttpRequest hook', () => {
  it('copies text responses only, keeps open/send behaviour', () => {
    const win = { location: { href: PAGE }, fetch: async () => new Response(''), XMLHttpRequest: makeXHR() };
    const reports = [];
    installNetHooks(win, { emit: (e) => reports.push(e) });
    const x = new win.XMLHttpRequest();
    x.open('GET', '/api/timedtext?v=UF8uR6Z6KLc&lang=en&fmt=json3&pot=abc');
    expect(x.method).toBe('GET');
    x.send();
    x.respond(200, { 'content-type': 'application/json' }, '{"events":[]}');
    expect(reports).toEqual([
      { k: 'subtitle', via: 'xhr', url: 'https://www.youtube.com/api/timedtext?v=UF8uR6Z6KLc&lang=en&fmt=json3&pot=abc', status: 200, contentType: 'application/json', text: '{"events":[]}' },
    ]);

    const j = new win.XMLHttpRequest();
    j.open('GET', '/api/timedtext?v=x');
    j.responseType = 'json';
    j.send();
    j.respond(200, { 'content-type': 'application/json' }, { events: [] });
    const other = new win.XMLHttpRequest();
    other.open('GET', '/youtubei/v1/next');
    other.send();
    other.respond(200, { 'content-type': 'application/json' }, '{}');
    expect(reports).toHaveLength(1);
    expect(x.listeners.load).toHaveLength(1);
  });
});

class FakeSB {
  constructor() {
    this.got = [];
    this._offset = 0;
  }
  appendBuffer(data) {
    if (this.full) throw new DOMException('full', 'QuotaExceededError');
    this.got.push(data);
  }
  changeType(type) {
    this.type = type;
  }
  abort() {}
  remove() {}
  get timestampOffset() {
    return this._offset;
  }
  set timestampOffset(v) {
    this._offset = v;
  }
}
class FakeMS {
  constructor() {
    this.listeners = {};
  }
  addSourceBuffer(mime) {
    if (mime === 'video/nope') throw new DOMException('nope', 'NotSupportedError');
    return new FakeSB();
  }
  removeSourceBuffer() {}
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  fire(type) {
    for (const fn of this.listeners[type] || []) fn({ type });
  }
}

const EBML = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01];

function mseWindow() {
  return { MediaSource: FakeMS, SourceBuffer: FakeSB, URL: { createObjectURL: (o) => (o instanceof FakeMS ? 'blob:https://www.youtube.com/ms-1' : 'blob:https://www.youtube.com/other') } };
}

describe('MSE hooks', () => {
  it('reports sources, buffers and audio appends; copies only decodable audio', () => {
    const win = mseWindow();
    const reports = [];
    expect(installMseHooks(win, { emit: (e) => reports.push(e) })).toEqual({ mse: 'ok', objectUrl: 'ok' });
    const ms = new win.MediaSource();
    expect(win.URL.createObjectURL(ms)).toBe('blob:https://www.youtube.com/ms-1');
    expect(win.URL.createObjectURL({})).toBe('blob:https://www.youtube.com/other');
    const audio = ms.addSourceBuffer('audio/webm; codecs="opus"');
    const video = ms.addSourceBuffer('video/mp4; codecs="av01.0.08M.08"');
    const aac = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    expect(audio).toBeInstanceOf(FakeSB);

    const init = new Uint8Array([...EBML, 1, 2, 3]);
    audio.appendBuffer(init);
    const page = new Uint8Array(64).fill(7);
    audio.appendBuffer(new DataView(page.buffer, 8, 16));
    video.appendBuffer(new Uint8Array(1000));
    aac.appendBuffer(new Uint8Array(500));
    expect(audio.got[0]).toBe(init); // the page's own object went to the browser

    const kinds = reports.map((r) => r.k);
    expect(kinds).toEqual(['mse-source', 'mse-buffer', 'mse-buffer', 'mse-buffer', 'mse-chunk', 'mse-chunk', 'mse-chunk']);
    expect(reports[1]).toEqual({ k: 'mse-buffer', sbId: 1, msId: 1, mime: 'audio/webm; codecs="opus"' });
    const [c0, c1, c2] = reports.filter((r) => r.k === 'mse-chunk');
    expect(c0).toMatchObject({ sbId: 1, seq: 0, init: true, size: 12 });
    expect(new Uint8Array(c0.bytes)).toEqual(init);
    expect(c0.bytes).not.toBe(init.buffer);
    expect(c1).toMatchObject({ sbId: 1, seq: 1, init: false, size: 16 });
    expect([...new Uint8Array(c1.bytes)]).toEqual(new Array(16).fill(7));
    expect(c2).toEqual({ k: 'mse-chunk', sbId: 3, seq: 0, init: false, size: 500, bytes: null });
  });

  it('page-visible failures stay the page’s: thrown errors pass through, nothing reported', () => {
    const win = mseWindow();
    const reports = [];
    installMseHooks(win, { emit: (e) => reports.push(e) });
    const ms = new win.MediaSource();
    expect(() => ms.addSourceBuffer('video/nope')).toThrow('nope');
    const sb = ms.addSourceBuffer('audio/webm; codecs="opus"');
    sb.full = true;
    let thrown;
    try {
      sb.appendBuffer(new Uint8Array(4));
    } catch (e) {
      thrown = e;
    }
    expect(thrown.name).toBe('QuotaExceededError');
    expect(reports.map((r) => r.k)).toEqual(['mse-buffer']);
  });

  it('reports ops, mime changes and the source closing; the setter still sets', () => {
    const win = mseWindow();
    const reports = [];
    installMseHooks(win, { emit: (e) => reports.push(e) });
    const ms = new win.MediaSource();
    const sb = ms.addSourceBuffer('audio/webm; codecs="opus"');
    sb.abort();
    sb.remove(0, 30);
    sb.timestampOffset = 12.5;
    expect(sb.timestampOffset).toBe(12.5);
    sb.changeType('audio/mp4; codecs="mp4a.40.2"');
    expect(sb.type).toBe('audio/mp4; codecs="mp4a.40.2"');
    sb.appendBuffer(new Uint8Array(10));
    ms.removeSourceBuffer(sb);
    ms.fire('sourceclose');
    const ops = reports.filter((r) => r.k === 'mse-op').map((r) => {
      const { k, sbId, ...rest } = r;
      expect([k, sbId]).toEqual(['mse-op', 1]);
      return rest;
    });
    expect(ops).toEqual([{ op: 'abort' }, { op: 'remove', start: 0, end: 30 }, { op: 'timestampOffset', value: 12.5 }, { op: 'changeType', mime: 'audio/mp4; codecs="mp4a.40.2"' }, { op: 'removed' }]);
    expect(reports.find((r) => r.k === 'mse-chunk')).toMatchObject({ bytes: null, size: 10 });
    expect(reports.at(-1)).toEqual({ k: 'mse-closed', msId: 1 });
  });

  it('without MediaSource there is nothing to hook', () => {
    expect(installMseHooks({ URL: {} }, { emit: () => {} })).toEqual({ mse: 'absent', objectUrl: 'absent' });
  });

  it('mime classification and init sniffing', () => {
    expect(classifyMime('audio/webm; codecs="opus"')).toEqual({ kind: 'audio', container: 'webm', codec: 'opus', forward: true });
    expect(classifyMime('audio/webm')).toMatchObject({ kind: 'audio', forward: true });
    expect(classifyMime('audio/mp4; codecs="mp4a.40.2"')).toMatchObject({ kind: 'audio', forward: false, codec: 'mp4a.40.2' });
    expect(classifyMime('video/webm; codecs="opus"')).toMatchObject({ kind: 'audio', forward: true });
    expect(classifyMime('video/webm; codecs="vp9, opus"')).toMatchObject({ kind: 'video', forward: false });
    expect(isInitSegment(new Uint8Array(EBML))).toBe(true);
    expect(isInitSegment(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe(true);
    expect(isInitSegment(new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 1, 1, 1, 1]))).toBe(false);
  });
});

describe('EME hooks', () => {
  it('report key system requests, setMediaKeys and encrypted events without blocking', async () => {
    class Navigator {
      requestMediaKeySystemAccess(keySystem) {
        return Promise.reject(new DOMException(`${keySystem} unsupported`, 'NotSupportedError'));
      }
    }
    class HTMLMediaElement {
      setMediaKeys(keys) {
        this.keys = keys;
        return Promise.resolve();
      }
    }
    const win = { Navigator, HTMLMediaElement, document };
    const reports = [];
    expect(installEmeHooks(win, { emit: (e) => reports.push(e) })).toEqual({ eme: 'ok' });
    await expect(new Navigator().requestMediaKeySystemAccess('com.widevine.alpha', [{}])).rejects.toThrow('com.widevine.alpha unsupported');
    const el = new HTMLMediaElement();
    await el.setMediaKeys({ id: 1 });
    expect(el.keys).toEqual({ id: 1 });
    const v = document.createElement('video');
    document.body.append(v);
    const e = new Event('encrypted');
    e.initDataType = 'cenc';
    v.dispatchEvent(e);
    expect(reports).toEqual([
      { k: 'eme', via: 'request', keySystem: 'com.widevine.alpha' },
      { k: 'eme', via: 'setMediaKeys', on: true },
      { k: 'eme', via: 'encrypted', initDataType: 'cenc' },
    ]);
    v.remove();
  });
});
