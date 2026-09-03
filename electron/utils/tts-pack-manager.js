// Neural voice pack manager: the TTS twin of audio-pack-manager, sharing the
// audio-models manifest and the model-pack-core machinery but bound to the
// tts-models root and to the worker's TTS engine for eviction.

const { net } = require('electron');
const { store } = require('../state');
const { isOfflineMode } = require('./privacy-gate');
const { computePackList, TTS_TYPES } = require('../shared/audio-packs');
const { listInstalledPacks } = require('./asr-models');
const { modelDir, modelDirs } = require('./model-root');
const engineManager = require('../managers/audio-engine-manager');
const { createPackManager } = require('./model-pack-core');
const { MANIFEST_URL } = require('./audio-pack-manager');

function packsRoot() {
  return modelDir('tts-models');
}

function packsRoots() {
  return modelDirs('tts-models');
}

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
  allowedRoots: packsRoots,
  listInstalled: listAllInstalled,
  // Only the voice engine holds these files; a running listen session is
  // untouched. Awaited so the swap never races the worker's open handles.
  evictSessions: (packId) => engineManager.unloadTtsAndWait(packId),
  computePackList: (installed, manifest) => computePackList(installed, manifest, TTS_TYPES),
  packFilter: (entry) => TTS_TYPES.includes(entry.type),
  // engine/voiceGroups/sampleRate ride along: the worker config and the voice
  // picker are built from pack.json alone, no manifest needed once installed.
  packJsonFields: (entry) => ({
    id: entry.id,
    version: entry.version,
    type: entry.type,
    model: entry.model,
    engine: entry.engine,
    sampleRate: entry.sampleRate,
    languages: entry.languages,
    files: entry.files,
    voiceGroups: entry.voiceGroups,
    featured: entry.featured,
    preferMixed: entry.preferMixed === true,
    size: entry.size,
  }),
  basePackId: null,
  offlineGate: () => isOfflineMode(store),
  logLabel: 'TTS-Packs',
  deps: { fetch: (...args) => net.fetch(...args) },
});

module.exports = {
  packsRoot,
  packsRoots,
  listPacks: manager.listPacks,
  downloadPack: manager.downloadPack,
  removePack: manager.removePack,
};
