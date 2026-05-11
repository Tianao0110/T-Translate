// TTS hook: bridges ttsManager into the panel UI with status tracking.

import { useState, useEffect, useCallback } from 'react';
import ttsManager, { TTS_STATUS } from '../../../services/tts/index.js';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('useTTS');

export default function useTTS(notify, t) {
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);
  // 'source' or 'target' — used by UI to highlight the right button
  const [ttsTarget, setTtsTarget] = useState(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);

  useEffect(() => {
    ttsManager.init().then(() => {
      setTtsEnabled(ttsManager.enabled);
    }).catch(e => {
      logger.warn('TTS init failed:', e.message);
    });

    ttsManager.onStatusChange((status) => {
      setTtsStatus(status);
      if (status === TTS_STATUS.IDLE || status === TTS_STATUS.ERROR) {
        setTtsTarget(null);
      }
    });

    return () => {
      ttsManager.stop();
    };
  }, []);

  const speakText = useCallback(async (text, target, lang) => {
    if (!text?.trim()) {
      notify(t('translation.noTextToSpeak'), 'warning');
      return;
    }

    // Re-clicking the active target is a stop toggle
    if (ttsStatus === TTS_STATUS.SPEAKING && ttsTarget === target) {
      ttsManager.stop();
      return;
    }

    // Switching to the other target: stop first to avoid race with new speak()
    if (ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    try {
      setTtsTarget(target);
      await ttsManager.speak(text, { lang });
    } catch (e) {
      logger.error('TTS speak error:', e);

      // Map web-speech engine error codes to localized messages
      const msg = e.message || '';
      if (msg === 'NO_VOICES') {
        notify(t('tts.noVoicesInstalled', { defaultValue: '系统未安装任何语音包，请在系统设置中安装语音' }), 'warning');
      } else if (msg.startsWith('NO_VOICE_FOR_LANG:')) {
        const langCode = msg.split(':')[1];
        const langName = t(`tts.langNames.${langCode}`, { defaultValue: langCode });
        notify(t('tts.noVoiceForLang', { lang: langName, defaultValue: `系统未安装${langName}语音包` }), 'warning');
      } else {
        notify(t('translation.speakFailed') + ': ' + e.message, 'error');
      }
    }
  }, [ttsStatus, ttsTarget, notify, t]);

  return {
    ttsStatus,
    ttsTarget,
    ttsEnabled,
    speakText,
  };
}
