import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import ProviderSettings from '../../ProviderSettings';

// forwardRef so callers can grab the inner ProviderSettings ref.
const ProvidersSection = forwardRef(({
  settings,
  settingsReady,
  updateSetting,
  notify
}, ref) => {
  const { t } = useTranslation();

  return (
    <div className="setting-content">
      <h3>{t('providerSettings.title')}</h3>
      <p className="setting-description">{t('providerSettings.description')}</p>
      
      <ProviderSettings 
        ref={ref}
        settings={settings}
        settingsReady={settingsReady}
        updateSettings={updateSetting}
        notify={notify}
      />
    </div>
  );
});

ProvidersSection.displayName = 'ProvidersSection';

export default ProvidersSection;
