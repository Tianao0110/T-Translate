// Local OCR engine facade: pack resolution (roots, pack.json, tier) in the
// main process; the PP-OCR runtime runs in the OCR host utilityProcess
// (services/ocr-host) through the T-Engine adapter. Design notes:
// docs/design/ocr.md.

const path = require('path');
const fs = require('fs');
const PATHS = require('../shared/paths');
const { modelDir, modelDirs } = require('../packs/model-root');
const { BASE_PACK_ID, HQ_PACK_ID, packIdForLanguage } = require('../shared/ocr-packs');
const tengine = require('../tengine');
const logger = require('../platform/logger')('OCR-Engine');

// 'standard' = bundled small model; 'high' = downloaded medium variant.
// Seeded from settings at IPC registration, updated via SET_MODEL_TIER.
let _modelTier = 'standard';

// The OCR engine adapter in T-Engine owns the host process; this side only
// resolves packs and model paths.
const host = () => tengine.get().get('ocr');

// Install target for new downloads (packs/model-root.js).
function packsRoot() {
  return modelDir('ocr-models');
}

// Every location packs may already sit in: the active root plus the old
// userData one.
function packsRoots() {
  return modelDirs('ocr-models');
}

function bundledBaseDir() {
  return path.join(PATHS.resources.ocrData, 'base');
}

// A downloaded copy wins over the bundled one.
function resolvePackDir(packId) {
  for (const root of packsRoots()) {
    const dir = path.join(root, packId);
    if (fs.existsSync(path.join(dir, 'pack.json'))) return dir;
  }
  if (packId === BASE_PACK_ID) {
    const bundled = bundledBaseDir();
    if (fs.existsSync(path.join(bundled, 'pack.json'))) return bundled;
  }
  return null;
}

function readPackMeta(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
  // Model files live flat inside the pack dir; basename() keeps pack.json
  // from referencing paths outside it.
  for (const key of Object.keys(meta.files || {})) {
    meta.files[key] = path.basename(meta.files[key]);
  }
  return meta;
}

function isPackInstalled(packId) {
  return resolvePackDir(packId) !== null;
}

// High tier prefers the medium variant, falling back to the standard base.
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
  host().evict();
  logger.info(`Model tier set to ${next}`);
}

// Scan every pack root (+ bundled base) for the settings UI.
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

  // Reverse order: the active root is scanned last so it overwrites a stale
  // copy of the same pack id left behind in the old location.
  for (const root of packsRoots().reverse()) {
    if (!fs.existsSync(root)) continue;
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

// The model files a session for `packId` needs, under the current tier.
function resolveModels(packId) {
  const baseDir = resolveBaseDir();
  if (!baseDir) {
    throw Object.assign(new Error('base models missing'), { code: 'BASE_MODELS_MISSING' });
  }
  const base = readPackMeta(baseDir);
  let recDir = baseDir;
  let recMeta = base;
  if (packId !== BASE_PACK_ID) {
    const dir = resolvePackDir(packId);
    if (!dir) {
      throw Object.assign(new Error(`pack not installed: ${packId}`), { code: 'PACK_NOT_INSTALLED' });
    }
    recDir = dir;
    recMeta = readPackMeta(dir);
  }
  return {
    det: path.join(baseDir, base.files.det),
    rec: path.join(recDir, recMeta.files.rec),
    dict: path.join(recDir, recMeta.files.dict),
    gen: recMeta.gen,
    baseId: base.id,
  };
}

// Pack manager calls this after uninstall / update. A base pack change drops
// every session (det comes from it), a language pack only its own.
function evictSessions(packId) {
  if (packId && packId !== BASE_PACK_ID && packId !== HQ_PACK_ID) host().evict(packId);
  else host().evict();
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
    // Requested language's pack isn't installed: recognize with the base
    // model; the caller surfaces the hint.
    packFallback = true;
    packId = BASE_PACK_ID;
  }

  try {
    const models = resolveModels(packId);
    const out = await host().recognize({
      packId,
      models,
      image: Buffer.isBuffer(imageInput) ? imageInput : String(imageInput),
      preprocess: options.preprocess || {},
    });
    return {
      success: true,
      ...out,
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

// Health probe. Light (default): the model files resolve and are non-empty.
// deep: also builds the session in the host; for explicit user action.
async function healthCheck({ deep = false } = {}) {
  const baseDir = resolveBaseDir();
  if (!baseDir) {
    return { healthy: false, error: 'BASE_MODELS_MISSING' };
  }
  try {
    // activeBase is the pack id, not the directory name.
    const meta = readPackMeta(baseDir);
    for (const name of Object.values(meta.files || {})) {
      const st = fs.statSync(path.join(baseDir, name));
      if (!st.size) throw Object.assign(new Error(`${name} is empty`), { code: 'ENOENT' });
    }
    if (deep) await host().health({ packId: BASE_PACK_ID, models: resolveModels(BASE_PACK_ID) });
    return { healthy: true, activeBase: meta.id };
  } catch (e) {
    const error = e.code === 'ENOENT' ? 'BASE_MODELS_MISSING' : (e.code || 'LOAD_FAILED');
    return { healthy: false, error, detail: e.message };
  }
}

// Spawns the host ahead of the first recognition; session build stays lazy.
function prewarm() {
  host().prewarm();
}

// Which backend the host runs the base model on, and the fallback reason if
// any; the settings GPU switch shows it.
async function hostStatus() {
  return host().health({ packId: BASE_PACK_ID, models: resolveModels(BASE_PACK_ID) });
}

// 'webgpu' | 'cpu'. Takes effect on the next session build; a running host
// drops its cached sessions so the switch is live without a restart.
function setProvider(provider) {
  host().setProvider(provider);
}

module.exports = {
  recognize,
  healthCheck,
  hostStatus,
  setProvider,
  prewarm,
  evictSessions,
  setModelTier,
  isPackInstalled,
  listInstalledPacks,
  resolvePackDir,
  packsRoot,
  packsRoots,
  bundledBaseDir,
};
