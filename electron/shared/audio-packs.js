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
// High-accuracy final-pass engine (v0.4.8). Optional: replaces the base
// engine for finals when the user picks the tier; the base pack's VAD still
// gates it, so it never stands alone.
const ASR_HQ_TYPE = 'asr-hq';
// Neural voice pack (sherpa-onnx TTS model + its G2P data). Any number.
const TTS_VOICE_TYPE = 'tts-voice';

// One manifest serves both domains; each pack manager lists only its own
// types so a voice pack never shows up under "识别模型" and vice versa.
const ASR_TYPES = [ASR_BASE_TYPE, ASR_DRAFT_TYPE, ASR_HQ_TYPE];
const TTS_TYPES = [TTS_VOICE_TYPE];

// Types this build knows how to install. A manifest written for a newer app
// lists types we must skip rather than offer.
const KNOWN_TYPES = [...ASR_TYPES, ...TTS_TYPES];

// Packs too big to re-host (the rule since v0.4.10: over 400 MB is a link,
// not an upload). The user fetches the upstream archive and drops its folder
// into <models>/asr-models; the layout below is what the locator trusts,
// pack.json or not ("hand-placed = trusted locally"). Shipped with the app
// so the folder resolves offline, and merged into the manifest entry of the
// same id so the settings page can show the link and the target folder.
// scripts/audio-model-sources.js carries the same entry for the release
// build; tests/unit/audio-packs.test.js keeps the two in step.
const QWEN3_ASR_DIR = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25';
const MANUAL_PACKS = [
  {
    id: 'asr-hq-qwen3-0.6b',
    type: ASR_HQ_TYPE,
    version: '1.0.0',
    model: QWEN3_ASR_DIR,
    engine: 'qwen3-asr',
    languages: [
      'zh', 'en', 'yue', 'ja', 'ko', 'hi', 'ar', 'de', 'fr', 'es', 'pt', 'id', 'it', 'ru', 'th', 'vi',
      'tr', 'ms', 'nl', 'sv', 'da', 'fi', 'pl', 'cs', 'fil', 'fa', 'el', 'hu', 'mk', 'ro',
    ],
    files: {
      convFrontend: 'conv_frontend.onnx',
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      tokenizer: 'tokenizer',
    },
    manual: {
      dir: QWEN3_ASR_DIR,
      url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${QWEN3_ASR_DIR}.tar.bz2`,
      archive: 'tar.bz2',
    },
  },
];

const manualPackById = (id) => MANUAL_PACKS.find((m) => m.id === id) || null;

// Merge what's installed with what the manifest offers into one UI-ready list.
// installedPacks: [{ id, version, type, ... }] from the disk scan
// manifest: { packs: [...] } or null (offline / unreachable)
// types: manifest types this list is for (default: everything this build knows)
// Returns [{ id, status: 'installed'|'update-available'|'not-installed'|'orphaned',
//            installedVersion?, ...manifestFields }]
function computePackList(installedPacks, manifest, types = KNOWN_TYPES) {
  const installed = new Map((installedPacks || []).map((p) => [p.id, p]));
  const result = [];

  for (const entry of manifest?.packs || []) {
    if (!types.includes(entry.type)) continue;
    // A link-only pack: the manifest may or may not carry the link; the
    // catalog shipped with the app always does.
    const manual = entry.manual || manualPackById(entry.id)?.manual || null;
    const mp = manual ? { ...entry, manual } : entry;

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
  ASR_HQ_TYPE,
  TTS_VOICE_TYPE,
  ASR_TYPES,
  TTS_TYPES,
  KNOWN_TYPES,
  MANUAL_PACKS,
  manualPackById,
  computePackList,
};
