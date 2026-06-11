// OCR model pack manager: download / verify / install / remove packs under
// userData/ocr-models. What's available comes from a manifest.json hosted as
// a GitHub release asset — the app hardcodes only the manifest URL, so new
// packs and model updates ship by editing the release, not the app.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { net } = require('electron');
const { BASE_PACK_ID, computePackList } = require('../shared/ocr-packs');
const ocrEngine = require('./ocr-engine');
const logger = require('./logger')('OCR-Packs');

// env override makes local testing possible (file:// or http://localhost)
const MANIFEST_URL =
  process.env.TT_OCR_MANIFEST_URL ||
  'https://github.com/Tianao0110/T-Translate/releases/download/ocr-models/manifest.json';

// Bump only when the manifest format changes incompatibly. Older apps refuse
// newer schemas instead of misreading them.
const SUPPORTED_SCHEMA = 1;

let _manifestCache = null;

async function readUrl(url) {
  if (url.startsWith('file://')) {
    return fs.promises.readFile(new URL(url));
  }
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.code = 'HTTP_' + res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function fetchManifest(force = false) {
  if (!force && _manifestCache) return _manifestCache;

  const raw = await readUrl(MANIFEST_URL);
  const manifest = JSON.parse(raw.toString('utf8'));

  if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > SUPPORTED_SCHEMA) {
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
  const installed = ocrEngine.listInstalledPacks();

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
    const res = await net.fetch(url, { cache: 'no-store' });
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
  const root = ocrEngine.packsRoot();
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
          id: entry.id,
          version: entry.version,
          gen: entry.gen,
          type: entry.type,
          languages: entry.languages,
          files: entry.files,
          size: entry.size,
          installedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // Swap into place: evict the live session first so no file handles linger
    ocrEngine.evictSessions(packId);
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
// userData copy can go — the bundled copy under resources/ is part of the app
// and removal just falls back to it.
async function removePack(packId) {
  const dir = path.join(ocrEngine.packsRoot(), packId);

  if (!fs.existsSync(dir)) {
    if (packId === BASE_PACK_ID) {
      const err = new Error('bundled base pack cannot be removed');
      err.code = 'BUILTIN_PACK';
      throw err;
    }
    const err = new Error(`pack not installed: ${packId}`);
    err.code = 'PACK_NOT_INSTALLED';
    throw err;
  }

  ocrEngine.evictSessions(packId);
  fs.rmSync(dir, { recursive: true, force: true });
  logger.info(`Pack ${packId} removed`);
  return { success: true, packId };
}

module.exports = {
  MANIFEST_URL,
  fetchManifest,
  listPacks,
  downloadPack,
  removePack,
};
