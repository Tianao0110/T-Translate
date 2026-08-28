// Audio model pack manager: thin shell over model-pack-core, binding the
// audio domain pieces (manifest URL, asr-models root, live-session eviction).
// Download / verify / staging-swap / remove machinery lives in the core,
// shared verbatim with the OCR pack manager.

const path = require('path');
const { app, net } = require('electron');
const { computePackList } = require('../shared/audio-packs');
const { listInstalledPacks } = require('./asr-models');
const engineManager = require('../managers/audio-engine-manager');
const { createPackManager } = require('./model-pack-core');

// env override makes local testing possible (file:// or http://localhost)
const MANIFEST_URL =
  process.env.TT_AUDIO_MANIFEST_URL ||
  'https://github.com/Tianao0110/T-Translate/releases/download/audio-models/manifest.json';

function packsRoot() {
  return path.join(app.getPath('userData'), 'asr-models');
}

const manager = createPackManager({
  manifestUrl: MANIFEST_URL,
  packsRoot,
  listInstalled: () => listInstalledPacks(packsRoot()),
  // The worker holds the .onnx files open; swapping a pack under a live
  // session would fail on Windows (or worse, half-swap). Stopping is the
  // honest move — a model change mid-session cannot be seamless anyway.
  evictSessions: () => engineManager.stopSession('pack-swap'),
  computePackList,
  packJsonFields: (entry) => ({
    id: entry.id,
    version: entry.version,
    type: entry.type,
    model: entry.model,
    languages: entry.languages,
    files: entry.files,
    size: entry.size,
  }),
  basePackId: null, // nothing is bundled: every pack is fully removable
  logLabel: 'Audio-Packs',
  deps: { fetch: (...args) => net.fetch(...args) },
});

module.exports = {
  MANIFEST_URL,
  packsRoot,
  fetchManifest: manager.fetchManifest,
  listPacks: manager.listPacks,
  downloadPack: manager.downloadPack,
  removePack: manager.removePack,
};
