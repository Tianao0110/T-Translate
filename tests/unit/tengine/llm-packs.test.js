// The whitelist is a security boundary: every row must carry a real hash,
// an exact size and a link the user can follow, and the lookups must never
// match on anything weaker than the hash.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packs = require('../../../electron/shared/llm-packs.js');

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

  it('names a file outside the whitelist as translation-only for the Hunyuan MT family alone', () => {
    expect(packs.roleForFileName('Hy-MT2-7B-Q4_K_M.gguf')).toBe(packs.LLM_ROLE_MT);
    expect(packs.roleForFileName('hunyuan-mt-1.8b.gguf')).toBe(packs.LLM_ROLE_MT);
    expect(packs.roleForFileName('Qwen3.8-27B-Uncensored-YMQ-M-TI.gguf')).toBe(packs.LLM_ROLE_GENERAL);
    expect(packs.roleForFileName('gemma-3-mt-tuned.gguf')).toBe(packs.LLM_ROLE_GENERAL);
    expect(packs.roleForFileName('')).toBe(packs.LLM_ROLE_GENERAL);
  });

  it('keeps the translation-only model out of the general role', () => {
    const mt = packs.packsForRole(packs.LLM_ROLE_MT);
    expect(mt.map((p) => p.id)).toEqual(['hy-mt2-1.8b']);
    expect(packs.packsForRole(packs.LLM_ROLE_GENERAL).every((p) => p.id !== 'hy-mt2-1.8b')).toBe(true);
  });

  it('pins the vision pack as two files, each with its own size, hash and link', () => {
    const v = packs.visionPack();
    expect(v.id).toBe('paddleocr-vl-1.6');
    expect(v.role).toBe(packs.LLM_ROLE_VISION);
    expect(v.default).toBe(false);
    expect(v.visionFamily).toBe('paddleocr');
    expect(v.mmproj.file).toMatch(/mmproj.*\.gguf$/);
    expect(v.mmproj.size).toBeGreaterThan(0);
    expect(v.mmproj.sha256).toMatch(HEX64);
    expect(v.mmproj.sha256).not.toBe(v.sha256);
    expect(v.source.mmproj.url.endsWith(`/${v.mmproj.file}`)).toBe(true);
    expect(v.source.mmproj.mirror).toMatch(/^https:\/\/.+\.gguf$/);
    expect(packs.packFiles(v).map((f) => f.part)).toEqual(['model', 'mmproj']);
    expect(packs.packFiles(packs.defaultPack()).map((f) => f.part)).toEqual(['model']);
  });

  it('recognises the mmproj by name and size but never the model by the mmproj hash', () => {
    const v = packs.visionPack();
    expect(packs.packForFile(v.mmproj.file, v.mmproj.size)).toBe(v);
    expect(packs.packForFile(v.mmproj.file, v.mmproj.size + 1)).toBeNull();
    expect(packs.packByHash(v.mmproj.sha256)).toBeNull();
    expect(packs.packsForRole(packs.LLM_ROLE_GENERAL).every((p) => p.id !== v.id)).toBe(true);
  });

  it('pins both speech packs as model + audio mmproj with the Qwen3-ASR prompt family', () => {
    const speech = packs.packsForRole(packs.LLM_ROLE_ASR);
    expect(speech.map((p) => p.id)).toEqual(['qwen3-asr-1.7b', 'qwen3-asr-0.6b']);
    expect(speech[0].size).toBeGreaterThan(speech[1].size);
    for (const p of speech) {
      expect(p.default).toBe(false);
      expect(p.audioFamily).toBe('qwen3-asr');
      expect(packs.packFiles(p).map((f) => f.part)).toEqual(['model', 'mmproj']);
      expect(p.mmproj.sha256).toMatch(HEX64);
      expect(p.mmproj.sha256).not.toBe(p.sha256);
      expect(p.source.url).toMatch(/^https:\/\/huggingface\.co\/ggml-org\//);
      expect(p.source.mmproj.url.endsWith(`/${p.mmproj.file}`)).toBe(true);
      expect(p.source.mmproj.mirror).toMatch(/^https:\/\/hf-mirror\.com\/.+\.gguf$/);
      expect(packs.packForFile(p.mmproj.file, p.mmproj.size)).toBe(p);
    }
  });

  it('only the general and translation-only roles can drive the translation provider', () => {
    expect(packs.LLM_TEXT_ROLES).toEqual([packs.LLM_ROLE_GENERAL, packs.LLM_ROLE_MT]);
    expect(packs.LLM_TEXT_ROLES).not.toContain(packs.LLM_ROLE_VISION);
    expect(packs.LLM_TEXT_ROLES).not.toContain(packs.LLM_ROLE_ASR);
  });
});
