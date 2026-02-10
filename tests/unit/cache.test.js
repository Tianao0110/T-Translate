// tests/unit/cache.test.js
// 翻译缓存服务测试
//
// 覆盖: get/set, TTL 过期, 容量驱逐, generateKey

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger before importing cache
vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Use named export (class), not default export (singleton instance)
const { TranslationCache } = await import('../../src/services/cache.js');

describe('TranslationCache', () => {
  let cache;

  beforeEach(() => {
    localStorage.clear();
    cache = new TranslationCache({ maxSize: 5, ttl: 1000 });
  });

  describe('generateKey', () => {
    it('generates consistent keys for same input', () => {
      const key1 = cache.generateKey('hello', 'en', 'zh', 'natural');
      const key2 = cache.generateKey('hello', 'en', 'zh', 'natural');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different languages', () => {
      const key1 = cache.generateKey('hello', 'en', 'zh');
      const key2 = cache.generateKey('hello', 'en', 'ja');
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different templates', () => {
      const key1 = cache.generateKey('hello', 'en', 'zh', 'natural');
      const key2 = cache.generateKey('hello', 'en', 'zh', 'formal');
      expect(key1).not.toBe(key2);
    });

    it('truncates long text in key', () => {
      const longText = 'a'.repeat(200);
      const key = cache.generateKey(longText, 'en', 'zh');
      expect(key.length).toBeLessThan(longText.length + 50);
    });

    it('avoids collision for texts with same prefix but different content', () => {
      const prefix = 'x'.repeat(100);
      const key1 = cache.generateKey(prefix + ' AAAA', 'en', 'zh');
      const key2 = cache.generateKey(prefix + ' BBBB', 'en', 'zh');
      expect(key1).not.toBe(key2);
    });
  });

  describe('get/set', () => {
    it('stores and retrieves values', () => {
      const key = cache.generateKey('hello', 'en', 'zh');
      cache.set(key, { text: '你好', success: true });
      
      const result = cache.get(key);
      expect(result).toEqual({ text: '你好', success: true });
    });

    it('returns null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('returns null for expired entries', async () => {
      const shortCache = new TranslationCache({ maxSize: 5, ttl: 50 });
      const key = shortCache.generateKey('test', 'en', 'zh');
      shortCache.set(key, { text: '测试' });

      // Wait for TTL to expire
      await new Promise(r => setTimeout(r, 60));
      expect(shortCache.get(key)).toBeNull();
    });
  });

  describe('has', () => {
    it('returns true for existing non-expired entries', () => {
      const key = cache.generateKey('hello', 'en', 'zh');
      cache.set(key, { text: '你好' });
      expect(cache.has(key)).toBe(true);
    });

    it('returns false for missing entries', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });
  });

  describe('capacity management', () => {
    it('evicts old entries when at capacity', () => {
      // Fill cache to maxSize (5)
      for (let i = 0; i < 5; i++) {
        cache.set(`key-${i}`, { text: `value-${i}` });
      }
      expect(cache.getStats().total).toBe(5);

      // Adding one more should trigger eviction
      cache.set('key-new', { text: 'new-value' });
      expect(cache.getStats().total).toBeLessThanOrEqual(5);
      // New entry should be accessible
      expect(cache.get('key-new')).toEqual({ text: 'new-value' });
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('key1', { text: 'a' });
      cache.set('key2', { text: 'b' });
      cache.clear();
      
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.getStats().total).toBe(0);
    });
  });

  describe('persistence', () => {
    it('survives re-instantiation via localStorage', () => {
      cache.set('persist-key', { text: 'persisted' });

      // Create new instance with same storageKey
      const cache2 = new TranslationCache({ maxSize: 5, ttl: 1000 });
      expect(cache2.get('persist-key')).toEqual({ text: 'persisted' });
    });
  });
});
