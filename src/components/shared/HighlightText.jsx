// Shared search-term highlighter. History and Favorites used to carry
// near-identical copies (the Favorites one without memo or error handling
// for regex-hostile input).

import { memo } from 'react';

const HighlightText = memo(({ text, search }) => {
  // Last line of defense: a non-string here (a stray result object from the
  // 0.3.x empty-translation bug) would be handed to React as a child and throw
  // #31, taking down the whole panel over one bad row. The store repairs those
  // on rehydrate; this makes the render path survive whatever slips past.
  if (typeof text !== 'string') return text == null ? null : String(text);
  if (!search) return text;
  try {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase() ? (
        <mark key={i} className="search-highlight">{part}</mark>
      ) : part
    );
  } catch {
    return text;
  }
});
HighlightText.displayName = 'HighlightText';

export default HighlightText;
