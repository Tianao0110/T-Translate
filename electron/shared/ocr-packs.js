// OCR model pack registry + pure helpers, shared by the engine, the pack
// manager, and unit tests. A "pack" is a folder of ONNX model files described
// by a pack.json; the base pack ships with the app, language packs are
// downloaded on demand from the GitHub `ocr-models` release.

const BASE_PACK_ID = 'base-v6';

// Optional high-accuracy base variant (PP-OCRv6 medium). When installed and
// the user has picked the high tier, the engine resolves base det/rec from
// this pack instead of BASE_PACK_ID. type 'base-variant' keeps it out of both
// the base row and the language-pack list in every client generation.
const HQ_PACK_ID = 'base-v6-hq';

// Which languages each recognition model can actually read. Mirrors
// OCR_LANGUAGE_GROUPS in src/config/ocr-languages.js, which documents how the
// list was verified and why Vietnamese, Greek, Uzbek and Mongolian are absent
// despite their scripts looking covered. The renderer cannot import this file,
// so `npm run check:languages` fails if the two drift apart.
// Detection is script-agnostic: every pack reuses the base det model.
const LANGUAGE_TO_PACK = {
  'auto': BASE_PACK_ID,
  // Bundled base pack — PP-OCRv6 small reads CJK, kana and Latin script.
  'zh-Hans': BASE_PACK_ID, 'zh-Hant': BASE_PACK_ID, 'en': BASE_PACK_ID, 'ja': BASE_PACK_ID,
  'fr': BASE_PACK_ID, 'de': BASE_PACK_ID, 'es': BASE_PACK_ID, 'it': BASE_PACK_ID,
  'pt': BASE_PACK_ID, 'nl': BASE_PACK_ID, 'sv': BASE_PACK_ID, 'da': BASE_PACK_ID,
  'no': BASE_PACK_ID, 'fi': BASE_PACK_ID, 'pl': BASE_PACK_ID, 'cs': BASE_PACK_ID,
  'sk': BASE_PACK_ID, 'sl': BASE_PACK_ID, 'hr': BASE_PACK_ID, 'bs': BASE_PACK_ID,
  'ro': BASE_PACK_ID, 'hu': BASE_PACK_ID, 'tr': BASE_PACK_ID, 'sq': BASE_PACK_ID,
  'lv': BASE_PACK_ID, 'lt': BASE_PACK_ID, 'et': BASE_PACK_ID, 'is': BASE_PACK_ID,
  'ga': BASE_PACK_ID, 'cy': BASE_PACK_ID, 'mt': BASE_PACK_ID, 'ca': BASE_PACK_ID,
  'gl': BASE_PACK_ID, 'eu': BASE_PACK_ID, 'af': BASE_PACK_ID, 'az': BASE_PACK_ID,
  'id': BASE_PACK_ID, 'ms': BASE_PACK_ID, 'tl': BASE_PACK_ID, 'sw': BASE_PACK_ID,
  'la': BASE_PACK_ID,
  // Downloadable packs — one recognition model per script family.
  'ko': 'korean',
  'ru': 'cyrillic', 'uk': 'cyrillic', 'be': 'cyrillic',
  'bg': 'cyrillic', 'sr': 'cyrillic', 'mk': 'cyrillic',
  'hi': 'devanagari', 'mr': 'devanagari', 'ne': 'devanagari', 'sa': 'devanagari',
  'ar': 'arabic', 'fa': 'arabic', 'ur': 'arabic', 'ug': 'arabic',
};

function packIdForLanguage(language) {
  return LANGUAGE_TO_PACK[language] || BASE_PACK_ID;
}

// "1.2.10" vs "1.3.0" — numeric per-segment compare, missing segments = 0.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Merge what's installed with what the manifest offers into one UI-ready list.
// installedPacks: [{ id, version, ... }] from disk scan
// manifest: { packs: [{ id, version, size, languages, ... }] } or null (offline)
// Returns [{ id, status: 'installed'|'update-available'|'not-installed'|'orphaned',
//            installedVersion?, ...manifestFields }]
function computePackList(installedPacks, manifest) {
  const installed = new Map((installedPacks || []).map((p) => [p.id, p]));
  const result = [];

  for (const mp of manifest?.packs || []) {
    // The manifest also carries entries for other app generations (their base
    // pack; packs absorbed into this build's base model). Skip what this
    // build can't use — a still-installed absorbed pack falls through to the
    // orphan branch below, staying visible and uninstallable.
    if (mp.type === 'base' && mp.id !== BASE_PACK_ID) continue;
    if (mp.type === 'lang' && !(mp.languages || []).some((l) => LANGUAGE_TO_PACK[l] === mp.id)) continue;

    const local = installed.get(mp.id);
    if (!local) {
      result.push({ ...mp, status: 'not-installed' });
    } else {
      installed.delete(mp.id);
      result.push({
        ...mp,
        status: compareVersions(mp.version, local.version) > 0 ? 'update-available' : 'installed',
        installedVersion: local.version,
      });
    }
  }

  // Installed but no longer in the manifest (or manifest unreachable):
  // still usable, still uninstallable — never hide what's on disk.
  for (const local of installed.values()) {
    if (local.id === BASE_PACK_ID) continue;
    result.push({ ...local, status: 'orphaned', installedVersion: local.version });
  }

  return result;
}

module.exports = {
  BASE_PACK_ID,
  HQ_PACK_ID,
  LANGUAGE_TO_PACK,
  packIdForLanguage,
  compareVersions,
  computePackList,
};
