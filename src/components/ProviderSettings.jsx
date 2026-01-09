// src/components/ProviderSettings.jsx
// 翻译源设置组件 - 动态从 registry 读取翻译源

import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Check, X, AlertCircle,
  RefreshCw, Eye, EyeOff, ExternalLink
} from 'lucide-react';
import { getAllProviderMetadata } from '../providers/registry.js';
import translationService from '../services/translation.js';

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

/**
 * 翻译源设置组件
 */
const ProviderSettings = ({ settings, updateSettings, notify }) => {
  // 从 registry 获取所有翻译源元信息
  const allProvidersMeta = getAllProviderMetadata();
  
  // 翻译源列表（启用状态和优先级）
  const [providers, setProviders] = useState([]);
  
  // 各翻译源配置
  const [providerConfigs, setProviderConfigs] = useState({});
  
  // 展开的配置面板
  const [expandedProvider, setExpandedProvider] = useState(null);
  
  // 显示密码状态
  const [showPasswords, setShowPasswords] = useState({});
  
  // 测试状态
  const [testingProvider, setTestingProvider] = useState(null);
  const [testResults, setTestResults] = useState({});

  // 初始化：从 registry 和 settings 加载
  useEffect(() => {
    const initProviders = async () => {
      // 从 settings 加载已保存的配置
      const savedProviders = settings?.translation?.providers || [];
      const savedConfigs = settings?.translation?.providerConfigs || {};
      
      // 构建 providers 列表（合并 registry 和已保存的状态）
      const providerList = allProvidersMeta.map((meta, index) => {
        const saved = savedProviders.find(p => p.id === meta.id);
        return {
          id: meta.id,
          enabled: saved?.enabled ?? (index === 0), // 默认第一个启用
          priority: saved?.priority ?? index,
        };
      });
      
      // 按优先级排序
      providerList.sort((a, b) => a.priority - b.priority);
      setProviders(providerList);
      
      // 构建配置（合并默认值和已保存的配置）
      const configs = {};
      for (const meta of allProvidersMeta) {
        const defaultConfig = {};
        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            defaultConfig[key] = field.default ?? '';
          }
        }
        configs[meta.id] = { ...defaultConfig, ...savedConfigs[meta.id] };
        
        // 解密加密字段
        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            if (field.encrypted && configs[meta.id][key]) {
              try {
                const decrypted = await secureStorage.get(`provider_${meta.id}_${key}`);
                if (decrypted) {
                  configs[meta.id][key] = decrypted;
                }
              } catch {}
            }
          }
        }
      }
      setProviderConfigs(configs);
    };
    
    initProviders();
  }, [settings]);

  // 保存设置
  const saveSettings = useCallback(async () => {
    // 准备保存的配置（加密敏感字段）
    const configsToSave = {};
    
    for (const meta of allProvidersMeta) {
      configsToSave[meta.id] = { ...providerConfigs[meta.id] };
      
      // 加密敏感字段
      if (meta.configSchema) {
        for (const [key, field] of Object.entries(meta.configSchema)) {
          if (field.encrypted && configsToSave[meta.id][key]) {
            await secureStorage.set(`provider_${meta.id}_${key}`, configsToSave[meta.id][key]);
            configsToSave[meta.id][key] = '***encrypted***';
          }
        }
      }
    }
    
    // 更新父组件 state
    updateSettings('translation', 'providers', providers);
    updateSettings('translation', 'providerConfigs', configsToSave);
    
    // 直接保存到 electron-store（确保立即生效）
    try {
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
      
      // 刷新 translationService 配置
      await translationService.reload({
        providers: {
          list: providers,
          configs: providerConfigs,  // 使用未加密的版本
        }
      });
      
      // 通知玻璃窗重新加载
      if (window.electron?.glass?.notifySettingsChanged) {
        await window.electron.glass.notifySettingsChanged();
      }
      
      notify?.('翻译源设置已保存', 'success');
    } catch (error) {
      console.error('[ProviderSettings] Save failed:', error);
      notify?.('保存失败: ' + error.message, 'error');
    }
  }, [providers, providerConfigs, updateSettings, notify, allProvidersMeta]);

  // 切换启用状态
  const toggleProvider = (providerId) => {
    setProviders(prev => prev.map(p => 
      p.id === providerId ? { ...p, enabled: !p.enabled } : p
    ));
  };

  // 更新配置
  const updateConfig = (providerId, key, value) => {
    setProviderConfigs(prev => ({
      ...prev,
      [providerId]: { ...prev[providerId], [key]: value }
    }));
  };

  // 测试连接（通过 Service）
  const testConnection = async (providerId) => {
    setTestingProvider(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: null }));
    
    try {
      const config = providerConfigs[providerId];
      
      // 使用 translationService 测试连接
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

  // 移动优先级
  const moveProvider = (index, direction) => {
    const newProviders = [...providers];
    const targetIndex = index + direction;
    
    if (targetIndex < 0 || targetIndex >= newProviders.length) return;
    
    [newProviders[index], newProviders[targetIndex]] = [newProviders[targetIndex], newProviders[index]];
    newProviders.forEach((p, i) => p.priority = i);
    
    setProviders(newProviders);
  };

  // 渲染配置表单
  const renderConfigForm = (providerId) => {
    const meta = allProvidersMeta.find(m => m.id === providerId);
    const config = providerConfigs[providerId] || {};
    
    if (!meta?.configSchema) return null;
    
    return (
      <div className="provider-config-form">
        {Object.entries(meta.configSchema).map(([key, field]) => (
          <div key={key} className="config-field">
            <label className="config-label">{field.label}</label>
            
            {field.type === 'password' ? (
              <div className="password-input-wrapper">
                <input
                  type={showPasswords[`${providerId}_${key}`] ? 'text' : 'password'}
                  value={config[key] || ''}
                  onChange={(e) => updateConfig(providerId, key, e.target.value)}
                  placeholder={field.placeholder}
                  className="config-input"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPasswords(prev => ({
                    ...prev,
                    [`${providerId}_${key}`]: !prev[`${providerId}_${key}`]
                  }))}
                >
                  {showPasswords[`${providerId}_${key}`] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            ) : field.type === 'checkbox' ? (
              <label className="checkbox-wrapper">
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
                className="config-select"
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
                className="config-input"
              />
            )}
          </div>
        ))}
        
        {/* 帮助链接 */}
        {meta.helpUrl && (
          <a 
            href={meta.helpUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="help-link"
          >
            <ExternalLink size={14} />
            获取 API Key
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="provider-settings">
      <div className="provider-settings-header">
        <h3>翻译源管理</h3>
        <p className="provider-settings-desc">
          拖动调整优先级，启用的翻译源将按顺序尝试
        </p>
      </div>

      <div className="provider-list">
        {providers.map((provider, index) => {
          const meta = allProvidersMeta.find(m => m.id === provider.id);
          if (!meta) return null;
          
          const isExpanded = expandedProvider === provider.id;
          const testResult = testResults[provider.id];
          
          return (
            <div 
              key={provider.id}
              className={`provider-item ${provider.enabled ? 'enabled' : 'disabled'}`}
            >
              {/* 头部 */}
              <div className="provider-header">
                <div className="provider-drag">
                  <button 
                    className="move-btn"
                    onClick={() => moveProvider(index, -1)}
                    disabled={index === 0}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button 
                    className="move-btn"
                    onClick={() => moveProvider(index, 1)}
                    disabled={index === providers.length - 1}
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                
                <div 
                  className="provider-icon"
                  style={{ backgroundColor: meta.color || '#666' }}
                >
                  <img src={meta.icon} alt={meta.name} />
                </div>
                
                <div className="provider-info">
                  <div className="provider-name">{meta.name}</div>
                  <div className="provider-desc">{meta.description}</div>
                </div>
                
                <div className="provider-actions">
                  {/* 测试按钮 */}
                  <button
                    className={`test-btn ${testResult?.success ? 'success' : testResult?.success === false ? 'error' : ''}`}
                    onClick={() => testConnection(provider.id)}
                    disabled={testingProvider === provider.id}
                    title={testResult?.message || '测试连接'}
                  >
                    {testingProvider === provider.id ? (
                      <RefreshCw size={16} className="spinning" />
                    ) : testResult?.success ? (
                      <Check size={16} />
                    ) : testResult?.success === false ? (
                      <X size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                  </button>
                  
                  {/* 启用开关 */}
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={() => toggleProvider(provider.id)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  
                  {/* 展开按钮 */}
                  <button
                    className="expand-btn"
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                  >
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>
                </div>
              </div>
              
              {/* 配置面板 */}
              {isExpanded && (
                <div className="provider-config">
                  {renderConfigForm(provider.id)}
                  
                  {/* 测试结果 */}
                  {testResult && (
                    <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                      {testResult.success ? <Check size={16} /> : <AlertCircle size={16} />}
                      <span>{testResult.message || (testResult.success ? '连接成功' : '连接失败')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 保存按钮 */}
      <div className="provider-settings-footer">
        <button className="save-btn" onClick={saveSettings}>
          <Check size={16} />
          保存设置
        </button>
      </div>
    </div>
  );
};

export default ProviderSettings;
