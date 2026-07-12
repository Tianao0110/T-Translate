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
    displayMode: 'auto',
    ...(settings.floatingWindow || {}),
  };

  const getOcrEngineName = (engine) => {
    const names = {
      'llm-vision': 'LLM Vision',
      'windows-ocr': 'Windows OCR',
      'rapid-ocr': t('ocr.localOcrName', 'Local OCR (PP-OCRv6)'),
    };
    return names[engine] || engine;
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.floatingWindow.title')}</h3>
      <p className="setting-description">{t('floatingWindow.description')}</p>
      
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

      {/* 显示模式 */}
      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.displayMode', '显示模式')}</label>
        <select
          className="setting-select"
          value={gw.displayMode}
          onChange={(e) => updateSetting('floatingWindow', 'displayMode', e.target.value)}
        >
          <option value="auto">{t('floatingWindow.modeAuto', '自动')}</option>
          <option value="scattered">{t('floatingWindow.modeScattered', '散点')}</option>
          <option value="unified">{t('floatingWindow.modeUnified', '整段')}</option>
        </select>
        <p className="setting-hint">{t('floatingWindow.displayModeHint', '自动＝按内容判断；散点＝每块文字原位贴译文（界面标签、单词、漫画）；整段＝合并为一段译文（文章段落）')}</p>
      </div>

      {/* 默认透明度 */}
      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.defaultOpacity')}</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="1"
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
