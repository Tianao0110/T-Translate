// The model folder scanner against a real temp directory: a whitelisted
// name with the pinned bytes is ready, the same name with other bytes is a
// mismatch, anything else is unlisted and only reachable through the
// developer door; hashes are cached by size + mtime.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const { createLlmPackManager, CACHE_FILE } = require('../../electron/managers/llm-pack-manager.js');

const GOOD = Buffer.from('GGUF-tiny-model-bytes-0123456789');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const PACKS = [
  { id: 'tiny', role: 'general', default: true, name: 'Tiny', vendor: 'test', file: 'Tiny-Q8_0.gguf', size: GOOD.length, sha256: sha(GOOD), ctx: 512, template: 'qwen3', license: { name: 'Apache-2.0', url: 'https://x' }, source: { url: 'https://x/Tiny-Q8_0.gguf' }, minRamGb: 1 },
  { id: 'other', role: 'mt', default: false, name: 'Other', vendor: 'test', file: 'Other.gguf', size: 99, sha256: '0'.repeat(64), ctx: 512, template: 'hunyuan', license: { name: 'Apache-2.0', url: 'https://x' }, source: { url: 'https://x/Other.gguf' }, minRamGb: 1 },
];

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-llm-packs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const manager = (extra = {}) => createLlmPackManager({ dir, packs: PACKS, ...extra });

describe('llm pack manager', () => {
  it('creates the folder and reports every pack missing when it is empty', async () => {
    const folder = path.join(dir, 'llm-models');
    const m = createLlmPackManager({ dir: folder, packs: PACKS });
    const s = await m.scan();
    expect(fs.existsSync(folder)).toBe(true);
    expect(s.packs.map((p) => [p.id, p.status])).toEqual([['tiny', 'missing'], ['other', 'missing']]);
    expect(s.unlisted).toEqual([]);
    expect(m.resolveDefault()).toBeNull();
  });

  it('marks the pinned bytes ready and caches the hash', async () => {
    fs.writeFileSync(path.join(dir, 'Tiny-Q8_0.gguf'), GOOD);
    const m = manager();
    const s = await m.scan();
    expect(s.packs[0]).toMatchObject({ id: 'tiny', status: 'ready', path: path.join(dir, 'Tiny-Q8_0.gguf') });
    expect(m.resolveDefault()).toEqual({ pack: PACKS[0], path: path.join(dir, 'Tiny-Q8_0.gguf'), trial: false });
    expect(m.resolvePack('other')).toBeNull();
    const cache = JSON.parse(fs.readFileSync(path.join(dir, CACHE_FILE), 'utf8'));
    expect(cache['Tiny-Q8_0.gguf'].sha256).toBe(sha(GOOD));
  });

  it('refuses a whitelisted name whose bytes differ', async () => {
    const bad = Buffer.from(GOOD);
    bad[3] = 0x21;
    fs.writeFileSync(path.join(dir, 'Tiny-Q8_0.gguf'), bad);
    const m = manager();
    const s = await m.scan();
    expect(s.packs[0].status).toBe('mismatch');
    expect(m.resolveDefault()).toBeNull();
  });

  it('lists other files as unlisted and gates them behind the door', async () => {
    fs.writeFileSync(path.join(dir, 'Stranger-Q4.gguf'), Buffer.alloc(40, 1));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    let door = false;
    const m = manager({ allowUnlisted: () => door });
    fs.writeFileSync(path.join(dir, 'hy-mt2-7b.gguf'), Buffer.alloc(41, 2));
    const s = await m.scan();
    expect(s.unlisted.map((u) => [u.file, u.role]).sort()).toEqual([['Stranger-Q4.gguf', 'general'], ['hy-mt2-7b.gguf', 'mt']]);
    expect(s.allowUnlisted).toBe(false);
    expect(m.resolveUnlisted('Stranger-Q4.gguf')).toBeNull();
    door = true;
    expect(m.resolveUnlisted('Stranger-Q4.gguf')).toEqual({ pack: null, path: path.join(dir, 'Stranger-Q4.gguf'), trial: true });
    expect(m.resolveUnlisted('../Stranger-Q4.gguf')).toEqual({ pack: null, path: path.join(dir, 'Stranger-Q4.gguf'), trial: true });
    expect(m.resolveUnlisted('C:/elsewhere/x.gguf')).toBeNull();
  });

  it('a wrong size with the right name is unlisted, not hashed', async () => {
    fs.writeFileSync(path.join(dir, 'Tiny-Q8_0.gguf'), Buffer.concat([GOOD, Buffer.from('!')]));
    const m = manager();
    const s = await m.scan();
    expect(s.packs[0].status).toBe('missing');
    expect(s.unlisted[0].file).toBe('Tiny-Q8_0.gguf');
    expect(fs.existsSync(path.join(dir, CACHE_FILE))).toBe(false);
  });

  it('shares one in-flight scan', async () => {
    const m = manager();
    const a = m.scan();
    const b = m.scan();
    expect(a).toBe(b);
    expect(m.scanning()).toBe(true);
    await a;
    expect(m.scanning()).toBe(false);
  });
});
