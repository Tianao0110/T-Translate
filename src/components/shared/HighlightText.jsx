// Shared search-term highlighter. History and Favorites used to carry
// near-identical copies (the Favorites one without memo or error handling
// for regex-hostile input).

import { memo } from 'react';

const HighlightText = memo(({ text, search }) => {
  if (!search || !text) return text;
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
