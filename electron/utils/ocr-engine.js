// Local OCR engine: esearch-ocr (PaddleOCR ONNX) on onnxruntime-node.
// Single owner of model-pack resolution, session cache, and result
// normalization for both IPC handlers and main-process callers.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const PATHS = require('../shared/paths');
const { BASE_PACK_ID, HQ_PACK_ID, packIdForLanguage } = require('../shared/ocr-packs');
const logger = require('./logger')('OCR-Engine');

// 'standard' = bundled small model; 'high' = downloaded medium variant.
// Seeded from settings at IPC registration, updated via SET_MODEL_TIER.
let _modelTier = 'standard';

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
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
  // Model files always live flat inside the pack dir; basename() keeps a
  // hand-edited or malformed pack.json from referencing paths outside it.
  for (const key of Object.keys(meta.files || {})) {
    meta.files[key] = path.basename(meta.files[key]);
  }
  return meta;
}

function isPackInstalled(packId) {
  return resolvePackDir(packId) !== null;
}

// High tier prefers the medium variant; silently falls back to the standard
// base if the hq pack was removed from disk while the setting still says high.
function resolveBaseDir() {
  if (_modelTier === 'high') {
    const hq = resolvePackDir(HQ_PACK_ID);
    if (hq) return hq;
  }
  return resolvePackDir(BASE_PACK_ID);
}

function setModelTier(tier) {
  const next = tier === 'high' ? 'high' : 'standard';
  if (next === _modelTier) return;
  _modelTier = next;
  // Base det/rec underlie every cached session — rebuild them all.
  _sessions.clear();
  logger.info(`Model tier set to ${next}`);
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

  const baseDir = resolveBaseDir();
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

  logger.info(`Loading OCR session: pack=${packId} gen=${recMeta.gen} base=${base.id}`);

  // No docCls here on purpose: tested 2026-07-04 and rejected — it fixes
  // upside-down photos but misclassifies short-line CJK screenshots as
  // vertical (Japanese garbled, Korean pack broken). See OCR_MODELS.md.
  return esearch.init({
    det: { input: detPath },
    rec: {
      input: recPath,
      decodeDic: dict,
      // The lib's space heuristic is for v3/v4 rec models; v5+ recognize
      // spaces natively and the heuristic over-inserts.
      optimize: { space: recMeta.gen === 'v3' || recMeta.gen === 'v4' },
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
// reloads from disk. Base packs supply the det model to every session, so
// changing either of them invalidates the whole cache, not just their own key.
function evictSessions(packId) {
  if (packId && packId !== BASE_PACK_ID && packId !== HQ_PACK_ID) {
    _sessions.delete(packId);
  } else {
    _sessions.clear();
  }
}

function stripDataUrl(s) {
  return s.startsWith('data:image') ? s.split(',')[1] : s;
}

// Small captures (selection strips, tiny screenshot regions) carry small
// glyphs that hurt recognition; upscaling before detection recovers them.
// Larger images skip it — cost outweighs gain.
const PREPROCESS_MAX_DIM = 1200;

async function decodeToImageData(imageInput, preprocess = {}) {
  const { canvasKit } = ensureEnv();
  const buf = Buffer.isBuffer(imageInput)
    ? imageInput
    : Buffer.from(stripDataUrl(String(imageInput)), 'base64');
  const img = await canvasKit.loadImage(buf);

  let scale = 1;
  if (
    preprocess.enabled &&
    preprocess.scale > 1 &&
    Math.max(img.width, img.height) < PREPROCESS_MAX_DIM
  ) {
    scale = preprocess.scale;
  }

  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = canvasKit.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (scale !== 1) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(img, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), scale };
}

// esearch box: [↖,↗,↘,↙] points -> axis-aligned rect. `scale` undoes
// preprocessing upscale so callers always see source-image pixel coords.
function boxToBBox(box, scale = 1) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const xs = box.map((p) => (p[0] || 0) / scale);
  const ys = box.map((p) => (p[1] || 0) / scale);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function toBlocks(lines, scale = 1) {
  return (lines || [])
    .filter((l) => l.text && l.text.trim())
    .map((l, index) => ({
      text: l.text,
      confidence: typeof l.mean === 'number' ? l.mean : 0.9,
      bbox: boxToBBox(l.box, scale),
      index,
    }));
}

/**
 * Recognize text in an image.
 *
 * @param {string|Buffer} imageInput - dataURL / base64 string / raw Buffer
 * @param {Object} options
 * @param {string} options.language - OCR language (settings value, e.g. 'zh-Hans', 'ko', 'auto')
 * @param {{enabled: boolean, scale: number}} [options.preprocess] - auto-enlarge small captures
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
    const { imageData, scale } = await decodeToImageData(imageInput, options.preprocess);
    const out = await session.ocr(imageData);

    // Per-paragraph (layout-aware merge by the lib) and per-line variants.
    const blocks = toBlocks(out.parragraphs, scale);
    const rawBlocks = toBlocks(out.src, scale);
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

// Health probe. The default (light) variant only verifies the model files
// resolve and are non-empty — cheap enough for the settings page to call on
// entry. deep additionally builds the ONNX session (catches corrupt models
// and broken native bindings) but costs ~0.5s of main-process stalls, so
// callers reserve it for explicit user action (re-check button, post-repair).
async function healthCheck({ deep = false } = {}) {
  const baseDir = resolveBaseDir();
  if (!baseDir) {
    return { healthy: false, error: 'BASE_MODELS_MISSING' };
  }
  try {
    // activeBase is the pack id, not the directory name (the bundled copy
    // lives in a dir just called 'base').
    const meta = readPackMeta(baseDir);
    for (const name of Object.values(meta.files || {})) {
      const st = fs.statSync(path.join(baseDir, name));
      if (!st.size) throw Object.assign(new Error(`${name} is empty`), { code: 'ENOENT' });
    }
    if (deep) await getSession(BASE_PACK_ID);
    return { healthy: true, activeBase: meta.id };
  } catch (e) {
    const error = e.code === 'ENOENT' ? 'BASE_MODELS_MISSING' : (e.code || 'LOAD_FAILED');
    return { healthy: false, error, detail: e.message };
  }
}

// Loads the heavy natives (~100ms of sync require, canvas being the bulk)
// off the interactive path. Called at idle shortly after startup when the
// local engine is selected; session build stays lazy — its cost lands during
// recognition where the user is already waiting on a spinner.
function prewarm() {
  try {
    ensureEnv();
    logger.info('OCR natives prewarmed');
  } catch (e) {
    logger.warn('Prewarm failed:', e.message);
  }
}

module.exports = {
  recognize,
  healthCheck,
  prewarm,
  evictSessions,
  setModelTier,
  isPackInstalled,
  listInstalledPacks,
  resolvePackDir,
  packsRoot,
  bundledBaseDir,
};
