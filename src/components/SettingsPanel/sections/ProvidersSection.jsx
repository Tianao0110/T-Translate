// src/components/SettingsPanel/sections/ProvidersSection.jsx
// 翻译源设置区块组件 - 从 SettingsPanel 拆分

import React, { forwardRef } from 'react';
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
  return (
    <div className="setting-content">
      <h3>翻译源设置</h3>
      <p className="setting-description">配置翻译服务，支持本地模型和在线 API</p>
      
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
