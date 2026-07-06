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
