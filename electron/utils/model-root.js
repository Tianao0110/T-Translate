// Where downloaded models live.
//
// Default is a `models` folder inside the install directory, not userData: the
// packs are hundreds of megabytes, and a user who installed the app on D:/F:
// expects that bulk to sit there too, not to grow %APPDATA% on the system
// drive forever. Falls back to userData when the install dir cannot be written
// (a Program Files install without admin) and in dev, where the "install dir"
// is node_modules/electron.
//
// Reads look in BOTH roots: models downloaded by an earlier build (or dropped
// in by hand, or written by a dev run) keep working where they are. Only new
// downloads land in the active root.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('./logger')('ModelRoot');

let _cached = null;

function installModelsDir() {
  return path.join(path.dirname(app.getPath('exe')), 'models');
}

function userDataDir() {
  return app.getPath('userData');
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// Active root — where downloads are installed. Probed once per process.
function modelsRoot() {
  if (_cached) return _cached;
  if (app.isPackaged) {
    const dir = installModelsDir();
    if (isWritable(dir)) {
      _cached = dir;
      logger.info(`Models root: ${dir}`);
      return _cached;
    }
    logger.warn(`Install dir not writable, models stay in userData: ${dir}`);
  }
  _cached = userDataDir();
  return _cached;
}

// Active root first, then the pre-v0.4.0 userData location. Deduped, so an
// unpackaged run (or a read-only install dir) yields a single entry.
function modelRoots() {
  const primary = modelsRoot();
  const legacy = userDataDir();
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
  const legacyRoot = userDataDir();
  return { root, legacyRoot, fallback: app.isPackaged && root === legacyRoot };
}

module.exports = { modelsRoot, modelRoots, modelDir, modelDirs, storageState, isWritable };
