// Audio (ASR) model pack registry + pure helpers, shared by the locator, the
// pack manager, and unit tests. A "pack" is a folder under
// <userData>/asr-models described by a pack.json; nothing ships with the app,
// so every pack is downloaded on demand from the GitHub `audio-models`
// release (or placed by hand — see asr-models.js for the legacy layout).
//
// Pack shape is defined by scripts/audio-model-sources.js: each entry carries
// a `files` map of role -> filename, which is what frees the engine from
// hardcoding sherpa's filenames.

const { compareVersions } = require('../utils/model-pack-core');

// Final-pass engine (+ the VAD that gates it). Listen mode needs exactly one.
const ASR_BASE_TYPE = 'asr-base';
// Two-pass draft engine. Optional: absent means pseudo-streaming drafts.
const ASR_DRAFT_TYPE = 'asr-draft';

// Types this build knows how to install. A manifest written for a newer app
// (TTS voice packs, v0.4.x) lists types we must skip rather than offer.
const KNOWN_TYPES = [ASR_BASE_TYPE, ASR_DRAFT_TYPE];

// Merge what's installed with what the manifest offers into one UI-ready list.
// installedPacks: [{ id, version, type, ... }] from the disk scan
// manifest: { packs: [...] } or null (offline / unreachable)
// Returns [{ id, status: 'installed'|'update-available'|'not-installed'|'orphaned',
//            installedVersion?, ...manifestFields }]
function computePackList(installedPacks, manifest) {
  const installed = new Map((installedPacks || []).map((p) => [p.id, p]));
  const result = [];

  for (const mp of manifest?.packs || []) {
    if (!KNOWN_TYPES.includes(mp.type)) continue;

    const local = installed.get(mp.id);
    if (!local) {
      result.push({ ...mp, status: 'not-installed' });
    } else {
      installed.delete(mp.id);
      result.push({
        ...mp,
        status: compareVersions(mp.version, local.version) > 0 ? 'update-available' : 'installed',
        installedVersion: local.version,
      });
    }
  }

  // Installed but no longer in the manifest (or the manifest never loaded):
  // still usable, still removable — never hide what is on disk.
  for (const local of installed.values()) {
    result.push({ ...local, status: 'orphaned', installedVersion: local.version });
  }

  return result;
}

module.exports = {
  ASR_BASE_TYPE,
  ASR_DRAFT_TYPE,
  KNOWN_TYPES,
  computePackList,
};
