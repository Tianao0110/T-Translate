// Shared search-term highlighter for the history and favorites cards.

import { memo } from 'react';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {string} [search] the search box's query
 * @param {string[]} [terms] extra strings to mark with a different class —
 *   used by the document to show which glossary terms it just substituted
 * @param {string} [termClassName]
 */
const HighlightText = memo(({ text, search, terms, termClassName = 'term-highlight', onTermClick }) => {
  // Last line of defense against a non-string (stores/history-sanitize.js
  // repairs them on rehydrate).
  if (typeof text !== 'string') return text == null ? null : String(text);

  const needles = [];
  if (search) needles.push({ value: search, className: 'search-highlight' });
  for (const term of terms || []) {
    if (term) needles.push({ value: term, className: termClassName });
  }
  if (!needles.length) return text;

  try {
    // Longest first.
    const sorted = [...needles].sort((a, b) => b.value.length - a.value.length);
    const pattern = new RegExp(`(${sorted.map((n) => escapeRe(n.value)).join('|')})`, 'gi');
    const parts = text.split(pattern);

    return parts.map((part, i) => {
      const hit = sorted.find((n) => n.value.toLowerCase() === part.toLowerCase());
      if (!hit) return part;
      // Only term marks are interactive; a search hit has nothing to say.
      const clickable = onTermClick && hit.className === termClassName;
      return (
        <mark
          key={i}
          className={clickable ? `${hit.className} is-clickable` : hit.className}
          onClick={clickable ? (e) => onTermClick(part, e) : undefined}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTermClick(part, e); } } : undefined}
        >
          {part}
        </mark>
      );
    });
  } catch {
    return text;
  }
});
HighlightText.displayName = 'HighlightText';

export default HighlightText;
