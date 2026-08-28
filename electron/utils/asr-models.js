// ASR model gate for the audio-transcription probe.
//
// The probe ships with the app but stays invisible until the user manually
// places models under <userData>/asr-models:
//   asr-models/
//     silero_vad.onnx
//     sherpa-onnx-sense-voice-.../          (dir name must contain "sense-voice")
//       model.int8.onnx
//       tokens.txt
//     sherpa-onnx-streaming-zipformer-.../  (OPTIONAL — two-pass draft engine;
//       encoder-epoch-99-avg-1.int8.onnx     absent = pseudo-streaming drafts)
//       decoder-epoch-99-avg-1.onnx
//       joiner-epoch-99-avg-1.int8.onnx
//       tokens.txt
//
// Dependency-injected fs/path so the gate is testable outside Electron
// (secure-vault pattern).

const nodeFs = require('fs');
const nodePath = require('path');

const VAD_FILE = 'silero_vad.onnx';
const MODEL_FILE = 'model.int8.onnx';
const TOKENS_FILE = 'tokens.txt';

// Fixed names from the sherpa release tarball; the pack.json regime (v0.4.0
// distribution batch) supersedes these for downloaded packs.
const STREAMING_FILES = {
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt',
};

// Locate the optional streaming (draft) model set. Never gates the probe.
function locateStreamingModels(baseDir, entries, fs, path) {
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
    try {
      if (Object.values(set).every((p) => fs.statSync(p).isFile())) {
        return { ...set, dirName: name };
      }
    } catch {
      // incomplete candidate — keep scanning
    }
  }
  return null;
}

/**
 * Locate a usable SenseVoice + VAD model set under baseDir.
 * @returns {null | {baseDir, vadPath, modelDir, modelPath, tokensPath, modelName, streaming}}
 */
function locateAsrModels(baseDir, { fs = nodeFs, path = nodePath } = {}) {
  if (!baseDir) return null;
  let entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return null; // asr-models dir absent — the normal case for regular users
  }

  const vadPath = path.join(baseDir, VAD_FILE);
  let vadOk;
  try {
    vadOk = fs.statSync(vadPath).isFile();
  } catch {
    vadOk = false;
  }
  if (!vadOk) return null;

  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.includes('sense-voice'))
    .map((e) => e.name)
    .sort(); // deterministic pick when several are present

  for (const name of candidates) {
    const modelDir = path.join(baseDir, name);
    const modelPath = path.join(modelDir, MODEL_FILE);
    const tokensPath = path.join(modelDir, TOKENS_FILE);
    try {
      if (fs.statSync(modelPath).isFile() && fs.statSync(tokensPath).isFile()) {
        return {
          baseDir,
          vadPath,
          modelDir,
          modelPath,
          tokensPath,
          modelName: name,
          streaming: locateStreamingModels(baseDir, entries, fs, path),
        };
      }
    } catch {
      // incomplete candidate — keep scanning
    }
  }
  return null;
}

module.exports = { locateAsrModels, VAD_FILE, MODEL_FILE, TOKENS_FILE, STREAMING_FILES };
