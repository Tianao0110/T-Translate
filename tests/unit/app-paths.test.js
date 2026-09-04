// app-paths with a fake app on temp directories: a packaged build with a
// writable install dir relocates userData and carries the old files over
// once; everything else stays in place and only tidies Chromium's folders
// into browser\.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const appPaths = require('../../electron/utils/app-paths.js');
const { applyAppPaths, resolveAppPaths, legacyUserData, isRelocated } = appPaths;

let base;
let legacy;

const fakeApp = (packaged) => {
  const paths = { userData: legacy, exe: path.join(base, 'install', 'T-Translate.exe') };
  return {
    isPackaged: packaged,
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      paths[name] = value;
    },
    paths,
  };
};

const write = (file, content = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-app-paths-'));
  legacy = path.join(base, 'appdata', 't-translate');
  fs.mkdirSync(path.join(base, 'install'), { recursive: true });
  fs.mkdirSync(legacy, { recursive: true });
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('resolveAppPaths', () => {
  it('keeps userData where it is when not packaged', () => {
    const p = resolveAppPaths(fakeApp(false));
    expect(p.userData).toBe(legacy);
    expect(p.browser).toBe(path.join(legacy, 'browser'));
    expect(p.relocated).toBe(false);
  });

  it('moves into <install>/data when packaged and writable', () => {
    const p = resolveAppPaths(fakeApp(true));
    expect(p.userData).toBe(path.join(base, 'install', 'data'));
    expect(p.legacyUserData).toBe(legacy);
    expect(p.relocated).toBe(true);
  });

  it('stays put when the install dir cannot be written', () => {
    const p = resolveAppPaths(fakeApp(true), { writable: () => false });
    expect(p.userData).toBe(legacy);
    expect(p.relocated).toBe(false);
  });

  it('honours the sandbox override even when packaged', () => {
    const sandbox = path.join(base, 'sandbox');
    const p = resolveAppPaths(fakeApp(true), { override: sandbox });
    expect(p.userData).toBe(sandbox);
    expect(p.legacyUserData).toBe(sandbox);
    expect(p.relocated).toBe(false);
  });
});

describe('applyAppPaths — relocated install', () => {
  it('sets the three paths and carries settings, vault, cache and localStorage over once', () => {
    write(path.join(legacy, 'config.json'), '{"a":1}');
    write(path.join(legacy, 'translation-data.enc'), 'vault');
    write(path.join(legacy, 'Caches', 'translation-cache.json'), '{"hits":1}');
    write(path.join(legacy, 'Local Storage', 'leveldb', '000001.log'), 'ls');
    write(path.join(legacy, 'Local State'), '{"os_crypt":{"encrypted_key":"k"}}');
    write(path.join(legacy, 'Session Storage', '000001.log'), 'ss');
    write(path.join(legacy, 'logs', 'app-2026-09-01.log'), 'log');

    const app = fakeApp(true);
    const p = applyAppPaths(app);
    const data = path.join(base, 'install', 'data');

    expect(app.paths.userData).toBe(data);
    expect(app.paths.sessionData).toBe(path.join(data, 'browser'));
    expect(app.paths.crashDumps).toBe(path.join(data, 'browser', 'Crashpad'));
    expect(p.relocated).toBe(true);
    expect(legacyUserData()).toBe(legacy);
    expect(isRelocated()).toBe(true);

    expect(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).toBe('{"a":1}');
    expect(fs.readFileSync(path.join(data, 'translation-data.enc'), 'utf8')).toBe('vault');
    expect(fs.readFileSync(path.join(data, 'cache', 'translation-cache.json'), 'utf8')).toBe('{"hits":1}');
    expect(fs.readFileSync(path.join(data, 'browser', 'Local Storage', 'leveldb', '000001.log'), 'utf8')).toBe('ls');
    // The safeStorage key lives here — without it the carried vault is unreadable.
    expect(fs.readFileSync(path.join(data, 'browser', 'Local State'), 'utf8')).toContain('encrypted_key');
    expect(fs.existsSync(path.join(data, 'browser', 'Session Storage'))).toBe(false);
    expect(fs.existsSync(path.join(data, 'logs'))).toBe(false);
    // The old folder is untouched — the user clears it from the About page.
    expect(fs.readFileSync(path.join(legacy, 'config.json'), 'utf8')).toBe('{"a":1}');
    expect(fs.existsSync(path.join(legacy, 'Local Storage'))).toBe(true);

    // Second launch: the new copy has moved on and must not be overwritten.
    fs.writeFileSync(path.join(data, 'config.json'), '{"a":2}');
    const again = applyAppPaths(fakeApp(true));
    expect(again.notes).toEqual([]);
    expect(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).toBe('{"a":2}');
  });

  it('copes with a fresh machine that has no old folder at all', () => {
    fs.rmSync(legacy, { recursive: true, force: true });
    const p = applyAppPaths(fakeApp(true));
    expect(p.relocated).toBe(true);
    expect(p.notes).toEqual([]);
  });
});

describe('applyAppPaths — in place', () => {
  it('tucks Chromium entries into browser/, lifts the v0.4.6 data/ folder and retires Caches/', () => {
    write(path.join(legacy, 'Cache', 'index'), 'c');
    write(path.join(legacy, 'Local Storage', 'leveldb', 'LOCK'), '');
    write(path.join(legacy, 'Local State'), '{}');
    write(path.join(legacy, 'config.json'), '{}');
    write(path.join(legacy, 'data', 'cache', 'translation-cache.json'), '{"hits":2}');
    write(path.join(legacy, 'data', 'logs', 'audio-probe-1.jsonl'), '{}');
    write(path.join(legacy, 'logs', 'app-2026-09-01.log'), 'log');
    write(path.join(legacy, 'Caches', 'translation-cache.json'), '{"hits":1}');

    const p = applyAppPaths(fakeApp(false));
    expect(p.relocated).toBe(false);
    expect(isRelocated()).toBe(false);

    expect(fs.existsSync(path.join(legacy, 'browser', 'Cache', 'index'))).toBe(true);
    expect(fs.existsSync(path.join(legacy, 'browser', 'Local Storage', 'leveldb', 'LOCK'))).toBe(true);
    expect(fs.existsSync(path.join(legacy, 'browser', 'Local State'))).toBe(true);
    // Not `legacy/Cache` itself: on a case-insensitive disk that now matches
    // our own cache/ folder — the very collision the browser/ split is for.
    expect(fs.existsSync(path.join(legacy, 'Cache', 'index'))).toBe(false);
    expect(fs.existsSync(path.join(legacy, 'Local Storage'))).toBe(false);
    expect(fs.existsSync(path.join(legacy, 'config.json'))).toBe(true);

    // v0.4.6 kept cache/logs one level down; they come back up, and the
    // newer nested cache wins over the pre-v0.4.6 Caches file.
    expect(fs.readFileSync(path.join(legacy, 'cache', 'translation-cache.json'), 'utf8')).toBe('{"hits":2}');
    expect(fs.existsSync(path.join(legacy, 'logs', 'audio-probe-1.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(legacy, 'logs', 'app-2026-09-01.log'))).toBe(true);
    expect(fs.existsSync(path.join(legacy, 'data'))).toBe(false);
    expect(fs.existsSync(path.join(legacy, 'Caches'))).toBe(true); // still holds the older file
    expect(fs.readFileSync(path.join(legacy, 'Caches', 'translation-cache.json'), 'utf8')).toBe('{"hits":1}');

    expect(applyAppPaths(fakeApp(false)).notes).toEqual([]);
  });

  it('moves the pre-v0.4.6 cache file when nothing newer exists', () => {
    write(path.join(legacy, 'Caches', 'translation-cache.json'), '{"hits":1}');
    applyAppPaths(fakeApp(false));
    expect(fs.readFileSync(path.join(legacy, 'cache', 'translation-cache.json'), 'utf8')).toBe('{"hits":1}');
    expect(fs.existsSync(path.join(legacy, 'Caches'))).toBe(false);
  });
});
