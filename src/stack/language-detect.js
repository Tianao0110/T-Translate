// Language judgment shared by the stack and every window: which language a
// text is mostly in, and whether it already reads as a target language.
// Callers: core/text.js, document/document-parser.js,
// translation/stack-client.js.

// [script, letters, unit, language its runs are labeled with]. Kana decides
// between zh and ja for the whole text (see scriptRuns).
const SCRIPTS = [
  ['cjk', '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Bopomofo}\\u30FC\\uFF70', 'char', 'zh'],
  ['hangul', '\\p{Script=Hangul}', 'char', 'ko'],
  ['thai', '\\p{Script=Thai}', 'char', 'th'],
  ['lao', '\\p{Script=Lao}', 'char', 'lo'],
  ['khmer', '\\p{Script=Khmer}', 'char', 'km'],
  ['myanmar', '\\p{Script=Myanmar}', 'char', 'my'],
  ['latin', '\\p{Script=Latin}', 'word', 'en'],
  ['cyrillic', '\\p{Script=Cyrillic}', 'word', 'ru'],
  ['arabic', '\\p{Script=Arabic}', 'word', 'ar'],
  ['devanagari', '\\p{Script=Devanagari}', 'word', 'hi'],
  ['greek', '\\p{Script=Greek}', 'word', 'el'],
  ['hebrew', '\\p{Script=Hebrew}', 'word', 'he'],
  ['armenian', '\\p{Script=Armenian}', 'word', 'hy'],
  ['georgian', '\\p{Script=Georgian}', 'word', 'ka'],
  ['bengali', '\\p{Script=Bengali}', 'word', 'bn'],
  ['gurmukhi', '\\p{Script=Gurmukhi}', 'word', 'pa'],
  ['gujarati', '\\p{Script=Gujarati}', 'word', 'gu'],
  ['oriya', '\\p{Script=Oriya}', 'word', 'or'],
  ['tamil', '\\p{Script=Tamil}', 'word', 'ta'],
  ['telugu', '\\p{Script=Telugu}', 'word', 'te'],
  ['kannada', '\\p{Script=Kannada}', 'word', 'kn'],
  ['malayalam', '\\p{Script=Malayalam}', 'word', 'ml'],
  ['sinhala', '\\p{Script=Sinhala}', 'word', 'si'],
  ['ethiopic', '\\p{Script=Ethiopic}', 'word', 'am'],
  ['thaana', '\\p{Script=Thaana}', 'word', 'dv'],
  ['meetei', '\\p{Script=Meetei_Mayek}', 'word', 'mni-Mtei'],
];

// Letters of any other script form runs of unknown language.
const OTHER = ['other', null, 'word', null];

// One alternative per script; the last one takes a single letter of any
// script not listed (Common / Inherited letters stay neutral).
const CHUNK_RE = new RegExp(
  [
    ...SCRIPTS.map(([, letters]) => `([${letters}][${letters}\\p{M}]*)`),
    '((?![\\p{Script=Common}\\p{Script=Inherited}])\\p{L})',
  ].join('|'),
  'gu'
);
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]/gu;
const LETTER_RE = /\p{L}/u;

// Longest run in another language that still reads as a name or a term:
// 3 words, or 4 characters in scripts counted per character.
const TERM_LIMIT = { word: 3, char: 4 };

const MAX_CHARS = 10000;

// Maximal same-script stretches; digits, spaces and punctuation between
// letters of one script stay inside its run. Units: characters for 'char'
// scripts, whitespace-separated words for the rest. CJK runs are ja when the
// text is all kana, or when kana written next to other CJK letters make up
// at least 5% of its CJK characters (a lone kana in a kaomoji does not).
function scriptRuns(text) {
  const sample = String(text || '').slice(0, MAX_CHARS);
  const runs = [];
  let cjk = 0;
  let kana = 0;
  let kanaInWords = 0;

  for (const m of sample.matchAll(CHUNK_RE)) {
    const index = m.slice(1).findIndex((group) => group !== undefined);
    const script = SCRIPTS[index] || OTHER;
    const chars = [...m[0]].length;
    if (script[0] === 'cjk') {
      const found = (m[0].match(KANA_RE) || []).length;
      cjk += chars;
      kana += found;
      if (chars > 1) kanaInWords += found;
    }
    const last = runs[runs.length - 1];
    if (last && last.script === script) {
      last.end = m.index + m[0].length;
      last.chars += chars;
    } else {
      runs.push({ script, start: m.index, end: m.index + m[0].length, chars });
    }
  }

  const japanese = kana > 0 && (kana === cjk || kanaInWords * 20 >= cjk);
  return runs.map(({ script, start, end, chars }) => {
    const [id, , unit, lang] = script;
    const units = unit === 'char'
      ? chars
      : sample.slice(start, end).split(/\s+/).filter((word) => LETTER_RE.test(word)).length;
    return { unit, units, lang: id === 'cjk' && japanese ? 'ja' : lang };
  });
}

function mostUnits(runs) {
  const totals = new Map();
  for (const run of runs) {
    if (run.lang) totals.set(run.lang, (totals.get(run.lang) || 0) + run.units);
  }
  let best = null;
  let bestUnits = 0;
  for (const [lang, units] of totals) {
    if (units > bestUnits) {
      best = lang;
      bestUnits = units;
    }
  }
  return best;
}

// Already in the target language: it holds most of the text and every other
// run is term-sized. Text without letters has nothing to translate.
function readsAs(runs, targetLang) {
  if (!runs.length) return true;
  if (!targetLang) return false;
  let target = 0;
  let other = 0;
  for (const run of runs) {
    if (run.lang === targetLang) {
      target += run.units;
    } else if (run.units > TERM_LIMIT[run.unit]) {
      return false;
    } else {
      other += run.units;
    }
  }
  return target > other;
}

// The language most of the text is in, or null when it has no letters of a
// known script.
export function mainLanguage(text) {
  return mostUnits(scriptRuns(text));
}

// { language, inTarget } for the same-language decision (core/text.js
// resolveSameLanguageTarget); language is 'auto' when unknown.
export function judgeLanguage(text, targetLang) {
  const runs = scriptRuns(text);
  return {
    language: mostUnits(runs) || 'auto',
    inTarget: readsAs(runs, targetLang),
  };
}
