// src/components/SettingsPanel/sections/TTSSection.jsx
// TTS 朗读设置 - 样式统一版

import React, { useState, useEffect, useCallback } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG, TTS_STATUS } from '../../../services/tts/index.js';

/**
 * TTS 设置区块
 */
const TTSSection = ({ settings, updateSetting, notify }) => {
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
      notify?.('加载语音列表失败', 'error');
    } finally {
      setIsLoadingVoices(false);
    }
  }, [notify]);

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
        ? '这是语音朗读测试。This is a TTS test.'
        : '你好，这是语音朗读功能测试。';
      
      await ttsManager.speak(testText, {
        lang: 'zh',
        voiceId: ttsConfig.voiceId,
        rate: ttsConfig.rate,
        pitch: ttsConfig.pitch,
        volume: ttsConfig.volume,
      });
    } catch (e) {
      console.error('TTS test failed:', e);
      notify?.('试听失败: ' + e.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  // 按语言分组语音
  const groupedVoices = voices.reduce((groups, voice) => {
    const langCode = voice.lang.split('-')[0];
    const langNames = {
      'zh': '中文',
      'en': '英语',
      'ja': '日语',
      'ko': '韩语',
      'fr': '法语',
      'de': '德语',
      'es': '西班牙语',
      'ru': '俄语',
      'pt': '葡萄牙语',
      'it': '意大利语',
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
      <h3>朗读设置</h3>
      <p className="setting-description">配置文本朗读功能和语音参数</p>

      {/* 启用开关 */}
      <div className="setting-group">
        <label className="setting-switch">
          <input
            type="checkbox"
            checked={ttsConfig.enabled}
            onChange={(e) => updateTTSConfig('enabled', e.target.checked)}
          />
          <span className="switch-slider"></span>
          <span className="switch-label">启用文本朗读</span>
        </label>
        <p className="setting-hint">在翻译面板显示朗读按钮</p>
      </div>

      {ttsConfig.enabled && (
        <>
          {/* 语音选择 */}
          <div className="setting-group">
            <label className="setting-label">默认语音</label>
            <div className="setting-row">
              <select
                className="setting-select"
                value={ttsConfig.voiceId || ''}
                onChange={(e) => updateTTSConfig('voiceId', e.target.value)}
                disabled={isLoadingVoices}
                style={{ flex: 1 }}
              >
                <option value="">自动选择</option>
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
                title="刷新语音列表"
              >
                <RefreshCw size={14} className={isLoadingVoices ? 'spinning' : ''} />
              </button>
            </div>
            <p className="setting-hint">
              {voices.length > 0 
                ? `已加载 ${voices.length} 个可用语音` 
                : '自动根据文本语言选择合适的语音'}
            </p>
          </div>

          {/* 语速 */}
          <div className="setting-group">
            <label className="setting-label">语速: {ttsConfig.rate.toFixed(1)}x</label>
            <input
              type="range"
              className="setting-range"
              min="0.5"
              max="2"
              step="0.1"
              value={ttsConfig.rate}
              onChange={(e) => updateTTSConfig('rate', parseFloat(e.target.value))}
            />
            <p className="setting-hint">调整朗读速度，1.0 为正常语速</p>
          </div>

          {/* 音调 */}
          <div className="setting-group">
            <label className="setting-label">音调: {ttsConfig.pitch.toFixed(1)}</label>
            <input
              type="range"
              className="setting-range"
              min="0.5"
              max="2"
              step="0.1"
              value={ttsConfig.pitch}
              onChange={(e) => updateTTSConfig('pitch', parseFloat(e.target.value))}
            />
            <p className="setting-hint">调整声音音调，1.0 为正常音调</p>
          </div>

          {/* 音量 */}
          <div className="setting-group">
            <label className="setting-label">音量: {Math.round(ttsConfig.volume * 100)}%</label>
            <input
              type="range"
              className="setting-range"
              min="0"
              max="1"
              step="0.1"
              value={ttsConfig.volume}
              onChange={(e) => updateTTSConfig('volume', parseFloat(e.target.value))}
            />
            <p className="setting-hint">调整朗读音量大小</p>
          </div>

          {/* 试听 */}
          <div className="setting-group" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)' }}>
            <label className="setting-label">试听效果</label>
            <p className="setting-hint" style={{ marginBottom: '12px' }}>使用当前设置播放测试语音</p>
            <button 
              className={`action-button ${isTesting ? 'danger' : 'primary'}`}
              onClick={handleTest}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {isTesting ? (
                <>
                  <Square size={14} />
                  停止播放
                </>
              ) : (
                <>
                  <Play size={14} />
                  播放试听
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
