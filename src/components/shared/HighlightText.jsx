// Shared search-term highlighter. History and Favorites used to carry
// near-identical copies (the Favorites one without memo or error handling
// for regex-hostile input).

import { memo } from 'react';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {string} [search] the search box's query
 * @param {string[]} [terms] extra strings to mark with a different class —
 *   used by the document to show which glossary terms it just substituted
 * @param {string} [termClassName]
 */
const HighlightText = memo(({ text, search, terms, termClassName = 'term-highlight' }) => {
  // Last line of defense: a non-string here (a stray result object from the
  // 0.3.x empty-translation bug) would be handed to React as a child and throw
  // #31, taking down the whole panel over one bad row. The store repairs those
  // on rehydrate; this makes the render path survive whatever slips past.
  if (typeof text !== 'string') return text == null ? null : String(text);

  const needles = [];
  if (search) needles.push({ value: search, className: 'search-highlight' });
  for (const term of terms || []) {
    if (term) needles.push({ value: term, className: termClassName });
  }
  if (!needles.length) return text;

  try {
    // Longest first: a term that contains another must win the match, or the
    // shorter one splits it and both render wrong.
    const sorted = [...needles].sort((a, b) => b.value.length - a.value.length);
    const pattern = new RegExp(`(${sorted.map((n) => escapeRe(n.value)).join('|')})`, 'gi');
    const parts = text.split(pattern);

    return parts.map((part, i) => {
      const hit = sorted.find((n) => n.value.toLowerCase() === part.toLowerCase());
      return hit ? <mark key={i} className={hit.className}>{part}</mark> : part;
    });
  } catch {
    return text;
  }
});
HighlightText.displayName = 'HighlightText';

export default HighlightText;
