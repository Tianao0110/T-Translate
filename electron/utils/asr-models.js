// ASR model gate for the audio-transcription probe.
//
// The probe ships with the app but stays invisible until the user manually
// places models under <userData>/asr-models:
//   asr-models/
//     silero_vad.onnx
//     ten-vad.onnx                   (optional — preferred when present)
//     sherpa-onnx-sense-voice-.../   (dir name must contain "sense-voice")
//       model.int8.onnx
//       tokens.txt
//
// silero stays REQUIRED (the gate and every existing install rely on it);
// ten-vad is an optional upgrade the worker picks automatically. Must be the
// sherpa-modified ten-vad.onnx — the original errors at runtime.
//
// Dependency-injected fs/path so the gate is testable outside Electron
// (secure-vault pattern).

const nodeFs = require('fs');
const nodePath = require('path');

const VAD_FILE = 'silero_vad.onnx';
const TEN_VAD_FILE = 'ten-vad.onnx';
const MODEL_FILE = 'model.int8.onnx';
const TOKENS_FILE = 'tokens.txt';

/**
 * Locate a usable SenseVoice + VAD model set under baseDir.
 * @returns {null | {baseDir, vadPath, tenVadPath, modelDir, modelPath, tokensPath, modelName}}
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

  let tenVadPath = path.join(baseDir, TEN_VAD_FILE);
  try {
    if (!fs.statSync(tenVadPath).isFile()) tenVadPath = null;
  } catch {
    tenVadPath = null;
  }

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
        return { baseDir, vadPath, tenVadPath, modelDir, modelPath, tokensPath, modelName: name };
      }
    } catch {
      // incomplete candidate — keep scanning
    }
  }
  return null;
}

module.exports = { locateAsrModels, VAD_FILE, TEN_VAD_FILE, MODEL_FILE, TOKENS_FILE };
