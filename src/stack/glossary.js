// Glossary replacement, shared by the translation stack (which applies it to
// every fresh translation) and the renderer (which re-applies it to a document
// that was translated before a term existed).
//
// It rewrites the *translated* text, and it can only act on a term the model
// left in the source language. A term the model rendered as some other word is
// invisible here — nothing in the string says which span was meant to be that
// term. Finding those needs alignment, which is what the document's term-drift
// pass uses a model for.

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

  // Longer terms first so "API" doesn't pre-empt "API Key".
  const sorted = [...glossaryTerms].sort((a, b) => b.source.length - a.source.length);

  for (const term of sorted) {
    if (!term.source || !term.target) continue;
    if (term.source.length < MIN_TERM_LENGTH) continue;

    const sourceEscaped = term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sourceRegex = new RegExp(sourceEscaped, 'gi');

    if (sourceRegex.test(result)) {
      result = result.replace(sourceRegex, term.target);
      replacements.push({ from: term.source, to: term.target });
    }
  }

  return { text: result, replacements };
}

// Single-character terms match far too much to be worth replacing.
export const MIN_TERM_LENGTH = 2;

export function isUsableTerm(term) {
  return !!term?.source && !!term?.target && term.source.length >= MIN_TERM_LENGTH;
}

const lower = (s) => String(s || '').toLowerCase();

/** Does this term's source appear in the passage it was supposed to cover? */
export function termAppliesTo(term, sourceText) {
  return isUsableTerm(term) && lower(sourceText).includes(lower(term.source));
}

/** Is the canonical rendering present in the translation? */
export function termHonoured(term, translatedText) {
  return lower(translatedText).includes(lower(term.target));
}
