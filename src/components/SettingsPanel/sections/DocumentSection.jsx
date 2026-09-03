import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';
import { Seg, Switch } from './shared';

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

  const filters = settings.document?.filters || {};

  return (
    <div className="setting-content">
      <h3>{t('documentSettings.title')}</h3>

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
      </div>

      <div className="setting-group">
        <label className="setting-label">
          <Filter size={16} /> {t('documentSettings.smartFilter')}
        </label>
        <Switch
          checked={filters.skipShort ?? true}
          onChange={(on) => updateFilter('skipShort', on)}
          label={t('documentSettings.skipShort')}
        />
        {(filters.skipShort ?? true) && (
          <div className="setting-row sub-setting">
            <span>{t('documentSettings.minLength')}</span>
            <input
              type="number"
              className="setting-input small"
              value={filters.minLength || 10}
              onChange={(e) => updateFilter('minLength', Math.min(Math.max(parseInt(e.target.value) || 10, 1), 50))}
              min="1"
              max="50"
            />
          </div>
        )}
        <Switch
          checked={filters.skipNumbers ?? true}
          onChange={(on) => updateFilter('skipNumbers', on)}
          label={t('documentSettings.skipNumbers')}
        />
        <Switch
          checked={filters.skipCode ?? true}
          onChange={(on) => updateFilter('skipCode', on)}
          label={t('documentSettings.skipCode')}
        />
        <Switch
          checked={filters.skipTargetLang ?? true}
          onChange={(on) => updateFilter('skipTargetLang', on)}
          label={t('documentSettings.skipTargetLang')}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.displayStyle')}</label>
        <Seg
          value={settings.document?.displayStyle || 'below'}
          onChange={(v) => updateSetting('document', 'displayStyle', v)}
          options={[
            { value: 'below', label: t('documentSettings.styleBelow') },
            { value: 'side-by-side', label: t('documentSettings.styleSideBySide') },
          ]}
        />
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
      </div>
    </div>
  );
};

export default DocumentSection;
