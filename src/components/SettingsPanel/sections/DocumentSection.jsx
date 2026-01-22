// src/components/SettingsPanel/sections/DocumentSection.jsx
// 文档翻译设置区块组件 - 国际化版

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';

/**
 * 文档翻译设置区块
 */
const DocumentSection = ({
  settings,
  updateSetting
}) => {
  const { t } = useTranslation();

  // 更新过滤器设置的辅助函数
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

      {/* 分段设置 */}
      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.segmentSettings')}</label>
        <div className="setting-row">
          <span>{t('documentSettings.maxCharsPerSegment')}</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.maxCharsPerSegment || 800}
            onChange={(e) => updateSetting('document', 'maxCharsPerSegment', parseInt(e.target.value) || 800)}
            min="200"
            max="2000"
            step="100"
          />
        </div>
        <p className="setting-hint">{t('documentSettings.segmentHint')}</p>
      </div>

      {/* 批量设置 */}
      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.batchTranslation')}</label>
        <div className="setting-row">
          <span>{t('documentSettings.batchMaxTokens')}</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.batchMaxTokens || 2000}
            onChange={(e) => updateSetting('document', 'batchMaxTokens', parseInt(e.target.value) || 2000)}
            min="500"
            max="4000"
            step="500"
          />
        </div>
        <div className="setting-row">
          <span>{t('documentSettings.batchMaxSegments')}</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.batchMaxSegments || 5}
            onChange={(e) => updateSetting('document', 'batchMaxSegments', parseInt(e.target.value) || 5)}
            min="1"
            max="10"
          />
        </div>
        <p className="setting-hint">{t('documentSettings.batchHint')}</p>
      </div>

      {/* 过滤规则 */}
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
              onChange={(e) => updateFilter('minLength', parseInt(e.target.value) || 10)}
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

      {/* 显示样式 */}
      <div className="setting-group">
        <label className="setting-label">{t('documentSettings.displayStyle')}</label>
        <select
          className="setting-select"
          value={settings.document?.displayStyle || 'below'}
          onChange={(e) => updateSetting('document', 'displayStyle', e.target.value)}
        >
          <option value="below">⬇️ {t('documentSettings.styleBelow')}</option>
          <option value="side-by-side">⬛ {t('documentSettings.styleSideBySide')}</option>
          <option value="source-only">📄 {t('documentSettings.styleSourceOnly')}</option>
          <option value="translated-only">🌐 {t('documentSettings.styleTranslatedOnly')}</option>
        </select>
      </div>

      {/* 支持格式 */}
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
