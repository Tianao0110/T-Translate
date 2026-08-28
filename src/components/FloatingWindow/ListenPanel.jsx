// Listen-mode content area: finals (split at sentence-ending punctuation, the
// subtitle short-line rule) + their translations, with the streaming draft as
// a gray italic tail line. Finals only ever reach translation — the draft
// line is provisional by contract. Session status lives in the TOP BAR (the
// otherwise-empty drag strip), not here — the transcript gets the full area.

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

function splitSubtitleLines(text) {
  const parts = text.split(/(?<=[。！？!?])/).filter((s) => s.trim());
  return parts.length ? parts.map((p) => p.trim()) : [text];
}

const ListenPanel = ({ session }) => {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const { segments, partial, running } = session;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  return (
    <div className="listen-panel">
      <div className="listen-transcript" ref={scrollRef}>
        {segments.length === 0 && !partial && (
          <div className="listen-placeholder">
            {running
              ? t('floatingWindow.listenWaiting', '正在监听系统声音…')
              : t('floatingWindow.listenIdle', '点击开始，实时转写并翻译系统声音（音频不落盘）')}
          </div>
        )}
        {segments.map((seg, idx) => (
          <div
            key={seg.id}
            className={`listen-seg ${idx === segments.length - 1 && !partial ? 'current' : 'old'}`}
          >
            <div className="listen-seg-text">
              {splitSubtitleLines(seg.text).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
            {seg.trans && seg.trans !== 'pending' && (
              <div className="listen-seg-trans">{seg.trans}</div>
            )}
          </div>
        ))}
        {partial && <div className="listen-partial">{partial}</div>}
      </div>
    </div>
  );
};

export default ListenPanel;
