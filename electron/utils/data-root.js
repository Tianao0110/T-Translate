// Where the app's lightweight per-install files live: the translation cache
// and listen session logs today, everything else when the userData move
// completes. Same rule as model-root: a `data` folder inside the install
// directory when it is writable, userData otherwise (a Program Files install
// without admin rights, or a dev run). Probed once per process.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { isWritable } = require('./model-root');
const logger = require('./logger')('DataRoot');

let _cached = null;

function installDataDir() {
  return path.join(path.dirname(app.getPath('exe')), 'data');
}

function userDataDir() {
  return app.getPath('userData');
}

function dataRoot() {
  if (_cached) return _cached;
  if (app.isPackaged) {
    const dir = installDataDir();
    if (isWritable(dir)) {
      _cached = dir;
      logger.info(`Data root: ${dir}`);
      return _cached;
    }
    logger.warn(`Install dir not writable, data stays in userData: ${dir}`);
  }
  _cached = userDataDir();
  return _cached;
}

function dataDir(name) {
  return path.join(dataRoot(), name);
}

// One-time carry-over of a file from where a pre-v0.4.6 build kept it, so
// the first launch after the move does not start from empty. Never
// overwrites: once the new location has a file, the old one is history.
function carryOver(legacyFile, targetFile) {
  try {
    if (fs.existsSync(targetFile) || !fs.existsSync(legacyFile)) return false;
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(legacyFile, targetFile);
    logger.info(`carried over ${path.basename(targetFile)} to ${path.dirname(targetFile)}`);
    return true;
  } catch (e) {
    logger.warn(`carry-over failed for ${legacyFile}: ${e.message}`);
    return false;
  }
}

module.exports = { dataRoot, dataDir, userDataDir, carryOver };
