import React from 'react';
import { useTranslation } from 'react-i18next';
import ProviderSettings from '../../ProviderSettings';

const ProvidersSection = ({
  settings,
  settingsReady,
  updateSetting,
  notify
}) => {
  const { t } = useTranslation();

  return (
    <div className="setting-content">
      <h3>{t('providerSettings.title')}</h3>

      <ProviderSettings
        settings={settings}
        settingsReady={settingsReady}
        updateSettings={updateSetting}
        notify={notify}
      />
    </div>
  );
};

export default ProvidersSection;
