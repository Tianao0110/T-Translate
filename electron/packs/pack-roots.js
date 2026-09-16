// Pack roots for a model family that lives under <models>/<name>: the active
// root, every root a pack may sit in (the old userData location included),
// and the installed list merged across them. Used by the listen and voice
// pack managers; the OCR side keeps its own bundled-base logic in ocr-engine.

const { modelDir, modelDirs } = require('./model-root');

function packRoots(name, listInstalledPacks) {
  const packsRoot = () => modelDir(name);
  const packsRoots = () => modelDirs(name);
  // Active root last: it wins on an id collision.
  function listAllInstalled() {
    const byId = new Map();
    for (const root of packsRoots().reverse()) {
      for (const pack of listInstalledPacks(root)) byId.set(pack.id, pack);
    }
    return [...byId.values()];
  }
  return { packsRoot, packsRoots, listAllInstalled };
}

module.exports = { packRoots };
