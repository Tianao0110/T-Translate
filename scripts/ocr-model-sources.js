// Single source of truth for OCR model pack origins. Used by
// fetch-ocr-models.js (bundles the base pack into the installer) and
// build-ocr-release.js (prepares the GitHub `ocr-models` release).
//
// Upstream: eSearch-OCR's model storage release (Apache-2.0, converted from
// official PaddleOCR models). Bump `version` when swapping in newer files —
// installed apps compare it against their local pack.json to offer updates.

const UPSTREAM_BASE = 'https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0';

const BASE_PACK = {
  id: 'base-v6',
  type: 'base',
  gen: 'v6',
  version: '1.0.0',
  file: 'ppocr_v6_small.zip',
  url: `${UPSTREAM_BASE}/ppocr_v6_small.zip`,
  // v6-small is a single 50-language model. The exposed subset is the one
  // verified against its dictionary — see src/config/ocr-languages.js for why
  // Vietnamese and Greek are absent despite the scripts looking covered.
  languages: [
    'zh-Hans', 'zh-Hant', 'en', 'ja',
    'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi',
    'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ro', 'hu', 'tr', 'sq',
    'lv', 'lt', 'et', 'is', 'ga', 'cy', 'mt', 'ca', 'gl', 'eu',
    'af', 'az', 'id', 'ms', 'tl', 'sw', 'la',
  ],
  files: {
    det: 'ppocr6_small_det.onnx',
    rec: 'ppocr6_small_rec.onnx',
    dict: 'dic.txt',
  },
};

// Optional high-accuracy base variant (PP-OCRv6 medium). Not bundled into the
// installer, not a language pack: users opt in via the model-tier control in
// OCR settings and the engine swaps it in for the base det/rec. Its type keeps
// it out of the base row and the language-pack list in every client generation.
const HQ_PACK = {
  id: 'base-v6-hq',
  type: 'base-variant',
  gen: 'v6',
  version: '1.0.0',
  file: 'ppocr_v6_medium.zip',
  url: `${UPSTREAM_BASE}/ppocr_v6_medium.zip`,
  languages: ['zh-Hans', 'zh-Hant', 'en', 'ja', 'fr', 'de', 'es'],
  files: {
    det: 'ppocr6_medium_det.onnx',
    rec: 'ppocr6_medium_rec.onnx',
    dict: 'dic.txt',
  },
};

// Kept in the release manifest for apps shipped before the v6 base swap:
// their base-pack repair resolves 'base-v5', and their fr/de/es still map to
// the latin pack. Never bump/change these — old clients' engine enables the
// space heuristic for gen !== 'v5', so they must never receive v6 models.
const LEGACY_PACKS = [
  {
    id: 'base-v5',
    type: 'base',
    gen: 'v5',
    version: '1.0.0',
    file: 'ppocr_v5_mobile.zip',
    url: `${UPSTREAM_BASE}/ppocr_v5_mobile.zip`,
    languages: ['zh-Hans', 'zh-Hant', 'en', 'ja'],
    files: {
      det: 'ppocr_v5_mobile_det.onnx',
      rec: 'ppocr_v5_mobile_rec.onnx',
      dict: 'ppocrv5_dict.txt',
    },
  },
  {
    id: 'latin',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'latin.zip',
    url: `${UPSTREAM_BASE}/latin.zip`,
    languages: ['fr', 'de', 'es'],
    files: { rec: 'latin_rec.onnx', dict: 'latin_dict.txt' },
  },
];

const LANG_PACKS = [
  {
    id: 'korean',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'korean.zip',
    url: `${UPSTREAM_BASE}/korean.zip`,
    languages: ['ko'],
    files: { rec: 'korean_rec.onnx', dict: 'korean_dict.txt' },
  },
  {
    id: 'cyrillic',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'cyrillic.zip',
    url: `${UPSTREAM_BASE}/cyrillic.zip`,
    languages: ['ru', 'uk', 'be', 'bg', 'sr', 'mk'],
    files: { rec: 'cyrillic_rec.onnx', dict: 'cyrillic_dict.txt' },
  },
  {
    id: 'devanagari',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'devanagari.zip',
    url: `${UPSTREAM_BASE}/devanagari.zip`,
    languages: ['hi', 'mr', 'ne', 'sa'],
    files: { rec: 'devanagari_rec.onnx', dict: 'devanagari_dict.txt' },
  },
  {
    id: 'tamil',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'ta.zip',
    url: `${UPSTREAM_BASE}/ta.zip`,
    languages: ['ta'],
    files: { rec: 'ta_rec.onnx', dict: 'ta_dict.txt' },
  },
  {
    id: 'telugu',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'te.zip',
    url: `${UPSTREAM_BASE}/te.zip`,
    languages: ['te'],
    files: { rec: 'te_rec.onnx', dict: 'te_dict.txt' },
  },
  {
    // Upstream calls this one "ka" — Georgian's ISO code — but the model is
    // Kannada. Verified against its dictionary, not its filename.
    id: 'kannada',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'ka.zip',
    url: `${UPSTREAM_BASE}/ka.zip`,
    languages: ['kn'],
    files: { rec: 'ka_rec.onnx', dict: 'ka_dict.txt' },
  },
  {
    id: 'arabic',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'arabic.zip',
    url: `${UPSTREAM_BASE}/arabic.zip`,
    languages: ['ar', 'fa', 'ur', 'ug'],
    files: { rec: 'arabic_rec.onnx', dict: 'arabic_dict.txt' },
  },
];

// Where the app downloads packs from at runtime (the user-controlled release).
const RELEASE_BASE_URL = 'https://github.com/Tianao0110/T-Translate/releases/download/ocr-models';

module.exports = { UPSTREAM_BASE, BASE_PACK, HQ_PACK, LANG_PACKS, LEGACY_PACKS, RELEASE_BASE_URL };
