import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronUp, Check, X, AlertCircle,
  RefreshCw, Eye, EyeOff, ExternalLink, GripVertical,
  Zap, Globe, Plus, Settings, Power, MessageSquareOff
} from 'lucide-react';
import { getAllProviderMetadata } from '../../config/provider-icons.js';
import translationService from '../../services/stack-client.js';
import useTranslationStore from '../../stores/translation-store';
import { secureStorage } from './persist.js';
import './styles.css';
import createLogger from '../../utils/logger.js';
const logger = createLogger('ProviderSettings');

// Status/type colors resolve to theme tokens (defined in ProviderSettings/styles.css).
const TYPE_COLOR_VARS = {
  'llm': 'var(--ps-type-llm)',
  'api': 'var(--ps-type-api)',
  'traditional': 'var(--ps-type-traditional)',
};

const ProviderSettings = ({ settings, settingsReady, updateSettings, notify }) => {
  const { t } = useTranslation();

  // useMemo so getAllProviderMetadata() returns a stable reference and
  // doesn't retrigger the init effect on every render.
  const allProvidersMeta = useMemo(() => getAllProviderMetadata(), []);

  const [providers, setProviders] = useState([]);
  const [providerConfigs, setProviderConfigs] = useState({});
  const [expandedProvider, setExpandedProvider] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});
  const [testingProvider, setTestingProvider] = useState(null);
  const [testResults, setTestResults] = useState({});
  const initializedRef = useRef(false);

  const { enabledProviders, disabledProviders } = useMemo(() => {
    const enabled = [];
    const disabled = [];
    providers.forEach((p, index) => {
      const item = { ...p, originalIndex: index };
      if (p.enabled) {
        enabled.push(item);
      } else {
        disabled.push(item);
      }
    });
    return { enabledProviders: enabled, disabledProviders: disabled };
  }, [providers]);

  useEffect(() => {
    // Wait for settings to load from disk before initializing — otherwise
    // we'd overwrite saved provider configs with defaults.
    if (!settingsReady) return;

    const savedProviders = settings?.translation?.providers;
    const savedConfigs = settings?.translation?.providerConfigs || {};

    const hasRealData = savedProviders && savedProviders.length > 0;

    const needsInit = !initializedRef.current ||
      (hasRealData && providers.length > 0 &&
       JSON.stringify(savedProviders.map(p => ({ id: p.id, enabled: p.enabled }))) !==
       JSON.stringify(providers.map(p => ({ id: p.id, enabled: p.enabled }))));

    if (!needsInit) return;

    const initProviders = async () => {
      let providerList;

      if (hasRealData) {
        providerList = [];
        const savedIds = new Set(savedProviders.map(p => p.id));

        for (const saved of savedProviders) {
          const meta = allProvidersMeta.find(m => m.id === saved.id);
          if (meta) {
            providerList.push({
              id: saved.id,
              enabled: saved.enabled ?? false,
              priority: saved.priority ?? providerList.length,
            });
          }
        }

        for (const meta of allProvidersMeta) {
          if (!savedIds.has(meta.id)) {
            providerList.push({
              id: meta.id,
              enabled: false,
              priority: providerList.length,
            });
          }
        }
      } else {
        providerList = allProvidersMeta.map((meta, index) => ({
          id: meta.id,
          enabled: index === 0,
          priority: index,
        }));
      }

      providerList.forEach((p, i) => p.priority = i);
      setProviders(providerList);

      const configs = {};
      for (const meta of allProvidersMeta) {
        const defaultConfig = {};
        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            defaultConfig[key] = field.default || '';
          }
        }

        configs[meta.id] = { ...defaultConfig, ...savedConfigs[meta.id] };

        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            // Only pull from the vault when the seed has no value — on a tab
            // re-mount savedConfigs already carries the user's unsaved edit,
            // and the old decrypt would clobber it with the on-disk key.
            if (field.encrypted && !configs[meta.id][key]) {
              const decrypted = await secureStorage.get(`provider_${meta.id}_${key}`, 'settings-load');
              if (decrypted) {
                configs[meta.id][key] = decrypted;
              }
            }
          }
        }
      }

      setProviderConfigs(configs);
      // Mirror the decrypted configs up to the parent so SettingsPanel's
      // unified save has complete provider data even if the user never edits
      // a field (silent: this is a load-time sync, not a user change).
      updateSettings?.('translation', 'providerConfigs', configs, true);
      initializedRef.current = true;
    };

    initProviders();
    // updateSettings intentionally omitted: it changes identity on every
    // parent render and would re-run this decrypt loop pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, settings?.translation?.providers, allProvidersMeta]);

  const toggleProvider = (providerId) => {
    const newProviders = providers.map(p =>
      p.id === providerId ? { ...p, enabled: !p.enabled } : p
    );
    setProviders(newProviders);
    if (updateSettings) {
      updateSettings('translation', 'providers', newProviders);
    }
  };

  const enableProvider = (providerId) => {
    const newProviders = providers.map(p =>
      p.id === providerId ? { ...p, enabled: true } : p
    );
    setProviders(newProviders);
    setExpandedProvider(providerId);
    if (updateSettings) {
      updateSettings('translation', 'providers', newProviders);
    }
  };

  const updateConfig = (providerId, key, value) => {
    const newConfigs = {
      ...providerConfigs,
      [providerId]: { ...providerConfigs[providerId], [key]: value }
    };
    setProviderConfigs(newConfigs);
    if (updateSettings) {
      updateSettings('translation', 'providerConfigs', newConfigs);
    }
  };

  const testConnection = async (providerId) => {
    setTestingProvider(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: null }));

    try {
      const config = providerConfigs[providerId];
      // Offline still blocks explicit test clicks ("no network requests, full
      // stop") — the gate now lives in the main-process facade, which applies
      // the live mode; nothing to pass from here.
      const result = await translationService.testProviderWithConfig(providerId, config);
      setTestResults(prev => ({ ...prev, [providerId]: result }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [providerId]: { success: false, message: error.message || 'Connection failed' }
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const moveProvider = (index, direction) => {
    const newProviders = [...providers];
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= newProviders.length) return;

    [newProviders[index], newProviders[targetIndex]] = [newProviders[targetIndex], newProviders[index]];
    newProviders.forEach((p, i) => p.priority = i);

    setProviders(newProviders);
    if (updateSettings) {
      updateSettings('translation', 'providers', newProviders);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.target.closest('.ps-card')?.classList.add('dragging');
  };

  const handleDragEnd = (e) => {
    e.target.closest('.ps-card')?.classList.remove('dragging');
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && index !== draggedIndex) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newProviders = [...providers];
    const [draggedItem] = newProviders.splice(draggedIndex, 1);
    newProviders.splice(targetIndex, 0, draggedItem);
    newProviders.forEach((p, i) => p.priority = i);

    setProviders(newProviders);
    setDraggedIndex(null);
    setDragOverIndex(null);

    if (updateSettings) {
      updateSettings('translation', 'providers', newProviders);
    }
  };

  const getStatusColor = (providerId) => {
    const result = testResults[providerId];
    if (result?.success) return 'var(--success)';
    if (result?.success === false) return 'var(--error)';
    return 'var(--text-tertiary)';
  };

  const getStatusText = (providerId) => {
    const result = testResults[providerId];
    if (testingProvider === providerId) return t('providerSettings.testing');
    if (result?.success) return t('providerSettings.connected');
    if (result?.success === false) return result.message || t('providerSettings.connectionFailed');
    return t('providerSettings.notTested');
  };

  // Field/option/placeholder lookups: prefer i18n key
  // providerConfig.{providerId}.{fieldKey} (with `_<value>` for option
  // labels and `_placeholder` for placeholders); fall back to the raw
  // schema label if no translation exists.
  const getFieldLabel = (providerId, fieldKey, originalLabel) => {
    const i18nKey = `providerConfig.${providerId}.${fieldKey}`;
    const translated = t(i18nKey);
    return translated !== i18nKey ? translated : originalLabel;
  };

  const getOptionLabel = (providerId, fieldKey, optValue, originalLabel) => {
    const i18nKey = `providerConfig.${providerId}.${fieldKey}_${optValue}`;
    const translated = t(i18nKey);
    return translated !== i18nKey ? translated : originalLabel;
  };

  const getFieldPlaceholder = (providerId, fieldKey, originalPlaceholder) => {
    const i18nKey = `providerConfig.${providerId}.${fieldKey}_placeholder`;
    const translated = t(i18nKey);
    return translated !== i18nKey ? translated : originalPlaceholder;
  };

  const renderConfigForm = (providerId) => {
    const meta = allProvidersMeta.find(m => m.id === providerId);
    const config = providerConfigs[providerId] || {};

    if (!meta?.configSchema || Object.keys(meta.configSchema).length === 0) {
      return (
        <div className="ps-config-empty">
          <Globe size={20} />
          <span>{t('providerSettings.noConfig')}</span>
        </div>
      );
    }

    return (
      <div className="ps-config-form">
        {Object.entries(meta.configSchema).map(([key, field]) => (
          <div key={key} className="ps-field">
            {field.type !== 'checkbox' && (
              <label className="ps-label">
                {getFieldLabel(providerId, key, field.label)}
                {field.required && <span className="ps-required">*</span>}
              </label>
            )}

            {field.type === 'password' ? (
              <div className="ps-input-group">
                <input
                  type={showPasswords[`${providerId}_${key}`] ? 'text' : 'password'}
                  value={config[key] || ''}
                  onChange={(e) => updateConfig(providerId, key, e.target.value)}
                  placeholder={getFieldPlaceholder(providerId, key, field.placeholder)}
                  className="ps-input"
                />
                <button
                  type="button"
                  className="ps-input-btn"
                  onClick={() => setShowPasswords(prev => ({
                    ...prev,
                    [`${providerId}_${key}`]: !prev[`${providerId}_${key}`]
                  }))}
                >
                  {showPasswords[`${providerId}_${key}`] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            ) : field.type === 'checkbox' ? (
              <label className="ps-checkbox">
                <input
                  type="checkbox"
                  checked={config[key] || false}
                  onChange={(e) => updateConfig(providerId, key, e.target.checked)}
                />
                <span>{getFieldLabel(providerId, key, field.label)}</span>
              </label>
            ) : field.type === 'select' ? (
              <select
                value={config[key] || field.default || ''}
                onChange={(e) => updateConfig(providerId, key, e.target.value)}
                className="ps-select"
              >
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{getOptionLabel(providerId, key, opt.value, opt.label)}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type || 'text'}
                value={config[key] || ''}
                onChange={(e) => updateConfig(providerId, key, e.target.value)}
                placeholder={getFieldPlaceholder(providerId, key, field.placeholder)}
                className="ps-input"
              />
            )}
          </div>
        ))}

        {meta.helpUrl && (
          <a href={meta.helpUrl} target="_blank" rel="noopener noreferrer" className="ps-help-link">
            <ExternalLink size={14} />
            {t('providerSettings.getApiKey', { defaultValue: 'Get API Key' })}
          </a>
        )}
      </div>
    );
  };

  const getEnabledRank = (providerId) => {
    let rank = 0;
    for (const p of providers) {
      if (p.enabled) {
        rank++;
        if (p.id === providerId) return rank;
      }
    }
    return 0;
  };

  return (
    <div className="ps-container">

      <div className="ps-section">
        <div className="ps-section-header">
          <div className="ps-section-title">
            <span className="ps-section-dot enabled"></span>
            <span>{t('providerSettings.enabledSection', { defaultValue: 'Enabled' })}</span>
            <span className="ps-section-count">{enabledProviders.length}</span>
          </div>
          <span className="ps-section-hint">{t('providerSettings.priorityHint')}</span>
        </div>

        {enabledProviders.length === 0 ? (
          <div className="ps-empty">
            <Power size={20} />
            <span>{t('providerSettings.noEnabled', { defaultValue: 'No providers enabled' })}</span>
          </div>
        ) : (
          <div className="ps-active-list">
            {enabledProviders.map((provider) => {
              const meta = allProvidersMeta.find(m => m.id === provider.id);
              if (!meta) return null;

              const isExpanded = expandedProvider === provider.id;
              const typeColor = TYPE_COLOR_VARS[meta.type] || TYPE_COLOR_VARS['api'];
              const typeLabel = t(`providerSettings.typeLabels.${meta.type}`) || meta.type;
              const rank = getEnabledRank(provider.id);
              const isDragOver = dragOverIndex === provider.originalIndex && draggedIndex !== provider.originalIndex;

              return (
                <div
                  key={provider.id}
                  className={`ps-card ${isExpanded ? 'expanded' : ''} ${isDragOver ? 'drag-over' : ''}`}
                  style={{ '--accent': meta.color || typeColor }}
                  // Only draggable when collapsed — otherwise HTML5 drag intercepts
                  // mousedown inside inputs, breaking text selection by click+drag.
                  draggable={!isExpanded}
                  onDragStart={(e) => handleDragStart(e, provider.originalIndex)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, provider.originalIndex)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, provider.originalIndex)}
                >
                  <div className="ps-card-header">
                    <div className="ps-priority">{rank}</div>

                    <div className="ps-icon">
                      {meta.icon ? <img src={meta.icon} alt="" className="ps-icon-img" /> : <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: '50%', background: meta.color || 'var(--text-tertiary)' }} />}
                    </div>

                    <div className="ps-info">
                      <div className="ps-title">
                        <span className="ps-name">{t(`providerSettings.names.${provider.id}`, { defaultValue: meta.name })}</span>
                        <span className="ps-tag" style={{ background: typeColor }}>
                          {typeLabel}
                        </span>
                        {/* AI actions need a real chat call; a source that only
                            translates would answer a prompt with a translation of
                            that prompt, so its entries stay hidden. Say so here
                            rather than leaving the user to wonder. */}
                        {!meta.supportsChat && (
                          <span className="ps-tag ps-tag-muted" title={t('providerSettings.noAiActionsHint')}>
                            {t('providerSettings.noAiActions')}
                          </span>
                        )}
                      </div>
                      <div className="ps-desc">{t(`providerSettings.descriptions.${provider.id}`, { defaultValue: meta.description })}</div>
                    </div>

                    <div className="ps-card-actions">
                      <button
                        className={`ps-config-btn ${isExpanded ? 'active' : ''}`}
                        onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                        title={t('providerSettings.configDetails')}
                      >
                        <Settings size={15} />
                      </button>
                      <label className="ps-switch">
                        <input
                          type="checkbox"
                          checked={provider.enabled}
                          onChange={() => toggleProvider(provider.id)}
                        />
                        <span className="ps-switch-track"></span>
                      </label>
                    </div>
                  </div>

                  <div className="ps-drag-hint">
                    <GripVertical size={12} />
                  </div>

                  {isExpanded && (
                    <div className="ps-expand-content">
                      {renderConfigForm(provider.id)}

                      <div className="ps-test-row">
                        <button
                          className={`ps-test-btn ${testResults[provider.id]?.success ? 'success' : testResults[provider.id]?.success === false ? 'error' : ''}`}
                          onClick={() => testConnection(provider.id)}
                          disabled={testingProvider === provider.id}
                        >
                          {testingProvider === provider.id ? (
                            <RefreshCw size={14} className="spinning" />
                          ) : (
                            <Zap size={14} />
                          )}
                          <span>{t('providerSettings.testConnection')}</span>
                        </button>

                        <div className="ps-status">
                          <span className="ps-status-dot" style={{ background: getStatusColor(provider.id) }}></span>
                          <span>{getStatusText(provider.id)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {disabledProviders.length > 0 && (
        <div className="ps-section">
          <div className="ps-section-header">
            <div className="ps-section-title">
              <span className="ps-section-dot disabled"></span>
              <span>{t('providerSettings.disabledSection', { defaultValue: 'Disabled' })}</span>
              <span className="ps-section-count">{disabledProviders.length}</span>
            </div>
          </div>

          <div className="ps-disabled-grid">
            {disabledProviders.map((provider) => {
              const meta = allProvidersMeta.find(m => m.id === provider.id);
              if (!meta) return null;

              const isExpanded = expandedProvider === provider.id;

              return (
                <div
                  key={provider.id}
                  className={`ps-mini-card ${isExpanded ? 'expanded' : ''}`}
                >
                  <div
                    className="ps-mini-header"
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                  >
                    <div className="ps-mini-icon">
                      {meta.icon ? <img src={meta.icon} alt="" className="ps-icon-img" /> : <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', background: meta.color || 'var(--text-tertiary)' }} />}
                    </div>
                    <div className="ps-mini-info">
                      <div className="ps-mini-name">
                        <span className="ps-mini-label">{t(`providerSettings.names.${provider.id}`, { defaultValue: meta.name })}</span>
                        {!meta.supportsChat && (
                          <MessageSquareOff
                            size={12}
                            className="ps-no-chat"
                            title={`${t('providerSettings.noAiActions')} — ${t('providerSettings.noAiActionsHint')}`}
                          />
                        )}
                      </div>
                      <div className="ps-mini-desc">{t(`providerSettings.descriptions.${provider.id}`, { defaultValue: meta.description })}</div>
                    </div>
                    <button
                      className="ps-enable-btn"
                      onClick={(e) => { e.stopPropagation(); enableProvider(provider.id); }}
                    >
                      <Plus size={13} />
                      <span>{t('providerSettings.enable', { defaultValue: 'Enable' })}</span>
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ps-expand-content">
                      {renderConfigForm(provider.id)}
                      <div className="ps-test-row">
                        <button
                          className={`ps-test-btn ${testResults[provider.id]?.success ? 'success' : testResults[provider.id]?.success === false ? 'error' : ''}`}
                          onClick={() => testConnection(provider.id)}
                          disabled={testingProvider === provider.id}
                        >
                          {testingProvider === provider.id ? (
                            <RefreshCw size={14} className="spinning" />
                          ) : (
                            <Zap size={14} />
                          )}
                          <span>{t('providerSettings.testConnection')}</span>
                        </button>
                        <div className="ps-status">
                          <span className="ps-status-dot" style={{ background: getStatusColor(provider.id) }}></span>
                          <span>{getStatusText(provider.id)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProviderSettings;
