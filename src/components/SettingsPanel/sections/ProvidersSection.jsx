// src/components/SettingsPanel/sections/ProvidersSection.jsx
// 翻译源设置区块组件 - 国际化版

import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import ProviderSettings from '../../ProviderSettings';

/**
 * 翻译源设置区块
 * 使用 forwardRef 以支持 ref 传递给 ProviderSettings
 */
const ProvidersSection = forwardRef(({
  settings,
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
        updateSettings={updateSetting}
        notify={notify}
      />
    </div>
  );
});

ProvidersSection.displayName = 'ProvidersSection';

export default ProvidersSection;
