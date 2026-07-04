// OCR model pack registry + pure helpers, shared by the engine, the pack
// manager, and unit tests. A "pack" is a folder of ONNX model files described
// by a pack.json; the base pack ships with the app, language packs are
// downloaded on demand from the GitHub `ocr-models` release.

const BASE_PACK_ID = 'base-v6';

// The base recognizer (PP-OCRv6 small) natively covers zh-Hans/zh-Hant/en/ja
// plus 46 Latin-script languages (fr/de/es exposed in the UI; the former
// latin pack is absorbed). Every other language maps to the pack whose
// recognition model unlocks it. Detection is script-agnostic: all packs
// reuse the base det model.
const LANGUAGE_TO_PACK = {
  'auto': BASE_PACK_ID,
  'zh-Hans': BASE_PACK_ID,
  'zh-Hant': BASE_PACK_ID,
  'en': BASE_PACK_ID,
  'ja': BASE_PACK_ID,
  'fr': BASE_PACK_ID,
  'de': BASE_PACK_ID,
  'es': BASE_PACK_ID,
  'ko': 'korean',
  'ru': 'cyrillic',
  'hi': 'devanagari',
  'ar': 'arabic',
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
  LANGUAGE_TO_PACK,
  packIdForLanguage,
  compareVersions,
  computePackList,
};
