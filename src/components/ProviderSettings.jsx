// src/components/ProviderSettings.jsx
// 翻译源设置组件 - 配置和管理翻译服务

import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, Cloud, Zap, ChevronDown, ChevronUp, Check, X, AlertCircle,
  RefreshCw, GripVertical, Eye, EyeOff, ExternalLink, Cpu, Globe2
} from 'lucide-react';

// 安全存储（直接使用 electron API，不依赖 src/utils）
const secureStorage = {
  async get(key) {
    if (window.electron?.secureStorage) {
      return await window.electron.secureStorage.decrypt(key);
    }
    // 浏览器回退
    const encoded = localStorage.getItem(`__secure_${key}`);
    if (encoded) {
      try {
        return decodeURIComponent(atob(encoded));
      } catch {
        return null;
      }
    }
    return null;
  },
  async set(key, value) {
    if (!value) {
      await this.delete(key);
      return true;
    }
    if (window.electron?.secureStorage) {
      await window.electron.secureStorage.encrypt(key, value);
      return true;
    }
    // 浏览器回退
    localStorage.setItem(`__secure_${key}`, btoa(encodeURIComponent(value)));
    return true;
  },
  async delete(key) {
    if (window.electron?.secureStorage) {
      await window.electron.secureStorage.delete(key);
    } else {
      localStorage.removeItem(`__secure_${key}`);
    }
    return true;
  }
};

// 翻译源图标映射
const PROVIDER_ICONS = {
  'local-llm': Cpu,
  'openai': Cloud,
  'deepl': Globe2,
  'deepseek': Zap,
};

// 翻译源描述
const PROVIDER_INFO = {
  'local-llm': {
    name: 'LM Studio (本地)',
    description: '使用本地大模型翻译，隐私安全、免费',
    color: '#10b981',
    helpUrl: 'https://lmstudio.ai/',
  },
  'openai': {
    name: 'OpenAI',
    description: '使用 GPT 模型翻译，质量高、速度快',
    color: '#10a37f',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  'deepl': {
    name: 'DeepL',
    description: '专业翻译 API，翻译质量极高',
    color: '#0f2b46',
    helpUrl: 'https://www.deepl.com/pro-api',
  },
};

// 配置字段类型映射
const CONFIG_SCHEMA = {
  'local-llm': {
    endpoint: {
      type: 'text',
      label: 'API 地址',
      default: 'http://localhost:1234/v1',
      placeholder: 'http://localhost:1234/v1',
    },
    model: {
      type: 'text',
      label: '模型名称',
      default: '',
      placeholder: '留空自动检测',
    },
  },
  'openai': {
    apiKey: {
      type: 'password',
      label: 'API Key',
      required: true,
      placeholder: 'sk-...',
      encrypted: true,
    },
    baseUrl: {
      type: 'text',
      label: 'API 地址',
      default: 'https://api.openai.com/v1',
      placeholder: 'https://api.openai.com/v1',
    },
    model: {
      type: 'select',
      label: '模型',
      options: [
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini (推荐)' },
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
      ],
      default: 'gpt-4o-mini',
    },
  },
  'deepl': {
    apiKey: {
      type: 'password',
      label: 'API Key',
      required: true,
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
      encrypted: true,
    },
    useFreeApi: {
      type: 'checkbox',
      label: '使用免费 API（Key 以 :fx 结尾）',
      default: true,
    },
  },
};

/**
 * 翻译源设置组件
 */
const ProviderSettings = ({ settings, updateSettings, notify }) => {
  // 翻译源列表和配置
  const [providers, setProviders] = useState([
    { id: 'local-llm', enabled: true, priority: 0 },
    { id: 'openai', enabled: false, priority: 1 },
    { id: 'deepl', enabled: false, priority: 2 },
  ]);
  
  // 各翻译源配置
  const [providerConfigs, setProviderConfigs] = useState({
    'local-llm': { endpoint: 'http://localhost:1234/v1', model: '' },
    'openai': { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    'deepl': { apiKey: '', useFreeApi: true },
  });
  
  // 展开的配置面板
  const [expandedProvider, setExpandedProvider] = useState(null);
  
  // 显示密码状态
  const [showPasswords, setShowPasswords] = useState({});
  
  // 测试状态
  const [testingProvider, setTestingProvider] = useState(null);
  const [testResults, setTestResults] = useState({});
  
  // 加载状态
  const [loading, setLoading] = useState(true);

  // 加载保存的配置
  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      // 从 settings 加载翻译源设置
      const savedProviders = settings?.providers?.list || providers;
      const savedConfigs = settings?.providers?.configs || {};
      
      // 加载加密的 API Keys
      const decryptedConfigs = { ...providerConfigs };
      
      for (const providerId of Object.keys(CONFIG_SCHEMA)) {
        const schema = CONFIG_SCHEMA[providerId];
        decryptedConfigs[providerId] = { ...decryptedConfigs[providerId], ...savedConfigs[providerId] };
        
        // 解密敏感字段
        for (const [key, field] of Object.entries(schema)) {
          if (field.encrypted) {
            const decrypted = await secureStorage.get(`provider_${providerId}_${key}`);
            if (decrypted) {
              decryptedConfigs[providerId][key] = decrypted;
            }
          }
        }
      }
      
      setProviders(savedProviders);
      setProviderConfigs(decryptedConfigs);
    } catch (error) {
      console.error('[ProviderSettings] Load configs failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveConfigs = async () => {
    try {
      // 准备非敏感配置用于普通存储
      const configsToSave = {};
      
      for (const providerId of Object.keys(providerConfigs)) {
        const schema = CONFIG_SCHEMA[providerId] || {};
        const config = providerConfigs[providerId];
        configsToSave[providerId] = {};
        
        for (const [key, value] of Object.entries(config)) {
          const field = schema[key];
          
          if (field?.encrypted && value) {
            // 加密存储敏感字段
            await secureStorage.set(`provider_${providerId}_${key}`, value);
            // 在普通存储中保存占位符
            configsToSave[providerId][key] = '***encrypted***';
          } else {
            configsToSave[providerId][key] = value;
          }
        }
      }
      
      // 更新 settings
      updateSettings('providers', 'list', providers);
      updateSettings('providers', 'configs', configsToSave);
      
      notify?.('翻译源设置已保存', 'success');
    } catch (error) {
      console.error('[ProviderSettings] Save configs failed:', error);
      notify?.('保存失败: ' + error.message, 'error');
    }
  };

  // 切换翻译源启用状态
  const toggleProvider = (providerId) => {
    setProviders(prev => prev.map(p => 
      p.id === providerId ? { ...p, enabled: !p.enabled } : p
    ));
  };

  // 更新配置字段
  const updateConfig = (providerId, key, value) => {
    setProviderConfigs(prev => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        [key]: value,
      },
    }));
  };

  // 测试翻译源连接
  const testProvider = async (providerId) => {
    setTestingProvider(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: null }));
    
    try {
      const config = providerConfigs[providerId];
      let result = { success: false, message: '未知错误' };
      
      if (providerId === 'local-llm') {
        // 测试本地 LLM
        const response = await fetch(`${config.endpoint}/models`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        
        if (response.ok) {
          const data = await response.json();
          const models = data.data?.length || 0;
          result = { success: true, message: `连接成功，检测到 ${models} 个模型` };
        } else {
          result = { success: false, message: `连接失败: ${response.status}` };
        }
      } else if (providerId === 'openai') {
        // 测试 OpenAI
        if (!config.apiKey) {
          result = { success: false, message: '请先配置 API Key' };
        } else {
          const response = await fetch(`${config.baseUrl}/models`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
            },
            signal: AbortSignal.timeout(10000),
          });
          
          if (response.status === 401) {
            result = { success: false, message: 'API Key 无效' };
          } else if (response.ok) {
            result = { success: true, message: '连接成功' };
          } else {
            result = { success: false, message: `连接失败: ${response.status}` };
          }
        }
      } else if (providerId === 'deepl') {
        // 测试 DeepL
        if (!config.apiKey) {
          result = { success: false, message: '请先配置 API Key' };
        } else {
          const baseUrl = config.useFreeApi || config.apiKey?.endsWith(':fx')
            ? 'https://api-free.deepl.com/v2'
            : 'https://api.deepl.com/v2';
            
          const response = await fetch(`${baseUrl}/usage`, {
            method: 'GET',
            headers: {
              'Authorization': `DeepL-Auth-Key ${config.apiKey}`,
            },
            signal: AbortSignal.timeout(10000),
          });
          
          if (response.status === 403) {
            result = { success: false, message: 'API Key 无效' };
          } else if (response.ok) {
            const data = await response.json();
            const remaining = (data.character_limit || 0) - (data.character_count || 0);
            result = { success: true, message: `连接成功，剩余字符: ${remaining.toLocaleString()}` };
          } else {
            result = { success: false, message: `连接失败: ${response.status}` };
          }
        }
      }
      
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
    
    // 更新优先级
    newProviders.forEach((p, i) => p.priority = i);
    
    setProviders(newProviders);
  };

  // 渲染配置表单
  const renderConfigForm = (providerId) => {
    const schema = CONFIG_SCHEMA[providerId];
    const config = providerConfigs[providerId] || {};
    
    if (!schema) return null;
    
    return (
      <div className="provider-config-form">
        {Object.entries(schema).map(([key, field]) => (
          <div key={key} className="config-field">
            <label className="config-label">{field.label}</label>
            
            {field.type === 'text' && (
              <input
                type="text"
                className="config-input"
                value={config[key] || ''}
                placeholder={field.placeholder || ''}
                onChange={(e) => updateConfig(providerId, key, e.target.value)}
              />
            )}
            
            {field.type === 'password' && (
              <div className="config-password-wrapper">
                <input
                  type={showPasswords[`${providerId}_${key}`] ? 'text' : 'password'}
                  className="config-input"
                  value={config[key] || ''}
                  placeholder={field.placeholder || ''}
                  onChange={(e) => updateConfig(providerId, key, e.target.value)}
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
            )}
            
            {field.type === 'select' && (
              <select
                className="config-select"
                value={config[key] || field.default || ''}
                onChange={(e) => updateConfig(providerId, key, e.target.value)}
              >
                {field.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            
            {field.type === 'checkbox' && (
              <label className="config-checkbox">
                <input
                  type="checkbox"
                  checked={config[key] ?? field.default ?? false}
                  onChange={(e) => updateConfig(providerId, key, e.target.checked)}
                />
                <span>{field.label}</span>
              </label>
            )}
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="provider-settings loading">
        <RefreshCw className="spin" size={24} />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="provider-settings">
      <div className="provider-header">
        <h4>翻译源管理</h4>
        <p className="provider-hint">
          拖拽调整优先级，启用的翻译源按顺序尝试，失败时自动切换到下一个
        </p>
      </div>
      
      <div className="provider-list">
        {providers.map((provider, index) => {
          const info = PROVIDER_INFO[provider.id];
          const Icon = PROVIDER_ICONS[provider.id] || Server;
          const isExpanded = expandedProvider === provider.id;
          const testResult = testResults[provider.id];
          const isTesting = testingProvider === provider.id;
          
          return (
            <div 
              key={provider.id}
              className={`provider-item ${provider.enabled ? 'enabled' : 'disabled'} ${isExpanded ? 'expanded' : ''}`}
            >
              {/* 拖拽手柄 + 主信息 */}
              <div className="provider-main">
                <div className="provider-drag">
                  <button 
                    className="drag-btn"
                    onClick={() => moveProvider(index, -1)}
                    disabled={index === 0}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <span className="priority-badge">{index + 1}</span>
                  <button 
                    className="drag-btn"
                    onClick={() => moveProvider(index, 1)}
                    disabled={index === providers.length - 1}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                
                <div 
                  className="provider-icon"
                  style={{ backgroundColor: info?.color || '#666' }}
                >
                  <Icon size={18} />
                </div>
                
                <div className="provider-info">
                  <div className="provider-name">{info?.name || provider.id}</div>
                  <div className="provider-desc">{info?.description}</div>
                </div>
                
                <div className="provider-actions">
                  {/* 测试结果 */}
                  {testResult && (
                    <span className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                      {testResult.success ? <Check size={14} /> : <X size={14} />}
                    </span>
                  )}
                  
                  {/* 启用开关 */}
                  <button
                    className={`toggle-btn ${provider.enabled ? 'active' : ''}`}
                    onClick={() => toggleProvider(provider.id)}
                  >
                    {provider.enabled ? '已启用' : '已禁用'}
                  </button>
                  
                  {/* 展开/收起配置 */}
                  <button
                    className="expand-btn"
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                  >
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
              </div>
              
              {/* 展开的配置面板 */}
              {isExpanded && (
                <div className="provider-config">
                  {renderConfigForm(provider.id)}
                  
                  <div className="config-actions">
                    <button
                      className="test-btn"
                      onClick={() => testProvider(provider.id)}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <>
                          <RefreshCw className="spin" size={14} />
                          测试中...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={14} />
                          测试连接
                        </>
                      )}
                    </button>
                    
                    {testResult && (
                      <span className={`test-message ${testResult.success ? 'success' : 'error'}`}>
                        {testResult.message}
                      </span>
                    )}
                    
                    {info?.helpUrl && (
                      <a 
                        href={info.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="help-link"
                      >
                        获取 API Key <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      <div className="provider-footer">
        <button className="save-btn" onClick={saveConfigs}>
          保存翻译源设置
        </button>
      </div>
    </div>
  );
};

export default ProviderSettings;
