// Regression: an empty translation used to poison the cache with an object.
//
// Field crash (2026-08-05, React #31 "object with keys {text, from, to}"): a
// local model streamed nothing back, the provider still reported success, and
// _saveCache stored `result.text || result` — with text empty that is the whole
// {text, from, to} object. Every later hit on that key handed the object back
// as the translation, the renderer tried to render it, and the app died. Only
// the one template was affected because template is part of the cache key,
// which is exactly what the user saw: "switching style works".
//
// Three independent defects, each enough on its own. All three are covered here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationService } from '../../src/stack/service.js';
import { getProvider } from '../../src/stack/registry.js';
import { configureRuntime } from '../../src/stack/runtime.js';

// The key includes the provider's resolved model — asking for it beats guessing.
const keyFor = (svc, text, targetLang) => svc._getCacheKey(text, {
  targetLang,
  template: 'natural',
  providerId: 'openai',
  model: getProvider('openai')?.config?.model || '',
});

// Minimal SSE body, which is what the streaming path actually reads.
function streamResponse(content) {
  const lines = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => (sent
            ? { done: true, value: undefined }
            : (sent = true, { done: false, value: new TextEncoder().encode(lines) })),
          releaseLock: () => {},
          cancel: async () => {},
        };
      },
    },
    json: async () => ({}),
    text: async () => '',
  };
}

const SETTINGS = {
  providers: {
    list: [{ id: 'openai', enabled: true, priority: 1 }],
    configs: { openai: { apiKey: 'sk-test' } },
  },
};

function makeL2() {
  const store = new Map();
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => store.set(k, v),
    clear: () => store.clear(),
    getStats: () => ({}),
    _store: store,
  };
}

function chatResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  };
}

beforeEach(() => {
  configureRuntime({ getLanguage: () => 'zh' });
});

describe('empty translation never reaches the cache', () => {
  it('a model that answers with nothing is a failure, not an empty success', async () => {
    configureRuntime({ fetch: vi.fn(async () => chatResponse('   ')) });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: makeL2() });
    await svc.init(SETTINGS);

    const result = await svc.translate('hello world', { targetLang: 'zh' });

    expect(result.success).toBe(false);
  });

  it('leaves no cache entry behind when there is nothing to cache', async () => {
    const l2 = makeL2();
    configureRuntime({ fetch: vi.fn(async () => chatResponse('')) });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: l2 });
    await svc.init(SETTINGS);

    await svc.translate('hello world', { targetLang: 'zh' });

    expect(l2._store.size).toBe(0);
  });

  it('caches a real translation as a plain string, not as the wrapper object', async () => {
    const l2 = makeL2();
    configureRuntime({ fetch: vi.fn(async () => chatResponse('你好世界')) });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: l2 });
    await svc.init(SETTINGS);

    await svc.translate('hello world', { targetLang: 'zh' });

    const [entry] = [...l2._store.values()];
    expect(typeof entry.translated).toBe('string');
    expect(entry.translated).toBe('你好世界');
  });
});

describe('a poisoned cache entry can never become the translation', () => {
  // Entries written by earlier versions are already on users' disks, so the
  // read side has to heal itself rather than trust what it finds.
  const poisoned = { success: true, translated: { text: '', from: 'zh', to: 'en' }, from: 'zh', to: 'en' };

  it('treats an object-valued entry as a miss and translates again', async () => {
    const l2 = makeL2();
    const fetchMock = vi.fn(async () => chatResponse('fresh translation'));
    configureRuntime({ fetch: fetchMock });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: l2 });
    await svc.init(SETTINGS);

    // Pre-poison exactly the key this request will compute.
    l2.set(keyFor(svc, 'hello world', 'en'), poisoned);

    const result = await svc.translate('hello world', { targetLang: 'en' });

    expect(typeof result.text).toBe('string');
    expect(result.text).toBe('fresh translation');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does the same on the streaming path, and never emits an object chunk', async () => {
    const l2 = makeL2();
    configureRuntime({ fetch: vi.fn(async () => streamResponse('fresh translation')) });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: l2 });
    await svc.init(SETTINGS);

    l2.set(keyFor(svc, 'hello world', 'en'), poisoned);

    const chunks = [];
    const result = await svc.translateStream('hello world', { targetLang: 'en' }, (t) => chunks.push(t));

    expect(typeof result.text).toBe('string');
    for (const c of chunks) expect(typeof c).toBe('string');
  });

  it('heals the poisoned entry instead of leaving it to bite again', async () => {
    const l2 = makeL2();
    configureRuntime({ fetch: vi.fn(async () => chatResponse('fresh translation')) });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: l2 });
    await svc.init(SETTINGS);

    const key = keyFor(svc, 'hello world', 'en');
    l2.set(key, poisoned);

    await svc.translate('hello world', { targetLang: 'en' });

    expect(typeof l2.get(key).translated).toBe('string');
  });
});
