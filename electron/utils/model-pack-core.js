// Generic model-pack manager factory: download / verify / install / remove
// packs under a domain-owned root, driven by a manifest.json hosted as a
// release asset. Extracted verbatim from the OCR pack manager so the audio
// engine (ASR/TTS packs, v0.4.x) reuses the same battle-tested machinery —
// the app hardcodes only manifest URLs, so new packs ship by editing releases.
//
// No electron import here: `fetch` is injected by each domain shell (the
// vitest CJS-electron externalization trap; secure-vault DI pattern).
//
// createPackManager({
//   manifestUrl,       resolved URL (env override happens in the shell)
//   packsRoot,         () => absolute install root
//   listInstalled,     () => installed packs (merged into the UI list)
//   evictSessions,     (packId) => void — release live file handles pre-swap
//   computePackList,   (installed, manifest) => UI-ready pack list
//   packJsonFields,    (entry) => fields persisted to pack.json (+installedAt)
//   basePackId,        optional — its removal falls back to the bundled copy
//   supportedSchema,   manifest schema ceiling (default 1)
//   logLabel,          logger channel name
//   deps: { fetch, fs, logger }   injection points for tests
// })

const path = require('path');
const nodeFs = require('fs');
const crypto = require('crypto');

function createPackManager({
  manifestUrl,
  packsRoot,
  listInstalled,
  evictSessions,
  computePackList,
  packJsonFields,
  basePackId = null,
  supportedSchema = 1,
  logLabel = 'ModelPacks',
  deps = {},
}) {
  const fetchImpl = deps.fetch;
  const fs = deps.fs || nodeFs;
  // Lazy: logger.js pulls in electron at module scope, which unit tests must
  // never reach — they inject deps.logger instead.
  const logger = deps.logger || require('./logger')(logLabel);
  if (typeof fetchImpl !== 'function') {
    throw new Error('createPackManager requires deps.fetch (inject net.fetch)');
  }

  let _manifestCache = null;

  async function readUrl(url) {
    if (url.startsWith('file://')) {
      return fs.promises.readFile(new URL(url));
    }
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.code = 'HTTP_' + res.status;
      throw err;
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async function fetchManifest(force = false) {
    if (!force && _manifestCache) return _manifestCache;

    const raw = await readUrl(manifestUrl);
    const manifest = JSON.parse(raw.toString('utf8'));

    // Older apps refuse newer schemas instead of misreading them.
    if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > supportedSchema) {
      const err = new Error(`unsupported manifest schema: ${manifest.schemaVersion}`);
      err.code = 'MANIFEST_TOO_NEW';
      throw err;
    }

    _manifestCache = manifest;
    return manifest;
  }

  // One UI-ready list: manifest entries merged with what's on disk.
  // Manifest unreachable -> still returns installed packs + manifestError.
  async function listPacks({ refresh = false } = {}) {
    const installed = listInstalled();

    let manifest = null;
    let manifestError = null;
    try {
      manifest = await fetchManifest(refresh);
    } catch (e) {
      logger.warn('Manifest fetch failed:', e.message);
      manifestError = e.code || e.message;
    }

    return {
      packs: computePackList(installed, manifest),
      manifestError,
      manifestUpdatedAt: manifest?.updatedAt || null,
    };
  }

  function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  async function extractZipTo(zipBuffer, destDir) {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(zipBuffer);
    fs.mkdirSync(destDir, { recursive: true });
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      // Flatten: pack folders are a single level, basename guards against
      // zip-slip paths from a tampered archive.
      const fileName = path.basename(name);
      fs.writeFileSync(path.join(destDir, fileName), await entry.async('nodebuffer'));
    }
  }

  /**
   * Download + install (or update) a pack. onProgress(percent, phase) with
   * phase in 'downloading' | 'verifying' | 'extracting' | 'done'.
   */
  async function downloadPack(packId, onProgress = () => {}) {
    const manifest = await fetchManifest(false);
    const entry = (manifest.packs || []).find((p) => p.id === packId);
    if (!entry) {
      const err = new Error(`pack not in manifest: ${packId}`);
      err.code = 'PACK_UNKNOWN';
      throw err;
    }

    const url = entry.url || `${manifest.baseUrl}/${entry.file}`;
    logger.info(`Downloading pack ${packId} from ${url}`);
    onProgress(0, 'downloading');

    // Download with streaming progress (GitHub redirects to a CDN; net.fetch follows).
    let buffer;
    if (url.startsWith('file://')) {
      buffer = await fs.promises.readFile(new URL(url));
      onProgress(80, 'downloading');
    } else {
      const res = await fetchImpl(url, { cache: 'no-store' });
      if (!res.ok) {
        const err = new Error(`download HTTP ${res.status}`);
        err.code = 'DOWNLOAD_FAILED';
        throw err;
      }
      const total = Number(res.headers.get('content-length')) || entry.size || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        received += value.length;
        if (total > 0) {
          onProgress(Math.min(80, Math.round((received / total) * 80)), 'downloading');
        }
      }
      buffer = Buffer.concat(chunks);
    }

    onProgress(85, 'verifying');
    if (entry.sha256 && sha256(buffer) !== entry.sha256.toLowerCase()) {
      const err = new Error(`checksum mismatch for ${packId}`);
      err.code = 'CHECKSUM_MISMATCH';
      throw err;
    }

    onProgress(90, 'extracting');
    const root = packsRoot();
    const finalDir = path.join(root, packId);
    const stagingDir = path.join(root, `.staging-${packId}`);
    fs.rmSync(stagingDir, { recursive: true, force: true });

    try {
      await extractZipTo(buffer, stagingDir);

      // pack.json mirrors the manifest entry so offline scans know what's installed
      fs.writeFileSync(
        path.join(stagingDir, 'pack.json'),
        JSON.stringify(
          {
            ...packJsonFields(entry),
            installedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      // Swap into place: evict the live session first so no file handles linger
      evictSessions(packId);
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(stagingDir, finalDir);
    } catch (e) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw e;
    }

    onProgress(100, 'done');
    logger.info(`Pack ${packId} installed at ${finalDir}`);
    return { success: true, packId, version: entry.version };
  }

  // Remove a pack folder entirely (no residue). For the base pack only the
  // userData copy can go — the bundled copy under resources/ is part of the
  // app and removal just falls back to it.
  async function removePack(packId) {
    const dir = path.join(packsRoot(), packId);

    if (!fs.existsSync(dir)) {
      if (basePackId !== null && packId === basePackId) {
        const err = new Error('bundled base pack cannot be removed');
        err.code = 'BUILTIN_PACK';
        throw err;
      }
      const err = new Error(`pack not installed: ${packId}`);
      err.code = 'PACK_NOT_INSTALLED';
      throw err;
    }

    evictSessions(packId);
    fs.rmSync(dir, { recursive: true, force: true });
    logger.info(`Pack ${packId} removed`);
    return { success: true, packId };
  }

  return {
    manifestUrl,
    fetchManifest,
    listPacks,
    downloadPack,
    removePack,
  };
}

module.exports = { createPackManager };
