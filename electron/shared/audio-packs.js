// Audio model pack registry + pure helpers, shared by the locators, the pack
// managers, and unit tests. A "pack" is a folder under <models>/asr-models or
// <models>/tts-models described by a pack.json; nothing ships with the app,
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
// Neural voice pack (sherpa-onnx TTS model + its G2P data). Any number.
const TTS_VOICE_TYPE = 'tts-voice';

// One manifest serves both domains; each pack manager lists only its own
// types so a voice pack never shows up under "识别模型" and vice versa.
const ASR_TYPES = [ASR_BASE_TYPE, ASR_DRAFT_TYPE];
const TTS_TYPES = [TTS_VOICE_TYPE];

// Types this build knows how to install. A manifest written for a newer app
// lists types we must skip rather than offer.
const KNOWN_TYPES = [...ASR_TYPES, ...TTS_TYPES];

// Merge what's installed with what the manifest offers into one UI-ready list.
// installedPacks: [{ id, version, type, ... }] from the disk scan
// manifest: { packs: [...] } or null (offline / unreachable)
// types: manifest types this list is for (default: everything this build knows)
// Returns [{ id, status: 'installed'|'update-available'|'not-installed'|'orphaned',
//            installedVersion?, ...manifestFields }]
function computePackList(installedPacks, manifest, types = KNOWN_TYPES) {
  const installed = new Map((installedPacks || []).map((p) => [p.id, p]));
  const result = [];

  for (const mp of manifest?.packs || []) {
    if (!types.includes(mp.type)) continue;

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
  TTS_VOICE_TYPE,
  ASR_TYPES,
  TTS_TYPES,
  KNOWN_TYPES,
  computePackList,
};
