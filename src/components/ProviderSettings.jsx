// src/components/ProviderSettings.jsx
// 翻译源设置组件 - 分组卡片风格
// M-V-S-P 架构：View 层，只负责展示和用户交互

import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Check, X, AlertCircle,
  RefreshCw, Eye, EyeOff, ExternalLink, GripVertical,
  Zap, Globe
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

// ========== 图标映射（Emoji 占位） ==========
const PROVIDER_ICONS = {
  'local-llm': '🖥️',
  'openai': '🤖',
  'gemini': '✨',
  'deepseek': '⚡',
  'deepl': '📘',
  'google-translate': '🌐',
};

// ========== 类型标签 ==========
const TYPE_LABELS = {
  'llm': { label: 'AI 大模型', color: '#8b5cf6' },
  'api': { label: '专业 API', color: '#3b82f6' },
  'traditional': { label: '传统翻译', color: '#10b981' },
};

/**
 * 翻译源设置组件 - 分组卡片风格
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
  
  // 保存状态
  const [isSaving, setIsSaving] = useState(false);

  // 初始化：从 registry 和 settings 加载
  useEffect(() => {
    const initProviders = async () => {
      const savedProviders = settings?.translation?.providers || [];
      const savedConfigs = settings?.translation?.providerConfigs || {};
      
      // 构建 providers 列表
      const providerList = allProvidersMeta.map((meta, index) => {
        const saved = savedProviders.find(p => p.id === meta.id);
        return {
          id: meta.id,
          enabled: saved?.enabled ?? (index === 0),
          priority: saved?.priority ?? index,
        };
      });
      
      providerList.sort((a, b) => a.priority - b.priority);
      setProviders(providerList);
      
      // 构建配置
      const configs = {};
      for (const meta of allProvidersMeta) {
        const defaultConfig = {};
        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            defaultConfig[key] = field.default || '';
          }
        }
        
        configs[meta.id] = { ...defaultConfig, ...savedConfigs[meta.id] };
        
        // 解密敏感字段 - 总是尝试从 secure storage 读取
        if (meta.configSchema) {
          for (const [key, field] of Object.entries(meta.configSchema)) {
            if (field.encrypted) {
              // 无论当前值是什么，都尝试从 secure storage 读取
              const decrypted = await secureStorage.get(`provider_${meta.id}_${key}`);
              if (decrypted) {
                configs[meta.id][key] = decrypted;
              }
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
      
      updateSettings('translation', 'providers', providers);
      updateSettings('translation', 'providerConfigs', configsToSave);
      
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
      
      notify?.('翻译源设置已保存', 'success');
    } catch (error) {
      console.error('[ProviderSettings] Save failed:', error);
      notify?.('保存失败: ' + error.message, 'error');
    } finally {
      setIsSaving(false);
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

  // 测试连接
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

  // 移动优先级
  const moveProvider = (index, direction) => {
    const newProviders = [...providers];
    const targetIndex = index + direction;
    
    if (targetIndex < 0 || targetIndex >= newProviders.length) return;
    
    [newProviders[index], newProviders[targetIndex]] = [newProviders[targetIndex], newProviders[index]];
    newProviders.forEach((p, i) => p.priority = i);
    
    setProviders(newProviders);
  };

  // 获取状态
  const getStatusColor = (providerId) => {
    const result = testResults[providerId];
    if (result?.success) return '#10b981';
    if (result?.success === false) return '#ef4444';
    return '#9ca3af';
  };

  const getStatusText = (providerId) => {
    const result = testResults[providerId];
    if (testingProvider === providerId) return '测试中...';
    if (result?.success) return '已连接';
    if (result?.success === false) return result.message || '连接失败';
    return '未测试';
  };

  // 渲染配置表单
  const renderConfigForm = (providerId) => {
    const meta = allProvidersMeta.find(m => m.id === providerId);
    const config = providerConfigs[providerId] || {};
    
    if (!meta?.configSchema || Object.keys(meta.configSchema).length === 0) {
      return (
        <div className="ps-config-empty">
          <Globe size={20} />
          <span>此翻译源无需额外配置，开箱即用</span>
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
            获取 API Key
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="ps-container">
      {/* 说明 */}
      <div className="ps-tip">
        <AlertCircle size={14} />
        <span>按优先级顺序尝试翻译，第一个成功的将被使用。拖动卡片调整顺序。</span>
      </div>

      {/* 翻译源列表 */}
      <div className="ps-list">
        {providers.map((provider, index) => {
          const meta = allProvidersMeta.find(m => m.id === provider.id);
          if (!meta) return null;
          
          const isExpanded = expandedProvider === provider.id;
          const typeInfo = TYPE_LABELS[meta.type] || TYPE_LABELS['api'];
          
          return (
            <div 
              key={provider.id}
              className={`ps-card ${provider.enabled ? 'enabled' : 'disabled'} ${isExpanded ? 'expanded' : ''}`}
              style={{ '--accent': meta.color || '#6b7280' }}
            >
              {/* 左侧彩色条 */}
              <div className="ps-accent-bar"></div>

              {/* 卡片头部 */}
              <div className="ps-card-header">
                {/* 优先级 */}
                <div className="ps-rank">#{index + 1}</div>

                {/* 拖拽区域 */}
                <div className="ps-drag">
                  <button 
                    className="ps-drag-btn"
                    onClick={() => moveProvider(index, -1)}
                    disabled={index === 0}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <GripVertical size={14} className="ps-grip-icon" />
                  <button 
                    className="ps-drag-btn"
                    onClick={() => moveProvider(index, 1)}
                    disabled={index === providers.length - 1}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {/* 图标 */}
                <div className="ps-icon">
                  {PROVIDER_ICONS[provider.id] || '📦'}
                </div>

                {/* 信息 */}
                <div className="ps-info">
                  <div className="ps-title">
                    <span className="ps-name">{meta.name}</span>
                    <span className="ps-tag" style={{ background: typeInfo.color }}>
                      {typeInfo.label}
                    </span>
                  </div>
                  <div className="ps-desc">{meta.description}</div>
                </div>

                {/* 开关 */}
                <label className="ps-switch">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={() => toggleProvider(provider.id)}
                  />
                  <span className="ps-switch-track"></span>
                  <span className="ps-switch-text">{provider.enabled ? 'ON' : 'OFF'}</span>
                </label>
              </div>

              {/* 展开按钮 */}
              <button 
                className="ps-expand-trigger"
                onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
              >
                <span>配置详情</span>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="ps-expand-content">
                  {renderConfigForm(provider.id)}
                  
                  {/* 测试区 */}
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
                      <span>测试连接</span>
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

      {/* 保存按钮 */}
      <div className="ps-actions">
        <button className="ps-save-btn" onClick={saveSettings} disabled={isSaving}>
          {isSaving ? <RefreshCw size={16} className="spinning" /> : <Check size={16} />}
          <span>{isSaving ? '保存中...' : '保存设置'}</span>
        </button>
      </div>
    </div>
  );
};

export default ProviderSettings;
