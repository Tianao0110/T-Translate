// Where the app's own files live (cache, listen logs, everything that is not
// a model): userData, as app-paths.js placed it.

const path = require('path');
const { app } = require('electron');

function dataRoot() {
  return app.getPath('userData');
}

function dataDir(name) {
  return path.join(dataRoot(), name);
}

module.exports = { dataRoot, dataDir };
