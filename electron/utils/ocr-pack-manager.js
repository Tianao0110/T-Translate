// OCR model pack manager: thin shell over model-pack-core, binding the OCR
// domain pieces (manifest URL, ocr-engine hooks, pack list filter). Download /
// verify / staging-swap / remove machinery lives in the core — shared with the
// audio-engine pack managers (v0.4.x) with zero OCR behavior change.

const { net } = require('electron');
const { BASE_PACK_ID, computePackList } = require('../shared/ocr-packs');
const ocrEngine = require('./ocr-engine');
const { createPackManager } = require('./model-pack-core');

// env override makes local testing possible (file:// or http://localhost)
const MANIFEST_URL =
  process.env.TT_OCR_MANIFEST_URL ||
  'https://github.com/Tianao0110/T-Translate/releases/download/ocr-models/manifest.json';

const manager = createPackManager({
  manifestUrl: MANIFEST_URL,
  packsRoot: () => ocrEngine.packsRoot(),
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
