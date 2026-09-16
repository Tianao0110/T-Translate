// Listen-mode pack manager: model-pack-core bound to the audio manifest, the
// asr-models roots and live-session eviction.

const path = require('path');
const { net } = require('electron');
const { store } = require('../state');
const { isOfflineMode } = require('../security/privacy-gate');
const { computePackList, ASR_TYPES } = require('../shared/audio-packs');
const { listInstalledPacks } = require('./asr-models');
const { packRoots } = require('../packs/pack-roots');
const engineManager = require('./audio-engine-manager');
const { createPackManager } = require('../packs/model-pack-core');

// env override makes local testing possible (file:// or http://localhost)
const MANIFEST_URL =
  process.env.TT_AUDIO_MANIFEST_URL ||
  'https://github.com/Tianao0110/T-Translate/releases/download/audio-models/manifest.json';

const { packsRoot, packsRoots, listAllInstalled } = packRoots('asr-models', listInstalledPacks);

const manager = createPackManager({
  manifestUrl: MANIFEST_URL,
  packsRoot,
  resolvePackDir: (packId) => listAllInstalled().find((p) => p.id === packId)?.dir || null,
  allowedRoots: packsRoots,
  listInstalled: listAllInstalled,
  // Awaited by the core: the swap must not race the worker's open files.
  evictSessions: () => engineManager.stopSessionAndWait('pack-swap'),
  // ASR types only (voice packs share the manifest but belong to
  // tts-pack-manager); a link-only pack carries the folder to drop it into.
  computePackList: (installed, manifest) =>
    computePackList(installed, manifest, ASR_TYPES).map((p) =>
      (p.manual && typeof p.manual === 'object' && !p.dir ? { ...p, targetDir: path.join(packsRoot(), p.manual.dir) } : p)),
  packFilter: (entry) => ASR_TYPES.includes(entry.type),
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
  // Injected into the core so it also covers the manifest fetch behind listPacks.
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
