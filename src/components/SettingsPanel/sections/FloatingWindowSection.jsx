// Floating-window settings section.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Seg, Switch, Slider } from './shared';

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
    captureVisible: false,
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

  const opacityPct = Math.round(gw.defaultOpacity * 100);

  return (
    <div className="setting-content">
      <h3>{t('settings.floatingWindow.title')}</h3>

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

      <div className="setting-group">
        <label className="setting-label">{t('floatingWindow.displayMode')}</label>
        <Seg
          value={gw.displayMode}
          onChange={(v) => updateSetting('floatingWindow', 'displayMode', v)}
          options={[
            { value: 'auto', label: t('floatingWindow.modeAuto') },
            { value: 'scattered', label: t('floatingWindow.modeScattered') },
            { value: 'unified', label: t('floatingWindow.modeUnified') },
          ]}
        />
      </div>

      <div className="setting-group">
        <div className="sliders solo">
          <Slider
            label={t('floatingWindow.defaultOpacity')}
            display={`${opacityPct}%`}
            min={1}
            max={100}
            value={opacityPct}
            onChange={(v) => updateSetting('floatingWindow', 'defaultOpacity', Math.round(v) / 100)}
          />
        </div>
      </div>

      <div className="setting-group">
        <Switch
          checked={gw.captureVisible}
          onChange={(on) => updateSetting('floatingWindow', 'captureVisible', on)}
          label={t('floatingWindow.captureVisible')}
        />
      </div>

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
    </div>
  );
};

export default FloatingWindowSection;
