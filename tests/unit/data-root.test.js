// data-root with a fake app: dev runs fall back to userData, a packaged build
// gets a data folder beside the executable, and carry-over copies exactly once.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createDataRoot } = require('../../electron/utils/data-root.js');

const quiet = { info() {}, warn() {} };
const fakeApp = (base, packaged) => ({
  isPackaged: packaged,
  getPath: (name) => (name === 'exe' ? path.join(base, 'install', 'T-Translate.exe') : path.join(base, 'userData')),
});

let base;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-data-root-'));
  fs.mkdirSync(path.join(base, 'install'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('dataRoot', () => {
  it('falls back to userData when not packaged', () => {
    const { dataRoot, dataDir } = createDataRoot({ app: fakeApp(base, false), logger: quiet });
    expect(dataRoot()).toBe(path.join(base, 'userData'));
    expect(dataDir('logs')).toBe(path.join(base, 'userData', 'logs'));
  });

  it('uses a data folder beside the executable when packaged and writable', () => {
    const { dataRoot, dataDir } = createDataRoot({ app: fakeApp(base, true), logger: quiet });
    expect(dataRoot()).toBe(path.join(base, 'install', 'data'));
    expect(dataDir('cache')).toBe(path.join(base, 'install', 'data', 'cache'));
    expect(fs.existsSync(path.join(base, 'install', 'data'))).toBe(true);
  });
});

describe('carryOver', () => {
  it('copies the legacy file into a fresh target directory and leaves the source', () => {
    const { carryOver } = createDataRoot({ app: fakeApp(base, false), logger: quiet });
    const legacy = path.join(base, 'Caches', 'translation-cache.json');
    const target = path.join(base, 'data', 'cache', 'translation-cache.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{"hits":1}');

    expect(carryOver(legacy, target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"hits":1}');
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('never overwrites an existing target and copes with a missing source', () => {
    const { carryOver } = createDataRoot({ app: fakeApp(base, false), logger: quiet });
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
