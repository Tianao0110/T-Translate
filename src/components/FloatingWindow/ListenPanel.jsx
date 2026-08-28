// Listen-mode content area: finals (split at sentence-ending punctuation, the
// subtitle short-line rule) + their translations, with the streaming draft as
// a gray italic tail line. Finals only ever reach translation — the draft
// line is provisional by contract.

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const STATUS_CLASS = {
  listening: 'live',
  'hint-no-audio': 'warn',
  'hint-no-speech': 'warn',
  'device-lost': 'warn',
  'engine-restarting': 'warn',
  'no-model': 'err',
  'secure-blocked': 'err',
  'engine-dead': 'err',
  'reacquire-failed': 'err',
  'capture-error': 'err',
};

function splitSubtitleLines(text) {
  const parts = text.split(/(?<=[。！？!?])/).filter((s) => s.trim());
  return parts.length ? parts.map((p) => p.trim()) : [text];
}

const ListenPanel = ({ session }) => {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const { segments, partial, sessionState, running } = session;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  const statusText = t(`floatingWindow.listenStatus.${sessionState}`, sessionState);

  return (
    <div className="listen-panel">
      <div className={`listen-status ${STATUS_CLASS[sessionState] || ''}`}>
        {statusText}
      </div>
      <div className="listen-transcript" ref={scrollRef}>
        {segments.length === 0 && !partial && (
          <div className="listen-placeholder">
            {running
              ? t('floatingWindow.listenWaiting', '正在监听系统声音…')
              : t('floatingWindow.listenIdle', '点击开始，实时转写并翻译系统声音（音频不落盘）')}
          </div>
        )}
        {segments.map((seg) => (
          <div key={seg.id} className="listen-seg">
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
