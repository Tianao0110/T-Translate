// Where downloaded models live: <install dir>/models (the repo's models/ in
// dev), userData when that is not writable. Reads look in both the active
// root and the pre-v0.4.0 userData root; new downloads land in the active
// one. Design notes: docs/design/model-packs.md.

const path = require('path');
const { app } = require('electron');
const { isWritable, legacyUserData } = require('../platform/app-paths');
const logger = require('../platform/logger')('ModelRoot');

let _cached = null;

function installModelsDir() {
  return path.join(path.dirname(app.getPath('exe')), 'models');
}

function devModelsDir() {
  return path.join(__dirname, '..', '..', 'models');
}

function userDataDir() {
  return app.getPath('userData');
}

// The pre-v0.4.0 location, as app-paths reports it.
function legacyModelsRoot() {
  return legacyUserData() || userDataDir();
}

// Active root — where downloads are installed. Probed once per process.
function modelsRoot() {
  if (_cached) return _cached;
  // TT_MODELS_ROOT: the smoke / bench harness sandbox.
  const dir = process.env.TT_MODELS_ROOT || (app.isPackaged ? installModelsDir() : devModelsDir());
  if (isWritable(dir)) {
    _cached = dir;
    logger.info(`Models root: ${dir}`);
    return _cached;
  }
  logger.warn(`Models dir not writable, models stay in userData: ${dir}`);
  _cached = userDataDir();
  return _cached;
}

// Active root first, then the pre-v0.4.0 userData location. Deduped, so an
// unpackaged run (or a read-only install dir) yields a single entry.
function modelRoots() {
  const primary = modelsRoot();
  const legacy = legacyModelsRoot();
  return primary === legacy ? [primary] : [primary, legacy];
}

// Install target for a model family, e.g. modelDir('ocr-models').
function modelDir(name) {
  return path.join(modelsRoot(), name);
}

// Every place that family may be read from, in priority order.
function modelDirs(name) {
  return modelRoots().map((root) => path.join(root, name));
}

// For the settings page: where packs go, whether that is the userData
// fallback (an unwritable install dir), and where an older build left them.
function storageState() {
  const root = modelsRoot();
  const legacyRoot = legacyModelsRoot();
  return { root, legacyRoot, fallback: app.isPackaged && root === userDataDir() };
}

module.exports = { modelsRoot, modelDir, modelDirs, storageState };
