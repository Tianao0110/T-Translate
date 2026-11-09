// Which language a shared-script text is in, voted from up to four
// detectors: ELD and fastText first, CLD3 and franc for what those two cannot
// settle. Labels become catalogue codes here; language-id.js runs the
// detectors. Rules and measurements: docs/design/stack.md §8.

// Catalogue codes each detector can answer (pinned package versions).
const ELD_LANGUAGES = new Set([
  'am', 'ar', 'az', 'be', 'bg', 'bn', 'ca', 'ckb', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fr',
  'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'is', 'it', 'ja', 'ka', 'kn', 'ko', 'lo', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl',
  'no', 'or', 'pa', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sq', 'sr', 'sv', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur',
  'vi', 'yo', 'zh',
]);

const FASTTEXT_LANGUAGES = new Set([
  'af', 'am', 'ar', 'as', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'ckb', 'co', 'cs', 'cy', 'da', 'de', 'dv', 'el',
  'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'gom', 'gu', 'he', 'hi', 'hr', 'ht',
  'hu', 'hy', 'id', 'ilo', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'la', 'lb', 'lo', 'lt',
  'lv', 'mai', 'mg', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'no', 'or', 'pa', 'pl', 'ps', 'pt', 'qu',
  'ro', 'ru', 'sa', 'sd', 'si', 'sk', 'sl', 'so', 'sq', 'sr', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl',
  'tr', 'tt', 'ug', 'uk', 'ur', 'uz', 'vi', 'yi', 'yo', 'zh',
]);

const CLD3_LANGUAGES = new Set([
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'co', 'cs', 'cy', 'da', 'de', 'el', 'en', 'eo', 'es',
  'et', 'eu', 'fa', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gu', 'ha', 'haw', 'he', 'hi', 'hmn', 'hr', 'ht', 'hu', 'hy',
  'id', 'ig', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'la', 'lb', 'lo', 'lt', 'lv', 'mg',
  'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'no', 'ny', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd',
  'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tl', 'tr', 'uk',
  'ur', 'uz', 'vi', 'xh', 'yi', 'yo', 'zh', 'zu',
]);

// franc answers in ISO 639-3; only languages ELD does not know are listed.
const FRANC_CODES = {
  afr: 'af', ayr: 'ay', bam: 'bm', bho: 'bho', bos: 'bs', ceb: 'ceb', epo: 'eo', ewe: 'ee', glg: 'gl', hat: 'ht',
  hau: 'ha', hnj: 'hmn', ibo: 'ig', ilo: 'ilo', ind: 'id', jav: 'jw', kaz: 'kk', khk: 'mn', kin: 'rw', kir: 'ky',
  lin: 'ln', lug: 'lg', mai: 'mai', mkd: 'mk', npi: 'ne', nso: 'nso', nya: 'ny', plt: 'mg', quy: 'qu', quz: 'qu',
  sna: 'sn', som: 'so', sot: 'st', sun: 'su', swh: 'sw', tat: 'tt', tgk: 'tg', tso: 'ts', tuk: 'tk', uig: 'ug',
  uzn: 'uz', xho: 'xh', zul: 'zu',
};

// Languages only CLD3 / franc know.
const FILLER_LANGUAGES = new Set([
  'ay', 'bho', 'bm', 'ee', 'ha', 'haw', 'hmn', 'ig', 'lg', 'ln', 'mi', 'nso', 'ny', 'rw', 'sm', 'sn', 'st', 'ts',
  'xh', 'zu',
]);

const FASTTEXT_ALONE = 0.7;
const CLD3_ALONE = 0.95;
const FRANC_MARGIN = 0.15;

const ARABIC = /\p{Script=Arabic}/u;
const ALIASES = { fil: 'tl', iw: 'he', jv: 'jw' };

// Kurdish: Sorani is written in Arabic letters, Kurmanji in Latin.
const kurdish = (text) => (ARABIC.test(text) ? 'ckb' : 'ku');

export function fromEld(label) {
  const code = label === 'ku' ? 'ckb' : label;
  return ELD_LANGUAGES.has(code) ? code : null;
}

export function fromFastText(label, text) {
  const code = label === 'ku' ? kurdish(text) : ALIASES[label] || label;
  return FASTTEXT_LANGUAGES.has(code) ? code : null;
}

export function fromCld3(label, text) {
  const code = label === 'ku' ? kurdish(text) : ALIASES[label] || label;
  return CLD3_LANGUAGES.has(code) ? code : null;
}

export function fromFranc(label) {
  return FRANC_CODES[label] || null;
}

// Answers: eld { code, reliable }, fasttext { code, score },
// cld3 { code, reliable, score }, franc { code, margin }; null for a
// detector that is not loaded.

// Both name it, or fastText alone is sure of a language ELD does not know.
export function voteFirst(eld, fasttext) {
  if (!fasttext) return eld?.reliable ? eld.code : null;
  const ftAlone = fasttext.code && fasttext.score >= FASTTEXT_ALONE ? fasttext.code : null;
  if (!eld) return ftAlone;
  if (eld.reliable && eld.code && fasttext.code === eld.code) return eld.code;
  return ftAlone && !ELD_LANGUAGES.has(ftAlone) ? ftAlone : null;
}

// After voteFirst: a filler sure of a language only it knows, else two of
// fastText / CLD3 / franc naming one ELD does not know.
export function voteFillers(fasttext, cld3, franc) {
  if (cld3?.reliable && cld3.score >= CLD3_ALONE && FILLER_LANGUAGES.has(cld3.code)) return cld3.code;
  if (franc && franc.margin >= FRANC_MARGIN && FILLER_LANGUAGES.has(franc.code)) return franc.code;
  const votes = [fasttext?.code, cld3?.reliable ? cld3.code : null, franc?.code].filter(Boolean);
  const twice = votes.find((code, i) => votes.indexOf(code) !== i);
  return twice && !ELD_LANGUAGES.has(twice) ? twice : null;
}
