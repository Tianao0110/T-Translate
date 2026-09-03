// model-pack-core: the download/verify/install machinery every pack domain
// (OCR today, ASR/TTS in v0.4.x) rides on. Real fs in a temp root, injected
// fetch/logger — no electron, no network.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import JSZip from 'jszip';
import { createPackManager } from '../../electron/utils/model-pack-core.js';

const MANIFEST_URL = 'https://packs.example/manifest.json';

let root;
const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function bufferResponse(buf) {
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(buf.length) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: new Uint8Array(buf) }),
      }),
    },
  };
}

async function makeZip(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

function makeManager({ manifest, files = {}, hooks = {}, offline = false } = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (url === MANIFEST_URL) return bufferResponse(Buffer.from(JSON.stringify(manifest)));
    if (files[url]) return bufferResponse(files[url]);
    return { ok: false, status: 404, headers: { get: () => null } };
  });
  const evict = hooks.evictSessions || vi.fn();
  const manager = createPackManager({
    manifestUrl: MANIFEST_URL,
    packsRoot: () => root,
    listInstalled: hooks.listInstalled || (() => []),
    evictSessions: evict,
    computePackList: (installed, m) => ({ installed, manifestPacks: m?.packs || null }),
    packJsonFields: (entry) => ({ id: entry.id, version: entry.version }),
    basePackId: 'base',
    offlineGate: () => offline,
    logLabel: 'Test-Packs',
    deps: { fetch: fetchMock, logger: silentLogger },
  });
  return { manager, fetchMock, evict };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-pack-core-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('model-pack-core', () => {
  it('refuses a manifest newer than the supported schema', async () => {
    const { manager } = makeManager({ manifest: { schemaVersion: 2, packs: [] } });
    await expect(manager.fetchManifest()).rejects.toMatchObject({ code: 'MANIFEST_TOO_NEW' });
  });

  it('refuses a manifest without a numeric schemaVersion', async () => {
    const { manager } = makeManager({ manifest: { packs: [] } });
    await expect(manager.fetchManifest()).rejects.toMatchObject({ code: 'MANIFEST_TOO_NEW' });
  });

  it('caches the manifest; refresh forces a refetch', async () => {
    const { manager, fetchMock } = makeManager({ manifest: { schemaVersion: 1, packs: [] } });
    await manager.fetchManifest();
    await manager.fetchManifest();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await manager.fetchManifest(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('checksum mismatch aborts the install and leaves no staging residue', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA' });
    const { manager } = makeManager({
      manifest: {
        schemaVersion: 1,
        packs: [{ id: 'pack-a', version: '1', url: 'https://packs.example/a.zip', sha256: 'f'.repeat(64) }],
      },
      files: { 'https://packs.example/a.zip': zipBuf },
    });
    await expect(manager.downloadPack('pack-a')).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('a failure after extraction rolls the staging dir back', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA' });
    const evictSessions = vi.fn(() => {
      throw new Error('handles busy');
    });
    const { manager } = makeManager({
      manifest: {
        schemaVersion: 1,
        packs: [{ id: 'pack-a', version: '1', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf) }],
      },
      files: { 'https://packs.example/a.zip': zipBuf },
      hooks: { evictSessions },
    });
    await expect(manager.downloadPack('pack-a')).rejects.toThrow('handles busy');
    expect(fs.readdirSync(root)).toEqual([]); // staging cleaned, nothing installed
  });

  // Voice packs ship whole directories (espeak-ng-data/, dict/) that sherpa
  // opens by path, so nested entries must land nested, not flattened.
  it('nested zip entries keep their relative path inside the pack dir', async () => {
    const zipBuf = await makeZip({
      'model.bin': 'DATA',
      'nested/dir/inner.bin': 'INNER',
      'dict/pos_dict/prob.utf8': 'P',
    });
    const { manager } = makeManager({
      manifest: {
        schemaVersion: 1,
        packs: [{ id: 'pack-a', version: '3', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf) }],
      },
      files: { 'https://packs.example/a.zip': zipBuf },
    });
    await manager.downloadPack('pack-a');

    const packDir = path.join(root, 'pack-a');
    expect(fs.readdirSync(packDir).sort()).toEqual(['dict', 'model.bin', 'nested', 'pack.json']);
    expect(fs.readFileSync(path.join(packDir, 'nested', 'dir', 'inner.bin'), 'utf8')).toBe('INNER');
    expect(fs.readFileSync(path.join(packDir, 'dict', 'pos_dict', 'prob.utf8'), 'utf8')).toBe('P');
  });

  // With paths preserved, the zip-slip guard is an explicit refusal: a
  // tampered archive aborts the install and leaves nothing behind. (JSZip
  // itself resolves '..' segments on load, so the names that reach the guard
  // raw are absolute and drive-relative ones.)
  it('an absolute zip entry aborts the install with no residue', async () => {
    for (const evil of ['/abs/evil.txt', 'C:/evil.txt']) {
      const zipBuf = await makeZip({ 'model.bin': 'DATA', [evil]: 'ESCAPED' });
      const { manager } = makeManager({
        manifest: {
          schemaVersion: 1,
          packs: [{ id: 'pack-a', version: '3', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf) }],
        },
        files: { 'https://packs.example/a.zip': zipBuf },
      });
      await expect(manager.downloadPack('pack-a')).rejects.toMatchObject({ code: 'ZIP_UNSAFE_ENTRY' });
      expect(fs.readdirSync(root)).toEqual([]);
    }
  });

  it('a traversing zip entry never lands outside the packs root', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA', '../../evil.txt': 'ESCAPED', 'a/../../evil2.txt': 'X' });
    const { manager } = makeManager({
      manifest: {
        schemaVersion: 1,
        packs: [{ id: 'pack-a', version: '3', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf) }],
      },
      files: { 'https://packs.example/a.zip': zipBuf },
    });
    await manager.downloadPack('pack-a').catch(() => {});
    expect(fs.existsSync(path.join(root, '..', 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(root, '..', 'evil2.txt'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'evil.txt'))).toBe(false);
  });

  it('packFilter turns a foreign-domain pack id into PACK_UNKNOWN before any download', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA' });
    const fetchMock = vi.fn(async (url) => {
      if (url === MANIFEST_URL) {
        return bufferResponse(Buffer.from(JSON.stringify({
          schemaVersion: 1,
          packs: [{ id: 'voice-a', type: 'tts-voice', version: '1', url: 'https://packs.example/v.zip', sha256: sha256(zipBuf) }],
        })));
      }
      return bufferResponse(zipBuf);
    });
    const manager = createPackManager({
      manifestUrl: MANIFEST_URL,
      packsRoot: () => root,
      listInstalled: () => [],
      evictSessions: vi.fn(),
      computePackList: (installed) => ({ installed }),
      packJsonFields: (entry) => ({ id: entry.id }),
      packFilter: (entry) => entry.type === 'asr-base',
      deps: { fetch: fetchMock, logger: silentLogger },
    });
    await expect(manager.downloadPack('voice-a')).rejects.toMatchObject({ code: 'PACK_UNKNOWN' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // manifest only
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('happy path: installs, writes pack.json, evicts sessions, reports phased progress', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA' });
    const { manager, evict } = makeManager({
      manifest: {
        schemaVersion: 1,
        packs: [{ id: 'pack-a', version: '2', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf).toUpperCase() }],
      },
      files: { 'https://packs.example/a.zip': zipBuf },
    });

    const progress = [];
    const result = await manager.downloadPack('pack-a', (pct, phase) => progress.push([pct, phase]));

    expect(result).toEqual({ success: true, packId: 'pack-a', version: '2' });
    const packJson = JSON.parse(fs.readFileSync(path.join(root, 'pack-a', 'pack.json'), 'utf8'));
    expect(packJson).toMatchObject({ id: 'pack-a', version: '2' });
    expect(typeof packJson.installedAt).toBe('string');
    expect(fs.readFileSync(path.join(root, 'pack-a', 'model.bin'), 'utf8')).toBe('DATA');
    expect(evict).toHaveBeenCalledWith('pack-a');
    expect(progress[0]).toEqual([0, 'downloading']);
    expect(progress.at(-1)).toEqual([100, 'done']);
    expect(progress.some(([, ph]) => ph === 'verifying')).toBe(true);
    expect(fs.existsSync(path.join(root, '.staging-pack-a'))).toBe(false);
  });

  it('listPacks survives an unreachable manifest and still reports installed packs', async () => {
    const { manager } = makeManager({ manifest: { schemaVersion: 1, packs: [] } });
    const broken = createPackManager({
      manifestUrl: 'https://down.example/manifest.json',
      packsRoot: () => root,
      listInstalled: () => [{ id: 'pack-x' }],
      evictSessions: vi.fn(),
      computePackList: (installed, m) => ({ installed, manifestPacks: m?.packs || null }),
      packJsonFields: (e) => e,
      deps: { fetch: vi.fn(async () => ({ ok: false, status: 503 })), logger: silentLogger },
    });
    const result = await broken.listPacks();
    expect(result.manifestError).toBe('HTTP_503');
    expect(result.packs.installed).toEqual([{ id: 'pack-x' }]);
    // and the healthy instance keeps working independently
    const ok = await manager.listPacks();
    expect(ok.manifestError).toBe(null);
  });

  it('removePack: base pack absent maps to BUILTIN_PACK, others to PACK_NOT_INSTALLED', async () => {
    const { manager } = makeManager({ manifest: { schemaVersion: 1, packs: [] } });
    await expect(manager.removePack('base')).rejects.toMatchObject({ code: 'BUILTIN_PACK' });
    await expect(manager.removePack('ghost')).rejects.toMatchObject({ code: 'PACK_NOT_INSTALLED' });
  });

  // The audio engine runs in another process: stopping it returns long before
  // the process is gone, and swapping the folder under its open .onnx files
  // fails on Windows at the very end of a 150 MB download.
  it('waits for an async evictSessions before touching the pack dir', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA' });
    let evicted = false;
    let evictedAtSwap = null;
    const evictSessions = vi.fn(
      () => new Promise((resolve) => setTimeout(() => { evicted = true; resolve(); }, 20))
    );
    const { manager } = makeManager({
      manifest: {
        schemaVersion: 1,
        packs: [{ id: 'pack-a', version: '1', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf) }],
      },
      files: { 'https://packs.example/a.zip': zipBuf },
      hooks: { evictSessions },
    });

    const realRename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      evictedAtSwap ??= evicted;
      return realRename(...args);
    });

    await manager.downloadPack('pack-a');
    spy.mockRestore();

    expect(evictSessions).toHaveBeenCalledWith('pack-a');
    expect(evictedAtSwap).toBe(true);
  });

  it('removePack also waits for an async evictSessions', async () => {
    const dir = path.join(root, 'pack-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), '{"id":"pack-a"}');

    let evicted = false;
    let evictedAtDelete = null;
    const { manager } = makeManager({
      manifest: { schemaVersion: 1, packs: [] },
      hooks: {
        evictSessions: () =>
          new Promise((resolve) => setTimeout(() => { evicted = true; resolve(); }, 20)),
      },
    });

    const realRm = fs.rmSync;
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((...args) => {
      if (String(args[0]).endsWith('pack-a')) evictedAtDelete ??= evicted;
      return realRm(...args);
    });

    await manager.removePack('pack-a');
    spy.mockRestore();

    expect(evictedAtDelete).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  // Offline mode's one absolute promise is "never touches the network". The
  // gate lives in the core so it holds for every domain and both network
  // paths — the OCR side shipped without one until v0.4.1.
  it('offline mode refuses the manifest fetch without hitting the network', async () => {
    const { manager, fetchMock } = makeManager({ manifest: { schemaVersion: 1, packs: [] }, offline: true });
    await expect(manager.fetchManifest()).rejects.toMatchObject({ code: 'OFFLINE_BLOCKED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline mode still lists installed packs, reporting the refusal as manifestError', async () => {
    const { manager, fetchMock } = makeManager({
      manifest: { schemaVersion: 1, packs: [] },
      hooks: { listInstalled: () => [{ id: 'pack-a' }] },
      offline: true,
    });
    const res = await manager.listPacks();
    expect(res.manifestError).toBe('OFFLINE_BLOCKED');
    expect(res.packs.installed).toEqual([{ id: 'pack-a' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline mode refuses a download even when the manifest is already cached', async () => {
    const zipBuf = await makeZip({ 'model.bin': 'DATA' });
    let offline = false;
    const fetchMock = vi.fn(async (url) => {
      if (url === MANIFEST_URL) {
        return bufferResponse(Buffer.from(JSON.stringify({
          schemaVersion: 1,
          packs: [{ id: 'pack-a', version: '1', url: 'https://packs.example/a.zip', sha256: sha256(zipBuf) }],
        })));
      }
      return bufferResponse(zipBuf);
    });
    const manager = createPackManager({
      manifestUrl: MANIFEST_URL,
      packsRoot: () => root,
      listInstalled: () => [],
      evictSessions: vi.fn(),
      computePackList: (installed) => ({ installed }),
      packJsonFields: (entry) => ({ id: entry.id }),
      offlineGate: () => offline,
      logLabel: 'Test-Packs',
      deps: { fetch: fetchMock, logger: silentLogger },
    });

    await manager.fetchManifest(); // warm the cache while still online
    offline = true;
    await expect(manager.downloadPack('pack-a')).rejects.toMatchObject({ code: 'OFFLINE_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // manifest only, no pack body
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('offline mode does not block a file:// manifest (a local read is not the network)', async () => {
    const local = path.join(root, 'manifest.json');
    fs.writeFileSync(local, JSON.stringify({ schemaVersion: 1, packs: [{ id: 'pack-a' }] }));
    const manager = createPackManager({
      manifestUrl: pathToFileURL(local).href,
      packsRoot: () => root,
      listInstalled: () => [],
      evictSessions: vi.fn(),
      computePackList: (installed, m) => ({ installed, manifestPacks: m?.packs || null }),
      packJsonFields: (entry) => ({ id: entry.id }),
      offlineGate: () => true,
      logLabel: 'Test-Packs',
      deps: { fetch: vi.fn(), logger: silentLogger },
    });
    await expect(manager.fetchManifest()).resolves.toMatchObject({ schemaVersion: 1 });
  });

  // A pack id is the one caller-supplied value that becomes a filesystem path,
  // and removal is a recursive delete. Reachable from the renderer through
  // ocr:packs-remove / audio-engine:packs-remove.
  it('removePack refuses a traversing pack id instead of deleting outside the root', async () => {
    const victim = path.join(root, 'PRECIOUS');
    const packs = path.join(root, 'models', 'asr-models');
    fs.mkdirSync(packs, { recursive: true });
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, 'user-data.txt'), 'do not delete');

    const manager = createPackManager({
      manifestUrl: MANIFEST_URL,
      packsRoot: () => packs,
      resolvePackDir: () => null,
      listInstalled: () => [],
      evictSessions: vi.fn(),
      computePackList: () => [],
      packJsonFields: (e) => e,
      deps: { fetch: vi.fn(), logger: silentLogger },
    });

    for (const bad of ['../../PRECIOUS', '..', 'a/../../PRECIOUS', 'C:\Windows', 'sub/dir', '']) {
      await expect(manager.removePack(bad)).rejects.toMatchObject({ code: 'INVALID_PACK_ID' });
    }
    expect(fs.existsSync(path.join(victim, 'user-data.txt'))).toBe(true);
  });

  it('downloadPack refuses a traversing pack id before any network call', async () => {
    const { manager, fetchMock } = makeManager({ manifest: { schemaVersion: 1, packs: [] } });
    await expect(manager.downloadPack('../../evil')).rejects.toMatchObject({ code: 'INVALID_PACK_ID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removePack refuses a dir a domain resolved outside the allowed roots', async () => {
    const packs = path.join(root, 'packs');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(packs, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');

    const manager = createPackManager({
      manifestUrl: MANIFEST_URL,
      packsRoot: () => packs,
      resolvePackDir: () => outside, // a domain bug, not a caller trick
      allowedRoots: () => [packs],
      listInstalled: () => [],
      evictSessions: vi.fn(),
      computePackList: () => [],
      packJsonFields: (e) => e,
      deps: { fetch: vi.fn(), logger: silentLogger },
    });

    await expect(manager.removePack('pack-a')).rejects.toMatchObject({ code: 'PACK_DIR_OUTSIDE_ROOT' });
    expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true);
  });

  it('removePack still deletes a pack sitting in a secondary allowed root', async () => {
    const current = path.join(root, 'install', 'asr-models');
    const legacy = path.join(root, 'userData', 'asr-models');
    const pack = path.join(legacy, 'pack-a');
    fs.mkdirSync(current, { recursive: true });
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(path.join(pack, 'pack.json'), '{"id":"pack-a"}');

    const manager = createPackManager({
      manifestUrl: MANIFEST_URL,
      packsRoot: () => current,
      resolvePackDir: () => pack,
      allowedRoots: () => [current, legacy],
      listInstalled: () => [],
      evictSessions: vi.fn(),
      computePackList: () => [],
      packJsonFields: (e) => e,
      deps: { fetch: vi.fn(), logger: silentLogger },
    });

    await expect(manager.removePack('pack-a')).resolves.toMatchObject({ success: true });
    expect(fs.existsSync(pack)).toBe(false);
  });
});
