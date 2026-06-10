// Local OCR engine: esearch-ocr (PaddleOCR ONNX) on onnxruntime-node.
// Single owner of model-pack resolution, session cache, and result
// normalization for both IPC handlers and main-process callers.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const PATHS = require('../shared/paths');
const { BASE_PACK_ID, packIdForLanguage } = require('../shared/ocr-packs');
const logger = require('./logger')('OCR-Engine');

// Heavy natives (onnxruntime dll, skia) load lazily on first recognition,
// not at app startup.
let _env = null;

// packId -> Promise<ocr instance>. Promise (not instance) so concurrent
// callers share one in-flight init instead of double-loading models.
const _sessions = new Map();
const MAX_SESSIONS = 2;

function ensureEnv() {
  if (_env) return _env;
  const esearch = require('esearch-ocr');
  const ort = require('onnxruntime-node');
  const canvasKit = require('@napi-rs/canvas');
  esearch.setOCREnv({
    canvas: (w, h) => canvasKit.createCanvas(w, h),
    imageData: (data, w, h) => new canvasKit.ImageData(data, w, h),
  });
  _env = { esearch, ort, canvasKit };
  return _env;
}

function packsRoot() {
  return path.join(app.getPath('userData'), 'ocr-models');
}

function bundledBaseDir() {
  return path.join(PATHS.resources.ocrData, 'base');
}

// Downloaded copy in userData wins over the bundled one (that's how base
// model updates/repairs land without touching Program Files).
function resolvePackDir(packId) {
  const userDir = path.join(packsRoot(), packId);
  if (fs.existsSync(path.join(userDir, 'pack.json'))) return userDir;
  if (packId === BASE_PACK_ID) {
    const bundled = bundledBaseDir();
    if (fs.existsSync(path.join(bundled, 'pack.json'))) return bundled;
  }
  return null;
}

function readPackMeta(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
}

function isPackInstalled(packId) {
  return resolvePackDir(packId) !== null;
}

// Scan userData packs (+ bundled base) for the settings UI.
function listInstalledPacks() {
  const packs = new Map();

  const bundled = bundledBaseDir();
  if (fs.existsSync(path.join(bundled, 'pack.json'))) {
    try {
      packs.set(BASE_PACK_ID, { ...readPackMeta(bundled), builtin: true });
    } catch (e) {
      logger.warn('Bundled base pack.json unreadable:', e.message);
    }
  }

  const root = packsRoot();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const meta = readPackMeta(path.join(root, entry.name));
        packs.set(meta.id, { ...meta, builtin: false });
      } catch (e) {
        // Half-installed/corrupt folder — surface nothing, installer cleans on retry
        logger.warn(`Skipping unreadable pack dir ${entry.name}:`, e.message);
      }
    }
  }

  return [...packs.values()];
}

async function createSession(packId) {
  const { esearch, ort } = ensureEnv();

  const baseDir = resolvePackDir(BASE_PACK_ID);
  if (!baseDir) {
    const err = new Error('base models missing');
    err.code = 'BASE_MODELS_MISSING';
    throw err;
  }
  const base = readPackMeta(baseDir);

  let recDir = baseDir;
  let recMeta = base;
  if (packId !== BASE_PACK_ID) {
    const dir = resolvePackDir(packId);
    if (!dir) {
      const err = new Error(`pack not installed: ${packId}`);
      err.code = 'PACK_NOT_INSTALLED';
      throw err;
    }
    recDir = dir;
    recMeta = readPackMeta(dir);
  }

  const detPath = path.join(baseDir, base.files.det);
  const recPath = path.join(recDir, recMeta.files.rec);
  const dict = fs.readFileSync(path.join(recDir, recMeta.files.dict), 'utf8');

  logger.info(`Loading OCR session: pack=${packId} gen=${recMeta.gen}`);

  return esearch.init({
    det: { input: detPath },
    rec: {
      input: recPath,
      decodeDic: dict,
      // v5 recognizes spaces natively; the lib's space heuristic is for v3/v4
      // and over-inserts on v5 output.
      optimize: { space: recMeta.gen !== 'v5' },
    },
    ort,
  });
}

async function getSession(packId) {
  if (_sessions.has(packId)) {
    // LRU bump: re-insert as newest
    const p = _sessions.get(packId);
    _sessions.delete(packId);
    _sessions.set(packId, p);
    return p;
  }

  while (_sessions.size >= MAX_SESSIONS) {
    const oldest = _sessions.keys().next().value;
    _sessions.delete(oldest);
    logger.info(`Evicted OCR session: ${oldest}`);
  }

  const promise = createSession(packId).catch((e) => {
    _sessions.delete(packId); // failed init must not poison the cache
    throw e;
  });
  _sessions.set(packId, promise);
  return promise;
}

// Pack manager calls this after uninstall/update so the next recognition
// reloads from disk.
function evictSessions(packId) {
  if (packId) {
    _sessions.delete(packId);
  } else {
    _sessions.clear();
  }
}

function stripDataUrl(s) {
  return s.startsWith('data:image') ? s.split(',')[1] : s;
}

async function decodeToImageData(imageInput) {
  const { canvasKit } = ensureEnv();
  const buf = Buffer.isBuffer(imageInput)
    ? imageInput
    : Buffer.from(stripDataUrl(String(imageInput)), 'base64');
  const img = await canvasKit.loadImage(buf);
  const canvas = canvasKit.createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

// esearch box: [↖,↗,↘,↙] points -> axis-aligned rect
function boxToBBox(box) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const xs = box.map((p) => p[0] || 0);
  const ys = box.map((p) => p[1] || 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function toBlocks(lines) {
  return (lines || [])
    .filter((l) => l.text && l.text.trim())
    .map((l, index) => ({
      text: l.text,
      confidence: typeof l.mean === 'number' ? l.mean : 0.9,
      bbox: boxToBBox(l.box),
      index,
    }));
}

/**
 * Recognize text in an image.
 *
 * @param {string|Buffer} imageInput - dataURL / base64 string / raw Buffer
 * @param {Object} options
 * @param {string} options.language - OCR language (settings value, e.g. 'zh-Hans', 'ko', 'auto')
 * @returns {Promise<{success, text?, blocks?, rawBlocks?, confidence?, engine, pack?, packFallback?, error?, errorCode?}>}
 */
async function recognize(imageInput, options = {}) {
  const language = options.language || 'auto';

  let packId = packIdForLanguage(language);
  let packFallback = false;
  if (packId !== BASE_PACK_ID && !isPackInstalled(packId)) {
    // Requested language's pack isn't installed — recognize with the base
    // model rather than failing; caller surfaces the hint.
    packFallback = true;
    packId = BASE_PACK_ID;
  }

  try {
    const session = await getSession(packId);
    const imageData = await decodeToImageData(imageInput);
    const out = await session.ocr(imageData);

    // Per-paragraph (layout-aware merge by the lib) and per-line variants.
    const blocks = toBlocks(out.parragraphs);
    const rawBlocks = toBlocks(out.src);
    const text = blocks.map((b) => b.text).join('\n').trim();
    const confidence = blocks.length
      ? blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length
      : 0;

    return {
      success: true,
      text,
      blocks,
      rawBlocks,
      confidence,
      engine: 'rapid-ocr',
      pack: packId,
      ...(packFallback && { packFallback: true, requestedLanguage: language }),
    };
  } catch (error) {
    logger.error(`Recognition failed (pack=${packId}):`, error.message);
    return {
      success: false,
      error: error.message,
      errorCode: error.code || 'OCR_FAILED',
      engine: 'rapid-ocr',
    };
  }
}

// Health probe: model files resolvable + sessions load (catches corrupt onnx
// and broken native bindings without running a full recognition).
async function healthCheck() {
  if (!resolvePackDir(BASE_PACK_ID)) {
    return { healthy: false, error: 'BASE_MODELS_MISSING' };
  }
  try {
    await getSession(BASE_PACK_ID);
    return { healthy: true };
  } catch (e) {
    return { healthy: false, error: e.code || 'LOAD_FAILED', detail: e.message };
  }
}

module.exports = {
  recognize,
  healthCheck,
  evictSessions,
  isPackInstalled,
  listInstalledPacks,
  resolvePackDir,
  packsRoot,
  bundledBaseDir,
};
