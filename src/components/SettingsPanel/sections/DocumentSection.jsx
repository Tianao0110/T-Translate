import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';
import { Seg, Switch } from './shared';
import LayoutModelCard from './LayoutModelCard.jsx';

const DocumentSection = ({
  settings,
  updateSetting,
  notify,
  confirm
}) => {
  const { t } = useTranslation();

  const updateFilter = (key, value) => {
    updateSetting('document', 'filters', {
      ...settings.document?.filters,
      [key]: value
    });
  };

  const filters = settings.document?.filters || {};

  const skipShort = filters.skipShort ?? true;

  return (
    <div className="setting-content">
      <h3>{t('settingsNav.document')}</h3>

      {/* How a document is cut, how many pieces run at once, how results show.
          Supported formats are listed on the document page's drop zone. */}
      <div className="setting-group">
        <div className="field-grid doc-fields">
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
          <span>{t('documentSettings.concurrency')}</span>
          <input
            type="number"
            className="setting-input small"
            value={settings.document?.concurrency || 2}
            onChange={(e) => updateSetting('document', 'concurrency', Math.min(Math.max(parseInt(e.target.value) || 2, 1), 6))}
            min="1"
            max="6"
          />
          <span>{t('documentSettings.displayStyle')}</span>
          <Seg
            value={settings.document?.displayStyle || 'below'}
            onChange={(v) => updateSetting('document', 'displayStyle', v)}
            options={[
              { value: 'below', label: t('documentSettings.styleBelow') },
              { value: 'side-by-side', label: t('documentSettings.styleSideBySide') },
            ]}
          />
        </div>
      </div>

      {/* Two rows tall on wide windows, so the layout model sits under the
          fields instead of alone in a third row. */}
      <div className="setting-group doc-filter-group">
        <label className="setting-label">
          <Filter size={16} /> {t('documentSettings.smartFilter')}
        </label>
        {/* The length threshold sits on the same line as its switch. */}
        <div className="doc-filter-row">
          <Switch
            checked={skipShort}
            onChange={(on) => updateFilter('skipShort', on)}
            label={t('documentSettings.skipShort')}
          />
          {skipShort && (
            <>
              <span className="input-suffix">{t('documentSettings.minLength')}</span>
              <input
                type="number"
                className="setting-input small"
                value={filters.minLength || 10}
                onChange={(e) => updateFilter('minLength', Math.min(Math.max(parseInt(e.target.value) || 10, 1), 50))}
                min="1"
                max="50"
              />
            </>
          )}
        </div>
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

      <LayoutModelCard notify={notify} confirm={confirm} />
    </div>
  );
};

export default DocumentSection;
