// The whitelist is a security boundary: every row must carry a real hash,
// an exact size and a link the user can follow, and the lookups must never
// match on anything weaker than the hash.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packs = require('../../electron/shared/llm-packs.js');

const HEX64 = /^[0-9a-f]{64}$/;

describe('llm packs whitelist', () => {
  it('every pack is fully pinned', () => {
    expect(packs.LLM_PACKS.length).toBeGreaterThan(0);
    for (const p of packs.LLM_PACKS) {
      expect(p.id).toMatch(/^[a-z0-9.-]+$/);
      expect(packs.LLM_ROLES).toContain(p.role);
      expect(p.file).toMatch(/\.gguf$/);
      expect(p.size).toBeGreaterThan(0);
      expect(p.sha256).toMatch(HEX64);
      expect(p.arch).toBeTruthy();
      expect(p.template).toBeTruthy();
      expect(typeof p.hasThinking).toBe('boolean');
      expect(p.ctx).toBeGreaterThan(0);
      expect(p.license.name).toBe('Apache-2.0');
      expect(p.license.url).toMatch(/^https:\/\//);
      expect(p.source.url).toMatch(/^https:\/\/huggingface\.co\/.+\.gguf$/);
      expect(p.source.mirror).toMatch(/^https:\/\/.+\.gguf$/);
      expect(p.source.url.endsWith(`/${p.file}`)).toBe(true);
    }
  });

  it('ids, files and hashes are unique', () => {
    const uniq = (k) => new Set(packs.LLM_PACKS.map((p) => p[k])).size;
    expect(uniq('id')).toBe(packs.LLM_PACKS.length);
    expect(uniq('file')).toBe(packs.LLM_PACKS.length);
    expect(uniq('sha256')).toBe(packs.LLM_PACKS.length);
  });

  it('has exactly one default and it is the general model', () => {
    const defaults = packs.LLM_PACKS.filter((p) => p.default);
    expect(defaults).toHaveLength(1);
    expect(packs.defaultPack().id).toBe('qwen3-1.7b');
    expect(packs.defaultPack().role).toBe(packs.LLM_ROLE_GENERAL);
  });

  it('looks packs up by id, hash and file identity', () => {
    const q = packs.packById('qwen3-1.7b');
    expect(q.name).toBe('Qwen3-1.7B');
    expect(packs.packById('nope')).toBeNull();
    expect(packs.packByHash(q.sha256.toUpperCase())).toBe(q);
    expect(packs.packByHash('0'.repeat(64))).toBeNull();
    expect(packs.packForFile(q.file, q.size)).toBe(q);
    expect(packs.packForFile(q.file, q.size - 1)).toBeNull();
    expect(packs.packForFile('other.gguf', q.size)).toBeNull();
  });

  it('keeps the translation-only model out of the general role', () => {
    const mt = packs.packsForRole(packs.LLM_ROLE_MT);
    expect(mt.map((p) => p.id)).toEqual(['hy-mt2-1.8b']);
    expect(packs.packsForRole(packs.LLM_ROLE_GENERAL).every((p) => p.id !== 'hy-mt2-1.8b')).toBe(true);
  });
});
