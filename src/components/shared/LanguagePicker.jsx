// Language picker for a 134-entry catalogue.
//
// A native <select> stopped working at this size, so this is a panel: recently
// used pinned at the top, then one section per letter, with an index strip you
// can click or press-and-drag through.
//
// Two things that look like details but are the design:
//
//   The index follows the UI language. 荷兰语 files under H for a Chinese
//   reader and Dutch under D for an English one, so a remembered letter is
//   only valid for the language it was recorded in (see letterLang).
//
//   Chips show the name in the UI language, not the endonym. Without a search
//   box the eye is the only way in, and `አማርኛ` tells a Chinese reader nothing
//   while 阿姆哈拉语 does. The endonym lives in the tooltip.

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock } from 'lucide-react';
import { indexLetter } from '../../config/languages.js';
import './language-picker.css';

const displayName = (lang, uiLanguage) =>
  (uiLanguage === 'zh' ? lang.name : lang.en) || lang.code;

const LanguagePicker = memo(({
  value,
  onChange,
  options = [],
  recent = [],
  lastLetter = null,
  letterLang = null,
  onBrowse,
  customCodes = [],
  disabled = false,
  size = 'default',
  title,
}) => {
  const { t, i18n } = useTranslation();
  const uiLanguage = i18n.language?.startsWith('zh') ? 'zh' : 'en';

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const groupRefs = useRef(new Map());
  const dragging = useRef(false);

  const custom = useMemo(() => new Set(customCodes), [customCodes]);
  const byCode = useMemo(
    () => Object.fromEntries(options.map((l) => [l.code, l])),
    [options]
  );

  // 'auto' is not a language and belongs in no letter group — it sits above
  // everything, in the picker that offers it.
  const autoOption = byCode.auto || null;
  const groups = useMemo(() => {
    const map = new Map();
    for (const lang of options) {
      if (lang.code === 'auto') continue;
      const letter = indexLetter(lang, uiLanguage);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter).push(lang);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([letter, items]) => ({ letter, items }));
  }, [options, uiLanguage]);

  const recentLangs = useMemo(
    () => recent.map((code) => byCode[code]).filter(Boolean).slice(0, 8),
    [recent, byCode]
  );

  const scrollToLetter = useCallback((letter, smooth) => {
    const group = groupRefs.current.get(letter);
    const list = listRef.current;
    if (!group || !list) return;
    // offsetTop is relative to the scroll container, so this lands the section
    // header at the top without the animation lag scrollIntoView has mid-drag.
    const top = group.offsetTop - list.offsetTop;
    // scrollTo is not universal (jsdom has no implementation, and neither did
    // older embedded engines); losing the animation beats throwing out of a
    // click handler.
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      list.scrollTop = top;
    }
  }, []);

  // Reopening returns to where the user was browsing — but a letter recorded
  // under a different UI language points at a group that no longer exists.
  useEffect(() => {
    if (!open) return;
    const usable = lastLetter && letterLang === uiLanguage;
    if (usable) {
      requestAnimationFrame(() => scrollToLetter(lastLetter, false));
    } else if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [open, lastLetter, letterLang, uiLanguage, scrollToLetter]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const jumpTo = useCallback((letter, smooth) => {
    if (!letter) return;
    scrollToLetter(letter, smooth);
    onBrowse?.(letter, uiLanguage);
  }, [scrollToLetter, onBrowse, uiLanguage]);

  // Press and drag along the strip. Click alone still works — drag is a touch
  // idiom a mouse user will not discover, so it can only ever be a bonus.
  const letterFromPoint = (x, y) =>
    document.elementFromPoint(x, y)?.closest('[data-letter]')?.dataset.letter;

  const handleStripPointerDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    jumpTo(letterFromPoint(e.clientX, e.clientY), false);
  };
  const handleStripPointerMove = (e) => {
    if (!dragging.current) return;
    jumpTo(letterFromPoint(e.clientX, e.clientY), false);
  };
  const handleStripPointerUp = (e) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const select = (code) => {
    onChange?.(code);
    setOpen(false);
  };

  const current = byCode[value];
  const currentLabel = current
    ? displayName(current, uiLanguage)
    : value;

  const renderChip = (lang) => (
    <button
      key={lang.code}
      type="button"
      className={[
        'lp-chip',
        lang.code === value ? 'active' : '',
        custom.has(lang.code) ? 'custom' : '',
      ].filter(Boolean).join(' ')}
      title={lang.nativeName && lang.nativeName !== displayName(lang, uiLanguage)
        ? lang.nativeName
        : undefined}
      onClick={() => select(lang.code)}
    >
      <span className="lp-chip-code">{lang.code.toUpperCase()}</span>
      <span className="lp-chip-name">{displayName(lang, uiLanguage)}</span>
    </button>
  );

  return (
    <div className={`lp-root ${size === 'compact' ? 'compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="lp-trigger"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lp-trigger-label">{currentLabel}</span>
        <ChevronDown size={14} className={open ? 'lp-caret open' : 'lp-caret'} />
      </button>

      {open && (
        <div className="lp-panel">
          <div
            className="lp-index"
            onPointerDown={handleStripPointerDown}
            onPointerMove={handleStripPointerMove}
            onPointerUp={handleStripPointerUp}
            onPointerCancel={handleStripPointerUp}
          >
            {groups.map(({ letter }) => (
              <span
                key={letter}
                className="lp-index-letter"
                data-letter={letter}
                // Its own click handler, not just the strip's hit-testing: the
                // drag path resolves the letter from pointer coordinates, and
                // a plain click must not depend on that working.
                onClick={() => jumpTo(letter, true)}
              >
                {letter}
              </span>
            ))}
          </div>

          <div className="lp-list" ref={listRef}>
            {autoOption && (
              <div className="lp-section lp-section-auto">
                {renderChip(autoOption)}
              </div>
            )}

            {recentLangs.length > 0 && (
              <div className="lp-section">
                <div className="lp-section-title">
                  <Clock size={11} />
                  {t('languagePicker.recent', '最近使用')}
                </div>
                <div className="lp-chips">{recentLangs.map(renderChip)}</div>
              </div>
            )}

            {groups.map(({ letter, items }) => (
              <div
                key={letter}
                className="lp-section"
                ref={(el) => {
                  if (el) groupRefs.current.set(letter, el);
                  else groupRefs.current.delete(letter);
                }}
              >
                <div className="lp-section-title">{letter}</div>
                <div className="lp-chips">{items.map(renderChip)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

LanguagePicker.displayName = 'LanguagePicker';

export default LanguagePicker;
