// Text utilities: language detection, output cleaning, similarity.

export function detectLanguage(text) {
  if (!text) return 'auto';

  // Kana before Han: Japanese mixes kana with kanji, so checking Han first
  // misfiles Japanese as Chinese (which then wrongly flips ja→zh into ja→en).
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[一-龥]/.test(text)) return 'zh';
  return 'en';
}

// What to do when the detected language already equals the target.
// 'original' (default): show the source untranslated, no provider call.
// 'swap': legacy zh<->en flip. Both behaviors were requested at different
// times (flip 2026-06-10, passthrough 2026-07-10), so it's a setting now —
// settings.translation.sameLanguageBehavior, shared by the selection window
// and the floating window.
export function resolveSameLanguageTarget(detected, targetLang, behavior = 'original') {
  if (!targetLang || detected !== targetLang) {
    return { targetLang, passthrough: false };
  }
  if (behavior === 'swap') {
    return { targetLang: targetLang === 'zh' ? 'en' : 'zh', passthrough: false };
  }
  return { targetLang, passthrough: true };
}

export function cleanText(text) {
  if (!text) return '';

  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Strips LLM artifacts (prefix labels, wrapping quotes, parenthetical notes)
// and discards output that's identical to the source.
export function cleanTranslationOutput(text, source = '') {
  if (!text) return '';

  let cleaned = text
    .replace(/^(翻译[：:]\s*|Translation[：:]\s*|译文[：:]\s*)/i, '')
    .replace(/^["'「」『』""''【】]|["'「」『』""''【】]$/g, '')
    .replace(/\s*（[^）]*）/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();

  if (cleaned === source) return '';

  return cleaned;
}

export function shouldTranslateText(text) {
  if (!text || text.length < 2) return false;

  const clean = text.trim();

  // Pure digits/punctuation/symbols — nothing to translate
  if (/^[\d\s\p{P}\p{S}]+$/u.test(clean)) return false;

  // Two letters or fewer of English is usually noise (e.g. UI initials)
  if (clean.length < 3 && /^[a-z]+$/i.test(clean)) return false;

  // Already a translation marker ("译: ...")
  if (/^译[：:]/.test(clean)) return false;

  return true;
}

// Jaccard similarity on character sets, scaled to 0-100
export function textSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 100;

  const set1 = new Set(text1.toLowerCase().split(''));
  const set2 = new Set(text2.toLowerCase().split(''));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return Math.round((intersection.size / union.size) * 100);
}

export function getLanguageName(code) {
  try {
    const i18n = require('../i18n.js').default;
    const key = `languages.${code}`;
    const result = i18n.t(key);
    if (result !== key) return result;
  } catch {}

  const names = {
    'auto': '自动',
    'zh': '中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'ru': 'Русский',
  };
  return names[code] || code;
}

export default {
  detectLanguage,
  resolveSameLanguageTarget,
  cleanText,
  cleanTranslationOutput,
  shouldTranslateText,
  textSimilarity,
  getLanguageName,
};
