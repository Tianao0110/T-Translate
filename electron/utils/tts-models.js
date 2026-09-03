// Installed neural voice packs: the read side of tts-pack-manager, kept free
// of engine/manager requires so both the pack manager and the audio engine
// manager can ask "which voices are usable right now" without a cycle.
//
// A voice pack is a folder under <models>/tts-models with a pack.json whose
// `files` map names the model plus its G2P data (a lexicon list, a jieba dict
// dir, espeak-ng-data for kokoro's English). Every referenced path must exist
// before the pack counts as usable — a half-swapped or hand-trimmed folder is
// skipped rather than crashing the worker on load.

const nodeFs = require('fs');
const nodePath = require('path');
const { TTS_VOICE_TYPE } = require('../shared/audio-packs');
const { listInstalledPacks } = require('./asr-models');

const ENGINES = new Set(['kokoro', 'vits']);

// Fallback pace correction for packs installed before the manifest carried
// speedScale (see audio-model-sources.js). Measured on the same 22-character
// sentence: kokoro 5.09s, MeloTTS 4.18s at speed 1.0.
const DEFAULT_SPEED_SCALE = { vits: { zh: 0.8, en: 1 } };

function exists(fs, p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

// Resolves a pack.json `files` map into absolute paths, or null when any
// required piece is missing. List-valued roles (lexicon, ruleFsts) stay lists.
function resolveFiles(pack, { fs, path }) {
  const files = pack.files || {};
  const out = {};
  for (const [role, value] of Object.entries(files)) {
    if (Array.isArray(value)) {
      const abs = value.map((f) => path.join(pack.dir, f));
      if (!abs.every((p) => exists(fs, p))) return null;
      out[role] = abs;
    } else if (typeof value === 'string' && value) {
      const abs = path.join(pack.dir, value);
      if (!exists(fs, abs)) return null;
      out[role] = abs;
    }
  }
  if (!out.model || !out.tokens) return null;
  return out;
}

/**
 * Usable voice packs across every pack root, newest root last so it wins on
 * an id collision. Shape is what the worker's tts-load expects plus the
 * voice layout the renderer builds its picker from.
 * @returns {Array<{id, version, model, engine, sampleRate, languages,
 *   voiceGroups, featured, preferMixed, dir, paths}>}
 */
function listVoicePacks(roots, { fs = nodeFs, path = nodePath } = {}) {
  const byId = new Map();
  for (const root of [...roots].reverse()) {
    for (const pack of listInstalledPacks(root, { fs, path })) {
      if (pack.type !== TTS_VOICE_TYPE) continue;
      if (!ENGINES.has(pack.engine)) continue;
      const paths = resolveFiles(pack, { fs, path });
      if (!paths) continue;
      byId.set(pack.id, {
        id: pack.id,
        version: pack.version,
        model: pack.model || pack.dirName,
        engine: pack.engine,
        sampleRate: pack.sampleRate || 0,
        languages: Array.isArray(pack.languages) ? pack.languages : [],
        voiceGroups: Array.isArray(pack.voiceGroups) ? pack.voiceGroups : [],
        featured: Array.isArray(pack.featured) ? pack.featured : [],
        preferMixed: pack.preferMixed === true,
        speedScale: pack.speedScale ?? DEFAULT_SPEED_SCALE[pack.engine] ?? 1,
        dir: pack.dir,
        paths,
      });
    }
  }
  return [...byId.values()];
}

module.exports = { listVoicePacks };
