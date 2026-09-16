// Listen-mode content area: finals + their translations, with the streaming
// draft as the tail line. Session status lives in the top bar. Each finished
// row carries a read-aloud button; playback mutes capture in the worker.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Square } from 'lucide-react';
import ttsManager, { TTS_STATUS } from '../../tts/index.js';
import createLogger from '../../core/logger.js';

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
        {/* The freshest final stays full-strength while a draft is in flight. */}
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
