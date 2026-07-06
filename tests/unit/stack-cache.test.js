// StackTranslationCache: file-backed L2 replacing the renderer localStorage
// cache. Covers TTL expiry, bulk eviction, persist/reload round-trip, and the
// SECURE persist pause (nothing may touch disk while disabled).

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { StackTranslationCache } from '../../src/stack/cache.js';

const tmpFiles = [];
function tmpFile() {
  const p = path.join(os.tmpdir(), `tt-stack-cache-${process.pid}-${tmpFiles.length}.json`);
  tmpFiles.push(p);
  return p;
}

afterEach(async () => {
  for (const p of tmpFiles.splice(0)) {
    await fs.rm(p, { force: true });
  }
});

describe('StackTranslationCache', () => {
  it('stores and retrieves entries (memory-only mode)', () => {
    const cache = new StackTranslationCache();
    cache.set('k1', { translated: 'hello' });
    expect(cache.get('k1')).toEqual({ translated: 'hello' });
    expect(cache.get('missing')).toBeNull();
  });

  it('expires entries past TTL', () => {
    const cache = new StackTranslationCache({ ttl: -1 }); // everything is instantly stale
    cache.set('k1', { translated: 'hello' });
    expect(cache.get('k1')).toBeNull();
  });

  it('bulk-evicts oldest entries at capacity', () => {
    const cache = new StackTranslationCache({ maxSize: 10 });
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, { translated: `v${i}` });
    cache.set('k10', { translated: 'v10' }); // triggers 20% eviction of oldest
    expect(cache.get('k0')).toBeNull();
    expect(cache.get('k10')).toEqual({ translated: 'v10' });
  });

  it('persists to file and reloads across instances', async () => {
    const file = tmpFile();
    const a = new StackTranslationCache({ filePath: file });
    await a.init();
    a.set('k1', { translated: 'hello' });
    await a.flush();

    const b = new StackTranslationCache({ filePath: file });
    await b.init();
    expect(b.get('k1')).toEqual({ translated: 'hello' });
  });

  it('setPersistEnabled(false) flushes pending writes then stops touching disk', async () => {
    const file = tmpFile();
    const cache = new StackTranslationCache({ filePath: file });
    await cache.init();

    cache.set('standard-entry', { translated: 'kept' });
    await cache.setPersistEnabled(false); // SECURE entered: flush, then pause

    cache.set('secure-entry', { translated: 'must-not-land' });
    await cache.flush(); // no-op while disabled

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk['standard-entry']).toBeDefined();
    expect(onDisk['secure-entry']).toBeUndefined();
  });

  it('clear() removes the on-disk snapshot too', async () => {
    const file = tmpFile();
    const cache = new StackTranslationCache({ filePath: file });
    await cache.init();
    cache.set('k1', { translated: 'hello' });
    await cache.flush();

    cache.clear();
    // rm is fire-and-forget; give it a tick
    await new Promise(r => setTimeout(r, 50));
    await expect(fs.readFile(file, 'utf8')).rejects.toThrow();
  });
});
