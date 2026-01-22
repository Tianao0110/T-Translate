// src/components/SettingsPanel/sections/TranslationSection.jsx
// 翻译设置区块组件 - 国际化版

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

/**
 * 翻译设置区块
 */
const TranslationSection = ({
  settings,
  updateSetting,
  notify,
  // Store 状态
  autoTranslate,
  setAutoTranslate,
  autoTranslateDelay,
  setAutoTranslateDelay,
  useStreamOutput,
  setUseStreamOutput
}) => {
  const { t } = useTranslation();

  // 清除缓存
  const handleClearCache = () => {
    if (window.confirm(t('translationSettings.clearCacheConfirm'))) {
      localStorage.removeItem('translation-cache');
      notify(t('translationSettings.cacheCleared'), 'success');
    }
  };

  return (
    <div className="setting-content">
      <h3>{t('translationSettings.title')}</h3>
      <p className="setting-description">{t('translationSettings.description')}</p>
      
      {/* 自动翻译 */}
      <div className="setting-group">
        <label className="setting-switch">
          <input 
            type="checkbox" 
            checked={autoTranslate} 
            onChange={(e) => setAutoTranslate(e.target.checked)} 
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('translationSettings.autoTranslate')}</span>
        </label>
        <p className="setting-hint">{t('translationSettings.autoTranslateHint')}</p>
      </div>
      
      {/* 自动翻译延迟 - 只在开启自动翻译时显示 */}
      {autoTranslate && (
        <div className="setting-group">
          <label className="setting-label">{t('translationSettings.autoDelay')}: {autoTranslateDelay}ms</label>
          <input 
            type="range" 
            className="setting-range" 
            min="300" 
            max="2000" 
            step="100"
            value={autoTranslateDelay} 
            onChange={(e) => setAutoTranslateDelay(parseInt(e.target.value))} 
          />
          <p className="setting-hint">{t('translationSettings.autoDelayHint')}</p>
        </div>
      )}
      
      {/* 流式输出 */}
      <div className="setting-group">
        <label className="setting-switch">
          <input 
            type="checkbox" 
            checked={useStreamOutput} 
            onChange={(e) => setUseStreamOutput(e.target.checked)} 
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('translationSettings.streamOutput')}</span>
        </label>
        <p className="setting-hint">{t('translationSettings.streamOutputHint')}</p>
      </div>
      
      {/* 缓存管理 */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '12px', color: 'var(--text-secondary)'}}>{t('translationSettings.cache')}</h4>
        <p className="setting-hint" style={{marginBottom: '12px'}}>
          {t('translationSettings.cacheHint')}
        </p>
        <button className="danger-button" onClick={handleClearCache}>
          <Trash2 size={16} /> {t('translationSettings.clearCache')}
        </button>
      </div>
    </div>
  );
};

export default TranslationSection;
