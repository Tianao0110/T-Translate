import { LANGUAGES } from './languages.js';

/**
 * Which languages the local OCR engine can actually read, grouped by the
 * model pack that unlocks them. Every entry was verified against the pack's
 * dictionary and a real run; the exclusions and their reasons are in
 * docs/design/renderer.md §8. Mirrored by LANGUAGE_TO_PACK in
 * electron/shared/ocr-packs.js (`npm run check:languages`).
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
