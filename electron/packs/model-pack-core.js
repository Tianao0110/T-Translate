// Generic model-pack manager factory: download / verify / install / remove
// packs under a domain-owned root, driven by a manifest.json hosted as a
// release asset. Shared by the OCR, listen and voice pack managers; design
// notes in docs/design/model-packs.md.
//
// No electron import here: `fetch` is injected by each domain shell.
//
// createPackManager({
//   manifestUrl,       resolved URL (env override happens in the shell)
//   packsRoot,         () => absolute install root (where downloads land)
//   resolvePackDir,    optional (packId) => installed dir | null — lets a
//                      domain find packs outside packsRoot() (legacy roots)
//                      so removal works there too; defaults to packsRoot/id
//   allowedRoots,      optional () => string[] — every root a pack may live
//                      under; removePack refuses anything outside them
//   listInstalled,     () => installed packs (merged into the UI list)
//   evictSessions,     (packId) => void | Promise — release live file handles
//                      before the swap (awaited)
//   computePackList,   (installed, manifest) => UI-ready pack list
//   packJsonFields,    (entry) => fields persisted to pack.json (+installedAt)
//   packFilter,        optional (entry) => boolean — manifest entries this
//                      domain may install; others answer PACK_UNKNOWN
//   basePackId,        optional — its removal falls back to the bundled copy
//   supportedSchema,   manifest schema ceiling (default 1)
//   offlineGate,       () => boolean — true refuses every network access with
//                      OFFLINE_BLOCKED (injected; this file is electron-free)
//   logLabel,          logger channel name
//   deps: { fetch, fs, logger }   injection points for tests
// })

const path = require('path');
const nodeFs = require('fs');
const crypto = require('crypto');

// A pack id becomes a directory name (and removal is a recursive delete):
// ids from the renderer and from the manifest both pass this check.
const SAFE_PACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafePackId(packId) {
  if (typeof packId !== 'string' || !SAFE_PACK_ID.test(packId) || packId.includes('..')) {
    const err = new Error(`invalid pack id: ${packId}`);
    err.code = 'INVALID_PACK_ID';
    throw err;
  }
  return packId;
}

// "1.2.10" vs "1.3.0" — numeric per-segment compare, missing segments = 0.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function createPackManager({
  manifestUrl,
  packsRoot,
  resolvePackDir = null,
  allowedRoots = null,
  listInstalled,
  evictSessions,
  computePackList,
  packJsonFields,
  packFilter = null,
  basePackId = null,
  supportedSchema = 1,
  offlineGate = () => false,
  logLabel = 'ModelPacks',
  deps = {},
}) {
  const fetchImpl = deps.fetch;
  const fs = deps.fs || nodeFs;
  // Lazy: unit tests inject deps.logger instead.
  const logger = deps.logger || require('../platform/logger')(logLabel);
  if (typeof fetchImpl !== 'function') {
    throw new Error('createPackManager requires deps.fetch (inject net.fetch)');
  }

  let _manifestCache = null;

  // Every network read in this file goes through here; file:// is a local
  // read and is not gated.
  function assertOnlineAllowed(url) {
    if (url.startsWith('file://')) return;
    if (!offlineGate()) return;
    const err = new Error('offline-mode');
    err.code = 'OFFLINE_BLOCKED';
    throw err;
  }

  async function readUrl(url) {
    assertOnlineAllowed(url);
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

  // Zip-slip guard: entries keep their relative path (voice packs carry
  // directory trees) but must resolve inside destDir.
  function safeEntryPath(destDir, name) {
    const segments = String(name).split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
    const unsafe =
      segments.length === 0 ||
      segments.includes('..') ||
      path.isAbsolute(name) ||
      /^[A-Za-z]:/.test(name);
    const base = path.resolve(destDir);
    const target = unsafe ? null : path.resolve(base, ...segments);
    const rel = target ? path.relative(base, target) : '..';
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      const err = new Error(`unsafe zip entry: ${name}`);
      err.code = 'ZIP_UNSAFE_ENTRY';
      throw err;
    }
    return target;
  }

  async function extractZipTo(zipBuffer, destDir) {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(zipBuffer);
    fs.mkdirSync(destDir, { recursive: true });
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const target = safeEntryPath(destDir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await entry.async('nodebuffer'));
    }
  }

  /**
   * Download + install (or update) a pack. onProgress(percent, phase) with
   * phase in 'downloading' | 'verifying' | 'extracting' | 'done'.
   */
  async function downloadPack(packId, onProgress = () => {}) {
    assertSafePackId(packId);
    const manifest = await fetchManifest(false);
    const entry = (manifest.packs || []).find((p) => p.id === packId);
    // packFilter keeps a domain to its own pack types (one manifest is
    // shared by the ASR and TTS managers).
    if (!entry || (packFilter && !packFilter(entry))) {
      const err = new Error(`pack not in manifest: ${packId}`);
      err.code = 'PACK_UNKNOWN';
      throw err;
    }

    const url = entry.url || `${manifest.baseUrl}/${entry.file}`;
    // Gated again for the download itself (the manifest may be cached).
    assertOnlineAllowed(url);
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
      await evictSessions(packId);
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

  // The delete below is recursive and forced: the directory must sit under a
  // root this domain owns, never the root itself.
  function assertInsideAllowedRoot(dir) {
    const roots = (allowedRoots ? allowedRoots() : [packsRoot()]).filter(Boolean);
    const target = path.resolve(dir);
    const contained = roots.some((root) => {
      const rel = path.relative(path.resolve(root), target);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    if (!contained) {
      logger.error(`Refusing to remove a pack dir outside the packs roots: ${target}`);
      const err = new Error('pack dir outside the packs roots');
      err.code = 'PACK_DIR_OUTSIDE_ROOT';
      throw err;
    }
  }

  // Removes the pack folder entirely; the bundled base copy is not a target.
  async function removePack(packId) {
    assertSafePackId(packId);
    // resolvePackDir lets the domain point at a pack outside the current root.
    const dir = (resolvePackDir && resolvePackDir(packId)) || path.join(packsRoot(), packId);
    assertInsideAllowedRoot(dir);

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

    await evictSessions(packId);
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

module.exports = { createPackManager, compareVersions };
