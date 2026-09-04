// Where the app's lightweight per-install files live: the translation cache
// and listen session logs today, everything else when the userData move
// completes. Same rule as model-root: a `data` folder inside the install
// directory when it is writable, userData otherwise (a Program Files install
// without admin rights, or a dev run). The fallback is userData/data rather
// than userData itself: Chromium keeps its own Cache/ folder there, and on
// a case-insensitive disk our cache/ would land inside it. Probed once.
//
// A factory plus a default instance: under vitest a CJS require('electron')
// reaches the real package (the alias only covers ESM imports), so the test
// hands in a fake app instead.

const path = require('path');
const nodeFs = require('fs');
const { isWritable } = require('./model-root');

function createDataRoot({ app, fs = nodeFs, logger = require('./logger')('DataRoot') }) {
  let _cached = null;

  const installDataDir = () => path.join(path.dirname(app.getPath('exe')), 'data');
  const userDataDir = () => app.getPath('userData');

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
    _cached = path.join(userDataDir(), 'data');
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

  return { dataRoot, dataDir, userDataDir, carryOver };
}

module.exports = { ...createDataRoot({ app: require('electron').app }), createDataRoot };
