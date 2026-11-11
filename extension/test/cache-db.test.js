// The subtitle cache over the in-memory store: records and their byte size,
// a hit refreshing its place, eviction of the least recently used past the
// entry and byte limits, an index rebuilt from what the store already has,
// clear / stats / list, bad input; and the worker's CACHE_* handlers behind
// handle() with a fake runtime (extension pages only).

import { describe, it, expect } from 'vitest';
import { createSubtitleCache, createMemoryStore, cacheHandlers } from '../src/sw/cache-db.js';
import { MSG, call, request, handle, isExtensionSender } from '../src/shared/messages.js';

const cue = (i, text = `line ${i}`, translation = null) => ({ id: String(i), start: i, end: i + 1, text, translation });
const rec = (n = 2, extra = {}) => ({ cues: Array.from({ length: n }, (_, i) => cue(i)), tier: 1, lang: 'en', target: 'zh', ...extra });

function clock(t = 1000) {
  const fn = () => t;
  fn.tick = (ms = 1) => (t += ms);
  return fn;
}

describe('subtitle cache', () => {
  it('put stores the record with its JSON size; get hands it back and counts as a use', async () => {
    const now = clock();
    const store = createMemoryStore();
    const cache = createSubtitleCache({ store, now });
    const m = await cache.put('youtube:UF8uR6Z6KLc', { cues: [cue(1, 'Hello', '你好'), { id: 2, start: 2, end: 3, text: 'World' }, { id: 'bad', start: 'x' }], tier: 2, lang: 'en', target: 'zh' });
    const stored = await store.get('youtube:UF8uR6Z6KLc');
    expect(m).toEqual({ key: 'youtube:UF8uR6Z6KLc', tier: 2, lang: 'en', target: 'zh', url: '', title: '', updatedAt: 1000, bytes: JSON.stringify(stored).length, cueCount: 2 });
    expect(stored.cues).toEqual([cue(1, 'Hello', '你好'), { id: '2', start: 2, end: 3, text: 'World', translation: null }]);
    now.tick(500);
    const hit = await cache.get('youtube:UF8uR6Z6KLc');
    expect(hit).toMatchObject({ key: 'youtube:UF8uR6Z6KLc', updatedAt: 1500, cueCount: 2 });
    expect(hit.cues).toHaveLength(2);
    expect((await store.get('youtube:UF8uR6Z6KLc')).updatedAt).toBe(1500);
    expect(await cache.get('youtube:missing')).toBeNull();
  });

  it('past the entry limit the least recently used goes; a hit keeps one', async () => {
    const now = clock();
    const cache = createSubtitleCache({ store: createMemoryStore(), maxEntries: 3, now });
    for (const k of ['a', 'b', 'c']) {
      await cache.put(`youtube:${k}`, rec());
      now.tick();
    }
    await cache.get('youtube:a');
    now.tick();
    await cache.put('youtube:d', rec());
    expect((await cache.list()).map((m) => m.key)).toEqual(['youtube:d', 'youtube:a', 'youtube:c']);
    now.tick();
    await cache.put('youtube:e', rec());
    expect((await cache.list()).map((m) => m.key)).toEqual(['youtube:e', 'youtube:d', 'youtube:a']);
    expect((await cache.stats()).count).toBe(3);
  });

  it('past the byte limit the oldest go until it fits; one record too big is refused', async () => {
    const now = clock();
    const one = (await createSubtitleCache({ store: createMemoryStore(), now }).put('x:1', rec(10))).bytes;
    const cache = createSubtitleCache({ store: createMemoryStore(), maxBytes: one * 3 + 10, now });
    for (let i = 1; i <= 3; i++) {
      await cache.put(`x:${i}`, rec(10));
      now.tick();
    }
    expect(await cache.stats()).toEqual({ count: 3, bytes: one * 3 });
    await cache.put('x:4', rec(10));
    expect((await cache.list()).map((m) => m.key)).toEqual(['x:4', 'x:3', 'x:2']);
    now.tick();
    await cache.put('x:5', rec(25));
    const left = (await cache.list()).map((m) => m.key);
    expect(left[0]).toBe('x:5');
    expect((await cache.stats()).bytes).toBeLessThanOrEqual(one * 3 + 10);
    await expect(cache.put('x:big', rec(200))).rejects.toMatchObject({ code: 'too-large' });
    expect((await cache.list()).map((m) => m.key)).toEqual(left);
  });

  it('putting a key again replaces it and makes it the newest', async () => {
    const now = clock();
    const cache = createSubtitleCache({ store: createMemoryStore(), maxEntries: 2, now });
    await cache.put('a:1', rec(1));
    await cache.put('a:2', rec(1));
    await cache.put('a:1', rec(4));
    // The clock stands still: uses still come out in order.
    expect(await cache.list()).toEqual([expect.objectContaining({ key: 'a:1', cueCount: 4, updatedAt: 1002 }), expect.objectContaining({ key: 'a:2', updatedAt: 1001 })]);
    await cache.put('a:3', rec(1));
    expect((await cache.list()).map((m) => m.key)).toEqual(['a:3', 'a:1']);
  });

  it('a new cache over a store with records reads their sizes once; clear empties the store', async () => {
    const now = clock();
    const store = createMemoryStore();
    const first = createSubtitleCache({ store, now });
    await first.put('youtube:a', rec(3));
    now.tick();
    await first.put('bilibili:BV1GJ411x7h7', rec(1, { tier: 1, lang: 'zh', target: 'en' }));
    const second = createSubtitleCache({ store, now });
    expect(await second.stats()).toEqual(await first.stats());
    expect(await second.list()).toEqual([
      expect.objectContaining({ key: 'bilibili:BV1GJ411x7h7', tier: 1, lang: 'zh', target: 'en', cueCount: 1 }),
      expect.objectContaining({ key: 'youtube:a', cueCount: 3 }),
    ]);
    expect(await second.delete('youtube:a')).toBe(true);
    await second.clear();
    expect(await second.stats()).toEqual({ count: 0, bytes: 0 });
    expect(store.size).toBe(0);
  });

  it('bad keys and records are refused', async () => {
    const cache = createSubtitleCache({ store: createMemoryStore() });
    await expect(cache.put('', rec())).rejects.toMatchObject({ code: 'bad-request' });
    await expect(cache.put('k'.repeat(600), rec())).rejects.toMatchObject({ code: 'bad-request' });
    await expect(cache.put('a:b', { cues: 'nope' })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(cache.get(42)).rejects.toMatchObject({ code: 'bad-request' });
    expect(await cache.put('a:b', { cues: [], tier: 'x', lang: 5 })).toMatchObject({ tier: null, lang: '', cueCount: 0 });
  });
});

describe('CACHE_* handlers', () => {
  const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
  function fakeRuntime() {
    const listeners = new Set();
    return {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      getURL: (p) => `${EXT}${p}`,
      sender: { id: 'abcdefghijklmnopabcdefghijklmnop', url: `${EXT}popup.html` },
      onMessage: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
      sendMessage(msg) {
        return new Promise((resolve) => {
          for (const fn of [...listeners]) fn(msg, this.sender, resolve);
        });
      },
    };
  }

  it('put → get → stats → clear → stats, for extension pages only', async () => {
    const runtime = fakeRuntime();
    const cache = createSubtitleCache({ store: createMemoryStore() });
    handle(cacheHandlers(cache), { runtime, accept: (_m, s) => isExtensionSender(s, runtime) });
    const put = await call(MSG.CACHE_PUT, { key: 'youtube:UF8uR6Z6KLc', record: rec(3) }, { runtime });
    expect(put).toMatchObject({ key: 'youtube:UF8uR6Z6KLc', cueCount: 3 });
    expect((await call(MSG.CACHE_GET, { key: 'youtube:UF8uR6Z6KLc' }, { runtime })).cues).toHaveLength(3);
    expect(await call(MSG.CACHE_STATS, null, { runtime })).toEqual({ count: 1, bytes: put.bytes });
    expect(await call(MSG.CACHE_CLEAR, null, { runtime })).toEqual({ count: 0, bytes: 0 });
    expect(await call(MSG.CACHE_GET, { key: 'youtube:UF8uR6Z6KLc' }, { runtime })).toBeNull();
    expect(await request(MSG.CACHE_PUT, { key: '' }, { runtime })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    runtime.sender = { id: runtime.id, url: 'https://www.youtube.com/watch?v=x', tab: { id: 3 } };
    expect(await request(MSG.CACHE_STATS, null, { runtime })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('list hands back where and when, newest first; delete removes one', async () => {
    const runtime = fakeRuntime();
    const now = clock();
    const cache = createSubtitleCache({ store: createMemoryStore(), now });
    handle(cacheHandlers(cache), { runtime, accept: (_m, s) => isExtensionSender(s, runtime) });
    await call(MSG.CACHE_PUT, { key: 'youtube:a', record: { ...rec(2), url: 'https://www.youtube.com/watch?v=a', title: 'First' } }, { runtime });
    now.tick(1000);
    await call(MSG.CACHE_PUT, { key: 'bilibili:b', record: { ...rec(1), url: 'javascript:alert(1)', title: 'Second' } }, { runtime });
    const list = await call(MSG.CACHE_LIST, null, { runtime });
    expect(list.map((m) => [m.key, m.title, m.url, m.cueCount])).toEqual([
      ['bilibili:b', 'Second', '', 1], // only an http(s) page is kept
      ['youtube:a', 'First', 'https://www.youtube.com/watch?v=a', 2],
    ]);
    expect(list[0]).not.toHaveProperty('cues');
    expect(await call(MSG.CACHE_DELETE, { key: 'youtube:a' }, { runtime })).toMatchObject({ count: 1 });
    expect((await call(MSG.CACHE_LIST, null, { runtime })).map((m) => m.key)).toEqual(['bilibili:b']);
  });
});
