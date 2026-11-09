// Ghost-text completion for the source box: the first history or favorites
// entry that extends what was typed shows its remainder in grey over the
// textarea; Tab takes it, Esc hides it until the text changes. The ghost
// layer copies the textarea's font metrics and size at runtime so both wrap
// the same way. Rendering is the panel's job.
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';

const MIN_CHARS = 2;
const MAX_SUFFIX = 300;
const MIRRORED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textIndent', 'textTransform', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
];

function isPlainAscii(s) {
  return /^[\x20-\x7E]+$/.test(s);
}

// Plain-ASCII input ignores case; anything else must match exactly.
function startsWithLoose(candidate, typed) {
  if (candidate.length <= typed.length) return false;
  if (candidate.startsWith(typed)) return true;
  return isPlainAscii(typed) && candidate.slice(0, typed.length).toLowerCase() === typed.toLowerCase();
}

// The text to append after `typed`, or null. `sources` is a list of arrays of
// { sourceText } scanned in order; the first hit wins.
export function findCompletion(typed, sources) {
  if (typeof typed !== 'string' || typed.trim().length < MIN_CHARS) return null;
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const text = item?.sourceText;
      if (typeof text !== 'string' || !startsWithLoose(text, typed)) continue;
      const suffix = text.slice(typed.length);
      if (!suffix.trim()) continue;
      return suffix.length > MAX_SUFFIX ? suffix.slice(0, MAX_SUFFIX) : suffix;
    }
  }
  return null;
}

export default function useInputCompletion({ text, enabled, history, favorites, textareaRef, onAccept }) {
  const ghostRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [dismissedFor, setDismissedFor] = useState(null);

  const candidate = useMemo(
    () => (enabled ? findCompletion(text, [history, favorites]) : null),
    [enabled, text, history, favorites]
  );
  const suffix = candidate && focused && !composing && caretAtEnd && dismissedFor !== text ? candidate : '';

  const syncGhost = useCallback(() => {
    const ta = textareaRef.current;
    const ghost = ghostRef.current;
    if (!ta || !ghost) return;
    const cs = getComputedStyle(ta);
    for (const prop of MIRRORED) ghost.style[prop] = cs[prop];
    ghost.style.width = `${ta.clientWidth}px`;
    ghost.style.height = `${ta.clientHeight}px`;
    ghost.scrollTop = ta.scrollTop;
  }, [textareaRef]);

  useEffect(() => {
    if (!suffix) return undefined;
    syncGhost();
    const ta = textareaRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(syncGhost);
    observer.observe(ta);
    return () => observer.disconnect();
  }, [suffix, syncGhost, textareaRef]);

  // Returns true when the key was consumed.
  const onKeyDown = (e) => {
    if (!suffix) return false;
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      onAccept(text + suffix);
      return true;
    }
    if (e.key === 'Escape') {
      setDismissedFor(text);
      return true;
    }
    return false;
  };

  const handlers = {
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onSelect: (e) => setCaretAtEnd(e.target.selectionEnd === e.target.value.length),
    onScroll: syncGhost,
  };

  return { suffix, ghostRef, handlers, onKeyDown };
}
