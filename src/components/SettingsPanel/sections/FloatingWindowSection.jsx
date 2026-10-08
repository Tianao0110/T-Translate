// Floating-window settings section.

import { useTranslation } from 'react-i18next';
import { Seg, Switch, Slider } from './shared';
import { defaultConfig } from '../constants.js';

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

  // Display names as the OCR page shows them.
  const getOcrEngineName = (engine) => {
    const names = {
      'rapid-ocr': t('ocr.localOcrName'),
      'windows-ocr': 'Windows OCR',
      'tengine-vision': t('ocr.tengineVision.name'),
      'llm-vision': 'LLM Vision',
      'ocrspace': 'OCR.space',
      'google-vision': 'Google Vision',
      'azure-ocr': 'Azure OCR',
      'baidu-ocr': t('ocr.baiduOcr'),
    };
    return names[engine] || engine;
  };

  const opacityPct = Math.round(gw.defaultOpacity * 100);
  // The open/close shortcut is a global one the appearance page can change,
  // so show the configured key; Space and Esc are fixed inside the window.
  const toggleKey = settings.shortcuts?.floatingWindow || defaultConfig.shortcuts.floatingWindow;

  return (
    <div className="setting-content">
      <h3>{t('settings.floatingWindow.title')}</h3>

      {/* The window: how results are laid out, how see-through it starts,
          whether screen capture sees it. */}
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
        <div className="sliders solo" style={{ marginTop: '16px' }}>
          <Slider
            label={t('floatingWindow.defaultOpacity')}
            display={`${opacityPct}%`}
            min={1}
            max={100}
            value={opacityPct}
            onChange={(v) => updateSetting('floatingWindow', 'defaultOpacity', Math.round(v) / 100)}
          />
        </div>
        <div style={{ marginTop: '16px' }}>
          <Switch
            checked={gw.captureVisible}
            onChange={(on) => updateSetting('floatingWindow', 'captureVisible', on)}
            label={t('floatingWindow.captureVisible')}
          />
        </div>
      </div>

      {/* What it reads with and how to drive it — both set elsewhere, shown
          here for reference. */}
      <div className="setting-group">
        <div className="storage-grid floating-info">
          <span className="storage-label">{t('floatingWindow.ocrEngine')}</span>
          <span className="storage-value">
            {t('floatingWindow.useGlobalOcr', { engine: getOcrEngineName(settings.ocr.engine) })}
            <button className="link-button" onClick={() => handleSectionChange('ocr')}>
              {t('floatingWindow.goToSettings')} →
            </button>
          </span>
          <span className="storage-label">{t('shortcuts.title')}</span>
          <div className="shortcut-info">
            <kbd>{toggleKey}</kbd>
            <span>{t('floatingWindow.shortcut.toggle')}</span>
            <kbd>Space</kbd>
            <span>{t('floatingWindow.shortcut.capture')}</span>
            <kbd>Esc</kbd>
            <span>{t('floatingWindow.shortcut.exit')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloatingWindowSection;
