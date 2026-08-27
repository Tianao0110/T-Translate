// model-pack-core: the download/verify/install machinery every pack domain
// (OCR today, ASR/TTS in v0.4.x) rides on. Real fs in a temp root, injected
// fetch/logger — no electron, no network.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
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

function makeManager({ manifest, files = {}, hooks = {} } = {}) {
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

  it('zip-slip paths are flattened to basenames inside the pack dir', async () => {
    const zipBuf = await makeZip({
      'model.bin': 'DATA',
      '../../evil.txt': 'ESCAPED',
      'nested/dir/inner.bin': 'INNER',
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
    const names = fs.readdirSync(packDir).sort();
    expect(names).toEqual(['evil.txt', 'inner.bin', 'model.bin', 'pack.json']);
    // nothing escaped the packs root
    expect(fs.existsSync(path.join(root, '..', 'evil.txt'))).toBe(false);
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
});
