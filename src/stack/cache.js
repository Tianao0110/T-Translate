// L2 translation cache for the main-process stack. Replaces the renderer's
// localStorage-backed services/cache.js: a single in-memory Map with a
// debounced JSON file behind it — one instance for all three windows, so the
// old timestamp-merge dance between windows is gone by construction.
// Old localStorage data is intentionally NOT migrated (decision D-2: 7-day TTL
// disposable cache, cold rebuild).

import { promises as fs } from 'fs';
import path from 'path';
import createLogger from './logger.js';

const logger = createLogger('StackCache');

export class StackTranslationCache {
  constructor(options = {}) {
    this.filePath = options.filePath || null; // null = memory-only (tests, browser-less runs)
    this.maxSize = options.maxSize || 200;
    this.ttl = options.ttl || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.cache = new Map();
    this._saveTimer = null;
    this._persistEnabled = true;
    this._loaded = false;
  }

  // Load the on-disk snapshot once. Corrupt/missing file = start empty
  // (the cache is disposable by design).
  async init() {
    if (this._loaded || !this.filePath) {
      this._loaded = true;
      return;
    }
    this._loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [key, value] of Object.entries(parsed)) {
        this.cache.set(key, value);
      }
      this.cleanup();
      logger.debug(`Loaded ${this.cache.size} cached translations`);
    } catch {
      // ENOENT or corrupt JSON — cold start
    }
  }

  // SECURE mode hook: while disabled, nothing is written to disk. Pending
  // debounced writes are flushed BEFORE disabling so standard-mode entries
  // captured earlier still land.
  async setPersistEnabled(enabled) {
    if (!enabled && this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      await this._persist();
    }
    this._persistEnabled = !!enabled;
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
      timestamp: Date.now(),
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
      this.debouncedSave();
      logger.debug(`Cleaned ${cleaned} expired entries`);
    }
  }

  clear() {
    this.cache.clear();
    if (this.filePath) {
      // Remove the snapshot too — "clear cache" must not resurrect on restart
      fs.rm(this.filePath, { force: true }).catch(() => {});
    }
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
      ttlDays: this.ttl / (24 * 60 * 60 * 1000),
    };
  }

  // Batched write — same 500ms debounce the renderer cache used, important for
  // streaming where every completed segment triggers a set().
  debouncedSave(delay = 500) {
    if (!this.filePath || !this._persistEnabled) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._persist().catch((e) => logger.warn('Cache persist failed:', e.message));
    }, delay);
  }

  async _persist() {
    if (!this.filePath || !this._persistEnabled) return;
    const obj = Object.fromEntries(this.cache);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(obj), 'utf8');
  }

  // Test/shutdown hook: force any pending write out now.
  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    await this._persist();
  }
}

export default StackTranslationCache;
