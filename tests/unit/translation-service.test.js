// tests/unit/translation-service.test.js
// 翻译服务核心逻辑测试
//
// 覆盖: _preProcess, _postProcess, _getCacheKey, translateBatch, provider fallback chain

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  }),
}));

// Mock registry - provide controllable fake providers
const mockProviders = {};
const mockPriority = [];
const mockConfigured = new Set();

vi.mock('../../src/providers/registry.js', () => ({
  getProvider: (id) => mockProviders[id] || null,
  isProviderConfigured: (id) => mockConfigured.has(id),
  getAllProviderIds: () => Object.keys(mockProviders),
  getAllProvidersStatus: () => ({}),
  getMissingConfig: () => [],
  updateProviderConfig: () => {},
  createProvider: () => null,
  getAllProviderMetadata: () => [],
  initProviders: async () => {},
}));

// Mock privacy
vi.mock('../../src/config/privacy-modes.js', () => ({
  isProviderAllowed: () => true,
  PRIVACY_MODE_IDS: { STANDARD: 'standard', SECURE: 'secure' },
}));

// Mock filters
vi.mock('../../src/config/filters.js', () => ({
  getEnabledFilters: () => [],
  DEFAULT_FILTERS: [],
}));

// Mock templates
vi.mock('../../src/config/templates.js', () => ({
  getSystemPrompt: () => 'Translate to target language',
  LANGUAGE_NAMES: { zh: '中文', en: 'English' },
}));

// Mock cache
vi.mock('../../src/services/cache.js', () => {
  const cache = new Map();
  return {
    default: {
      get: (key) => cache.get(key)?.result || null,
      set: (key, result) => cache.set(key, { result, timestamp: Date.now() }),
      has: (key) => cache.has(key),
      clear: () => cache.clear(),
      getStats: () => ({ total: cache.size }),
    },
    TranslationCache: class { constructor() { this.cache = new Map(); } },
  };
});

const { TranslationService } = await import('../../src/services/translation.js');

// ========== Helper: create a fake provider ==========

function createFakeProvider(id, { translateFn, streaming = false } = {}) {
  return {
    constructor: { metadata: { id, name: id } },
    supportsStreaming: streaming,
    isConfigured: () => true,
    translate: translateFn || (async (text) => ({ success: true, text: `[${id}]${text}` })),
    translateStream: streaming
      ? async (text, src, tgt, onChunk) => {
          const result = `[${id}:stream]${text}`;
          onChunk?.(result);
          return { success: true, text: result };
        }
      : undefined,
    testConnection: async () => ({ success: true }),
  };
}

// ========== Tests ==========

describe('TranslationService', () => {
  let service;

  beforeEach(() => {
    // Reset mocks
    Object.keys(mockProviders).forEach(k => delete mockProviders[k]);
    mockConfigured.clear();

    // Create fresh service instance (not the singleton)
    service = new TranslationService();
    // Mark as initialized to skip async init
    service._initialized = true;
    service._mode = 'normal';
    service._filters = [];
    service._failureCount = {};
    service._skipThreshold = 3;
  });

  // ========== _getCacheKey ==========

  describe('_getCacheKey', () => {
    it('generates consistent keys for same input', () => {
      const k1 = service._getCacheKey('hello world', { targetLang: 'zh', template: 'natural' });
      const k2 = service._getCacheKey('hello world', { targetLang: 'zh', template: 'natural' });
      expect(k1).toBe(k2);
    });

    it('generates different keys for different target languages', () => {
      const k1 = service._getCacheKey('hello', { targetLang: 'zh' });
      const k2 = service._getCacheKey('hello', { targetLang: 'ja' });
      expect(k1).not.toBe(k2);
    });

    it('generates different keys for different templates', () => {
      const k1 = service._getCacheKey('hello', { targetLang: 'zh', template: 'natural' });
      const k2 = service._getCacheKey('hello', { targetLang: 'zh', template: 'formal' });
      expect(k1).not.toBe(k2);
    });

    it('generates different keys for different texts', () => {
      const k1 = service._getCacheKey('hello', { targetLang: 'zh' });
      const k2 = service._getCacheKey('world', { targetLang: 'zh' });
      expect(k1).not.toBe(k2);
    });

    it('no collision for texts with same prefix but different content', () => {
      const prefix = 'A'.repeat(200);
      const k1 = service._getCacheKey(prefix + ' TEXT_AAA', { targetLang: 'zh' });
      const k2 = service._getCacheKey(prefix + ' TEXT_BBB', { targetLang: 'zh' });
      expect(k1).not.toBe(k2);
    });

    it('no collision for texts with same length and same prefix', () => {
      // This was the bug: old implementation used first 100 chars + length
      const prefix = 'X'.repeat(100);
      const a = prefix + 'DIFFER_A';  // 108 chars
      const b = prefix + 'DIFFER_B';  // 108 chars - same length, same prefix
      const k1 = service._getCacheKey(a, { targetLang: 'zh' });
      const k2 = service._getCacheKey(b, { targetLang: 'zh' });
      expect(k1).not.toBe(k2);
    });

    it('handles empty text', () => {
      const key = service._getCacheKey('', { targetLang: 'zh' });
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('handles very long text', () => {
      const longText = 'word '.repeat(10000);
      const key = service._getCacheKey(longText, { targetLang: 'zh' });
      expect(typeof key).toBe('string');
      // Key should be compact (hash-based), not contain the full text
      expect(key.length).toBeLessThan(100);
    });
  });

  // ========== _preProcess / _postProcess ==========

  describe('_preProcess / _postProcess', () => {
    it('returns text unchanged when no filters', () => {
      service._filters = [];
      const { processed, protectedMap } = service._preProcess('Hello world');
      expect(processed).toBe('Hello world');
      expect(protectedMap.size).toBe(0);
    });

    it('protects matched patterns with placeholders', () => {
      service._filters = [
        { name: 'url', pattern: /https?:\/\/[^\s]+/g, enabled: true },
      ];
      const text = 'Visit https://example.com for more';
      const { processed, protectedMap } = service._preProcess(text);

      expect(processed).not.toContain('https://example.com');
      expect(protectedMap.size).toBe(1);
      // Placeholder format: ⟦url_0⟧
      expect(processed).toMatch(/⟦url_0⟧/);
    });

    it('restores protected content in postProcess', () => {
      service._filters = [
        { name: 'url', pattern: /https?:\/\/[^\s]+/g, enabled: true },
      ];
      const original = 'Visit https://example.com for more';
      const { processed, protectedMap } = service._preProcess(original);

      // Simulate translation that keeps placeholders intact
      const translated = processed.replace('Visit', '访问').replace('for more', '了解更多');
      const result = service._postProcess(translated, protectedMap);

      expect(result).toContain('https://example.com');
    });

    it('handles multiple filter types', () => {
      service._filters = [
        { name: 'url', pattern: /https?:\/\/[^\s]+/g, enabled: true },
        { name: 'email', pattern: /[\w.-]+@[\w.-]+\.\w{2,}/g, enabled: true },
      ];
      const text = 'Contact user@test.com or visit https://test.com';
      const { processed, protectedMap } = service._preProcess(text);

      expect(protectedMap.size).toBe(2);
      expect(processed).not.toContain('user@test.com');
      expect(processed).not.toContain('https://test.com');
    });

    it('skips disabled filters', () => {
      service._filters = [
        { name: 'url', pattern: /https?:\/\/[^\s]+/g, enabled: false },
      ];
      const text = 'Visit https://example.com';
      const { processed, protectedMap } = service._preProcess(text);

      expect(processed).toBe(text);
      expect(protectedMap.size).toBe(0);
    });

    it('handles code blocks', () => {
      service._filters = [
        { name: 'code_block', pattern: /```[\s\S]*?```/g, enabled: true },
      ];
      const text = 'Run this:\n```\nconst x = 1;\n```\nDone.';
      const { processed, protectedMap } = service._preProcess(text);

      expect(protectedMap.size).toBe(1);
      const restored = service._postProcess(processed, protectedMap);
      expect(restored).toContain('```\nconst x = 1;\n```');
    });

    it('postProcess is idempotent with empty map', () => {
      const text = 'Nothing to restore';
      expect(service._postProcess(text, new Map())).toBe(text);
      expect(service._postProcess(text, null)).toBe(text);
    });
  });

  // ========== translateBatch ==========

  describe('translateBatch', () => {
    beforeEach(() => {
      // Set up a working provider
      mockProviders['test-provider'] = createFakeProvider('test-provider');
      mockConfigured.add('test-provider');
      service._priority = ['test-provider'];
    });

    it('returns empty array for empty input', async () => {
      const result = await service.translateBatch([], {});
      expect(result.success).toBe(true);
      expect(result.translations).toEqual([]);
    });

    it('translates multiple texts', async () => {
      const result = await service.translateBatch(
        ['hello', 'world'],
        { targetLang: 'zh' }
      );
      expect(result.success).toBe(true);
      expect(result.translations).toHaveLength(2);
      expect(result.translations[0]).toContain('hello');
      expect(result.translations[1]).toContain('world');
    });

    it('maintains index alignment on partial failure', async () => {
      let callCount = 0;
      mockProviders['flaky'] = createFakeProvider('flaky', {
        translateFn: async (text) => {
          callCount++;
          if (callCount === 2) return { success: false, error: 'temporary failure' };
          return { success: true, text: `translated:${text}` };
        },
      });
      mockConfigured.add('flaky');
      service._priority = ['flaky'];

      const result = await service.translateBatch(
        ['text1', 'text2', 'text3'],
        { targetLang: 'zh' }
      );

      // Should still succeed overall (has some results)
      expect(result.success).toBe(true);
      expect(result.translations).toHaveLength(3);
      expect(result.translations[0]).toContain('text1');
      expect(result.translations[1]).toBe('');  // failed
      expect(result.translations[2]).toContain('text3');
    });

    it('returns failure when all translations fail', async () => {
      mockProviders['broken'] = createFakeProvider('broken', {
        translateFn: async () => ({ success: false, error: 'broken' }),
      });
      mockConfigured.add('broken');
      service._priority = ['broken'];

      const result = await service.translateBatch(
        ['a', 'b'],
        { targetLang: 'zh', enableFallback: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ========== Provider fallback chain ==========

  describe('provider fallback', () => {
    it('uses first available provider', async () => {
      mockProviders['primary'] = createFakeProvider('primary');
      mockConfigured.add('primary');
      service._priority = ['primary'];

      const result = await service.translate('test', { targetLang: 'zh' });
      expect(result.success).toBe(true);
      expect(result.provider).toBe('primary');
    });

    it('falls back to next provider on failure', async () => {
      mockProviders['failing'] = createFakeProvider('failing', {
        translateFn: async () => ({ success: false, error: 'fail' }),
      });
      mockProviders['backup'] = createFakeProvider('backup');
      mockConfigured.add('failing');
      mockConfigured.add('backup');
      service._priority = ['failing', 'backup'];

      const result = await service.translate('test', { targetLang: 'zh' });
      expect(result.success).toBe(true);
      expect(result.provider).toBe('backup');
    });

    it('falls back on exception', async () => {
      mockProviders['throws'] = createFakeProvider('throws', {
        translateFn: async () => { throw new Error('crash'); },
      });
      mockProviders['stable'] = createFakeProvider('stable');
      mockConfigured.add('throws');
      mockConfigured.add('stable');
      service._priority = ['throws', 'stable'];

      const result = await service.translate('test', { targetLang: 'zh' });
      expect(result.success).toBe(true);
      expect(result.provider).toBe('stable');
    });

    it('skips provider after repeated failures', async () => {
      mockProviders['unreliable'] = createFakeProvider('unreliable', {
        translateFn: async () => ({ success: false, error: 'fail' }),
      });
      mockProviders['reliable'] = createFakeProvider('reliable');
      mockConfigured.add('unreliable');
      mockConfigured.add('reliable');
      service._priority = ['unreliable', 'reliable'];
      service._skipThreshold = 2;

      // First call: tries unreliable (fails), falls back to reliable
      await service.translate('test1', { targetLang: 'zh' });
      expect(service._failureCount['unreliable']).toBe(1);

      // Second call: tries unreliable again (fails again)
      await service.translate('test2', { targetLang: 'zh' });
      expect(service._failureCount['unreliable']).toBe(2);

      // Third call: unreliable should be SKIPPED (>= threshold)
      const spy = vi.spyOn(mockProviders['unreliable'], 'translate');
      await service.translate('test3', { targetLang: 'zh' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not fallback when enableFallback is false', async () => {
      mockProviders['fails'] = createFakeProvider('fails', {
        translateFn: async () => ({ success: false, error: 'nope' }),
      });
      mockProviders['backup'] = createFakeProvider('backup');
      mockConfigured.add('fails');
      mockConfigured.add('backup');
      service._priority = ['fails', 'backup'];

      const result = await service.translate('test', {
        targetLang: 'zh',
        enableFallback: false,
      });
      expect(result.success).toBe(false);
      expect(result.provider).toBe('fails');
    });

    it('returns error when no providers available', async () => {
      service._priority = [];
      const result = await service.translate('test', { targetLang: 'zh' });
      expect(result.success).toBe(false);
    });

    it('resets failure counts when all providers are skipped', async () => {
      mockProviders['only'] = createFakeProvider('only', {
        translateFn: async () => ({ success: true, text: 'ok' }),
      });
      mockConfigured.add('only');
      service._priority = ['only'];
      service._failureCount['only'] = 5;
      service._skipThreshold = 3;

      // All providers skipped → should reset and retry
      const result = await service.translate('test', { targetLang: 'zh' });
      expect(result.success).toBe(true);
      expect(service._failureCount['only']).toBe(0);
    });
  });

  // ========== L1 Cache ==========

  describe('L1 cache', () => {
    beforeEach(() => {
      mockProviders['provider'] = createFakeProvider('provider');
      mockConfigured.add('provider');
      service._priority = ['provider'];
    });

    it('caches translation results in L1', async () => {
      await service.translate('cached text', { targetLang: 'zh' });

      // Second call should hit L1 cache
      const result = await service.translate('cached text', { targetLang: 'zh' });
      expect(result.fromCache).toBe(true);
    });

    it('skips cache when useCache is false', async () => {
      await service.translate('no cache', { targetLang: 'zh' });

      const result = await service.translate('no cache', {
        targetLang: 'zh',
        useCache: false,
      });
      expect(result.fromCache).toBeFalsy();
    });

    it('respects L1 max size (LRU eviction)', () => {
      service._l1MaxSize = 3;

      // Fill beyond capacity
      service._setL1Cache('key1', 'val1');
      service._setL1Cache('key2', 'val2');
      service._setL1Cache('key3', 'val3');
      service._setL1Cache('key4', 'val4');  // should evict key1

      expect(service._l1Cache.has('key1')).toBe(false);
      expect(service._l1Cache.has('key4')).toBe(true);
      expect(service._l1Cache.size).toBe(3);
    });
  });
});
