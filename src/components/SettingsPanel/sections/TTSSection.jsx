// src/components/SettingsPanel/sections/TTSSection.jsx
// TTS 朗读设置 - 自定义语音选择下拉

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RefreshCw, AlertTriangle, ChevronDown, Check } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG, TTS_STATUS } from '../../../services/tts/index.js';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('TTSSection');

/**
 * 自定义语音选择下拉（替代原生 select，解决 Electron 卡顿）
 */
const VoiceDropdown = ({ value, onChange, groupedVoices, noVoices, isLoading, autoLabel, emptyLabel }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedName = useMemo(() => {
    if (!value) return noVoices ? emptyLabel : autoLabel;
    for (const voices of Object.values(groupedVoices)) {
      const found = voices.find(v => v.id === value);
      if (found) return found.name;
    }
    return autoLabel;
  }, [value, groupedVoices, noVoices, autoLabel, emptyLabel]);

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="tts-dropdown" ref={ref}>
      <button
        className={`tts-dropdown-trigger ${open ? 'open' : ''}`}
        onClick={() => !isLoading && !noVoices && setOpen(!open)}
        disabled={isLoading || noVoices}
        type="button"
      >
        <span className="tts-dropdown-text">{selectedName}</span>
        <ChevronDown size={14} className={`tts-dropdown-arrow ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="tts-dropdown-menu">
          <div
            className={`tts-dropdown-item ${!value ? 'selected' : ''}`}
            onClick={() => handleSelect('')}
          >
            <span>{autoLabel}</span>
            {!value && <Check size={12} />}
          </div>

          {Object.entries(groupedVoices).map(([lang, voices]) => (
            <div key={lang}>
              <div className="tts-dropdown-group">{lang}</div>
              {voices.map(voice => (
                <div
                  key={voice.id}
                  className={`tts-dropdown-item ${value === voice.id ? 'selected' : ''}`}
                  onClick={() => handleSelect(voice.id)}
                >
                  <span className="tts-dropdown-voice-name">{voice.name}</span>
                  {value === voice.id && <Check size={12} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * TTS 设置区块
 */
const TTSSection = ({ settings, updateSetting, notify }) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);

  const ttsConfig = {
    ...DEFAULT_TTS_CONFIG,
    ...(settings?.tts || {}),
  };

  const loadVoices = useCallback(async () => {
    setIsLoadingVoices(true);
    try {
      await ttsManager.init();
      const voiceList = await ttsManager.getVoices();
      setVoices(voiceList);
    } catch (e) {
      logger.error('Failed to load voices:', e);
      notify?.(t('tts.loadVoicesFailed'), 'error');
    } finally {
      setIsLoadingVoices(false);
    }
  }, [notify, t]);

  useEffect(() => {
    loadVoices();
    ttsManager.onStatusChange((status) => {
      setTtsStatus(status);
      if (status === TTS_STATUS.IDLE) setIsTesting(false);
    });
  }, [loadVoices]);

  const updateTTSConfig = useCallback((key, value) => {
    updateSetting('tts', key, value);
    ttsManager.updateConfig({ [key]: value });
  }, [updateSetting]);

  const getTTSErrorMessage = (e) => {
    const msg = e.message || '';
    if (msg === 'NO_VOICES') {
      return { text: t('tts.noVoicesInstalled'), type: 'warning' };
    }
    if (msg.startsWith('NO_VOICE_FOR_LANG:')) {
      const langCode = msg.split(':')[1];
      const langName = t(`tts.langNames.${langCode}`, { defaultValue: langCode });
      return { text: t('tts.noVoiceForLang', { lang: langName }), type: 'warning' };
    }
    return { text: t('tts.testFailed') + ': ' + e.message, type: 'error' };
  };

  const handleTest = async () => {
    if (isTesting || ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
      setIsTesting(false);
      return;
    }
    setIsTesting(true);
    try {
      const testText = ttsConfig.voiceId ? t('tts.testTextMixed') : t('tts.testTextChinese');
      await ttsManager.speak(testText, {
        lang: 'zh',
        voiceId: ttsConfig.voiceId,
        rate: ttsConfig.rate,
        pitch: ttsConfig.pitch,
        volume: ttsConfig.volume,
      });
    } catch (e) {
      logger.error('TTS test failed:', e);
      const { text, type } = getTTSErrorMessage(e);
      notify?.(text, type);
    } finally {
      setIsTesting(false);
    }
  };

  const groupedVoices = useMemo(() => {
    return voices.reduce((groups, voice) => {
      const langCode = voice.lang.split('-')[0];
      const langNames = {
        'zh': t('tts.langNames.zh'), 'en': t('tts.langNames.en'),
        'ja': t('tts.langNames.ja'), 'ko': t('tts.langNames.ko'),
        'fr': t('tts.langNames.fr'), 'de': t('tts.langNames.de'),
        'es': t('tts.langNames.es'), 'ru': t('tts.langNames.ru'),
        'pt': t('tts.langNames.pt'), 'it': t('tts.langNames.it'),
      };
      const groupName = langNames[langCode] || voice.lang;
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(voice);
      return groups;
    }, {});
  }, [voices, t]);

  const noVoices = !isLoadingVoices && voices.length === 0;

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
            <div className="tts-slider-header">
              <label className="setting-label">{t('tts.defaultVoice')}</label>
              <span className={`tts-voice-count ${noVoices ? 'empty' : ''}`}>
                {isLoadingVoices ? '...' : voices.length > 0
                  ? t('tts.voicesLoaded', { count: voices.length })
                  : t('tts.noVoicesInstalled')}
              </span>
            </div>

            <div className="setting-row">
              <VoiceDropdown
                value={ttsConfig.voiceId || ''}
                onChange={(id) => updateTTSConfig('voiceId', id)}
                groupedVoices={groupedVoices}
                noVoices={noVoices}
                isLoading={isLoadingVoices}
                autoLabel={t('tts.autoSelect')}
                emptyLabel="—"
              />
              <button
                className="setting-btn-icon"
                onClick={loadVoices}
                disabled={isLoadingVoices}
                title={t('tts.refreshVoices')}
              >
                <RefreshCw size={14} className={isLoadingVoices ? 'spinning' : ''} />
              </button>
            </div>

            {noVoices && (
              <div className="tts-voice-warning">
                <AlertTriangle size={14} className="tts-voice-warning-icon" />
                <div className="tts-voice-warning-text">
                  <div className="tts-voice-warning-title">{t('tts.noVoicesInstalled')}</div>
                  <div className="tts-voice-warning-hint">{t('tts.installVoiceHint')}</div>
                </div>
              </div>
            )}

            {!noVoices && !isLoadingVoices && (
              <p className="setting-hint">{t('tts.autoSelectHint')}</p>
            )}
          </div>

          {/* 语速 / 音调 / 音量 */}
          <div className="tts-slider-group">
            <div className="setting-group tts-slider-item">
              <div className="tts-slider-header">
                <label className="setting-label">{t('tts.rate')}</label>
                <span className="tts-slider-value">{ttsConfig.rate.toFixed(1)}x</span>
              </div>
              <input type="range" className="setting-range" min="0.5" max="2" step="0.1"
                value={ttsConfig.rate}
                onChange={(e) => updateTTSConfig('rate', parseFloat(e.target.value))}
              />
              <p className="setting-hint">{t('tts.rateHint')}</p>
            </div>

            <div className="setting-group tts-slider-item">
              <div className="tts-slider-header">
                <label className="setting-label">{t('tts.pitch')}</label>
                <span className="tts-slider-value">{ttsConfig.pitch.toFixed(1)}</span>
              </div>
              <input type="range" className="setting-range" min="0.5" max="2" step="0.1"
                value={ttsConfig.pitch}
                onChange={(e) => updateTTSConfig('pitch', parseFloat(e.target.value))}
              />
              <p className="setting-hint">{t('tts.pitchHint')}</p>
            </div>

            <div className="setting-group tts-slider-item">
              <div className="tts-slider-header">
                <label className="setting-label">{t('tts.volume')}</label>
                <span className="tts-slider-value">{Math.round(ttsConfig.volume * 100)}%</span>
              </div>
              <input type="range" className="setting-range" min="0" max="1" step="0.1"
                value={ttsConfig.volume}
                onChange={(e) => updateTTSConfig('volume', parseFloat(e.target.value))}
              />
              <p className="setting-hint">{t('tts.volumeHint')}</p>
            </div>
          </div>

          {/* 试听 */}
          <div className="tts-preview">
            <button
              className={`tts-preview-btn ${isTesting ? 'stop' : 'play'}`}
              onClick={handleTest}
              disabled={noVoices}
            >
              {isTesting ? <><Square size={14} />{t('tts.stop')}</> : <><Play size={14} />{t('tts.play')}</>}
            </button>
            {noVoices && <span className="tts-preview-status">{t('tts.noVoicesInstalled')}</span>}
          </div>
        </>
      )}
    </div>
  );
};

export default TTSSection;
