// src/components/TranslationPanel/hooks/useTTS.js
// TTS 朗读逻辑 - 从 TranslationPanel 抽出
//
// 管理 TTS 初始化、朗读控制、状态追踪

import { useState, useEffect, useCallback } from 'react';
import ttsManager, { TTS_STATUS } from '../../../services/tts/index.js';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('useTTS');

/**
 * TTS 朗读 Hook
 * @param {Function} notify - 通知函数
 * @param {Function} t - i18n 翻译函数
 * @returns {Object} TTS 状态和控制方法
 */
export default function useTTS(notify, t) {
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);
  const [ttsTarget, setTtsTarget] = useState(null); // 'source' | 'target'
  const [ttsEnabled, setTtsEnabled] = useState(true);

  // 初始化
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

  // 朗读文本
  const speakText = useCallback(async (text, target, lang) => {
    if (!text?.trim()) {
      notify(t('translation.noTextToSpeak'), 'warning');
      return;
    }

    // 正在朗读同一个目标 → 停止
    if (ttsStatus === TTS_STATUS.SPEAKING && ttsTarget === target) {
      ttsManager.stop();
      return;
    }

    // 正在朗读其他目标 → 先停止
    if (ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    try {
      setTtsTarget(target);
      await ttsManager.speak(text, { lang });
    } catch (e) {
      logger.error('TTS speak error:', e);
      
      // 根据错误类型给用户友好提示
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
