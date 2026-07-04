// L2 translation cache. localStorage-backed, TTL'd, with debounced saves.

import createLogger from '../utils/logger.js';

const logger = createLogger('Cache');

class TranslationCache {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'translation-cache';
    this.maxSize = options.maxSize || 200;
    this.ttl = options.ttl || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.cache = new Map();
    this._saveTimer = null;

    this.load();
    this.cleanup();
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        Object.entries(parsed).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        logger.debug(`Loaded ${this.cache.size} cached translations`);
      }
    } catch (error) {
      logger.error('Failed to load cache:', error);
      this.cache = new Map();
    }
  }

  save() {
    try {
      // Three renderer windows share this one localStorage key. A plain
      // overwrite means the last window to save drops every entry the others
      // added since load. Merge against the current on-disk copy first
      // (newer timestamp wins), then reflect the union back into our own map.
      let merged = {};
      try {
        const existing = localStorage.getItem(this.storageKey);
        if (existing) merged = JSON.parse(existing);
      } catch { /* corrupt/other-window write; fall back to our own data */ }

      this.cache.forEach((value, key) => {
        const prev = merged[key];
        if (!prev || (value.timestamp || 0) >= (prev.timestamp || 0)) {
          merged[key] = value;
        }
      });

      let entries = Object.entries(merged);
      if (entries.length > this.maxSize) {
        entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
        entries = entries.slice(0, this.maxSize);
        merged = Object.fromEntries(entries);
      }

      // Keep our in-memory view consistent with the merged union so this
      // window can also read entries the others contributed.
      this.cache = new Map(entries);
      localStorage.setItem(this.storageKey, JSON.stringify(merged));
    } catch (error) {
      logger.error('Failed to save cache:', error);
      // localStorage quota is ~5MB; on overflow drop half and retry once
      if (error.name === 'QuotaExceededError') {
        this.evict(Math.floor(this.cache.size / 2));
        this.save();
      }
    }
  }

  // Batched write — important for streaming translation where each chunk
  // would otherwise trigger a full JSON.stringify of the cache
  debouncedSave(delay = 500) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), delay);
  }

  generateKey(text, from, to, template = 'natural') {
    return `${from}-${to}-${template}-${this._hash(text)}`;
  }

  // djb2 dual-hash — same scheme as translation service's L1 key so the
  // two layers can share keys
  _hash(str) {
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = (h1 * 33) ^ c;
      h2 = (h2 * 33) ^ c;
    }
    return ((h1 >>> 0) * 4096 + (h2 >>> 0)).toString(36);
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      this.debouncedSave();
      return null;
    }

    return item.result;
  }

  set(key, result) {
    // Bulk evict 20% rather than 1 — avoids re-evicting on every set near capacity
    if (this.cache.size >= this.maxSize) {
      this.evict(Math.floor(this.maxSize * 0.2));
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    this.debouncedSave();
  }

  has(key) {
    return this.get(key) !== null;
  }

  // Map preserves insertion order; iterating keys() gives oldest first
  evict(count) {
    const keysToDelete = Array.from(this.cache.keys()).slice(0, count);
    keysToDelete.forEach(key => this.cache.delete(key));
    logger.debug(`Evicted ${keysToDelete.length} old entries`);
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    this.cache.forEach((value, key) => {
      if (now - value.timestamp > this.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      this.save();
      logger.debug(`Cleaned ${cleaned} expired entries`);
    }
  }

  clear() {
    this.cache.clear();
    localStorage.removeItem(this.storageKey);
    logger.debug('All cache cleared');
  }

  getStats() {
    let validCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    this.cache.forEach((value) => {
      if (now - value.timestamp > this.ttl) {
        expiredCount++;
      } else {
        validCount++;
      }
    });

    return {
      total: this.cache.size,
      valid: validCount,
      expired: expiredCount,
      maxSize: this.maxSize,
      ttlDays: this.ttl / (24 * 60 * 60 * 1000)
    };
  }
}

const translationCache = new TranslationCache();

export default translationCache;
export { TranslationCache };
