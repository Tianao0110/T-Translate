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
  // v6-small is a single 50-language model; the exposed subset is the one
  // verified against its dictionary (src/config/ocr-languages.js).
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

// Optional high-accuracy base variant (PP-OCRv6 medium): not bundled, not a
// language pack; users opt in via the model-tier control in OCR settings.
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

// Kept in the release manifest for apps shipped before the v6 base swap.
// Never bump or change these (docs/design/tooling.md §3).
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
    // Upstream's "ka" archive is Kannada, not Georgian.
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

// Layout analysis for PDF documents: PaddlePaddle's official ONNX export of
// PP-DocLayoutV3 (Apache-2.0). Upstream ships loose files, so the release
// builder zips them with the license notice; each source is pinned.
const LAYOUT_UPSTREAM = 'https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx/resolve/main';
const LAYOUT_PACK = {
  id: 'layout-v3',
  type: 'layout',
  version: '1.0.0',
  file: 'pp_doclayout_v3.zip',
  sources: {
    'inference.onnx': {
      url: `${LAYOUT_UPSTREAM}/inference.onnx`,
      sha256: '45bf71750b00739a41fc209f132eb104a4d6b5bb29483c9078164d8b87cf28ba',
    },
    'inference.yml': {
      url: `${LAYOUT_UPSTREAM}/inference.yml`,
      sha256: '506fcfac13b3b546ae40d7886b44126420f392adb694e3f8bb6a6286a1f90fdc',
    },
  },
  notice: 'PP-DocLayoutV3 by PaddlePaddle, licensed under the Apache License 2.0.\n'
    + 'Source: https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_onnx\n'
    + 'License: https://www.apache.org/licenses/LICENSE-2.0\n',
  files: { model: 'inference.onnx', config: 'inference.yml' },
};

// Where the app downloads packs from at runtime (the user-controlled release).
const RELEASE_BASE_URL = 'https://github.com/Tianao0110/T-Translate/releases/download/ocr-models';

module.exports = { UPSTREAM_BASE, BASE_PACK, HQ_PACK, LANG_PACKS, LEGACY_PACKS, LAYOUT_PACK, RELEASE_BASE_URL };
