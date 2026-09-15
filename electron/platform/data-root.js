// Where the app's own files live: the translation cache, listen session
// logs, and everything else that is not a model. Since v0.4.7 this is simply
// userData — app-paths.js has already pointed it at `<install>\data` (or left
// it in %APPDATA% when the install dir cannot be written) before any module
// loads, so nothing here has to choose.

const path = require('path');
const { app } = require('electron');

function dataRoot() {
  return app.getPath('userData');
}

function dataDir(name) {
  return path.join(dataRoot(), name);
}

module.exports = { dataRoot, dataDir };
