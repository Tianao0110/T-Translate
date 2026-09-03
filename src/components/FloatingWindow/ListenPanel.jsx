// Listen-mode content area: finals (split at sentence-ending punctuation, the
// subtitle short-line rule) + their translations, with the streaming draft as
// the big "now playing" tail line. Finals only ever reach translation — the
// draft line is provisional by contract. Session status lives in the TOP BAR
// (the otherwise-empty drag strip), not here — the transcript gets the area.
//
// Each finished row carries a read-aloud button (v0.4.2): hover to reveal,
// click to hear the translation (or the source when there is none) through
// the configured TTS engine. Playback from any window mutes capture in the
// worker (the gate), so the spoken line never comes back as a subtitle.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Square } from 'lucide-react';
import ttsManager, { TTS_STATUS } from '../../services/tts/index.js';
import createLogger from '../../utils/logger.js';

const logger = createLogger('ListenPanel');

function splitSubtitleLines(text) {
  const parts = text.split(/(?<=[。！？!?])/).filter((s) => s.trim());
  return parts.length ? parts.map((p) => p.trim()) : [text];
}

const ListenPanel = ({ session }) => {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const { segments, partial, running, lang, targetLang } = session;
  // Row being read right now; null when idle. Cleared by the engine's IDLE.
  const [speakingId, setSpeakingId] = useState(null);
  const speakingIdRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  useEffect(() => {
    ttsManager.init().catch((e) => logger.warn('TTS init failed:', e.message));
    const unsub = ttsManager.onStatusChange((status) => {
      if (status === TTS_STATUS.IDLE || status === TTS_STATUS.ERROR) {
        speakingIdRef.current = null;
        setSpeakingId(null);
      }
    });
    return () => {
      unsub();
      ttsManager.stop();
    };
  }, []);

  const speakRow = useCallback(async (seg) => {
    if (speakingIdRef.current === seg.id) {
      ttsManager.stop();
      return;
    }
    const hasTrans = !!seg.trans && seg.trans !== 'pending';
    const text = hasTrans ? seg.trans : seg.text;
    // Translations are in the target language; a source line is whatever the
    // session was set to ('' = auto, the engine detects from the text).
    const speakLang = hasTrans ? targetLang : lang;
    speakingIdRef.current = seg.id;
    setSpeakingId(seg.id);
    try {
      await ttsManager.speak(text, { lang: speakLang || 'auto' });
    } catch (e) {
      logger.warn('read-aloud failed:', e.message);
      if (speakingIdRef.current === seg.id) {
        speakingIdRef.current = null;
        setSpeakingId(null);
      }
    }
  }, [lang, targetLang]);

  return (
    <div className="listen-panel">
      <div className="listen-transcript" ref={scrollRef}>
        {segments.length === 0 && !partial && (
          <div className="listen-placeholder">
            {running
              ? t('floatingWindow.listenWaiting', '正在监听系统声音…')
              : t('floatingWindow.listenIdle', '点击开始，听译系统声音')}
          </div>
        )}
        {/* The freshest final stays full-strength even while a draft is in
            flight — the draft outranks it by size/weight alone, and dimming
            the newest translation mid-sentence hides the payload. */}
        {segments.map((seg, idx) => {
          const speaking = speakingId === seg.id;
          const hasTrans = !!seg.trans && seg.trans !== 'pending';
          return (
            <div
              key={seg.id}
              className={`listen-seg ${idx === segments.length - 1 ? 'current' : 'old'}${speaking ? ' speaking' : ''}${hasTrans ? '' : ' no-trans'}`}
            >
              <div className="listen-seg-text">
                {splitSubtitleLines(seg.text).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
              {hasTrans && (
                <div className="listen-seg-trans">{seg.trans}</div>
              )}
              <button
                type="button"
                className={`listen-seg-speak${speaking ? ' playing' : ''}`}
                title={speaking ? t('floatingWindow.listenSpeakStop') : t('floatingWindow.listenSpeakLine')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); speakRow(seg); }}
              >
                {speaking ? <Square size={11} /> : <Volume2 size={13} />}
              </button>
            </div>
          );
        })}
        {partial && <div className="listen-partial">{partial}</div>}
      </div>
    </div>
  );
};

export default ListenPanel;
