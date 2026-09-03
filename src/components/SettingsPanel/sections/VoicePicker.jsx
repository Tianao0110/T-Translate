// Voice picker panel: replaces the long dropdown for engines with many
// voices (kokoro ships 103). A search box, a segmented filter, and grouped
// chips three to a row, each with its own preview button; picking a chip
// applies immediately. Neural voices group by gender with a featured row on
// top; system voices group by language with "auto" as the first choice.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Play } from 'lucide-react';

function langKey(voice) {
  return String(voice.lang || '').toLowerCase().split(/[-_]/)[0] || 'other';
}

const VoicePicker = ({ voices, value, mode, onChange, onPreview, autoLabel = '', placeholder = '' }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = voices.find((v) => v.id === value) || null;
  const label = selected ? selected.name : (value ? value : (autoLabel || placeholder));
  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (v) => !q || String(v.name || '').toLowerCase().includes(q) || String(v.lang || '').toLowerCase().includes(q),
    [q]
  );

  const filters = useMemo(() => {
    if (mode === 'neural') {
      return [
        { key: 'all', label: t('audio.picker.all') },
        { key: 'f', label: t('audio.picker.female'), count: voices.filter((v) => v.gender === 'f').length },
        { key: 'm', label: t('audio.picker.male'), count: voices.filter((v) => v.gender === 'm').length },
      ];
    }
    const langs = new Map();
    for (const v of voices) {
      const k = langKey(v);
      langs.set(k, (langs.get(k) || 0) + 1);
    }
    const main = ['zh', 'en'].filter((k) => langs.has(k));
    const rest = [...langs.keys()].filter((k) => !main.includes(k));
    const out = [{ key: 'all', label: t('audio.picker.all') }];
    for (const k of main) out.push({ key: k, label: t(`tts.langNames.${k}`, { defaultValue: k }), count: langs.get(k) });
    if (rest.length) out.push({ key: 'other', label: t('audio.picker.other'), count: rest.reduce((s, k) => s + langs.get(k), 0) });
    return out;
  }, [voices, mode, t]);

  const groups = useMemo(() => {
    const out = [];
    if (mode === 'neural') {
      const pool = voices.filter(matches).filter((v) => filter === 'all' || v.gender === filter);
      const featured = pool.filter((v) => v.featured);
      const f = pool.filter((v) => v.gender === 'f');
      const m = pool.filter((v) => v.gender === 'm');
      const other = pool.filter((v) => v.gender !== 'f' && v.gender !== 'm');
      if (featured.length && !q) out.push({ key: 'featured', title: t('audio.picker.featured'), items: featured });
      if (f.length) out.push({ key: 'f', title: `${t('audio.picker.female')} · ${f.length}`, items: f });
      if (m.length) out.push({ key: 'm', title: `${t('audio.picker.male')} · ${m.length}`, items: m });
      if (other.length) out.push({ key: 'other', title: t('audio.picker.other'), items: other });
      return out;
    }
    const byLang = new Map();
    for (const v of voices) {
      if (!matches(v)) continue;
      const k = langKey(v);
      const bucket = filter === 'all' ? true : filter === 'other' ? !['zh', 'en'].includes(k) : k === filter;
      if (!bucket) continue;
      if (!byLang.has(k)) byLang.set(k, []);
      byLang.get(k).push({ ...v, sub: v.lang });
    }
    const order = [...byLang.keys()].sort((a, b) => {
      const rank = (k) => (k === 'zh' ? 0 : k === 'en' ? 1 : 2);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    for (const k of order) {
      const items = byLang.get(k);
      out.push({ key: k, title: `${t(`tts.langNames.${k}`, { defaultValue: k })} · ${items.length}`, items });
    }
    return out;
  }, [voices, mode, filter, matches, q, t]);

  const choose = (id) => {
    onChange?.(id);
    setOpen(false);
  };

  return (
    <div className="tts-dropdown vp-wrap" ref={ref}>
      <button
        type="button"
        className={`tts-dropdown-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={!voices.length && !autoLabel}
      >
        <span className="tts-dropdown-text">{label}</span>
        <ChevronDown size={14} className={`tts-dropdown-arrow ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="vp">
          <div className="vp-head">
            <input
              className="ps-input vp-search"
              placeholder={t('audio.picker.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="seg small">
              {filters.map((f) => (
                <button key={f.key} type="button" className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                  {f.label}{f.count != null && <span className="n">{f.count}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="vp-body">
            {autoLabel && !q && (
              <div className="vp-group">
                <div className="vp-grid">
                  <button type="button" className={`vp-chip ${!value ? 'on' : ''}`} onClick={() => choose('')}>
                    <span>{autoLabel}</span>
                  </button>
                </div>
              </div>
            )}
            {groups.length === 0 && <p className="vp-empty">{t('audio.picker.noMatch')}</p>}
            {groups.map((g) => (
              <div className="vp-group" key={g.key}>
                <div className="vp-group-title">{g.title}</div>
                <div className="vp-grid">
                  {g.items.map((v) => (
                    <button
                      type="button"
                      key={v.id}
                      className={`vp-chip ${value === v.id ? 'on' : ''}`}
                      onClick={() => choose(v.id)}
                      title={v.name}
                    >
                      <span>{v.name}{v.sub && <span className="sub">{v.sub}</span>}</span>
                      <span
                        className="vp-play"
                        role="button"
                        title={t('audio.picker.preview')}
                        onClick={(e) => { e.stopPropagation(); onPreview?.(v); }}
                      >
                        <Play size={10} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="vp-foot">{t('audio.picker.foot')}</div>
        </div>
      )}
    </div>
  );
};

export default VoicePicker;
