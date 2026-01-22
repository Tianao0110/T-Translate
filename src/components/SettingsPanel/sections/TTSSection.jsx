// src/components/SettingsPanel/sections/TTSSection.jsx
// TTS 朗读设置 - 国际化版

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RefreshCw } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG, TTS_STATUS } from '../../../services/tts/index.js';

/**
 * TTS 设置区块
 */
const TTSSection = ({ settings, updateSetting, notify }) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);
  
  // 获取 TTS 设置，确保有默认值
  const ttsConfig = {
    ...DEFAULT_TTS_CONFIG,
    ...(settings?.tts || {}),
  };

  // 加载语音列表
  const loadVoices = useCallback(async () => {
    setIsLoadingVoices(true);
    try {
      await ttsManager.init();
      const voiceList = await ttsManager.getVoices();
      setVoices(voiceList);
    } catch (e) {
      console.error('Failed to load voices:', e);
      notify?.(t('tts.loadVoicesFailed'), 'error');
    } finally {
      setIsLoadingVoices(false);
    }
  }, [notify, t]);

  // 初始化
  useEffect(() => {
    loadVoices();
    
    // 监听 TTS 状态
    ttsManager.onStatusChange((status) => {
      setTtsStatus(status);
      if (status === TTS_STATUS.IDLE) {
        setIsTesting(false);
      }
    });
  }, [loadVoices]);

  // 更新 TTS 配置
  const updateTTSConfig = useCallback((key, value) => {
    updateSetting('tts', key, value);
    ttsManager.updateConfig({ [key]: value });
  }, [updateSetting]);

  // 试听
  const handleTest = async () => {
    if (isTesting || ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
      setIsTesting(false);
      return;
    }
    
    setIsTesting(true);
    try {
      const testText = ttsConfig.voiceId 
        ? t('tts.testTextMixed')
        : t('tts.testTextChinese');
      
      await ttsManager.speak(testText, {
        lang: 'zh',
        voiceId: ttsConfig.voiceId,
        rate: ttsConfig.rate,
        pitch: ttsConfig.pitch,
        volume: ttsConfig.volume,
      });
    } catch (e) {
      console.error('TTS test failed:', e);
      notify?.(t('tts.testFailed') + ': ' + e.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  // 按语言分组语音
  const groupedVoices = voices.reduce((groups, voice) => {
    const langCode = voice.lang.split('-')[0];
    const langNames = {
      'zh': t('tts.langNames.zh'),
      'en': t('tts.langNames.en'),
      'ja': t('tts.langNames.ja'),
      'ko': t('tts.langNames.ko'),
      'fr': t('tts.langNames.fr'),
      'de': t('tts.langNames.de'),
      'es': t('tts.langNames.es'),
      'ru': t('tts.langNames.ru'),
      'pt': t('tts.langNames.pt'),
      'it': t('tts.langNames.it'),
    };
    const groupName = langNames[langCode] || voice.lang;
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(voice);
    return groups;
  }, {});

  return (
    <div className="setting-content">
      <h3>{t('settings.tts.title')}</h3>
      <p className="setting-description">{t('tts.description')}</p>

      {/* 启用开关 */}
      <div className="setting-group">
        <label className="setting-switch">
          <input
            type="checkbox"
            checked={ttsConfig.enabled}
            onChange={(e) => updateTTSConfig('enabled', e.target.checked)}
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('tts.enableTTS')}</span>
        </label>
        <p className="setting-hint">{t('tts.enableHint')}</p>
      </div>

      {ttsConfig.enabled && (
        <>
          {/* 语音选择 */}
          <div className="setting-group">
            <label className="setting-label">{t('tts.defaultVoice')}</label>
            <div className="setting-row">
              <select
                className="setting-select"
                value={ttsConfig.voiceId || ''}
                onChange={(e) => updateTTSConfig('voiceId', e.target.value)}
                disabled={isLoadingVoices}
                style={{ flex: 1 }}
              >
                <option value="">{t('tts.autoSelect')}</option>
                {Object.entries(groupedVoices).map(([lang, langVoices]) => (
                  <optgroup key={lang} label={lang}>
                    {langVoices.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button 
                className="setting-btn-icon" 
                onClick={loadVoices}
                disabled={isLoadingVoices}
                title={t('tts.refreshVoices')}
              >
                <RefreshCw size={14} className={isLoadingVoices ? 'spinning' : ''} />
              </button>
            </div>
            <p className="setting-hint">
              {voices.length > 0 
                ? t('tts.voicesLoaded', {count: voices.length})
                : t('tts.autoSelectHint')}
            </p>
          </div>

          {/* 语速 */}
          <div className="setting-group">
            <label className="setting-label">{t('tts.rate')}: {ttsConfig.rate.toFixed(1)}x</label>
            <input
              type="range"
              className="setting-range"
              min="0.5"
              max="2"
              step="0.1"
              value={ttsConfig.rate}
              onChange={(e) => updateTTSConfig('rate', parseFloat(e.target.value))}
            />
            <p className="setting-hint">{t('tts.rateHint')}</p>
          </div>

          {/* 音调 */}
          <div className="setting-group">
            <label className="setting-label">{t('tts.pitch')}: {ttsConfig.pitch.toFixed(1)}</label>
            <input
              type="range"
              className="setting-range"
              min="0.5"
              max="2"
              step="0.1"
              value={ttsConfig.pitch}
              onChange={(e) => updateTTSConfig('pitch', parseFloat(e.target.value))}
            />
            <p className="setting-hint">{t('tts.pitchHint')}</p>
          </div>

          {/* 音量 */}
          <div className="setting-group">
            <label className="setting-label">{t('tts.volume')}: {Math.round(ttsConfig.volume * 100)}%</label>
            <input
              type="range"
              className="setting-range"
              min="0"
              max="1"
              step="0.1"
              value={ttsConfig.volume}
              onChange={(e) => updateTTSConfig('volume', parseFloat(e.target.value))}
            />
            <p className="setting-hint">{t('tts.volumeHint')}</p>
          </div>

          {/* 试听 */}
          <div className="setting-group" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)' }}>
            <label className="setting-label">{t('tts.preview')}</label>
            <p className="setting-hint" style={{ marginBottom: '12px' }}>{t('tts.previewHint')}</p>
            <button 
              className={`action-button ${isTesting ? 'danger' : 'primary'}`}
              onClick={handleTest}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {isTesting ? (
                <>
                  <Square size={14} />
                  {t('tts.stop')}
                </>
              ) : (
                <>
                  <Play size={14} />
                  {t('tts.play')}
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default TTSSection;
