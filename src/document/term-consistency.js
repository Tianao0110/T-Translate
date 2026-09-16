import { applyGlossary, isUsableTerm, termAppliesTo } from '../stack/glossary.js';

/**
 * Find glossary terms a translated document left in the source language.
 * Only that one case is reported (docs/design/renderer.md §5).
 *
 * @param {Array} segments document segments
 * @param {Array<{source: string, target: string}>} terms from getGlossaryTerms()
 * @returns {{fixable: Array<{segmentId, before, replacements}>, checked: number}}
 */
export function scanDocumentTerms(segments, terms) {
  const usable = (terms || []).filter(isUsableTerm);
  const fixable = [];
  let checked = 0;

  if (!usable.length) return { fixable, checked };

  for (const segment of segments || []) {
    const original = segment?.original;
    const translated = segment?.translated;
    if (!original || !translated) continue;

    // The term has to have been in this paragraph's source.
    const relevant = usable.filter((term) => termAppliesTo(term, original));
    if (!relevant.length) continue;
    checked += 1;

    const { replacements } = applyGlossary(translated, relevant);
    if (replacements.length) {
      fixable.push({ segmentId: segment.id, before: translated, replacements });
    }
  }

  return { fixable, checked };
}

/**
 * The translation as it stands with only the still-active replacements
 * applied, recomputed from the untouched original.
 */
export function renderWithReplacements(before, replacements, isActive) {
  const active = replacements
    .filter((r) => isActive(r.from))
    .map((r) => ({ source: r.from, target: r.to }));
  return active.length ? applyGlossary(before, active).text : before;
}
