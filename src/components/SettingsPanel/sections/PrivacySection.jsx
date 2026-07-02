// Privacy mode picker + data-management actions.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Shield, Lock, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import useTranslationStore from '../../../stores/translation-store';
import translationService from '../../../services/translation.js';
import { PRIVACY_MODES, PRIVACY_MODE_IDS } from '../constants.js';

const formatBytes = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const PrivacySection = ({
  settings,
  updateSetting,
  notify,
  confirm
}) => {
  const { t } = useTranslation();
  // Reactive subscription — nothing else re-renders this section on mode change
  const currentMode = useTranslationStore((s) => s.translationMode) || PRIVACY_MODE_IDS.STANDARD;
  const modeConfig = PRIVACY_MODES[currentMode];

  // PRIVACY_MODES stores icon names as strings (so the config file stays
  // pure data); resolve them to actual lucide components here.
  const getModeIcon = (iconName, size = 24) => {
    const icons = {
      'Zap': Zap,
      'Shield': Shield,
      'Lock': Lock,
    };
    const IconComponent = icons[iconName] || Zap;
    return <IconComponent size={size} />;
  };

  const getModeName = (modeId) => {
    const modeKeys = {
      [PRIVACY_MODE_IDS.STANDARD]: 'privacy.modes.standard',
      [PRIVACY_MODE_IDS.OFFLINE]: 'privacy.modes.offline',
      [PRIVACY_MODE_IDS.SECURE]: 'privacy.modes.incognito',
    };
    return t(modeKeys[modeId] || 'privacy.modes.standard');
  };

  const getModeDesc = (modeId) => {
    const descKeys = {
      [PRIVACY_MODE_IDS.STANDARD]: 'privacy.modes.standardDesc',
      [PRIVACY_MODE_IDS.OFFLINE]: 'privacy.modes.offlineDesc',
      [PRIVACY_MODE_IDS.SECURE]: 'privacy.modes.incognitoDesc',
    };
    return t(descKeys[modeId] || 'privacy.modes.standardDesc');
  };

  // Storage footprint for the data-management panel. Counts come from the
  // store, sizes from localStorage scan + a main-process stat call.
  const [dataStats, setDataStats] = useState(null);

  const refreshDataStats = useCallback(async () => {
    const state = useTranslationStore.getState();

    let localStorageBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        localStorageBytes += k.length + (localStorage.getItem(k)?.length || 0);
      }
    } catch { /* size stays 0 */ }

    let cacheCount = 0;
    try {
      cacheCount = translationService.getCacheStats()?.l2Stats?.total ?? 0;
    } catch { /* count stays 0 */ }

    const main = (await window.electron?.app?.getDataStats?.()) || {};

    setDataStats({
      historyCount: state.history.length,
      favoritesCount: state.favorites.length,
      cacheCount,
      localStorageBytes,
      settingsFileSize: main.settingsFileSize || 0,
      logsDirSize: main.logsDirSize || 0,
    });
  }, []);

  useEffect(() => {
    refreshDataStats();
  }, [refreshDataStats]);

  // Mode change hits two places: translation-store (persisted; drives the
  // secure-mode history stash) and main process (offline gate + key access).
  const handleModeChange = (mode) => {
    useTranslationStore.getState().setTranslationMode(mode.id);
    window.electron?.privacy?.setMode?.(mode.id);
    notify(t('privacy.switchedTo', { mode: getModeName(mode.id) }), 'success');
  };

  const handleClearHistory = async () => {
    if (!(await confirm(t('privacy.clearHistoryConfirm')))) return;
    useTranslationStore.getState().clearHistory?.();
    notify(t('privacy.historyCleared'), 'success');
    refreshDataStats();
  };

  const handleClearAllData = async () => {
    if (!(await confirm(t('privacy.clearAllConfirm')))) return;
    localStorage.clear();
    window.electron?.store?.clear?.();
    window.location.reload();
  };

  const handleClearCache = async () => {
    if (!(await confirm(t('translationSettings.clearCacheConfirm')))) return;
    translationService.clearCache();
    notify(t('translationSettings.cacheCleared'), 'success');
    refreshDataStats();
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.privacy.title')}</h3>
      <p className="setting-description">{t('privacy.modeDescription')}</p>
      
      {/* Current mode banner */}
      <div className={`current-mode-banner mode-${currentMode}`}>
        <div className="mode-banner-icon">
          {getModeIcon(modeConfig?.icon, 20)}
        </div>
        <div className="mode-banner-info">
          <span className="mode-banner-label">{t('privacy.currentMode')}</span>
          <span className="mode-banner-name">{getModeName(currentMode)}</span>
        </div>
      </div>
      
      {/* Mode selection cards */}
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

      {/* Feature matrix for the active mode */}
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

      {/* Data management */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '16px', color: 'var(--text-primary)'}}>🗂️ {t('privacy.dataManagement')}</h4>

        {dataStats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px 16px',
            marginBottom: '16px',
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            fontSize: '13px',
          }}>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.history')}</span><br/>{dataStats.historyCount} {t('privacy.stats.items')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.favorites')}</span><br/>{dataStats.favoritesCount} {t('privacy.stats.items')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.cache')}</span><br/>{dataStats.cacheCount} {t('privacy.stats.items')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.localData')}</span><br/>{formatBytes(dataStats.localStorageBytes)}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.settingsFile')}</span><br/>{formatBytes(dataStats.settingsFileSize)}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.logs')}</span><br/>{formatBytes(dataStats.logsDirSize)}</div>
          </div>
        )}

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
          <button className="danger-button" onClick={handleClearCache}>
            <Trash2 size={16} /> {t('translationSettings.clearCache')}
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
