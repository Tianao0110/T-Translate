// Single source of truth for audio (ASR + VAD) model pack origins. Used by
// build-audio-release.js to prepare the GitHub `audio-models` release —
// the sibling of ocr-model-sources.js / build-ocr-release.js.
//
// Upstream is k2-fsa/sherpa-onnx's pre-converted model releases, repackaged
// as flat zips from an extracted local copy; `sourceDir` pins the vetted
// upstream artifact. Bump `version` when swapping in newer weights.
// Design notes: docs/design/tooling.md §3.

const UPSTREAM_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

const RELEASE_BASE_URL =
  'https://github.com/Tianao0110/T-Translate/releases/download/audio-models';

const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const ZIPFORMER_DIR = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20';

// Required pack: the final-pass engine (punctuation + ITN) plus the VAD
// that gates it.
const ASR_BASE_PACK = {
  id: 'asr-base-sense-voice',
  type: 'asr-base',
  version: '1.0.0',
  model: SENSE_VOICE_DIR,
  file: 'asr-base-sense-voice.zip',
  languages: ['zh', 'en', 'ja', 'ko', 'yue'],
  // Role -> installed filename (electron/listen/asr-models.js reads it).
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

// Optional pack: the two-pass draft engine. Absent = pseudo-streaming drafts.
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

// Optional pack: the high-accuracy final-pass engine (Qwen3-ASR 0.6B).
// Replaces SenseVoice for finals when the user picks the tier; the VAD
// still comes from the base pack.
const QWEN3_ASR_DIR = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25';

const ASR_HQ_PACK = {
  id: 'asr-hq-qwen3-0.6b',
  type: 'asr-hq',
  version: '1.0.0',
  model: QWEN3_ASR_DIR,
  file: 'asr-hq-qwen3-0.6b.zip',
  engine: 'qwen3-asr',
  languages: [
    'zh', 'en', 'yue', 'ja', 'ko', 'hi', 'ar', 'de', 'fr', 'es', 'pt', 'id', 'it', 'ru', 'th', 'vi',
    'tr', 'ms', 'nl', 'sv', 'da', 'fi', 'pl', 'cs', 'fil', 'fa', 'el', 'hu', 'mk', 'ro',
  ],
  files: {
    convFrontend: 'conv_frontend.onnx',
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    // A directory: sherpa opens vocab.json / merges.txt by path inside it.
    tokenizer: 'tokenizer',
  },
  sources: [
    { dir: QWEN3_ASR_DIR, file: 'conv_frontend.onnx' },
    { dir: QWEN3_ASR_DIR, file: 'encoder.int8.onnx' },
    { dir: QWEN3_ASR_DIR, file: 'decoder.int8.onnx' },
    { dir: QWEN3_ASR_DIR, tree: 'tokenizer' },
  ],
  licenses: ['LICENSE-qwen3-asr.txt'],
  license: 'Apache-2.0 (Qwen3-ASR-0.6B, Qwen team / Alibaba Cloud; ONNX export by Wasser1462 via sherpa-onnx)',
  upstream: [`${UPSTREAM_BASE}/${QWEN3_ASR_DIR}.tar.bz2`],
  // Link-only pack (`manual`, no `file`): the app ships the same entry in
  // electron/shared/audio-packs.js (MANUAL_PACKS); a unit test keeps the two
  // in step.
  manual: { dir: QWEN3_ASR_DIR, url: `${UPSTREAM_BASE}/${QWEN3_ASR_DIR}.tar.bz2`, archive: 'tar.bz2' },
};

// ===== Neural voice packs =====
// Same release, same manifest, different root (tts-models) and manager.
// These carry whole directories (`tree` sources, zipped with relative
// paths). fp32 weights on purpose (docs/design/tooling.md §3).

const TTS_UPSTREAM_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

const KOKORO_DIR = 'kokoro-multi-lang-v1_1';
const MELO_DIR = 'vits-melo-tts-zh_en';

// Kokoro v1.1-zh, 103 speakers: 0-1 US English female, 2 British English
// female, 3-57 Chinese female, 58-102 Chinese male. English goes through
// espeak-ng (GPL-3 data, shipped in the pack), Chinese through jieba.
const TTS_KOKORO_PACK = {
  id: 'tts-kokoro-zh-en',
  type: 'tts-voice',
  version: '1.0.0',
  model: KOKORO_DIR,
  file: 'tts-kokoro-zh-en.zip',
  languages: ['zh', 'en'],
  engine: 'kokoro',
  sampleRate: 24000,
  files: {
    model: 'model.onnx',
    voices: 'voices.bin',
    tokens: 'tokens.txt',
    dataDir: 'espeak-ng-data',
    dictDir: 'dict',
    lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'],
    ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'],
  },
  voiceGroups: [
    { from: 0, to: 1, lang: 'en', gender: 'f' },
    { from: 2, to: 2, lang: 'en', gender: 'f' },
    { from: 3, to: 57, lang: 'zh', gender: 'f' },
    { from: 58, to: 102, lang: 'zh', gender: 'm' },
  ],
  // Shown unfolded in the picker; the rest sit behind "all voices".
  featured: [0, 1, 2, 3, 4, 5, 58, 59, 60],
  preferMixed: false,
  sources: [
    { dir: KOKORO_DIR, file: 'model.onnx' },
    { dir: KOKORO_DIR, file: 'voices.bin' },
    { dir: KOKORO_DIR, file: 'tokens.txt' },
    { dir: KOKORO_DIR, file: 'lexicon-us-en.txt' },
    { dir: KOKORO_DIR, file: 'lexicon-zh.txt' },
    { dir: KOKORO_DIR, file: 'date-zh.fst' },
    { dir: KOKORO_DIR, file: 'number-zh.fst' },
    { dir: KOKORO_DIR, file: 'phone-zh.fst' },
    { dir: KOKORO_DIR, tree: 'espeak-ng-data' },
    { dir: KOKORO_DIR, tree: 'dict' },
  ],
  licenses: ['LICENSE-kokoro.txt', 'LICENSE-espeak-ng.txt'],
  license:
    'Apache-2.0 (Kokoro-82M v1.1-zh, hexgrad; sherpa-onnx export) + GPL-3.0 (espeak-ng-data phoneme data, espeak-ng project)',
  upstream: [`${TTS_UPSTREAM_BASE}/${KOKORO_DIR}.tar.bz2`],
};

// MeloTTS zh_en: one female speaker trained on mixed Chinese / English; the
// pack the renderer prefers for mixed text. No espeak-ng needed.
const TTS_MELO_PACK = {
  id: 'tts-melo-zh-en',
  type: 'tts-voice',
  version: '1.0.0',
  model: MELO_DIR,
  file: 'tts-melo-zh-en.zip',
  languages: ['zh', 'en'],
  engine: 'vits',
  sampleRate: 44100,
  files: {
    model: 'model.onnx',
    tokens: 'tokens.txt',
    lexicon: ['lexicon.txt'],
    dictDir: 'dict',
    ruleFsts: ['date.fst', 'number.fst', 'phone.fst', 'new_heteronym.fst'],
  },
  voiceGroups: [{ from: 0, to: 0, lang: 'zh', gender: 'f' }],
  featured: [0],
  preferMixed: true,
  // Speed chosen by ear.
  speedScale: { zh: 0.9, en: 1 },
  sources: [
    { dir: MELO_DIR, file: 'model.onnx' },
    { dir: MELO_DIR, file: 'tokens.txt' },
    { dir: MELO_DIR, file: 'lexicon.txt' },
    { dir: MELO_DIR, file: 'date.fst' },
    { dir: MELO_DIR, file: 'number.fst' },
    { dir: MELO_DIR, file: 'phone.fst' },
    { dir: MELO_DIR, file: 'new_heteronym.fst' },
    { dir: MELO_DIR, tree: 'dict' },
  ],
  licenses: ['LICENSE-melo-tts.txt'],
  license: 'MIT (MeloTTS, MyShell.ai; sherpa-onnx export)',
  upstream: [`${TTS_UPSTREAM_BASE}/${MELO_DIR}.tar.bz2`],
};

module.exports = {
  UPSTREAM_BASE,
  RELEASE_BASE_URL,
  PACKS: [ASR_BASE_PACK, ASR_DRAFT_PACK, ASR_HQ_PACK, TTS_KOKORO_PACK, TTS_MELO_PACK],
};
