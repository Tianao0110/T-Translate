// Voice selection for the neural TTS engine: pure, so the rules that decide
// which pack and speaker read a given text can be unit-tested without a
// bridge. Voices come from the main process as {id:'pack:sid', packId, sid,
// lang, gender, featured, preferMixed, languages}.

const CJK_RE = /[㐀-鿿豈-﫿]/;
const LATIN_WORD_RE = /[A-Za-z]{2,}/;

export function normalizeLang(lang) {
  if (!lang || typeof lang !== 'string') return '';
  const base = lang.toLowerCase().split(/[-_]/)[0];
  if (base === 'auto') return '';
  if (base === 'yue' || base === 'cmn') return 'zh';
  return base;
}

// Script-based guess for auto mode: CJK ideographs = zh, Latin letters = en.
export function detectTextLang(text) {
  if (!text) return '';
  if (CJK_RE.test(text)) return 'zh';
  if (LATIN_WORD_RE.test(text)) return 'en';
  return '';
}

// A sentence that switches between Chinese and English mid-way. kokoro's
// Chinese speakers read the English part with a heavy accent; MeloTTS was
// trained on exactly this kind of text, so a pack flagged preferMixed wins.
export function isMixedText(text) {
  return !!text && CJK_RE.test(text) && LATIN_WORD_RE.test(text);
}

function supports(voice, lang) {
  if (!lang) return true;
  return voice.lang === lang || (Array.isArray(voice.languages) && voice.languages.includes(lang));
}

/**
 * voiceByLang: the user's per-language choice ({ zh: 'pack:sid', en: ... }),
 * treated as the default for that language — a mixed sentence still goes to
 * the preferMixed pack when one is installed. voiceId is the legacy single
 * choice and wins outright as long as its pack can read the language.
 * @returns the voice to use, or null when no installed pack covers the text
 *   (the caller falls back to system voices for that utterance).
 */
export function pickVoice(voices, { voiceByLang = {}, voiceId = '', lang = '', text = '' } = {}) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const want = normalizeLang(lang) || detectTextLang(text);

  // An explicit choice wins as long as its pack can read this language at
  // all; a Chinese-only pack asked to read Japanese falls through to auto.
  if (voiceId) {
    const chosen = voices.find((v) => v.id === voiceId);
    if (chosen && supports(chosen, want)) return chosen;
  }

  if (isMixedText(text)) {
    const mixed = voices.filter((v) => v.preferMixed);
    if (mixed.length) return mixed.find((v) => v.featured) || mixed[0];
  }

  const pinnedId = want && voiceByLang ? voiceByLang[want] : '';
  if (pinnedId) {
    const pinned = voices.find((v) => v.id === pinnedId);
    if (pinned) return pinned;
  }

  // Native voices first; a pack whose single speaker covers both languages
  // (MeloTTS is 'zh' but reads 'en') still counts before giving up.
  let candidates = want ? voices.filter((v) => v.lang === want) : voices;
  if (!candidates.length && want) candidates = voices.filter((v) => supports(v, want));
  if (!candidates.length) return null;
  return candidates.find((v) => v.featured) || candidates[0];
}
