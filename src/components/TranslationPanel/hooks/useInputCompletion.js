// Ghost-text completion for the source box: the first history or favorites
// entry that extends what was typed shows its next few words in grey over
// the textarea; with none, after a typing pause, the main process finishes the
// word being typed or guesses the next one (stack:compose). Tab takes it,
// Esc hides it until the text changes. The ghost layer copies the
// textarea's font metrics and size at runtime so both wrap the same way.
// Rendering is the panel's job.
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import translationService from '../../../translation/stack-client.js';

const MIN_CHARS = 2;
// Typing pause before asking: inside a word (Windows predictor), after a space (model).
const WORD_PAUSE_MS = 150;
const SPACE_PAUSE_MS = 300;
// A history hit stops where its phrase ends (docs/design/renderer.md §1);
// the caps only keep a run-on short.
const MAX_WORDS = 8;
const MAX_CJK_CHARS = 10;
const MAX_CHARS = 300;
const CJK_CHAR = /[぀-ヿ㐀-鿿가-힯＀-￯]/;
const CJK_STOP = /[，。！？；：、,.!?;:\n]/;
// Words that usually open a new phrase: the completion stops before them.
const BREAK_BEFORE = new Set([
  'and', 'but', 'or', 'so', 'because', 'when', 'while', 'if', 'although', 'though', 'unless', 'until',
  'after', 'before', 'as', 'than', 'which', 'who', 'whom', 'whose', 'where',
  'at', 'in', 'on', 'by', 'from', 'during', 'about', 'without', 'within', 'through', 'across', 'around', 'near', 'via',
  'last', 'next', 'yesterday', 'today', 'tomorrow', 'tonight',
  'i', 'we', 'they', 'he', 'she',
]);
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

// The part of a remainder up to its natural stop, never past a line break.
// The first piece (the rest of a half word, or else the next word) always
// shows; then words follow until a clause mark (, ; : dropped; . ! ? kept)
// or a word that opens a new phrase. CJK text stops at its first punctuation.
export function capCompletion(suffix) {
  const line = suffix.split('\n')[0];
  const first = line.trimStart()[0] || '';
  if (CJK_CHAR.test(first)) {
    const lead = line.length - line.trimStart().length;
    const body = line.slice(lead);
    const stop = body.search(CJK_STOP);
    return line.slice(0, lead) + body.slice(0, Math.min(stop < 0 ? body.length : stop, MAX_CJK_CHARS));
  }
  const words = line.match(/\s*\S+/g) || [];
  let out = '';
  for (let i = 0; i < words.length && i < MAX_WORDS; i++) {
    const w = words[i];
    if (i > 0 && BREAK_BEFORE.has(w.trim().replace(/[^A-Za-z']/g, '').toLowerCase())) break;
    if (/[,;:]$/.test(w)) {
      out += w.slice(0, -1);
      break;
    }
    out += w;
    if (/[.!?]$/.test(w)) break;
  }
  return out.slice(0, MAX_CHARS);
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
      const suffix = capCompletion(text.slice(typed.length));
      if (!suffix.trim()) continue;
      return suffix;
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
  const [guess, setGuess] = useState(null); // { for: text, suffix } from stack:compose

  const candidate = useMemo(
    () => (enabled ? findCompletion(text, [history, favorites]) : null),
    [enabled, text, history, favorites]
  );
  const guessed = enabled && guess && guess.for === text ? guess.suffix : '';
  const best = candidate || guessed;
  const suffix = best && focused && !composing && caretAtEnd && dismissedFor !== text ? best : '';

  // Asks once typing pauses, only when history had nothing.
  const wantGuess = enabled && !candidate && focused && !composing && caretAtEnd && dismissedFor !== text;
  useEffect(() => {
    if (!wantGuess) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const s = await translationService.compose(text);
      if (live) setGuess({ for: text, suffix: s });
    }, /[A-Za-z']$/.test(text) ? WORD_PAUSE_MS : SPACE_PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wantGuess, text]);

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
    onFocus: () => {
      setFocused(true);
      if (enabled) translationService.composeWarm();
    },
    onBlur: () => setFocused(false),
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onSelect: (e) => setCaretAtEnd(e.target.selectionEnd === e.target.value.length),
    onScroll: syncGhost,
  };

  return { suffix, ghostRef, handlers, onKeyDown };
}
