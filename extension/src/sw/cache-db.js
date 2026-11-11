// Subtitle cache: a media's cues with their translations under
// `${site}:${mediaId}` (the orchestrator's media key), least recently used
// out first past maxEntries / maxBytes. The LRU sits over a minimal store
// { get(key), put(record), delete(key), all(), clear?() }: IndexedDB in the
// worker, a Map in tests and wherever nothing may reach the disk.
//
// A record is { key, cues: [{ id, start, end, text, translation }], tier,
// lang, target, sentences, updatedAt, bytes, cueCount }; bytes is its JSON
// length; sentences: recognized cues were cut into sentences by the app.
// all() may leave cues out: the LRU only reads the rest.

import { MSG } from '../shared/messages.js';

export const CACHE_STORE = 'subtitles';
const MAX_KEY = 512;
const MAX_LANG = 32;

const err = (code) => Object.assign(new Error(code), { code });
const meta = ({ key, tier, lang, target, updatedAt, bytes, cueCount }) => ({ key, tier, lang, target, updatedAt, bytes, cueCount });
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');

function cleanCues(cues) {
  if (!Array.isArray(cues)) throw err('bad-request');
  const out = [];
  for (const c of cues) {
    if (!c || typeof c !== 'object' || !Number.isFinite(c.start) || !Number.isFinite(c.end) || typeof c.text !== 'string') continue;
    if (typeof c.id !== 'string' && typeof c.id !== 'number') continue;
    out.push({ id: String(c.id), start: c.start, end: c.end, text: c.text, translation: typeof c.translation === 'string' ? c.translation : null });
  }
  return out;
}

export function createSubtitleCache({ store, maxEntries = 200, maxBytes = 100 * 1024 * 1024, now = Date.now }) {
  let index = null; // key → meta, read from the store once
  let last = 0; // newest updatedAt handed out: uses stay in order within one millisecond
  let chain = Promise.resolve();

  const stamp = () => (last = Math.max(now(), last + 1));

  // One operation at a time, so eviction never races a put.
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  async function load() {
    if (!index) {
      const next = new Map();
      for (const r of (await store.all()) || []) {
        if (!r || typeof r.key !== 'string') continue;
        next.set(r.key, meta(r));
        last = Math.max(last, Number(r.updatedAt) || 0);
      }
      index = next;
    }
    return index;
  }

  const total = () => {
    let n = 0;
    for (const m of index.values()) n += m.bytes || 0;
    return n;
  };

  async function evict(keep) {
    const oldest = [...index.values()].filter((m) => m.key !== keep).sort((a, b) => a.updatedAt - b.updatedAt);
    let bytes = total();
    while (oldest.length && (index.size > maxEntries || bytes > maxBytes)) {
      const m = oldest.shift();
      await store.delete(m.key);
      index.delete(m.key);
      bytes -= m.bytes || 0;
    }
  }

  const checkKey = (key) => {
    if (typeof key !== 'string' || !key || key.length > MAX_KEY) throw err('bad-request');
    return key;
  };

  return {
    // The record (a hit counts as a use), or null.
    get: (key) =>
      serial(async () => {
        checkKey(key);
        await load();
        const r = await store.get(key);
        if (!r) {
          index.delete(key);
          return null;
        }
        r.updatedAt = stamp();
        await store.put(r);
        index.set(key, meta(r));
        return r;
      }),

    // Stores the record and evicts the oldest past the limits; resolves its metadata.
    put: (key, { cues, tier = null, lang = '', target = '', sentences = false } = {}) =>
      serial(async () => {
        checkKey(key);
        await load();
        const list = cleanCues(cues);
        const record = { key, cues: list, tier: Number.isSafeInteger(tier) ? tier : null, lang: str(lang, MAX_LANG), target: str(target, MAX_LANG), sentences: sentences === true, updatedAt: stamp(), bytes: 0, cueCount: list.length };
        // The size includes its own digits.
        for (let n = 0, i = 0; i < 4; i++) {
          const len = JSON.stringify({ ...record, bytes: n }).length;
          if (len === n) break;
          n = len;
          record.bytes = n;
        }
        if (record.bytes > maxBytes) throw err('too-large');
        await store.put(record);
        index.set(key, meta(record));
        await evict(key);
        return meta(record);
      }),

    delete: (key) =>
      serial(async () => {
        checkKey(key);
        await load();
        await store.delete(key);
        return index.delete(key);
      }),

    clear: () =>
      serial(async () => {
        await load();
        if (typeof store.clear === 'function') await store.clear();
        else for (const key of [...index.keys()]) await store.delete(key);
        index.clear();
      }),

    stats: () =>
      serial(async () => {
        await load();
        return { count: index.size, bytes: total() };
      }),

    // Newest first.
    list: () =>
      serial(async () => {
        await load();
        return [...index.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((m) => ({ ...m }));
      }),
  };
}

// For tests, and the store to use when nothing may be written to disk.
export function createMemoryStore() {
  const map = new Map();
  const copy = (v) => (v ? JSON.parse(JSON.stringify(v)) : null);
  return {
    get: async (key) => copy(map.get(key)),
    put: async (record) => {
      map.set(record.key, copy(record));
    },
    delete: async (key) => {
      map.delete(key);
    },
    all: async () => [...map.values()].map(copy),
    clear: async () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

// IndexedDB database `name`, object store 'subtitles' (keyPath key, index updatedAt).
export function openIndexedDbStore({ name = 't-caption', idb = globalThis.indexedDB } = {}) {
  let opening = null;

  function open() {
    opening ??= new Promise((resolve, reject) => {
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        s.createIndex('updatedAt', 'updatedAt');
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another context upgrading, or the browser closing it: open again next time.
        const drop = () => {
          db.close();
          opening = null;
        };
        db.onversionchange = drop;
        db.onclose = () => {
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    });
    return opening;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(CACHE_STORE, mode);
      let result;
      fn(t.objectStore(CACHE_STORE), (v) => {
        result = v;
      });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || err('aborted'));
    });
  }

  return {
    get: (key) =>
      tx('readonly', (s, set) => {
        const q = s.get(key);
        q.onsuccess = () => set(q.result ?? null);
      }),
    put: (record) => tx('readwrite', (s) => s.put(record)),
    delete: (key) => tx('readwrite', (s) => s.delete(key)),
    clear: () => tx('readwrite', (s) => s.clear()),
    // One record at a time through a cursor, cues left out.
    all: () =>
      tx('readonly', (s, set) => {
        const out = [];
        set(out);
        const q = s.openCursor();
        q.onsuccess = () => {
          const c = q.result;
          if (!c) return;
          const { cues: _cues, ...rest } = c.value;
          out.push(rest);
          c.continue();
        };
      }),
  };
}

// The worker's handlers for extension pages.
export function cacheHandlers(cache) {
  return {
    [MSG.CACHE_STATS]: () => cache.stats(),
    [MSG.CACHE_CLEAR]: async () => {
      await cache.clear();
      return cache.stats();
    },
    [MSG.CACHE_GET]: ({ key } = {}) => cache.get(key),
    [MSG.CACHE_PUT]: ({ key, record } = {}) => cache.put(key, record || {}),
  };
}
