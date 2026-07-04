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
  // v6-small is a single 50-language model (simp/trad Chinese, English,
  // Japanese + 46 Latin-script languages); the UI exposes fr/de/es.
  languages: ['zh-Hans', 'zh-Hant', 'en', 'ja', 'fr', 'de', 'es'],
  files: {
    det: 'ppocr6_small_det.onnx',
    rec: 'ppocr6_small_rec.onnx',
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
    languages: ['ru'],
    files: { rec: 'cyrillic_rec.onnx', dict: 'cyrillic_dict.txt' },
  },
  {
    id: 'devanagari',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'devanagari.zip',
    url: `${UPSTREAM_BASE}/devanagari.zip`,
    languages: ['hi'],
    files: { rec: 'devanagari_rec.onnx', dict: 'devanagari_dict.txt' },
  },
  {
    id: 'arabic',
    type: 'lang',
    gen: 'v4',
    version: '1.0.0',
    file: 'arabic.zip',
    url: `${UPSTREAM_BASE}/arabic.zip`,
    languages: ['ar'],
    files: { rec: 'arabic_rec.onnx', dict: 'arabic_dict.txt' },
  },
];

// Where the app downloads packs from at runtime (the user-controlled release).
const RELEASE_BASE_URL = 'https://github.com/Tianao0110/T-Translate/releases/download/ocr-models';

module.exports = { UPSTREAM_BASE, BASE_PACK, LANG_PACKS, LEGACY_PACKS, RELEASE_BASE_URL };
