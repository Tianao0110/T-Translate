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
import { ChevronDown, Clock, Plus, AlertTriangle } from 'lucide-react';
import { indexLetter } from '../../config/languages.js';
import { normalizeCustomLanguage } from '../../config/custom-languages.js';
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
  onAddCustom,
  existingCustom = [],
  disabled = false,
  size = 'default',
  title,
}) => {
  const { t, i18n } = useTranslation();
  const uiLanguage = i18n.language?.startsWith('zh') ? 'zh' : 'en';

  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', promptName: '' });
  const [formError, setFormError] = useState('');
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

  // User-added languages get their own pinned section rather than a letter
  // group: their "letter" is the first character of a name the user typed,
  // which put a stray 藏 on the end of an A-Z strip.
  const customLangs = useMemo(
    () => options.filter((l) => l.custom || custom.has(l.code)),
    [options, custom]
  );

  const groups = useMemo(() => {
    const map = new Map();
    for (const lang of options) {
      if (lang.code === 'auto') continue;
      if (lang.custom || custom.has(lang.code)) continue;
      const letter = indexLetter(lang, uiLanguage);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter).push(lang);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([letter, items]) => ({ letter, items }));
  }, [options, uiLanguage, custom]);

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

  // The panel is far wider than its trigger, so a trigger sitting near the
  // right edge (the document translator's header, or any narrow window) pushes
  // it off screen. Measured on open rather than guessed from a breakpoint —
  // what matters is this trigger's position, not the viewport size.
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const { left } = rootRef.current.getBoundingClientRect();
    const PANEL_WIDTH = 452;
    setAlignRight(left + PANEL_WIDTH > window.innerWidth - 8);
  }, [open]);

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
    if (open) return;
    setAdding(false);
    setForm({ name: '', promptName: '' });
    setFormError('');
  }, [open]);

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

  const submitCustom = () => {
    const result = normalizeCustomLanguage(form, existingCustom);
    if (!result.ok) {
      setFormError(result.reason);
      return;
    }
    onAddCustom?.(result.language);
    setAdding(false);
    setForm({ name: '', promptName: '' });
    onChange?.(result.language.code);
    setOpen(false);
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
      {/* A custom language's code IS its prompt name, so it would render as a
          whole word in the slot meant for a two-letter tag. The dashed frame
          already says "custom"; the slot stays empty. */}
      {!lang.custom && <span className="lp-chip-code">{lang.code.toUpperCase()}</span>}
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
        <div className={alignRight ? 'lp-panel align-right' : 'lp-panel'}>
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

          {adding && (
            <div className="lp-add">
              <div className="lp-add-warn">
                <AlertTriangle size={13} />
                <span>
                  {t(
                    'languagePicker.addWarning',
                    '自定义语言不在谷歌翻译的支持范围内，能否翻译取决于你当前使用的大模型是否认识它。结果可能不准确或完全错误。'
                  )}
                </span>
              </div>

              <label className="lp-add-field">
                <span>{t('languagePicker.addName', '语言名称')}</span>
                <input
                  autoFocus
                  value={form.name}
                  placeholder={t('languagePicker.addNamePlaceholder', '如：藏语')}
                  onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setFormError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitCustom(); }}
                />
              </label>

              <label className="lp-add-field">
                <span>{t('languagePicker.addPromptName', '发给模型的名字')}</span>
                <input
                  value={form.promptName}
                  placeholder={t('languagePicker.addPromptPlaceholder', '留空则同上；模型只认 Tibetan 就填 Tibetan')}
                  onChange={(e) => { setForm((f) => ({ ...f, promptName: e.target.value })); setFormError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitCustom(); }}
                />
              </label>

              {formError && (
                <div className="lp-add-error">
                  {t(`languagePicker.addError.${formError}`, {
                    emptyName: '请填写语言名称',
                    duplicate: '已经添加过同名的语言',
                    tooLong: '名称太长',
                    tooMany: '自定义语言数量已达上限',
                  }[formError] || formError)}
                </div>
              )}

              <div className="lp-add-actions">
                <button type="button" className="lp-add-cancel" onClick={() => setAdding(false)}>
                  {t('common.cancel', '取消')}
                </button>
                <button type="button" className="lp-add-confirm" onClick={submitCustom}>
                  {t('languagePicker.addConfirm', '我知道了，添加')}
                </button>
              </div>
            </div>
          )}

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

            {customLangs.length > 0 && (
              <div className="lp-section">
                <div className="lp-section-title">
                  {t('languagePicker.customSection', '自定义')}
                </div>
                <div className="lp-chips">{customLangs.map(renderChip)}</div>
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

          {onAddCustom && !adding && (
            <button type="button" className="lp-add-entry" onClick={() => setAdding(true)}>
              <Plus size={12} />
              {t('languagePicker.addCustom', '添加自定义语言')}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

LanguagePicker.displayName = 'LanguagePicker';

export default LanguagePicker;
