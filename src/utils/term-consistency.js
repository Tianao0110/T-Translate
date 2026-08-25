import { applyGlossary, isUsableTerm, termAppliesTo, termHonoured } from '../stack/glossary.js';

/**
 * Check a translated document against the glossary.
 *
 * The glossary is applied per translation as it happens, so a document only
 * drifts in two ways: it was translated before a term was added (or with the
 * glossary switch off), or the model rendered a term as something else.
 *
 * Those two need different treatment, and only the first can be fixed without
 * asking a model anything:
 *
 *   fixable — the model left the source term in place, so the canonical
 *             rendering can be substituted for it. Deterministic.
 *   review  — the source term is in the paragraph but its canonical rendering
 *             is not in the translation, and there is no source term left to
 *             replace. The model rendered it as *something*, and nothing in
 *             the string says which span that was. Reported for the reader to
 *             judge, never rewritten by guesswork.
 *
 * Note what this cannot see: a rendering that CONTAINS the canonical one
 * ("张量积" contains "张量") reads as honoured here. That is not a bug to paper
 * over — the two may well be different terms — and catching it needs the
 * source-to-target alignment that the drift pass asks a model for.
 *
 * @param {Array} segments document segments
 * @param {Array<{source: string, target: string}>} terms from getGlossaryTerms()
 * @returns {{fixable: Array, review: Array, checked: number}}
 */
export function scanDocumentTerms(segments, terms) {
  const usable = (terms || []).filter(isUsableTerm);
  const fixable = [];
  const review = [];
  let checked = 0;

  if (!usable.length) return { fixable, review, checked };

  for (const segment of segments || []) {
    const original = segment?.original;
    const translated = segment?.translated;
    if (!original || !translated) continue;

    const relevant = usable.filter((term) => termAppliesTo(term, original));
    if (!relevant.length) continue;
    checked += 1;

    const { text, replacements } = applyGlossary(translated, relevant);
    if (replacements.length) {
      fixable.push({ segmentId: segment.id, before: translated, after: text, replacements });
    }

    // Judged against the post-replacement text: a term fixed above is honoured.
    for (const term of relevant) {
      if (!termHonoured(term, text)) {
        review.push({ segmentId: segment.id, source: term.source, canonical: term.target });
      }
    }
  }

  return { fixable, review, checked };
}
