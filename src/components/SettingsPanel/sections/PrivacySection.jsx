// src/components/SettingsPanel/sections/PrivacySection.jsx
// 隐私与安全设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Shield, Lock, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import useTranslationStore from '../../../stores/translation-store';
import { PRIVACY_MODES, PRIVACY_MODE_IDS } from '../constants.js';

/**
 * 隐私与安全设置区块
 */
const PrivacySection = ({
  settings,
  updateSetting,
  notify
}) => {
  const { t } = useTranslation();
  const currentMode = useTranslationStore.getState().translationMode || PRIVACY_MODE_IDS.STANDARD;
  const modeConfig = PRIVACY_MODES[currentMode];

  // 获取模式图标组件
  const getModeIcon = (iconName, size = 24) => {
    const icons = {
      'Zap': Zap,
      'Shield': Shield,
      'Lock': Lock,
    };
    const IconComponent = icons[iconName] || Zap;
    return <IconComponent size={size} />;
  };

  // 获取国际化的模式名称
  const getModeName = (modeId) => {
    const modeKeys = {
      [PRIVACY_MODE_IDS.STANDARD]: 'settings.privacy.modes.standard',
      [PRIVACY_MODE_IDS.OFFLINE]: 'settings.privacy.modes.offline',
      [PRIVACY_MODE_IDS.SECURE]: 'settings.privacy.modes.incognito',
      [PRIVACY_MODE_IDS.STRICT]: 'settings.privacy.modes.strict',
    };
    return t(modeKeys[modeId] || 'settings.privacy.modes.standard');
  };

  // 获取国际化的模式描述
  const getModeDesc = (modeId) => {
    const descKeys = {
      [PRIVACY_MODE_IDS.STANDARD]: 'settings.privacy.modes.standardDesc',
      [PRIVACY_MODE_IDS.OFFLINE]: 'settings.privacy.modes.offlineDesc',
      [PRIVACY_MODE_IDS.SECURE]: 'settings.privacy.modes.incognitoDesc',
      [PRIVACY_MODE_IDS.STRICT]: 'settings.privacy.modes.strictDesc',
    };
    return t(descKeys[modeId] || 'settings.privacy.modes.standardDesc');
  };

  // 切换隐私模式
  const handleModeChange = (mode) => {
    updateSetting('privacy', 'mode', mode.id);
    useTranslationStore.getState().setTranslationMode(mode.id);
    window.electron?.privacy?.setMode?.(mode.id);
    notify(t('privacy.switchedTo', { mode: getModeName(mode.id) }), 'success');
  };

  // 清除历史记录
  const handleClearHistory = () => {
    if (window.confirm(t('privacy.clearHistoryConfirm'))) {
      useTranslationStore.getState().clearHistory?.();
      notify(t('privacy.historyCleared'), 'success');
    }
  };

  // 清除所有数据
  const handleClearAllData = () => {
    if (window.confirm(t('privacy.clearAllConfirm'))) {
      localStorage.clear();
      window.electron?.store?.clear?.();
      window.location.reload();
    }
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.privacy.title')}</h3>
      <p className="setting-description">{t('privacy.modeDescription')}</p>
      
      {/* 当前模式状态提示 */}
      <div className={`current-mode-banner mode-${currentMode}`}>
        <div className="mode-banner-icon">
          {getModeIcon(modeConfig?.icon, 20)}
        </div>
        <div className="mode-banner-info">
          <span className="mode-banner-label">{t('privacy.currentMode')}</span>
          <span className="mode-banner-name">{getModeName(currentMode)}</span>
        </div>
      </div>
      
      {/* 模式选择卡片 */}
      <div className="mode-selection-grid">
        {Object.values(PRIVACY_MODES).map((mode) => {
          const isSelected = currentMode === mode.id;
          
          return (
            <div 
              key={mode.id}
              className={`mode-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleModeChange(mode)}
            >
              <div className="mode-icon">{getModeIcon(mode.icon)}</div>
              <div className="mode-info">
                <h4>{getModeName(mode.id)}</h4>
                <p>{getModeDesc(mode.id)}</p>
              </div>
              {isSelected && <div className="mode-check"><CheckCircle size={18} /></div>}
            </div>
          );
        })}
      </div>

      {/* 当前模式功能说明 */}
      <div className="mode-features-panel">
        <h4>📋 {t('privacy.featuresTitle')}</h4>
        <div className="feature-list">
          <div className={`feature-item ${modeConfig?.features.saveHistory ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.saveHistory ? '✓' : '✗'}</span>
            <span className="feature-name">{t('privacy.features.history')}</span>
            <span className="feature-status">{modeConfig?.features.saveHistory ? t('privacy.save') : t('privacy.noSave')}</span>
          </div>
          <div className={`feature-item ${modeConfig?.features.useCache ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.useCache ? '✓' : '✗'}</span>
            <span className="feature-name">{t('privacy.features.cache')}</span>
            <span className="feature-status">{modeConfig?.features.useCache ? t('common.enable') : t('common.disable')}</span>
          </div>
          <div className={`feature-item ${modeConfig?.features.onlineApi ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.onlineApi ? '✓' : '✗'}</span>
            <span className="feature-name">{t('privacy.features.onlineApi')}</span>
            <span className="feature-status">{modeConfig?.features.onlineApi ? t('privacy.allow') : t('privacy.deny')}</span>
          </div>
          <div className={`feature-item ${modeConfig?.features.analytics ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.analytics ? '✓' : '✗'}</span>
            <span className="feature-name">{t('privacy.features.analytics')}</span>
            <span className="feature-status">{modeConfig?.features.analytics ? t('privacy.collect') : t('privacy.noCollect')}</span>
          </div>
        </div>
        
        {currentMode === PRIVACY_MODE_IDS.OFFLINE && (
          <div className="mode-warning">
            <AlertCircle size={16} />
            <span>{t('privacy.offlineWarning')}</span>
          </div>
        )}
        
        {currentMode === PRIVACY_MODE_IDS.SECURE && (
          <div className="mode-warning secure">
            <Shield size={16} />
            <span>{t('privacy.incognitoWarning')}</span>
          </div>
        )}
      </div>

      {/* 数据管理 */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '16px', color: 'var(--text-primary)'}}>🗂️ {t('privacy.dataManagement')}</h4>
        
        <div className="setting-row">
          <span>{t('privacy.autoDeleteHistory')}</span>
          <div className="input-with-suffix">
            <input
              type="number"
              className="setting-input small"
              value={settings.privacy?.autoDeleteDays || 0}
              onChange={(e) => updateSetting('privacy', 'autoDeleteDays', parseInt(e.target.value) || 0)}
              min="0"
              max="365"
              disabled={currentMode === PRIVACY_MODE_IDS.SECURE}
            />
            <span className="input-suffix">{t('privacy.daysLater')}</span>
          </div>
        </div>
        <p className="setting-hint">
          {t('privacy.zeroMeansNever')}
          {currentMode === PRIVACY_MODE_IDS.SECURE ? t('privacy.incognitoDisabled') : ''}
        </p>
      </div>

      <div className="setting-group">
        <div className="danger-actions">
          <button className="danger-button" onClick={handleClearHistory}>
            <Trash2 size={16} /> {t('settings.privacy.clearHistory')}
          </button>
          <button className="danger-button" onClick={handleClearAllData}>
            <Trash2 size={16} /> {t('settings.privacy.clearAll')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacySection;
