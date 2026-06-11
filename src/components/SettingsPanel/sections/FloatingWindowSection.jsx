// Floating-window settings section.

import React from 'react';
import { useTranslation } from 'react-i18next';

const FloatingWindowSection = ({
  settings,
  updateSetting,
  handleSectionChange
}) => {
  const { t } = useTranslation();

  // Fallbacks mirror DEFAULT_SETTINGS.floatingWindow.
  const gw = {
    defaultOpacity: 0.85,
    lockTargetLang: false,
    ...(settings.floatingWindow || {}),
  };

  const getOcrEngineName = (engine) => {
    const names = {
      'llm-vision': 'LLM Vision',
      'windows-ocr': 'Windows OCR',
      'rapid-ocr': t('ocr.localOcrName', 'Local OCR (PP-OCRv5)'),
    };
    return names[engine] || engine;
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.floatingWindow.title')}</h3>
      <p className="setting-description">{t('floatingWindow.description')}</p>
      
      {/* 锁定目标语言 */}
      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.lockTargetLang')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${gw.lockTargetLang ? 'active' : ''}`}
            onClick={() => updateSetting('floatingWindow', 'lockTargetLang', !gw.lockTargetLang)}
          >
            {gw.lockTargetLang ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {gw.lockTargetLang ? t('floatingWindow.lockTargetLangOnDesc') : t('floatingWindow.lockTargetLangOffDesc')}
          </span>
        </div>
        <p className="setting-hint">{t('floatingWindow.lockTargetLangHint')}</p>
      </div>

      {/* OCR 引擎 */}
      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.ocrEngine')}</label>
        <div className="setting-hint-inline">
          {t('floatingWindow.useGlobalOcr', {engine: getOcrEngineName(settings.ocr.engine)})}
          <button 
            className="link-button"
            onClick={() => handleSectionChange('ocr')}
            style={{marginLeft: '8px'}}
          >
            {t('floatingWindow.goToSettings')} →
          </button>
        </div>
      </div>

      {/* 默认透明度 */}
      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.defaultOpacity')}</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="30"
            max="100"
            value={Math.round(gw.defaultOpacity * 100)}
            onChange={(e) => updateSetting('floatingWindow', 'defaultOpacity', parseInt(e.target.value) / 100)}
          />
          <span className="range-value">{Math.round(gw.defaultOpacity * 100)}%</span>
        </div>
        <p className="setting-hint">{t('floatingWindow.opacityHint')}</p>
      </div>

      {/* 快捷键 */}
      <div className="setting-group">
        <label className="setting-label">{t('shortcuts.title')}</label>
        <div className="shortcut-info">
          <div className="shortcut-item">
            <kbd>Ctrl+Alt+G</kbd>
            <span>{t('floatingWindow.shortcut.toggle')}</span>
          </div>
          <div className="shortcut-item">
            <kbd>Space</kbd>
            <span>{t('floatingWindow.shortcut.capture')}</span>
          </div>
          <div className="shortcut-item">
            <kbd>Esc</kbd>
            <span>{t('floatingWindow.shortcut.exit')}</span>
          </div>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.instructions')}</label>
        <div className="info-box">
          <p><strong>{t('floatingWindow.normalMode')}：</strong>{t('floatingWindow.normalModeDesc')}</p>
        </div>
      </div>
    </div>
  );
};

export default FloatingWindowSection;
