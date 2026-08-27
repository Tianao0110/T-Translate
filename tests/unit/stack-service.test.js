// Stack TranslationService: the privacy/fallback/cache behaviors that must
// survive the main-process migration byte-for-byte. Runs against the real
// stack registry + real provider classes with an injected mock fetch — no
// network, no electron.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationService } from '../../src/stack/service.js';
import { configureRuntime } from '../../src/stack/runtime.js';

// Two cloud providers, both configured; priority = openai then deepseek.
const SETTINGS = {
  providers: {
    list: [
      { id: 'openai', enabled: true, priority: 1 },
      { id: 'deepseek', enabled: true, priority: 2 },
    ],
    configs: {
      openai: { apiKey: 'sk-test-openai' },
      deepseek: { apiKey: 'sk-test-deepseek' },
    },
  },
};

function okChatResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
    text: async () => '',
  };
}

function makeFakeL2() {
  return {
    get: vi.fn(() => null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn(() => ({})),
  };
}

function makeService(l2) {
  return new TranslationService({
    getCustomFilters: () => [],
    cache: l2,
  });
}

beforeEach(() => {
  configureRuntime({ getLanguage: () => 'zh' });
});

describe('stack TranslationService', () => {
  it('OFFLINE mode never reaches a cloud provider (no fetch issued)', async () => {
    const fetchMock = vi.fn();
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(SETTINGS);

    const result = await svc.translate('hello world', { privacyMode: 'offline' });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the next provider when the first fails', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('api.openai.com')) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      }
      return okChatResponse('你好，世界');
    });
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(SETTINGS);

    const result = await svc.translate('hello world', { targetLang: 'zh' });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('deepseek');
    expect(result.text).toBe('你好，世界');
    // openai tried once, deepseek succeeded once
    const hosts = fetchMock.mock.calls.map(c => String(c[0]));
    expect(hosts.some(u => u.includes('api.openai.com'))).toBe(true);
    expect(hosts.some(u => u.includes('api.deepseek.com'))).toBe(true);
  });

  it('SECURE mode never writes the persistent L2 cache', async () => {
    const fetchMock = vi.fn(async () => okChatResponse('翻译结果'));
    configureRuntime({ fetch: fetchMock });

    const l2 = makeFakeL2();
    const svc = makeService(l2);
    await svc.init(SETTINGS);

    const result = await svc.translate('sensitive text', { privacyMode: 'secure' });

    expect(result.success).toBe(true);
    expect(l2.set).not.toHaveBeenCalled();
    expect(l2.get).not.toHaveBeenCalled();
  });

  it('STANDARD mode caches: identical repeat translate is served without a second fetch', async () => {
    const fetchMock = vi.fn(async () => okChatResponse('缓存我'));
    configureRuntime({ fetch: fetchMock });

    const l2 = makeFakeL2();
    const svc = makeService(l2);
    await svc.init(SETTINGS);

    const first = await svc.translate('cache me', { targetLang: 'zh' });
    const second = await svc.translate('cache me', { targetLang: 'zh' });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe('缓存我');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // L2 was offered the entry in standard mode
    expect(l2.set).toHaveBeenCalled();
  });

  it('external abort interrupts the in-flight provider fetch (P2-34)', async () => {
    let firstSignal;
    const fetchMock = vi.fn((url, opts) => new Promise((resolve, reject) => {
      const fail = () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (!firstSignal) firstSignal = opts.signal;
      if (opts.signal.aborted) return fail();
      opts.signal.addEventListener('abort', fail, { once: true });
    }));
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(SETTINGS);

    const ac = new AbortController();
    const pending = svc.translate('slow text', { signal: ac.signal });
    await new Promise(r => setTimeout(r, 20)); // let the first fetch start
    ac.abort();

    const result = await pending;
    expect(result.success).toBe(false);
    expect(firstSignal.aborted).toBe(true); // the HTTP request itself was cancelled
  });

  it('testProviderWithConfig is blocked by offline mode before any network', async () => {
    const fetchMock = vi.fn();
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(SETTINGS);

    const result = await svc.testProviderWithConfig('openai', { apiKey: 'sk-x' }, 'offline');

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The language reorder (model-language-coverage.js) once lived only inside
// translate(); the default UI path is translateStream(), so it never ran where
// it mattered. These pin the reorder to BOTH scheduler paths.
describe('language-coverage reorder', () => {
  // Local llama-3 first (documented languages do NOT include zh), Google behind it.
  const LOCAL_FIRST = {
    providers: {
      list: [
        { id: 'local-llm', enabled: true, priority: 1 },
        { id: 'google-translate', enabled: true, priority: 2 },
      ],
      configs: {
        'local-llm': { model: 'llama-3.1-8b-instruct' },
        'google-translate': {},
      },
    },
  };

  // SSE stream shaped like LM Studio's /chat/completions output — the local
  // model must be able to "succeed" for the test to prove it was demoted
  // rather than merely failing over.
  function okSseResponse(text) {
    const payload =
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(payload);
    let sent = false;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes })),
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
      json: async () => ({}),
      text: async () => '',
    };
  }

  function makeRoutedFetch() {
    return vi.fn(async (url) => {
      if (String(url).includes('localhost:1234')) {
        return okSseResponse('自信的胡话');
      }
      // google-translate web API shape
      return { ok: true, status: 200, json: async () => [[['你好', 'hello']]], text: async () => '' };
    });
  }

  it('translateStream (default UI path) demotes a local model that does not cover the target language', async () => {
    const fetchMock = makeRoutedFetch();
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(LOCAL_FIRST);

    const chunks = [];
    const result = await svc.translateStream('hello', { targetLang: 'zh' }, (c) => chunks.push(c));

    expect(result.success).toBe(true);
    expect(result.provider).toBe('google-translate');
    expect(chunks.length).toBeGreaterThan(0);
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('localhost:1234'))).toBe(false);
  });

  it('translate (non-streaming path) applies the same reorder', async () => {
    const fetchMock = makeRoutedFetch();
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(LOCAL_FIRST);

    const result = await svc.translate('hello', { targetLang: 'zh' });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('google-translate');
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('localhost:1234'))).toBe(false);
  });

  it('a covered target language leaves the local model first', async () => {
    const fetchMock = makeRoutedFetch();
    configureRuntime({ fetch: fetchMock });

    const svc = makeService(makeFakeL2());
    await svc.init(LOCAL_FIRST);

    // en IS in llama-3's documented set — no demotion, local model answers
    const result = await svc.translateStream('你好', { targetLang: 'en' }, () => {});

    expect(result.success).toBe(true);
    expect(result.provider).toBe('local-llm');
  });
});

// A provider that only translates answers a prompt with a translation OF that
// prompt, which reads like a working AI feature. These lock the honest answer.
describe('chat capability', () => {
  const TRADITIONAL_ONLY = {
    providers: {
      list: [{ id: 'google-translate', enabled: true, priority: 1 }],
      configs: { 'google-translate': {} },
    },
  };

  it('reports the chat-capable provider when one is configured', async () => {
    configureRuntime({ fetch: vi.fn() });
    const svc = makeService(makeFakeL2());
    await svc.init(SETTINGS);

    expect(svc.getChatCapability()).toMatchObject({ available: true, providerId: 'openai' });
  });

  it('reports unavailable when only traditional sources are configured', async () => {
    configureRuntime({ fetch: vi.fn() });
    const svc = makeService(makeFakeL2());
    await svc.init(TRADITIONAL_ONLY);

    expect(svc.getChatCapability()).toMatchObject({ available: false, providerId: null });
  });

  it('reports unavailable in offline mode when the only LLM is a cloud one', async () => {
    configureRuntime({ fetch: vi.fn() });
    const svc = makeService(makeFakeL2());
    await svc.init(SETTINGS);

    expect(svc.getChatCapability({ privacyMode: 'offline' }).available).toBe(false);
  });

  it('requireChat refuses instead of translating the prompt', async () => {
    const fetchMock = vi.fn();
    configureRuntime({ fetch: fetchMock });
    const svc = makeService(makeFakeL2());
    await svc.init(TRADITIONAL_ONLY);

    const result = await svc.chatCompletion(
      [{ role: 'user', content: 'Summarize this article' }],
      { requireChat: true }
    );

    expect(result.success).toBe(false);
    expect(result.error.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without requireChat the legacy translate fallback still runs', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [[['翻译结果', 'Summarize this article']]],
      text: async () => '',
    }));
    configureRuntime({ fetch: fetchMock });
    const svc = makeService(makeFakeL2());
    await svc.init(TRADITIONAL_ONLY);

    await svc.chatCompletion([{ role: 'user', content: 'Summarize this article' }]);

    expect(fetchMock).toHaveBeenCalled();
  });
});
