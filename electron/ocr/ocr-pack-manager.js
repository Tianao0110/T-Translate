// OCR model pack manager: thin shell over packs/model-pack-core, binding the
// OCR domain pieces (manifest URL, ocr-engine hooks, pack list filter).

const { net } = require('electron');
const { store } = require('../state');
const { BASE_PACK_ID, computePackList } = require('../shared/ocr-packs');
const { isOfflineMode } = require('../security/privacy-gate');
const ocrEngine = require('./ocr-engine');
const { createPackManager } = require('../packs/model-pack-core');

// Env override for local testing (file:// or http://localhost).
const MANIFEST_URL =
  process.env.TT_OCR_MANIFEST_URL ||
  'https://github.com/Tianao0110/T-Translate/releases/download/ocr-models/manifest.json';

const manager = createPackManager({
  manifestUrl: MANIFEST_URL,
  packsRoot: () => ocrEngine.packsRoot(),
  // Legacy userData packs are removable too; the bundled base dir is not
  // (removePack falls through to BUILTIN_PACK).
  resolvePackDir: (packId) => {
    const dir = ocrEngine.resolvePackDir(packId);
    return dir && dir !== ocrEngine.bundledBaseDir() ? dir : null;
  },
  allowedRoots: () => ocrEngine.packsRoots(),
  listInstalled: () => ocrEngine.listInstalledPacks(),
  evictSessions: (packId) => ocrEngine.evictSessions(packId),
  computePackList,
  packJsonFields: (entry) => ({
    id: entry.id,
    version: entry.version,
    gen: entry.gen,
    type: entry.type,
    languages: entry.languages,
    files: entry.files,
    size: entry.size,
  }),
  basePackId: BASE_PACK_ID,
  // Offline gate, same as the audio packs.
  offlineGate: () => isOfflineMode(store),
  logLabel: 'OCR-Packs',
  deps: { fetch: (...args) => net.fetch(...args) },
});

module.exports = {
  MANIFEST_URL,
  fetchManifest: manager.fetchManifest,
  listPacks: manager.listPacks,
  downloadPack: manager.downloadPack,
  removePack: manager.removePack,
};
