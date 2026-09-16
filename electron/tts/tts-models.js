// Installed neural voice packs: the read side of tts-pack-manager, free of
// engine / manager requires. A pack.json `files` map names the model and its
// G2P data; every referenced path must exist before the pack counts as usable.

const nodeFs = require('fs');
const nodePath = require('path');
const { TTS_VOICE_TYPE } = require('../shared/audio-packs');
const { listInstalledPacks } = require('../listen/asr-models');

const ENGINES = new Set(['kokoro', 'vits']);

// Pace correction for packs installed before the manifest carried speedScale.
const DEFAULT_SPEED_SCALE = { vits: { zh: 0.9, en: 1 } };

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

// Usable voice packs across every root (the active root wins on an id
// collision): what the worker's tts-load expects plus the voice layout the
// picker is built from.
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
