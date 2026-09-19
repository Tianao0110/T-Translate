// Glossary replacement, shared by the translation stack (which applies it to
// every translation, cached or fresh) and the renderer (which re-applies it to
// a document that was translated before a term existed).
//
// It rewrites the translated text and only acts on a term the model left in
// the source language; the document's term-drift pass covers the rest.
// Matching and language rules: docs/design/stack.md §3.

// Single-character terms are skipped.
const MIN_TERM_LENGTH = 2;

// Letters and digits of the scripts that put spaces between words (Latin,
// Greek, Cyrillic). A term edge made of these matches at a word boundary only.
const WORD_CHARS = 'A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u052F';
const WORD_CHAR = new RegExp(`[${WORD_CHARS}]`);

// Case-insensitive matcher for one term source.
export function termRegex(source) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = WORD_CHAR.test(source[0]) ? `(?<![${WORD_CHARS}])` : '';
  const tail = WORD_CHAR.test(source[source.length - 1]) ? `(?![${WORD_CHARS}])` : '';
  return new RegExp(`${head}${escaped}${tail}`, 'gi');
}

/**
 * @param {string} translatedText
 * @param {Array<{source: string, target: string}>} glossaryTerms
 * @returns {{text: string, replacements: Array<{from: string, to: string}>}}
 */
export function applyGlossary(translatedText, glossaryTerms) {
  if (!translatedText || !glossaryTerms || glossaryTerms.length === 0) {
    return { text: translatedText, replacements: [] };
  }

  let result = translatedText;
  const replacements = [];

  // Longer terms first.
  const sorted = [...glossaryTerms].sort((a, b) => b.source.length - a.source.length);

  for (const term of sorted) {
    if (!term.source || !term.target) continue;
    if (term.source.length < MIN_TERM_LENGTH) continue;

    const replaced = result.replace(termRegex(term.source), () => term.target);
    if (replaced !== result) {
      result = replaced;
      replacements.push({ from: term.source, to: term.target });
    }
  }

  return { text: result, replacements };
}

export function isUsableTerm(term) {
  return !!term?.source && !!term?.target && term.source.length >= MIN_TERM_LENGTH;
}

/** Does this term's source appear in the passage it was supposed to cover? */
export function termAppliesTo(term, sourceText) {
  return isUsableTerm(term) && termRegex(term.source).test(String(sourceText || ''));
}

// Bounds of the glossary a window hands to the service (setGlossary).
const MAX_GLOSSARY_ITEMS = 5000;
const MAX_TERM_CHARS = 500;

/** Keeps the well-formed `{source, target, targetLanguage?}` items, within bounds. */
export function sanitizeGlossaryItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= MAX_GLOSSARY_ITEMS) break;
    if (!item || typeof item.source !== 'string' || typeof item.target !== 'string') continue;
    if (!item.source || !item.target) continue;
    if (item.source.length > MAX_TERM_CHARS || item.target.length > MAX_TERM_CHARS) continue;
    out.push({
      source: item.source,
      target: item.target,
      ...(typeof item.targetLanguage === 'string' && item.targetLanguage
        ? { targetLanguage: item.targetLanguage.slice(0, 32) }
        : {}),
    });
  }
  return out;
}

/**
 * The terms one translation may use. A term saved for another target language
 * is left out; one saved for this language beats a language-less one with the
 * same source. `bound` says the term was saved for exactly this language.
 *
 * @param {Array<{source: string, target: string, targetLanguage?: string}>} items
 * @param {string} [targetLanguage]
 * @returns {Array<{source: string, target: string, bound: boolean}>}
 */
export function pickTermsForTarget(items, targetLanguage) {
  const all = (items || []).filter((item) => item && item.source && item.target);
  const usable = targetLanguage
    ? all.filter((item) => !item.targetLanguage || item.targetLanguage === targetLanguage)
    : all;

  const bySource = new Map();
  for (const item of usable) {
    const key = item.source.toLowerCase();
    const held = bySource.get(key);
    const isExact = !!targetLanguage && item.targetLanguage === targetLanguage;
    const heldIsExact = !!targetLanguage && held?.targetLanguage === targetLanguage;
    if (!held || (isExact && !heldIsExact)) bySource.set(key, item);
  }

  return [...bySource.values()].map((item) => ({
    source: item.source,
    target: item.target,
    bound: !!targetLanguage && item.targetLanguage === targetLanguage,
  }));
}

/**
 * The glossary pass of one translation. A term bound to the target language
 * applies wherever it was left untranslated; a language-less term only when
 * the source text contained it.
 */
export function glossaryPass(translatedText, terms, sourceText) {
  const usable = (terms || []).filter((term) => term?.bound === true || termAppliesTo(term, sourceText));
  return applyGlossary(translatedText, usable);
}
