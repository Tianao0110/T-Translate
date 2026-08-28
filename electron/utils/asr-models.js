// ASR model gate for listen mode. Two layouts resolve here:
//
// 1. PACKS (v0.4.0 distribution) — installed by the audio pack manager into
//    <userData>/asr-models/<packId>/, each with a pack.json whose `files` map
//    names the role -> filename. This is the layout the settings page installs.
//      asr-models/
//        asr-base-sense-voice/        pack.json {type:'asr-base', files:{model,tokens,vad}}
//        asr-draft-zipformer-zh-en/   pack.json {type:'asr-draft', files:{encoder,decoder,joiner,tokens}}
//
// 2. LEGACY manual placement — what the hidden probe shipped with, kept
//    working so anyone who dropped sherpa's tarballs in by hand (and the
//    probe's early users) is not broken by the distribution batch:
//      asr-models/
//        silero_vad.onnx
//        sherpa-onnx-sense-voice-.../          (dir name must contain "sense-voice")
//          model.int8.onnx
//          tokens.txt
//        sherpa-onnx-streaming-zipformer-.../  (OPTIONAL — two-pass draft engine)
//          encoder-epoch-99-avg-1.int8.onnx
//          decoder-epoch-99-avg-1.onnx
//          joiner-epoch-99-avg-1.int8.onnx
//          tokens.txt
//
// Packs win when both are present. Base and draft resolve independently, so a
// pack-installed base pairs fine with a hand-placed draft and vice versa.
//
// Dependency-injected fs/path so the gate is testable outside Electron
// (secure-vault pattern).

const nodeFs = require('fs');
const nodePath = require('path');
const { ASR_BASE_TYPE, ASR_DRAFT_TYPE } = require('../shared/audio-packs');

const VAD_FILE = 'silero_vad.onnx';
const MODEL_FILE = 'model.int8.onnx';
const TOKENS_FILE = 'tokens.txt';

// Fixed names from the sherpa release tarball — legacy layout only. Packs
// carry their own names in pack.json.
const STREAMING_FILES = {
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt',
};

function isFile(fs, p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readDirEntries(baseDir, fs) {
  try {
    return fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return null; // asr-models dir absent — the normal case before any download
  }
}

/**
 * Every installed pack (a folder with a readable pack.json), newest-sorted by
 * folder name for deterministic picks. Also feeds the settings pack list.
 * @returns {Array<{id, version, type, files, dir, dirName}>}
 */
function listInstalledPacks(baseDir, { fs = nodeFs, path = nodePath } = {}) {
  if (!baseDir) return [];
  const entries = readDirEntries(baseDir, fs);
  if (!entries) return [];

  const packs = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(baseDir, entry.name);
    const metaPath = path.join(dir, 'pack.json');
    if (!isFile(fs, metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!meta || typeof meta !== 'object') continue;
      packs.push({ ...meta, id: meta.id || entry.name, dir, dirName: entry.name });
    } catch {
      // unreadable pack.json — a half-written folder, not a pack
    }
  }
  return packs;
}

// Resolve the final-pass engine from an installed pack. Its `files` map is
// authoritative: a swapped model changes the manifest, not this file.
function baseFromPacks(packs, fs, path) {
  for (const pack of packs) {
    if (pack.type !== ASR_BASE_TYPE) continue;
    const files = pack.files || {};
    const modelPath = files.model && path.join(pack.dir, files.model);
    const tokensPath = files.tokens && path.join(pack.dir, files.tokens);
    const vadPath = files.vad && path.join(pack.dir, files.vad);
    if (!modelPath || !tokensPath || !vadPath) continue;
    if (isFile(fs, modelPath) && isFile(fs, tokensPath) && isFile(fs, vadPath)) {
      return {
        vadPath,
        modelDir: pack.dir,
        modelPath,
        tokensPath,
        modelName: pack.model || pack.dirName,
      };
    }
  }
  return null;
}

function draftFromPacks(packs, fs, path) {
  for (const pack of packs) {
    if (pack.type !== ASR_DRAFT_TYPE) continue;
    const files = pack.files || {};
    const set = {
      encoder: files.encoder && path.join(pack.dir, files.encoder),
      decoder: files.decoder && path.join(pack.dir, files.decoder),
      joiner: files.joiner && path.join(pack.dir, files.joiner),
      tokens: files.tokens && path.join(pack.dir, files.tokens),
    };
    if (Object.values(set).every((p) => p && isFile(fs, p))) {
      return { ...set, dirName: pack.dirName };
    }
  }
  return null;
}

// Legacy: the optional streaming (draft) model set by folder name. Never gates.
function draftFromLegacy(baseDir, entries, fs, path) {
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.includes('streaming-zipformer'))
    .map((e) => e.name)
    .sort();
  for (const name of candidates) {
    const dir = path.join(baseDir, name);
    const set = {
      encoder: path.join(dir, STREAMING_FILES.encoder),
      decoder: path.join(dir, STREAMING_FILES.decoder),
      joiner: path.join(dir, STREAMING_FILES.joiner),
      tokens: path.join(dir, STREAMING_FILES.tokens),
    };
    if (Object.values(set).every((p) => isFile(fs, p))) {
      return { ...set, dirName: name };
    }
  }
  return null;
}

// Legacy: VAD at the root + a folder whose name contains "sense-voice".
function baseFromLegacy(baseDir, entries, fs, path) {
  const vadPath = path.join(baseDir, VAD_FILE);
  if (!isFile(fs, vadPath)) return null;

  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.includes('sense-voice'))
    .map((e) => e.name)
    .sort(); // deterministic pick when several are present

  for (const name of candidates) {
    const modelDir = path.join(baseDir, name);
    const modelPath = path.join(modelDir, MODEL_FILE);
    const tokensPath = path.join(modelDir, TOKENS_FILE);
    if (isFile(fs, modelPath) && isFile(fs, tokensPath)) {
      return { vadPath, modelDir, modelPath, tokensPath, modelName: name };
    }
  }
  return null;
}

/**
 * Locate a usable final-pass model + VAD under baseDir, plus the optional
 * draft model set. Packs first, hand-placed folders second.
 * @returns {null | {baseDir, vadPath, modelDir, modelPath, tokensPath, modelName, streaming}}
 */
function locateAsrModels(baseDir, { fs = nodeFs, path = nodePath } = {}) {
  if (!baseDir) return null;
  const entries = readDirEntries(baseDir, fs);
  if (!entries) return null;

  const packs = listInstalledPacks(baseDir, { fs, path });

  const base = baseFromPacks(packs, fs, path) || baseFromLegacy(baseDir, entries, fs, path);
  if (!base) return null;

  const streaming =
    draftFromPacks(packs, fs, path) || draftFromLegacy(baseDir, entries, fs, path);

  return { baseDir, ...base, streaming };
}

module.exports = {
  locateAsrModels,
  listInstalledPacks,
  VAD_FILE,
  MODEL_FILE,
  TOKENS_FILE,
  STREAMING_FILES,
};
