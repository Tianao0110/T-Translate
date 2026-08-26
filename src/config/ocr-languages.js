import { LANGUAGES } from './languages.js';

/**
 * Which languages the local OCR engine can actually read, grouped by the model
 * pack that unlocks them.
 *
 * Every entry here was verified against the pack's own dictionary file and, for
 * the bundled base pack, against a real recognition run — not against upstream
 * documentation, which turned out to be wrong in both directions. The rule for
 * inclusion is that the writing system is present, not merely the script:
 *
 *   - Vietnamese is excluded. It looks like ordinary Latin and the base
 *     dictionary has ă â đ ê ô ơ ư, but not one stacked tone mark. A real run
 *     returned "Tôi đang hc ting Vit" at confidence 0.985 — every tone silently
 *     dropped, which reads as plausible text and translates to nonsense.
 *   - Greek is excluded for the same reason: the base dictionary carries 76
 *     Greek letters (they are there as maths symbols) but none of the accented
 *     ones, so real Greek comes back with its accents stripped.
 *   - Mongolian, Kazakh and Tajik are excluded from the Cyrillic pack — its
 *     dictionary has none of ө ү ғ қ ң.
 *   - Uzbek is excluded from the base pack: oʻ and gʻ are productive letters
 *     and the okina is missing.
 *
 * Ukrainian (missing ї) and Macedonian (missing ѓ ѕ ќ) are included: a handful
 * of glyphs come back wrong, which is worth far more than the alternative of
 * not offering the language at all.
 *
 * This table is mirrored by LANGUAGE_TO_PACK in electron/shared/ocr-packs.js,
 * which the main-process engine uses to resolve a model pack. The renderer
 * cannot import main-process code, so `npm run check:languages` fails the build
 * if the two drift apart.
 */
export const OCR_LANGUAGE_GROUPS = [
  {
    packId: 'base-v6',
    // Bundled with the installer — nothing to download.
    languages: [
      'zh-Hans', 'zh-Hant', 'en', 'ja',
      'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi',
      'pl', 'cs', 'sk', 'sl', 'hr', 'bs', 'ro', 'hu', 'tr', 'sq',
      'lv', 'lt', 'et', 'is', 'ga', 'cy', 'mt', 'ca', 'gl', 'eu',
      'af', 'az', 'id', 'ms', 'tl', 'sw', 'la',
    ],
  },
  { packId: 'korean', languages: ['ko'] },
  { packId: 'cyrillic', languages: ['ru', 'uk', 'be', 'bg', 'sr', 'mk'] },
  { packId: 'devanagari', languages: ['hi', 'mr', 'ne', 'sa'] },
  { packId: 'arabic', languages: ['ar', 'fa', 'ur', 'ug'] },
  // One script each — these three share no alphabet with anything else.
  { packId: 'tamil', languages: ['ta'] },
  { packId: 'telugu', languages: ['te'] },
  { packId: 'kannada', languages: ['kn'] },
];

export const OCR_LANGUAGE_TO_PACK = Object.fromEntries([
  ['auto', 'base-v6'],
  ...OCR_LANGUAGE_GROUPS.flatMap((g) => g.languages.map((code) => [code, g.packId])),
]);

// The OCR setting distinguishes the two Chinese scripts; the shared catalogue
// is about translation, where the distinction is region.
const CATALOGUE_ALIAS = { 'zh-Hans': 'zh', 'zh-Hant': 'zh-TW' };

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Display name for an OCR language code, in the interface language. */
export function ocrLanguageName(code, uiLanguage = 'zh') {
  const entry = byCode.get(CATALOGUE_ALIAS[code] || code);
  if (!entry) return code;
  if (code === 'zh-Hans') return uiLanguage === 'en' ? 'Chinese (Simplified)' : '简体中文';
  return uiLanguage === 'en' ? entry.en : entry.name;
}
