// data-root under the electron stub: unpackaged, so everything falls back to
// userData — the dev behaviour — and carry-over copies exactly once.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// ESM imports so vitest's electron alias applies; createRequire would load
// the real electron package, whose require() export is a path string.
import { dataRoot, dataDir, carryOver } from '../../electron/utils/data-root.js';
import { storageState } from '../../electron/utils/model-root.js';

describe('data-root', () => {
  it('falls back to userData when not packaged', () => {
    expect(dataRoot()).toBe('/mock/path');
    expect(dataDir('logs')).toBe(path.join('/mock/path', 'logs'));
  });

  it('reports the model storage state without a fallback flag when unpackaged', () => {
    expect(storageState()).toMatchObject({ root: '/mock/path', legacyRoot: '/mock/path', fallback: false });
  });
});

describe('carryOver', () => {
  let base;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-carry-'));
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('copies the legacy file into a fresh target directory', () => {
    const legacy = path.join(base, 'Caches', 'translation-cache.json');
    const target = path.join(base, 'data', 'cache', 'translation-cache.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{"hits":1}');

    expect(carryOver(legacy, target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"hits":1}');
    // The source is left alone: nothing else is moved until the final switch.
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('never overwrites an existing target and copes with a missing source', () => {
    const legacy = path.join(base, 'old.json');
    const target = path.join(base, 'new.json');
    fs.writeFileSync(legacy, 'old');
    fs.writeFileSync(target, 'new');

    expect(carryOver(legacy, target)).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(carryOver(path.join(base, 'absent.json'), path.join(base, 'other.json'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'other.json'))).toBe(false);
  });
});
