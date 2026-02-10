// src/components/SettingsPanel/sections/GlassWindowSection.jsx
// 玻璃窗口设置区块组件 - 国际化版

import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 玻璃窗口设置区块
 */
const GlassWindowSection = ({
  settings,
  updateSetting,
  handleSectionChange
}) => {
  const { t } = useTranslation();

  // 安全读取 glassWindow 设置，兼容 glass/glassWindow 两种 key
  const gw = {
    defaultOpacity: 0.95,
    rememberPosition: false,
    autoPin: true,
    lockTargetLang: false,
    smartDetect: true,
    ...(settings.glass || {}),
    ...(settings.glassWindow || {}),
  };
  // 兼容 opacity → defaultOpacity
  if (gw.defaultOpacity === undefined && gw.opacity !== undefined) {
    gw.defaultOpacity = gw.opacity;
  }

  // 获取 OCR 引擎显示名称
  const getOcrEngineName = (engine) => {
    const names = {
      'llm-vision': 'LLM Vision',
      'windows-ocr': 'Windows OCR',
      'paddle-ocr': 'PaddleOCR',
      'rapid-ocr': 'RapidOCR',
    };
    return names[engine] || engine;
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.glass.title')}</h3>
      <p className="setting-description">{t('glass.description')}</p>
      
      {/* 锁定目标语言 */}
      <div className="setting-group">
        <label className="setting-label">{t('glass.lockTargetLang')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${gw.lockTargetLang ? 'active' : ''}`}
            onClick={() => updateSetting('glassWindow', 'lockTargetLang', !gw.lockTargetLang)}
          >
            {gw.lockTargetLang ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {gw.lockTargetLang ? t('glass.lockTargetLangOnDesc') : t('glass.lockTargetLangOffDesc')}
          </span>
        </div>
        <p className="setting-hint">{t('glass.lockTargetLangHint')}</p>
      </div>

      {/* 智能检测 */}
      <div className="setting-group">
        <label className="setting-label">{t('glass.smartDetect')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${gw.smartDetect ? 'active' : ''}`}
            onClick={() => updateSetting('glassWindow', 'smartDetect', !gw.smartDetect)}
          >
            {gw.smartDetect ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {gw.smartDetect ? t('glass.smartDetectOnDesc') : t('glass.smartDetectOffDesc')}
          </span>
        </div>
      </div>

      {/* OCR 引擎 */}
      <div className="setting-group">
        <label className="setting-label">{t('glass.ocrEngine')}</label>
        <div className="setting-hint-inline">
          {t('glass.useGlobalOcr', {engine: getOcrEngineName(settings.ocr.engine)})}
          <button 
            className="link-button"
            onClick={() => handleSectionChange('ocr')}
            style={{marginLeft: '8px'}}
          >
            {t('glass.goToSettings')} →
          </button>
        </div>
      </div>

      {/* 默认透明度 */}
      <div className="setting-group">
        <label className="setting-label">{t('glass.defaultOpacity')}</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="30"
            max="100"
            value={Math.round(gw.defaultOpacity * 100)}
            onChange={(e) => updateSetting('glassWindow', 'defaultOpacity', parseInt(e.target.value) / 100)}
          />
          <span className="range-value">{Math.round(gw.defaultOpacity * 100)}%</span>
        </div>
        <p className="setting-hint">{t('glass.opacityHint')}</p>
      </div>

      {/* 窗口选项 */}
      <div className="setting-group">
        <label className="setting-label">{t('glass.windowOptions')}</label>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={gw.rememberPosition}
              onChange={(e) => updateSetting('glassWindow', 'rememberPosition', e.target.checked)}
            />
            <span>{t('glass.rememberPosition')}</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={gw.autoPin}
              onChange={(e) => updateSetting('glassWindow', 'autoPin', e.target.checked)}
            />
            <span>{t('glass.autoPin')}</span>
          </label>
        </div>
      </div>

      {/* 快捷键 */}
      <div className="setting-group">
        <label className="setting-label">{t('shortcuts.title')}</label>
        <div className="shortcut-info">
          <div className="shortcut-item">
            <kbd>Ctrl+Alt+G</kbd>
            <span>{t('glass.shortcut.toggle')}</span>
          </div>
          <div className="shortcut-item">
            <kbd>Space</kbd>
            <span>{t('glass.shortcut.capture')}</span>
          </div>
          <div className="shortcut-item">
            <kbd>Esc</kbd>
            <span>{t('glass.shortcut.exit')}</span>
          </div>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="setting-group">
        <label className="setting-label">{t('glass.instructions')}</label>
        <div className="info-box">
          <p><strong>{t('glass.normalMode')}：</strong>{t('glass.normalModeDesc')}</p>
        </div>
      </div>
    </div>
  );
};

export default GlassWindowSection;
