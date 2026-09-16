// Neural voice pack manager: the TTS twin of audio-pack-manager, sharing the
// audio-models manifest and the model-pack-core machinery but bound to the
// tts-models root and to the worker's TTS engine for eviction.

const { net } = require('electron');
const { store } = require('../state');
const { isOfflineMode } = require('../security/privacy-gate');
const { computePackList, TTS_TYPES } = require('../shared/audio-packs');
const { listInstalledPacks } = require('../listen/asr-models');
const { packRoots } = require('../packs/pack-roots');
const engineManager = require('../listen/audio-engine-manager');
const { createPackManager } = require('../packs/model-pack-core');
const { MANIFEST_URL } = require('../listen/audio-pack-manager');

const { packsRoot, packsRoots, listAllInstalled } = packRoots('tts-models', listInstalledPacks);

const manager = createPackManager({
  manifestUrl: MANIFEST_URL,
  packsRoot,
  resolvePackDir: (packId) => listAllInstalled().find((p) => p.id === packId)?.dir || null,
  allowedRoots: packsRoots,
  listInstalled: listAllInstalled,
  // Awaited so the swap never races the worker's open handles.
  evictSessions: (packId) => engineManager.unloadTtsAndWait(packId),
  computePackList: (installed, manifest) => computePackList(installed, manifest, TTS_TYPES),
  packFilter: (entry) => TTS_TYPES.includes(entry.type),
  // pack.json alone builds the worker config and the voice picker.
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
    ...(entry.speedScale !== undefined ? { speedScale: entry.speedScale } : {}),
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
