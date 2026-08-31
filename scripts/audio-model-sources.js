// Single source of truth for audio (ASR + VAD) model pack origins. Used by
// build-audio-release.js to prepare the GitHub `audio-models` release —
// the sibling of ocr-model-sources.js / build-ocr-release.js.
//
// Upstream is k2-fsa/sherpa-onnx's pre-converted model releases, shipped as
// .tar.bz2. Node has no bzip2, so the packs published here are REPACKAGED as
// flat zips from an already-extracted local copy; the exact upstream artifact
// each file came from is recorded per pack and burned into PROVENANCE.txt
// inside the zip.
//
// Same-name-different-source trap: the 2025-09-09 `sense-voice` package on the
// same upstream tag is ASLP-lab's Cantonese-specialised fine-tune (judges every
// language as yue, garbles ja/ko). `sourceDir` pins the vetted 2024-07-17
// original and the build refuses to package anything else.
//
// Bump `version` when swapping in newer weights — installed apps compare it
// against their local pack.json to offer updates.

const UPSTREAM_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

const RELEASE_BASE_URL =
  'https://github.com/Tianao0110/T-Translate/releases/download/audio-models';

const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const ZIPFORMER_DIR = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20';

// Required pack: the final-pass engine (punctuation + ITN) plus the VAD that
// gates it. VAD rides along instead of being its own pack because every path
// needs it, it is 0.3% of the download, and a future base swap brings its own.
const ASR_BASE_PACK = {
  id: 'asr-base-sense-voice',
  type: 'asr-base',
  version: '1.0.0',
  model: SENSE_VOICE_DIR,
  file: 'asr-base-sense-voice.zip',
  languages: ['zh', 'en', 'ja', 'ko', 'yue'],
  // Role -> installed filename. This map supersedes the hardcoded filenames in
  // electron/utils/asr-models.js: swapping a model edits the map, not the code.
  files: {
    model: 'model.int8.onnx',
    tokens: 'tokens.txt',
    vad: 'silero_vad.onnx',
  },
  // Where each file comes from in the extracted source tree. `root: true`
  // means it sits directly under the source root, not in a model folder.
  sources: [
    { dir: SENSE_VOICE_DIR, file: 'model.int8.onnx' },
    { dir: SENSE_VOICE_DIR, file: 'tokens.txt' },
    { root: true, file: 'silero_vad.onnx' },
  ],
  licenses: ['LICENSE-sense-voice.txt', 'LICENSE-silero-vad.txt'],
  license:
    'FunASR Model Open Source License 1.1 (SenseVoiceSmall, Alibaba Group) + MIT (silero-vad, Silero Team)',
  upstream: [
    `${UPSTREAM_BASE}/${SENSE_VOICE_DIR}.tar.bz2`,
    `${UPSTREAM_BASE}/silero_vad.onnx`,
  ],
};

// Optional pack: the two-pass draft engine. Absent = drafts fall back to
// pseudo-streaming (partials replayed from the final engine), which still
// works — never gate listen mode on this one.
const ASR_DRAFT_PACK = {
  id: 'asr-draft-zipformer-zh-en',
  type: 'asr-draft',
  version: '1.0.0',
  model: ZIPFORMER_DIR,
  file: 'asr-draft-zipformer-zh-en.zip',
  languages: ['zh', 'en'],
  files: {
    encoder: 'encoder-epoch-99-avg-1.int8.onnx',
    decoder: 'decoder-epoch-99-avg-1.onnx',
    joiner: 'joiner-epoch-99-avg-1.int8.onnx',
    tokens: 'tokens.txt',
  },
  sources: [
    { dir: ZIPFORMER_DIR, file: 'encoder-epoch-99-avg-1.int8.onnx' },
    { dir: ZIPFORMER_DIR, file: 'decoder-epoch-99-avg-1.onnx' },
    { dir: ZIPFORMER_DIR, file: 'joiner-epoch-99-avg-1.int8.onnx' },
    { dir: ZIPFORMER_DIR, file: 'tokens.txt' },
  ],
  licenses: ['LICENSE-zipformer.txt'],
  license: 'Apache-2.0 (k2-fsa/icefall zipformer, torchscript model from pfluo/k2fsa-zipformer-chinese-english-mixed)',
  upstream: [`${UPSTREAM_BASE}/${ZIPFORMER_DIR}.tar.bz2`],
};

module.exports = {
  UPSTREAM_BASE,
  RELEASE_BASE_URL,
  PACKS: [ASR_BASE_PACK, ASR_DRAFT_PACK],
};
