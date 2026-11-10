// @vitest-environment node
// (esbuild refuses jsdom's Uint8Array.)
//
// The extension build into a temp dir: every file the manifest and pages
// point at exists, the version comes from the root package.json, content
// scripts are classic scripts in the right worlds; and the two locales carry
// every message key the code asks for.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, manifestVersion, ICON_SIZES } from '../scripts/build.mjs';
import { describeState, errorText } from '../src/shared/status-text.js';
import { CLIENT_STATUS } from '../src/shared/protocol.js';

const EXT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(EXT, '..', 'package.json'), 'utf8'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

let out;
let result;
beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'tcaption-build-'));
  result = await build({ outDir: path.join(out, 'dist'), logLevel: 'silent' });
}, 30000);
afterAll(() => {
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

describe('extension build', () => {
  it('writes the scripts, pages, styles, locales, icons and manifest', () => {
    const expected = [
      'sw.js', 'offscreen.js', 'options.js', 'popup.js', 'content-main.js', 'content-isolated.js',
      'offscreen.html', 'options.html', 'popup.html', 'options.css', 'popup.css',
      '_locales/zh_CN/messages.json', '_locales/en/messages.json', 'manifest.json',
      ...ICON_SIZES.map((s) => `icons/icon-${s}.png`),
    ];
    expect(result.files).toEqual(expect.arrayContaining(expected));
    expect(result.files).toHaveLength(expected.length);
  });

  it('stamps the app version and keeps the MV3 wiring', () => {
    const m = readJson(path.join(result.outDir, 'manifest.json'));
    expect(m.version).toBe(pkg.version);
    expect(m.manifest_version).toBe(3);
    expect(m.background).toEqual({ service_worker: 'sw.js', type: 'module' });
    const [main, isolated] = m.content_scripts;
    expect(main).toMatchObject({ js: ['content-main.js'], world: 'MAIN', run_at: 'document_start' });
    expect(isolated).toMatchObject({ js: ['content-isolated.js'], run_at: 'document_idle' });
    expect(isolated.world).toBeUndefined();
    const referenced = [
      m.background.service_worker, m.options_ui.page, m.action.default_popup,
      ...Object.values(m.icons), ...Object.values(m.action.default_icon), ...m.content_scripts.flatMap((c) => c.js),
    ];
    for (const f of referenced) expect(fs.existsSync(path.join(result.outDir, f)), f).toBe(true);
  });

  it('the offscreen bundle carries the version and needs nothing beyond runtime messaging', () => {
    const js = fs.readFileSync(path.join(result.outDir, 'offscreen.js'), 'utf8');
    expect(js).toContain(JSON.stringify(pkg.version));
    expect(js).not.toMatch(/getManifest|chrome\.storage|chrome\.i18n/);
  });

  it('content scripts are classic scripts; pages point at built files', () => {
    for (const f of ['content-main.js', 'content-isolated.js']) {
      expect(fs.readFileSync(path.join(result.outDir, f), 'utf8')).not.toMatch(/^\s*(import|export)\b/m);
    }
    for (const page of ['offscreen.html', 'options.html', 'popup.html']) {
      const html = fs.readFileSync(path.join(result.outDir, page), 'utf8');
      for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        expect(fs.existsSync(path.join(result.outDir, ref)), `${page} → ${ref}`).toBe(true);
      }
    }
  });

  it('a prerelease version moves to version_name', () => {
    expect(manifestVersion('0.6.0-beta.1')).toEqual({ version: '0.6.0', version_name: '0.6.0-beta.1' });
    expect(manifestVersion('0.5.7')).toEqual({ version: '0.5.7' });
  });
});

describe('locales', () => {
  const zh = readJson(path.join(EXT, '_locales/zh_CN/messages.json'));
  const en = readJson(path.join(EXT, '_locales/en/messages.json'));

  it('zh_CN and en have the same keys and placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const k of Object.keys(zh)) expect(Object.keys(en[k].placeholders || {}), k).toEqual(Object.keys(zh[k].placeholders || {}));
  });

  it('every key the manifest, pages and scripts use exists', () => {
    const used = new Set();
    const manifest = fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8');
    for (const [, k] of manifest.matchAll(/__MSG_(\w+)__/g)) used.add(k);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    for (const file of walk(path.join(EXT, 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, k] of text.matchAll(/data-i18n="(\w+)"/g)) used.add(k);
      for (const [, args] of text.matchAll(/\bt\(([^()]*)\)/g)) for (const [, k] of args.matchAll(/'(\w+)'/g)) used.add(k);
    }
    // Keys picked from tables in status-text.js.
    const strict = (k) => {
      used.add(k);
      return k;
    };
    for (const status of Object.values(CLIENT_STATUS)) {
      for (const privacyMode of ['standard', 'secure', 'offline']) describeState({ status, privacyMode, port: 1, appVersion: '1' }, strict);
    }
    for (const code of ['protocol-mismatch', 'pairing-failed', 'unreachable', 'hello-failed', 'unauthorized', 'other']) errorText(code, strict);

    expect(used.size).toBeGreaterThan(15);
    for (const k of used) expect(zh[k], k).toBeDefined();
  });
});
