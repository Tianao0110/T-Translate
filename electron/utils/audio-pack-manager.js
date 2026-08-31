// Audio model pack manager: thin shell over model-pack-core, binding the
// audio domain pieces (manifest URL, asr-models root, live-session eviction).
// Download / verify / staging-swap / remove machinery lives in the core,
// shared verbatim with the OCR pack manager.

const { net } = require('electron');
const { store } = require('../state');
const { isOfflineMode } = require('./privacy-gate');
const { computePackList } = require('../shared/audio-packs');
const { listInstalledPacks } = require('./asr-models');
const { modelDir, modelDirs } = require('./model-root');
const engineManager = require('../managers/audio-engine-manager');
const { createPackManager } = require('./model-pack-core');

// env override makes local testing possible (file:// or http://localhost)
const MANIFEST_URL =
  process.env.TT_AUDIO_MANIFEST_URL ||
  'https://github.com/Tianao0110/T-Translate/releases/download/audio-models/manifest.json';

// Downloads land in the install dir's models folder (see model-root.js);
// packsRoots() also covers the old userData location so a pack put there by an
// earlier build stays listed, usable and removable.
function packsRoot() {
  return modelDir('asr-models');
}

function packsRoots() {
  return modelDirs('asr-models');
}

// Active root last so it wins on an id collision with a stale older copy.
function listAllInstalled() {
  const byId = new Map();
  for (const root of packsRoots().reverse()) {
    for (const pack of listInstalledPacks(root)) byId.set(pack.id, pack);
  }
  return [...byId.values()];
}

const manager = createPackManager({
  manifestUrl: MANIFEST_URL,
  packsRoot,
  resolvePackDir: (packId) => listAllInstalled().find((p) => p.id === packId)?.dir || null,
  listInstalled: listAllInstalled,
  // The worker holds the .onnx files open; swapping a pack under a live
  // session would fail on Windows (or worse, half-swap). Stopping is the
  // honest move — a model change mid-session cannot be seamless anyway.
  // Awaited by the core: stopSession alone returns before the process is
  // actually gone, and the swap would race its file handles.
  evictSessions: () => engineManager.stopSessionAndWait('pack-swap'),
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
  // Offline mode promises the app never reaches the network, and a model
  // download is not an exception the user can click their way out of. The gate
  // is injected into the core rather than wrapped around downloadPack here, so
  // it also covers the manifest fetch behind listPacks — opening the settings
  // page used to hit GitHub in offline mode.
  offlineGate: () => isOfflineMode(store),
  logLabel: 'Audio-Packs',
  deps: { fetch: (...args) => net.fetch(...args) },
});

module.exports = {
  MANIFEST_URL,
  packsRoot,
  packsRoots,
  fetchManifest: manager.fetchManifest,
  listPacks: manager.listPacks,
  downloadPack: manager.downloadPack,
  removePack: manager.removePack,
};
