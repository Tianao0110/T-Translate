import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';

const DocumentSection = ({
  settings,
  updateSetting
}) => {
  const { t } = useTranslation();

  const updateFilter = (key, value) => {
    updateSetting('document', 'filters', {
      ...settings.document?.filters,
      [key]: value
    });
  };

  return (
    <div className="setting-content">
      <h3>{t('documentSettings.title')}</h3>
      <p className="setting-description">{t('documentSettings.description')}</p>

      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.segmentSettings')}</label>
        <div className="setting-row">
          <span>{t('documentSettings.maxCharsPerSegment')}</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.maxCharsPerSegment || 800}
            onChange={(e) => updateSetting('document', 'maxCharsPerSegment', Math.min(Math.max(parseInt(e.target.value) || 800, 200), 2000))}
            min="200"
            max="2000"
            step="100"
          />
        </div>
        <p className="setting-hint">{t('documentSettings.segmentHint')}</p>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.parallelTranslation')}</label>
        <div className="setting-row">
          <span>{t('documentSettings.concurrency')}</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.concurrency || 2}
            onChange={(e) => updateSetting('document', 'concurrency', Math.min(Math.max(parseInt(e.target.value) || 2, 1), 6))}
            min="1"
            max="6"
          />
        </div>
        <p className="setting-hint">{t('documentSettings.concurrencyHint')}</p>
      </div>

      <div className="setting-group">
        <label className="setting-label">
          <Filter size={16} /> {t('documentSettings.smartFilter')}
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipShort ?? true}
            onChange={(e) => updateFilter('skipShort', e.target.checked)}
          />
          <span>{t('documentSettings.skipShort')}</span>
        </label>
        {settings.document?.filters?.skipShort && (
          <div className="setting-row sub-setting">
            <span>{t('documentSettings.minLength')}</span>
            <input
              type="number"
              className="setting-input small"
              value={settings.document?.filters?.minLength || 10}
              onChange={(e) => updateFilter('minLength', Math.min(Math.max(parseInt(e.target.value) || 10, 1), 50))}
              min="1"
              max="50"
            />
          </div>
        )}
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipNumbers ?? true}
            onChange={(e) => updateFilter('skipNumbers', e.target.checked)}
          />
          <span>{t('documentSettings.skipNumbers')}</span>
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipCode ?? true}
            onChange={(e) => updateFilter('skipCode', e.target.checked)}
          />
          <span>{t('documentSettings.skipCode')}</span>
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.document?.filters?.skipTargetLang ?? true}
            onChange={(e) => updateFilter('skipTargetLang', e.target.checked)}
          />
          <span>{t('documentSettings.skipTargetLang')}</span>
        </label>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.displayStyle')}</label>
        <select
          className="setting-select"
          value={settings.document?.displayStyle || 'below'}
          onChange={(e) => updateSetting('document', 'displayStyle', e.target.value)}
        >
          <option value="below">{t('documentSettings.styleBelow')}</option>
          <option value="side-by-side">{t('documentSettings.styleSideBySide')}</option>
        </select>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.supportedFormats')}</label>
        <div className="format-tags">
          <span className="format-tag">TXT</span>
          <span className="format-tag">MD</span>
          <span className="format-tag">SRT</span>
          <span className="format-tag">VTT</span>
          <span className="format-tag">PDF</span>
          <span className="format-tag">DOCX</span>
          <span className="format-tag">CSV</span>
          <span className="format-tag">JSON</span>
          <span className="format-tag">EPUB</span>
        </div>
        <p className="setting-hint">{t('documentSettings.formatHint')}</p>
      </div>
    </div>
  );
};

export default DocumentSection;
