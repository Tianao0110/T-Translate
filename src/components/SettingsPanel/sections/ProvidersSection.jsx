// src/components/SettingsPanel/sections/ProvidersSection.jsx
// 翻译源设置区块组件 - 含翻译行为设置

import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import ProviderSettings from '../../ProviderSettings';

/**
 * 翻译源设置区块（含自动翻译、流式输出）
 */
const ProvidersSection = forwardRef(({
  settings,
  updateSetting,
  notify,
  // 翻译行为 props
  autoTranslate,
  setAutoTranslate,
  autoTranslateDelay,
  setAutoTranslateDelay,
  useStreamOutput,
  setUseStreamOutput
}, ref) => {
  const { t } = useTranslation();

  return (
    <div className="setting-content">
      <h3>{t('providerSettings.title')}</h3>
      <p className="setting-description">{t('providerSettings.description')}</p>
      
      <ProviderSettings 
        ref={ref}
        settings={settings}
        updateSettings={updateSetting}
        notify={notify}
      />

      {/* 翻译行为设置 */}
      <div className="ps-section" style={{marginTop: '8px'}}>
        <div className="ps-section-header">
          <div className="ps-section-title">
            <span className="ps-section-dot enabled"></span>
            <span>{t('translationSettings.title')}</span>
          </div>
        </div>

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

        {/* 自动翻译延迟 */}
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
      </div>
    </div>
  );
});

ProvidersSection.displayName = 'ProvidersSection';

export default ProvidersSection;
