// src/components/ProviderSettings/index.jsx
// 翻译源设置组件 - 分组面板风格 (启用/停用分区)

import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronUp, Check, X, AlertCircle,
  RefreshCw, Eye, EyeOff, ExternalLink, GripVertical,
  Zap, Globe, Plus, Settings, Power
} from 'lucide-react';
import { getAllProviderMetadata } from '../../providers/registry.js';
import translationService from '../../services/translation.js';
import './styles.css';
import createLogger from '../../utils/logger.js';
const logger = createLogger('ProviderSettings');

// ========== 安全存储 ==========
const secureStorage = {
  async get(key) {
    if (window.electron?.secureStorage) {
      return await window.electron.secureStorage.decrypt(key);
    }
    const encoded = localStorage.getItem(`__secure_${key}`);
    if (encoded) {
      try {
        return decodeURIComponent(atob(encoded));
      } catch { return null; }
    }
    return null;
  },
  async set(key, value) {
    if (window.electron?.secureStorage) {
      return await window.electron.secureStorage.encrypt(key, value);
    }
    const encoded = btoa(encodeURIComponent(value));
    localStorage.setItem(`__secure_${key}`, encoded);
    return true;
  }
};

// ========== 图标映射 ==========
const PROVIDER_ICONS = {
  'local-llm': '🖥️',
  'openai': '🤖',
  'gemini': '✨',
  'deepseek': '⚡',
  'deepl': '📘',
  'google-translate': '🌐',
};

// ========== 类型标签颜色 ==========
const TYPE_COLORS = {
  'llm': '#8b5cf6',
  'api': '#3b82f6',
  'traditional': '#10b981',
};

/**
 * 翻译源设置组件 - 分组面板风格
 */
const ProviderSettings = forwardRef(({ settings, updateSettings, notify }, ref) => {
  const { t } = useTranslation();
  
  const allProvidersMeta = getAllProviderMetadata();
  
  const [providers, setProviders] = useState([]);
  const [providerConfigs, setProviderConfigs] = useState({});
  const [expandedProvider, setExpandedProvider] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});
  const [testingProvider, setTestingProvider] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const initializedRef = useRef(false);
  
  // ========== 分组：启用 vs 停用 ==========
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

  // ========== 初始化 ==========
  useEffect(() => {
    const savedProviders = settings?.translation?.providers;
    const savedConfigs = settings?.translation?.providerConfigs || {};
    
    const hasRealData = savedProviders && savedProviders.length > 0;
    
    const needsInit = !initializedRef.current || 
      (hasRealData && providers.length > 0 && 
       JSON.stringify(savedProviders.map(p => p.id)) !== JSON.stringify(providers.map(p => p.id)));
    
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
            if (field.encrypted) {
              const decrypted = await secureStorage.get(`provider_${meta.id}_${key}`);
              if (decrypted) {
                configs[meta.id][key] = decrypted;
              }
            }
          }
        }
      }
      
      setProviderConfigs(configs);
      initializedRef.current = true;
    };
    
    initProviders();
  }, [settings?.translation?.providers, allProvidersMeta]);

  // ========== 保存 ==========
  const saveSettings = useCallback(async () => {
    setIsSaving(true);
    
    try {
      const configsToSave = {};
      
      for (const meta of allProvidersMeta) {
        configsToSave[meta.id] = { ...providerConfigs[meta.id] };
        
        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            if (field.encrypted && configsToSave[meta.id][key]) {
              await secureStorage.set(`provider_${meta.id}_${key}`, configsToSave[meta.id][key]);
              configsToSave[meta.id][key] = '***encrypted***';
            }
          }
        }
      }
      
      updateSettings('translation', 'providers', providers, true);
      updateSettings('translation', 'providerConfigs', configsToSave, true);
      
      if (window.electron?.store) {
        const currentSettings = await window.electron.store.get('settings') || {};
        const newSettings = {
          ...currentSettings,
          translation: {
            ...currentSettings.translation,
            providers,
            providerConfigs: configsToSave,
          }
        };
        await window.electron.store.set('settings', newSettings);
      }
      
      await translationService.reload({
        providers: {
          list: providers,
          configs: providerConfigs,
        }
      });
      
      if (window.electron?.glass?.notifySettingsChanged) {
        await window.electron.glass.notifySettingsChanged();
      }
      
      notify?.(t('providerSettings.saved'), 'success');
    } catch (error) {
      logger.error('Save failed:', error);
      notify?.(t('providerSettings.saveFailed') + ': ' + error.message, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [providers, providerConfigs, updateSettings, notify, allProvidersMeta]);

  useImperativeHandle(ref, () => ({
    save: saveSettings
  }), [saveSettings]);

  // ========== 切换启用 ==========
  const toggleProvider = (providerId) => {
    const newProviders = providers.map(p => 
      p.id === providerId ? { ...p, enabled: !p.enabled } : p
    );
    setProviders(newProviders);
    if (updateSettings) {
      updateSettings('translation', 'providers', newProviders);
    }
  };

  // ========== 快速启用（从停用区点击） ==========
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

  // ========== 更新配置 ==========
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

  // ========== 测试连接 ==========
  const testConnection = async (providerId) => {
    setTestingProvider(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: null }));
    
    try {
      const config = providerConfigs[providerId];
      const result = await translationService.testProviderWithConfig(providerId, config);
      setTestResults(prev => ({ ...prev, [providerId]: result }));
    } catch (error) {
      setTestResults(prev => ({ 
        ...prev, 
        [providerId]: { success: false, message: error.message || '连接失败' }
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  // ========== 移动优先级 ==========
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

  // ========== 拖拽 ==========
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

  // ========== 状态 ==========
  const getStatusColor = (providerId) => {
    const result = testResults[providerId];
    if (result?.success) return '#10b981';
    if (result?.success === false) return '#ef4444';
    return '#9ca3af';
  };

  const getStatusText = (providerId) => {
    const result = testResults[providerId];
    if (testingProvider === providerId) return t('providerSettings.testing');
    if (result?.success) return t('providerSettings.connected');
    if (result?.success === false) return result.message || t('providerSettings.connectionFailed');
    return t('providerSettings.notTested');
  };

  // ========== 配置表单 ==========
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
            <label className="ps-label">
              {field.label}
              {field.required && <span className="ps-required">*</span>}
            </label>
            
            {field.type === 'password' ? (
              <div className="ps-input-group">
                <input
                  type={showPasswords[`${providerId}_${key}`] ? 'text' : 'password'}
                  value={config[key] || ''}
                  onChange={(e) => updateConfig(providerId, key, e.target.value)}
                  placeholder={field.placeholder}
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
                <span>{field.label}</span>
              </label>
            ) : field.type === 'select' ? (
              <select
                value={config[key] || field.default || ''}
                onChange={(e) => updateConfig(providerId, key, e.target.value)}
                className="ps-select"
              >
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type || 'text'}
                value={config[key] || ''}
                onChange={(e) => updateConfig(providerId, key, e.target.value)}
                placeholder={field.placeholder}
                className="ps-input"
              />
            )}
          </div>
        ))}
        
        {meta.helpUrl && (
          <a href={meta.helpUrl} target="_blank" rel="noopener noreferrer" className="ps-help-link">
            <ExternalLink size={14} />
            {t('providerSettings.getApiKey', { defaultValue: '获取 API Key' })}
          </a>
        )}
      </div>
    );
  };

  // ========== 已启用列表中的排名 ==========
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

      {/* ===== 已启用区域 ===== */}
      <div className="ps-section">
        <div className="ps-section-header">
          <div className="ps-section-title">
            <span className="ps-section-dot enabled"></span>
            <span>{t('providerSettings.enabledSection', { defaultValue: '已启用' })}</span>
            <span className="ps-section-count">{enabledProviders.length}</span>
          </div>
          <span className="ps-section-hint">{t('providerSettings.priorityHint')}</span>
        </div>

        {enabledProviders.length === 0 ? (
          <div className="ps-empty">
            <Power size={20} />
            <span>{t('providerSettings.noEnabled', { defaultValue: '尚未启用任何翻译源' })}</span>
          </div>
        ) : (
          <div className="ps-active-list">
            {enabledProviders.map((provider) => {
              const meta = allProvidersMeta.find(m => m.id === provider.id);
              if (!meta) return null;
              
              const isExpanded = expandedProvider === provider.id;
              const typeColor = TYPE_COLORS[meta.type] || TYPE_COLORS['api'];
              const typeLabel = t(`providerSettings.typeLabels.${meta.type}`) || meta.type;
              const rank = getEnabledRank(provider.id);
              const isDragOver = dragOverIndex === provider.originalIndex && draggedIndex !== provider.originalIndex;
              
              return (
                <div 
                  key={provider.id}
                  className={`ps-card ${isExpanded ? 'expanded' : ''} ${isDragOver ? 'drag-over' : ''}`}
                  style={{ '--accent': meta.color || typeColor }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, provider.originalIndex)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, provider.originalIndex)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, provider.originalIndex)}
                >
                  {/* 卡片头部 */}
                  <div className="ps-card-header">
                    <div className="ps-priority">{rank}</div>

                    <div className="ps-icon">
                      {PROVIDER_ICONS[provider.id] || '📦'}
                    </div>

                    <div className="ps-info">
                      <div className="ps-title">
                        <span className="ps-name">{t(`providerSettings.names.${provider.id}`, { defaultValue: meta.name })}</span>
                        <span className="ps-tag" style={{ background: typeColor }}>
                          {typeLabel}
                        </span>
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

                  {/* 排序手柄 */}
                  <div className="ps-drag-hint">
                    <GripVertical size={12} />
                  </div>

                  {/* 展开内容 */}
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

      {/* ===== 未启用区域 ===== */}
      {disabledProviders.length > 0 && (
        <div className="ps-section">
          <div className="ps-section-header">
            <div className="ps-section-title">
              <span className="ps-section-dot disabled"></span>
              <span>{t('providerSettings.disabledSection', { defaultValue: '未启用' })}</span>
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
                      {PROVIDER_ICONS[provider.id] || '📦'}
                    </div>
                    <div className="ps-mini-info">
                      <div className="ps-mini-name">{t(`providerSettings.names.${provider.id}`, { defaultValue: meta.name })}</div>
                      <div className="ps-mini-desc">{t(`providerSettings.descriptions.${provider.id}`, { defaultValue: meta.description })}</div>
                    </div>
                    <button 
                      className="ps-enable-btn"
                      onClick={(e) => { e.stopPropagation(); enableProvider(provider.id); }}
                    >
                      <Plus size={13} />
                      <span>{t('providerSettings.enable', { defaultValue: '启用' })}</span>
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
});

ProviderSettings.displayName = 'ProviderSettings';

export default ProviderSettings;
