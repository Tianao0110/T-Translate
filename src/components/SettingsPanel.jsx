// src/components/SettingsPanel.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Settings, Globe, Shield, Zap, Database, Download, Upload, Moon, Sun, Monitor,
  Volume2, Keyboard, Info, AlertCircle, CheckCircle, WifiOff, Wifi, RefreshCw,
  Save, FolderOpen, Trash2, Eye, EyeOff, Lock, Unlock, GitBranch, HelpCircle,
  ExternalLink, ChevronRight, Terminal, Code2, Palette, Layers, MousePointer, Server,
  FileText, Filter
} from 'lucide-react';
import translationService from '../services/translation-service.js';
import { ocrManager } from '../providers/ocr/index.js';
import useTranslationStore from '../stores/translation-store';
import ProviderSettings from './ProviderSettings';
import '../styles/components/SettingsPanel.css';
import '../styles/components/ProviderSettings.css'; 

/**
 * 默认配置 (内联，防止 import 报错)
 */
const defaultConfig = {
  llm: { endpoint: 'http://localhost:1234/v1', timeout: 60000 },
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh', batch: { maxLength: 5000 } },
  ocr: { defaultEngine: 'llm-vision', windowsLanguage: 'zh-Hans' },
  ui: { theme: 'light', fontSize: 14 },
  logging: { level: 'info' },
  shortcuts: {
    translate: 'Ctrl+Enter',
    swapLanguages: 'Ctrl+L',
    clear: 'Ctrl+Shift+C',
    paste: 'Ctrl+V',
    copy: 'Ctrl+C'
  },
  dev: { debugMode: false },
  storage: { cache: { maxSize: 100 }, history: { maxItems: 1000 } }
};

/**
 * 设置面板组件
 */
const SettingsPanel = ({ showNotification }) => {
  // 兼容 props
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // Store actions
  const { 
    setOcrEngine, 
    useStreamOutput, 
    setUseStreamOutput,
    autoTranslate,
    setAutoTranslate,
    autoTranslateDelay,
    setAutoTranslateDelay
  } = useTranslationStore();

  // Ref for ProviderSettings
  const providerSettingsRef = useRef(null);

  // 设置状态
  const [settings, setSettings] = useState({
    connection: {
      endpoint: 'http://localhost:1234/v1',
      timeout: 60000,
      autoReconnect: true,
      reconnectInterval: 30000
    },
    translation: {
      defaultSourceLang: 'auto',
      defaultTargetLang: 'zh',
      autoTranslate: false,
      translationDelay: 500,
      maxLength: 5000,
      template: 'general',
      providers: [
        { id: 'local-llm', enabled: true, priority: 0 },
        { id: 'openai', enabled: false, priority: 1 },
        { id: 'deepl', enabled: false, priority: 2 },
      ],
      providerConfigs: {
        'local-llm': { endpoint: 'http://localhost:1234/v1', model: '' },
        'openai': { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        'deepl': { apiKey: '', useFreeApi: true },
      },
      subtitleProvider: null,
    },
    ocr: {
      engine: 'llm-vision',
      language: 'chi_sim+eng',
      autoDetect: true,
      imageQuality: 'high',
      preprocessImage: true,
      isWindows: false,  // 是否 Windows 系统
      paddleInstalled: false,  // PaddleOCR 是否已安装
      rapidInstalled: false,   // RapidOCR 是否已安装
      // 第三方 OCR API Keys
      ocrspaceKey: '',
      googleVisionKey: '',
      azureKey: '',
      azureEndpoint: '',
      baiduApiKey: '',
      baiduSecretKey: '',
    },
    screenshot: {
      showConfirmButtons: true,  // 显示确认按钮
      autoCapture: false         // 自动截图（不显示确认）
    },
    glassWindow: {
      refreshInterval: 3000,     // 自动刷新间隔（毫秒）
      smartDetect: true,         // 智能检测变化
      streamOutput: true,        // 流式输出
      ocrEngine: 'llm-vision',   // OCR 引擎
      defaultOpacity: 0.85,      // 默认透明度
      rememberPosition: true,    // 记住窗口位置
      autoPin: true,             // 默认置顶
      lockTargetLang: true       // 锁定目标语言（避免回译）
    },
    selection: {
      enabled: false,            // 启用划词翻译 - 默认关闭
      triggerTimeout: 4000,      // 触发点消失时间（毫秒）
      showSourceByDefault: false, // 默认显示原文
      minChars: 2,               // 最小字符数
      maxChars: 500,             // 最大字符数
      autoCloseOnCopy: false,    // 复制后自动关闭
    },
    interface: {
      theme: 'light',
      fontSize: 14,
      fontFamily: 'system',
      compactMode: false,
      showLineNumbers: false,
      highlightSyntax: true
    },
    privacy: {
      saveHistory: true,
      encryptHistory: false,
      autoDeleteDays: 0,
      secureMode: false,
      logLevel: 'info'
    },
    document: {
      maxCharsPerSegment: 800,
      batchMaxTokens: 2000,
      batchMaxSegments: 5,
      filters: {
        skipShort: true,
        minLength: 10,
        skipNumbers: true,
        skipCode: true,
        skipTargetLang: true,
        skipKeywords: [],
      },
      displayStyle: 'below',
    },
    shortcuts: defaultConfig.shortcuts,
    advanced: {
      debugMode: false,
      experimentalFeatures: false,
      cacheSize: 100,
      maxHistoryItems: 1000,
      exportFormat: 'json'
    }
  });

  const [activeSection, setActiveSection] = useState('connection');
  const [connectionStatus, setConnectionStatus] = useState('unknown');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [models, setModels] = useState([]);
  const [showApiKeys, setShowApiKeys] = useState({});  // API Key 可见性状态

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // 检测平台和 OCR 引擎安装状态
      let isWindows = false;
      let paddleInstalled = false;
      let rapidInstalled = false;
      
      // 优先通过 IPC 从主进程获取平台信息（更准确）
      if (window.electron?.app?.getPlatform) {
        try {
          const platform = await window.electron.app.getPlatform();
          isWindows = platform === 'win32';
        } catch (e) {
          // 降级：使用 navigator
          if (typeof navigator !== 'undefined') {
            isWindows = navigator.platform?.toLowerCase().includes('win') || 
                        navigator.userAgent?.toLowerCase().includes('windows');
          }
        }
      } else if (window.nodeAPI?.process?.platform) {
        isWindows = window.nodeAPI.process.platform === 'win32';
      } else if (typeof navigator !== 'undefined') {
        isWindows = navigator.platform?.toLowerCase().includes('win') || 
                    navigator.userAgent?.toLowerCase().includes('windows');
      }
      
      // 通过 IPC 检测 OCR 引擎安装状态
      if (window.electron?.ocr?.checkInstalled) {
        try {
          const installedStatus = await window.electron.ocr.checkInstalled();
          rapidInstalled = installedStatus?.['rapid-ocr'] || false;
        } catch (e) {
          console.log('OCR install check failed:', e);
        }
      }
      
      // 获取划词翻译的真实状态（从主进程）
      let selectionEnabled = false;
      if (window.electron?.selection?.getEnabled) {
        try {
          selectionEnabled = await window.electron.selection.getEnabled();
          console.log('[Settings] Selection translate state from main:', selectionEnabled);
        } catch (e) {
          console.log('Selection state check failed:', e);
        }
      }
      
      // 优先从 Electron Store 读取
      if (window.electron && window.electron.store) {
        const savedSettings = await window.electron.store.get('settings');
        if (savedSettings) {
          // 迁移旧格式：settings.providers -> settings.translation.providers
          let migratedSettings = { ...savedSettings };
          if (savedSettings.providers?.list && !savedSettings.translation?.providers) {
            console.log('[Settings] Migrating old providers format...');
            migratedSettings = {
              ...savedSettings,
              translation: {
                ...savedSettings.translation,
                providers: savedSettings.providers.list,
                providerConfigs: savedSettings.providers.configs,
                subtitleProvider: savedSettings.providers.subtitleProvider,
              }
            };
            // 删除旧字段
            delete migratedSettings.providers;
          }
          
          setSettings(prev => ({ 
            ...prev, 
            ...migratedSettings,
            ocr: {
              ...prev.ocr,
              ...migratedSettings.ocr,
              isWindows,
              paddleInstalled,
              rapidInstalled,
            },
            // 使用主进程的真实状态覆盖
            selection: {
              ...prev.selection,
              ...migratedSettings.selection,
              enabled: selectionEnabled,  // 以主进程状态为准
            },
            // 确保 translation.providers 存在
            translation: {
              ...prev.translation,
              ...migratedSettings.translation,
            }
          }));
          // 同步 OCR 引擎到 Store
          if (savedSettings.ocr?.engine && setOcrEngine) {
            setOcrEngine(savedSettings.ocr.engine);
          }
        } else {
          // 没有保存的设置，只更新平台检测和划词翻译状态
          setSettings(prev => ({
            ...prev,
            ocr: { ...prev.ocr, isWindows, paddleInstalled, rapidInstalled },
            selection: { ...prev.selection, enabled: selectionEnabled }
          }));
        }
      } else {
        const savedSettings = localStorage.getItem('settings');
        if (savedSettings) {
          let parsed = JSON.parse(savedSettings);
          
          // 迁移旧格式：settings.providers -> settings.translation.providers
          if (parsed.providers?.list && !parsed.translation?.providers) {
            console.log('[Settings] Migrating old providers format (localStorage)...');
            parsed = {
              ...parsed,
              translation: {
                ...parsed.translation,
                providers: parsed.providers.list,
                providerConfigs: parsed.providers.configs,
                subtitleProvider: parsed.providers.subtitleProvider,
              }
            };
            delete parsed.providers;
          }
          
          setSettings(prev => ({
            ...prev,
            ...parsed,
            ocr: {
              ...prev.ocr,
              ...parsed.ocr,
              isWindows,
              paddleInstalled,
              rapidInstalled,
            },
            selection: {
              ...prev.selection,
              ...parsed.selection,
              enabled: selectionEnabled,
            },
            translation: {
              ...prev.translation,
              ...parsed.translation,
            }
          }));
          // 同步 OCR 引擎到 Store
          if (parsed.ocr?.engine && setOcrEngine) {
            setOcrEngine(parsed.ocr.engine);
          }
        } else {
          setSettings(prev => ({
            ...prev,
            ocr: { ...prev.ocr, isWindows, paddleInstalled, rapidInstalled },
            selection: { ...prev.selection, enabled: selectionEnabled }
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      // 如果在翻译源设置页面，调用 ProviderSettings 的保存逻辑后直接返回
      // 因为 ProviderSettings.save() 已经完成了所有保存工作
      if (activeSection === 'providers' && providerSettingsRef.current?.save) {
        await providerSettingsRef.current.save();
        setIsSaving(false);
        return; // 直接返回，不要再用旧的 settings state 覆盖
      }
      
      // 清理掉不需要保存的临时状态
      const settingsToSave = {
        ...settings,
        ocr: {
          ...settings.ocr,
          // 不保存这些运行时状态，每次启动重新检测
          isWindows: undefined,
          paddleInstalled: undefined,
          rapidInstalled: undefined,
        }
      };
      
      if (window.electron && window.electron.store) {
        await window.electron.store.set('settings', settingsToSave);
      } else {
        localStorage.setItem('settings', JSON.stringify(settingsToSave));
      }
      
      // 同步 OCR 引擎到 Store
      if (setOcrEngine && settings.ocr?.engine) {
        setOcrEngine(settings.ocr.engine);
      }

      // 刷新 OCR Manager 配置
      if (settings.ocr) {
        try {
          ocrManager.updateConfigs(settings.ocr);
          console.log('[Settings] OCR configs updated');
        } catch (e) {
          console.warn('[Settings] ocrManager update failed:', e);
        }
      }

      // 刷新 translationService 配置（如果有翻译源配置变更）
      if (settings.translation?.providers || settings.translation?.providerConfigs) {
        try {
          await translationService.reload({
            providers: {
              list: settings.translation.providers,
              configs: settings.translation.providerConfigs,
            }
          });
        } catch (e) {
          console.warn('[Settings] translationService reload failed:', e);
        }
      }

      // 通知玻璃窗重新加载设置
      if (window.electron?.glass?.notifySettingsChanged) {
        await window.electron.glass.notifySettingsChanged();
      }

      // 只有非 providers tab 才显示通知（providers tab 有自己的通知）
      if (activeSection !== 'providers') {
        notify('设置已保存', 'success');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      notify('保存设置失败', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    setConnectionStatus('testing');

    try {
      const result = await translationService.testConnection();
      if (result.success) {
        setConnectionStatus('connected');
        setModels(result.models || []);
        notify(`连接成功！${result.models?.length ? `检测到 ${result.models.length} 个模型` : ''}`, 'success');
      } else {
        setConnectionStatus('disconnected');
        notify('连接失败: ' + (result.error || result.message || '未知错误'), 'error');
      }
    } catch (error) {
      setConnectionStatus('error');
      notify('连接错误: ' + error.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const resetSettings = (section = null) => {
    if (!window.confirm(section ? `重置 ${section} 设置？` : '重置所有设置？')) return;

    if (section) {
        // 部分重置逻辑需要对照 defaultConfig 结构，这里简化处理
        notify(`${section} 设置已重置 (需重启生效)`, 'info');
    } else {
        localStorage.removeItem('settings');
        if (window.electron && window.electron.store) {
            window.electron.store.delete('settings');
        }
        notify('设置已重置，请重启应用', 'success');
        // 也可以 reload window.location.reload()
    }
  };

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settings_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('设置已导出', 'success');
  };

  const importSettings = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        setSettings(imported);
        notify('设置已导入，请保存', 'success');
      } catch (error) {
        notify('无效的设置文件', 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = null;
  };

  const updateSetting = (section, key, value) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  };

  // 渲染设置内容
  const renderSettingContent = () => {
    switch (activeSection) {
      case 'connection':
        return (
          <div className="setting-content">
            <h3>LM Studio 连接设置</h3>
            <div className="setting-group">
              <label className="setting-label">API 端点</label>
              <div className="input-group">
                <input
                  type="text"
                  className="setting-input"
                  value={settings.connection.endpoint}
                  onChange={(e) => updateSetting('connection', 'endpoint', e.target.value)}
                  placeholder="http://localhost:1234/v1"
                />
                <button className={`test-button ${connectionStatus}`} onClick={testConnection} disabled={isTesting}>
                  {isTesting ? <RefreshCw size={16} className="animate-spin"/> : <Wifi size={16}/>}
                  {isTesting ? '测试中...' : '测试连接'}
                </button>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">超时时间 (ms)</label>
              <input type="number" className="setting-input" value={settings.connection.timeout} onChange={(e)=>updateSetting('connection','timeout',parseInt(e.target.value))} step="1000"/>
            </div>
            {models.length > 0 && (
              <div className="setting-group">
                <label className="setting-label">可用模型</label>
                <div className="models-list">
                  {models.map((m, i) => <div key={i} className="model-item"><Code2 size={14}/><span>{m.id}</span></div>)}
                </div>
              </div>
            )}
          </div>
        );

      case 'providers':
        return (
          <div className="setting-content">
            <h3>翻译源设置</h3>
            <p className="setting-description">配置翻译服务，支持本地模型和在线 API</p>
            
            <ProviderSettings 
              ref={providerSettingsRef}
              settings={settings}
              updateSettings={updateSetting}
              notify={notify}
            />
          </div>
        );

      case 'translation':
        return (
          <div className="setting-content">
            <h3>翻译设置</h3>
            <div className="setting-group">
              <label className="setting-label">默认源语言</label>
              <select className="setting-select" value={settings.translation.defaultSourceLang} onChange={(e)=>updateSetting('translation','defaultSourceLang',e.target.value)}>
                <option value="auto">自动检测</option><option value="en">English</option><option value="zh">中文</option>
              </select>
            </div>
            <div className="setting-group">
                <label className="setting-label">默认目标语言</label>
                <select className="setting-select" value={settings.translation.defaultTargetLang} onChange={(e)=>updateSetting('translation','defaultTargetLang',e.target.value)}>
                  <option value="zh">中文</option><option value="en">English</option>
                </select>
            </div>
            <div className="setting-group">
                <label className="setting-switch">
                    <input 
                      type="checkbox" 
                      checked={autoTranslate} 
                      onChange={(e) => setAutoTranslate(e.target.checked)} 
                    />
                    <span className="switch-slider"></span>
                    <span className="switch-label">自动翻译</span>
                </label>
                <p className="setting-hint">输入停止后自动开始翻译</p>
            </div>
            <div className="setting-group">
                <label className="setting-label">自动翻译延迟: {autoTranslateDelay}ms</label>
                <input 
                  type="range" 
                  className="setting-range" 
                  min="300" 
                  max="2000" 
                  step="100"
                  value={autoTranslateDelay} 
                  onChange={(e) => setAutoTranslateDelay(parseInt(e.target.value))} 
                />
                <p className="setting-hint">停止输入后等待多久开始翻译</p>
            </div>
            <div className="setting-group">
                <label className="setting-switch">
                    <input 
                      type="checkbox" 
                      checked={useStreamOutput} 
                      onChange={(e) => setUseStreamOutput(e.target.checked)} 
                    />
                    <span className="switch-slider"></span>
                    <span className="switch-label">流式输出（打字机效果）</span>
                </label>
                <p className="setting-hint">开启后翻译结果将逐字显示，关闭则一次性显示</p>
            </div>
            
            {/* 缓存管理 */}
            <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
                <h4 style={{marginBottom: '12px', color: 'var(--text-secondary)'}}>翻译缓存</h4>
                <p className="setting-hint" style={{marginBottom: '12px'}}>
                  缓存已翻译的内容，相同文本再次翻译时直接返回结果，节省时间和资源。
                  <br />
                  缓存状态: 已迁移至新翻译源系统
                </p>
                <button 
                  className="danger-button"
                  onClick={() => {
                    if (window.confirm('确定要清除浏览器本地存储吗？这将清除所有缓存数据。')) {
                      localStorage.removeItem('translation-cache');
                      notify('缓存已清除', 'success');
                    }
                  }}
                >
                  <Trash2 size={16} /> 清除本地缓存
                </button>
            </div>
          </div>
        );

        case 'document':
          return (
            <div className="setting-content">
              <h3>文档翻译设置</h3>
              <p className="setting-description">配置文档翻译的分段策略、过滤规则和显示样式</p>

              {/* 分段设置 */}
              <div className="setting-group">
                <label className="setting-label">分段设置</label>
                <div className="setting-row">
                  <span>单段最大字符数</span>
                  <input
                    type="number"
                    className="setting-input small"
                    value={settings.document?.maxCharsPerSegment || 800}
                    onChange={(e) => updateSetting('document', 'maxCharsPerSegment', parseInt(e.target.value) || 800)}
                    min="200"
                    max="2000"
                    step="100"
                  />
                </div>
                <p className="setting-hint">过长的段落会按此限制自动分割</p>
              </div>

              {/* 批量设置 */}
              <div className="setting-group">
                <label className="setting-label">批量翻译</label>
                <div className="setting-row">
                  <span>每批最大 Tokens</span>
                  <input
                    type="number"
                    className="setting-input small"
                    value={settings.document?.batchMaxTokens || 2000}
                    onChange={(e) => updateSetting('document', 'batchMaxTokens', parseInt(e.target.value) || 2000)}
                    min="500"
                    max="4000"
                    step="500"
                  />
                </div>
                <div className="setting-row">
                  <span>每批最大段落数</span>
                  <input
                    type="number"
                    className="setting-input small"
                    value={settings.document?.batchMaxSegments || 5}
                    onChange={(e) => updateSetting('document', 'batchMaxSegments', parseInt(e.target.value) || 5)}
                    min="1"
                    max="10"
                  />
                </div>
                <p className="setting-hint">合并短段落可减少 API 调用次数</p>
              </div>

              {/* 过滤规则 */}
              <div className="setting-group">
                <label className="setting-label">
                  <Filter size={16} /> 智能过滤
                </label>
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={settings.document?.filters?.skipShort ?? true}
                    onChange={(e) => updateSetting('document', 'filters', {
                      ...settings.document?.filters,
                      skipShort: e.target.checked
                    })}
                  />
                  <span>跳过过短段落</span>
                </label>
                {settings.document?.filters?.skipShort && (
                  <div className="setting-row sub-setting">
                    <span>最小字符数</span>
                    <input
                      type="number"
                      className="setting-input small"
                      value={settings.document?.filters?.minLength || 10}
                      onChange={(e) => updateSetting('document', 'filters', {
                        ...settings.document?.filters,
                        minLength: parseInt(e.target.value) || 10
                      })}
                      min="1"
                      max="50"
                    />
                  </div>
                )}
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={settings.document?.filters?.skipNumbers ?? true}
                    onChange={(e) => updateSetting('document', 'filters', {
                      ...settings.document?.filters,
                      skipNumbers: e.target.checked
                    })}
                  />
                  <span>跳过纯数字段落（如页码）</span>
                </label>
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={settings.document?.filters?.skipCode ?? true}
                    onChange={(e) => updateSetting('document', 'filters', {
                      ...settings.document?.filters,
                      skipCode: e.target.checked
                    })}
                  />
                  <span>保留代码块不翻译</span>
                </label>
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={settings.document?.filters?.skipTargetLang ?? true}
                    onChange={(e) => updateSetting('document', 'filters', {
                      ...settings.document?.filters,
                      skipTargetLang: e.target.checked
                    })}
                  />
                  <span>跳过已是目标语言的段落</span>
                </label>
              </div>

              {/* 显示样式 */}
              <div className="setting-group">
                <label className="setting-label">默认显示样式</label>
                <select
                  className="setting-select"
                  value={settings.document?.displayStyle || 'below'}
                  onChange={(e) => updateSetting('document', 'displayStyle', e.target.value)}
                >
                  <option value="below">⬇️ 上下对照 - 译文显示在原文下方</option>
                  <option value="side-by-side">⬛ 左右对照 - 原文和译文并排显示</option>
                  <option value="source-only">📄 仅原文 - 隐藏译文</option>
                  <option value="translated-only">🌐 仅译文 - 隐藏原文</option>
                </select>
              </div>

              {/* 支持格式 */}
              <div className="setting-group">
                <label className="setting-label">支持的文件格式</label>
                <div className="format-tags">
                  <span className="format-tag">TXT</span>
                  <span className="format-tag">MD</span>
                  <span className="format-tag">SRT</span>
                  <span className="format-tag">VTT</span>
                  <span className="format-tag">PDF</span>
                  <span className="format-tag">DOCX</span>
                  <span className="format-tag">CSV</span>
                  <span className="format-tag">JSON</span>
                  <span className="format-tag">EPUB</span>
                </div>
                <p className="setting-hint">支持加密 PDF · 自动识别章节大纲 · 翻译记忆复用</p>
              </div>
            </div>
          );

        case 'privacy':
          return (
            <div className="setting-content">
              <h3>翻译与隐私模式</h3>
              
              {/* 模式选择卡片 */}
              <div className="mode-selection-grid">
                <div 
                  className={`mode-card ${useTranslationStore.getState().translationMode === 'standard' ? 'selected' : ''}`}
                  onClick={() => {
                     updateSetting('privacy', 'mode', 'standard'); 
                     useTranslationStore.getState().setTranslationMode('standard');
                     // 强制刷新组件以更新 UI (简单做法)
                     setActiveSection('privacy'); 
                  }}
                >
                  <div className="mode-icon"><Zap size={24} /></div>
                  <div className="mode-info">
                    <h4>标准模式</h4>
                    <p>功能全开，自动保存历史记录。</p>
                  </div>
                  {useTranslationStore.getState().translationMode === 'standard' && <div className="mode-check"><CheckCircle size={18} /></div>}
                </div>
  
                <div 
                  className={`mode-card ${useTranslationStore.getState().translationMode === 'secure' ? 'selected' : ''}`}
                  onClick={() => {
                     updateSetting('privacy', 'mode', 'secure');
                     useTranslationStore.getState().setTranslationMode('secure');
                     setActiveSection('privacy');
                  }}
                >
                  <div className="mode-icon"><Shield size={24} /></div>
                  <div className="mode-info">
                    <h4>无痕模式</h4>
                    <p>不保存任何历史记录，重启即焚。</p>
                  </div>
                  {useTranslationStore.getState().translationMode === 'secure' && <div className="mode-check"><CheckCircle size={18} /></div>}
                </div>
  
                <div 
                  className={`mode-card ${useTranslationStore.getState().translationMode === 'offline' ? 'selected' : ''}`}
                  onClick={() => {
                     updateSetting('privacy', 'mode', 'offline');
                     useTranslationStore.getState().setTranslationMode('offline');
                     setActiveSection('privacy');
                  }}
                >
                  <div className="mode-icon"><Lock size={24} /></div>
                  <div className="mode-info">
                    <h4>离线模式</h4>
                    <p>仅使用本地 OCR 和缓存，断开联网。</p>
                  </div>
                  {useTranslationStore.getState().translationMode === 'offline' && <div className="mode-check"><CheckCircle size={18} /></div>}
                </div>
              </div>
  
              <div className="setting-group" style={{marginTop: '24px'}}>
                <label className="setting-label">自动删除历史 (天)</label>
                <input
                  type="number"
                  className="setting-input"
                  value={settings.privacy?.autoDeleteDays || 0}
                  onChange={(e) => updateSetting('privacy', 'autoDeleteDays', parseInt(e.target.value))}
                  min="0"
                />
              </div>
  
              <div className="setting-group">
                <button className="danger-button" onClick={() => {
                  if (window.confirm('确定要清除所有本地数据吗？')) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }}>
                  <Trash2 size={16} /> 清除所有数据
                </button>
              </div>
            </div>
          );
          
      case 'ocr':
        return (
          <div className="setting-content">
            <h3>OCR 设置</h3>
            
            {/* 1. OCR 识别语言 */}
            <div className="setting-group">
              <label className="setting-label">识别语言</label>
              <select 
                className="setting-select" 
                value={settings.ocr.recognitionLanguage || 'auto'} 
                onChange={(e) => updateSetting('ocr', 'recognitionLanguage', e.target.value)}
              >
                <option value="auto">🔄 自动（跟随翻译原文语言）</option>
                <optgroup label="东亚语言">
                  <option value="zh-Hans">简体中文</option>
                  <option value="zh-Hant">繁体中文</option>
                  <option value="ja">日文</option>
                  <option value="ko">韩文</option>
                </optgroup>
                <optgroup label="欧洲语言">
                  <option value="en">英文</option>
                  <option value="fr">法文</option>
                  <option value="de">德文</option>
                  <option value="es">西班牙文</option>
                  <option value="ru">俄文</option>
                </optgroup>
              </select>
              <p className="setting-hint">
                选择"自动"时，将根据翻译原文语言自动选择
              </p>
            </div>
            
            {/* 2. 截图设置 */}
            <div className="setting-group">
              <label className="setting-label">
                <input 
                  type="checkbox" 
                  checked={settings.screenshot?.showConfirmButtons ?? true}
                  onChange={(e) => updateSetting('screenshot', 'showConfirmButtons', e.target.checked)}
                  style={{marginRight: '8px'}}
                />
                显示截图确认按钮
              </label>
              <p className="setting-hint">
                启用后，选择区域后需点击确认或按 Enter 键
              </p>
            </div>

            {/* 3. 图片预处理设置 */}
            <div className="setting-group">
              <label className="setting-label">
                <input 
                  type="checkbox" 
                  checked={settings.ocr?.enablePreprocess ?? true}
                  onChange={(e) => updateSetting('ocr', 'enablePreprocess', e.target.checked)}
                  style={{marginRight: '8px'}}
                />
                自动放大小图片
              </label>
              <p className="setting-hint">
                小字体（&lt;15px）识别率低，自动放大 2 倍可显著提升准确率
              </p>
              {(settings.ocr?.enablePreprocess ?? true) && (
                <div style={{marginTop: '8px', paddingLeft: '24px'}}>
                  <label className="setting-label-small">放大倍数</label>
                  <select 
                    className="setting-select compact"
                    value={settings.ocr?.scaleFactor || 2}
                    onChange={(e) => updateSetting('ocr', 'scaleFactor', parseFloat(e.target.value))}
                    style={{width: '100px', marginLeft: '8px'}}
                  >
                    <option value="1.5">1.5x</option>
                    <option value="2">2x（推荐）</option>
                    <option value="2.5">2.5x</option>
                    <option value="3">3x</option>
                  </select>
                </div>
              )}
            </div>

            {/* ========== 分层 OCR 策略 ========== */}
            
            {/* 第一梯队：本地 OCR（主力先锋） */}
            <h3 style={{marginTop: '24px'}}>
              🚀 第一梯队：本地 OCR
              <span className="tier-hint">（主力，毫秒级）</span>
            </h3>
            <div className="ocr-engines-list">
              {/* RapidOCR - 推荐首选 */}
              <div className={`ocr-engine-item ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">RapidOCR</span>
                    {settings.ocr.rapidInstalled ? (
                      <span className="engine-badge installed">已安装</span>
                    ) : (
                      <span className="engine-badge download">需下载 ~60MB</span>
                    )}
                  </div>
                  <p className="engine-desc">基于 PP-OCRv4，标准文字识别率 98%+，速度最快</p>
                </div>
                <div className="engine-actions">
                  {settings.ocr.rapidInstalled ? (
                    <>
                      <button 
                        className={`btn ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}
                        onClick={() => {
                          updateSetting('ocr', 'engine', 'rapid-ocr');
                          if (setOcrEngine) setOcrEngine('rapid-ocr');
                        }}
                      >
                        {settings.ocr.engine === 'rapid-ocr' ? '✓ 使用中' : '使用'}
                      </button>
                      <button 
                        className="btn-small uninstall"
                        onClick={async () => {
                          if (!window.confirm('确定要卸载 RapidOCR 吗？')) return;
                          notify('正在卸载...', 'info');
                          try {
                            const result = await window.electron?.ocr?.removeEngine?.('rapid-ocr');
                            if (result?.success) {
                              updateSetting('ocr', 'rapidInstalled', false);
                              if (settings.ocr.engine === 'rapid-ocr') {
                                updateSetting('ocr', 'engine', 'llm-vision');
                                if (setOcrEngine) setOcrEngine('llm-vision');
                              }
                              notify('已卸载', 'success');
                            } else {
                              notify(result?.error || '卸载失败', 'error');
                            }
                          } catch (e) {
                            notify('卸载失败', 'error');
                          }
                        }}
                      >
                        卸载
                      </button>
                    </>
                  ) : (
                    <button 
                      className="btn download"
                      onClick={async () => {
                        notify('开始下载 RapidOCR...', 'info');
                        try {
                          const result = await window.electron?.ocr?.downloadEngine?.('rapid-ocr');
                          if (result?.success) {
                            updateSetting('ocr', 'rapidInstalled', true);
                            notify('下载完成！建议重启应用', 'success');
                          } else {
                            notify(result?.error || '下载失败', 'error');
                          }
                        } catch (e) {
                          notify('下载失败', 'error');
                        }
                      }}
                    >
                      下载
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 第二梯队：视觉大模型（特种部队） */}
            <h3 style={{marginTop: '24px'}}>
              ⚡ 第二梯队：视觉大模型
              <span className="tier-hint">（深度识别，处理复杂场景）</span>
            </h3>
            <div className="ocr-engines-list">
              <div className={`ocr-engine-item ${settings.ocr.engine === 'llm-vision' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">LLM Vision</span>
                    <span className="engine-badge builtin">内置</span>
                  </div>
                  <p className="engine-desc">处理艺术字、手写体、模糊文字、漫画气泡等复杂场景</p>
                  <p className="engine-meta">需要 LM Studio + 视觉模型（如 Qwen-VL）</p>
                </div>
                <div className="engine-actions">
                  <button 
                    className={`btn ${settings.ocr.engine === 'llm-vision' ? 'active' : ''}`}
                    onClick={() => {
                      updateSetting('ocr', 'engine', 'llm-vision');
                      if (setOcrEngine) setOcrEngine('llm-vision');
                    }}
                  >
                    {settings.ocr.engine === 'llm-vision' ? '✓ 使用中' : '使用'}
                  </button>
                </div>
              </div>
            </div>

            {/* 第三梯队：在线 OCR API（最终防线） */}
            <h3 style={{marginTop: '24px'}}>
              🌐 第三梯队：在线 OCR
              <span className="tier-hint">（精准模式，需联网）</span>
            </h3>
            <p className="setting-hint" style={{marginBottom: '12px'}}>
              商业 API 训练数据最多，识别精度最高。隐私模式下自动禁用。
            </p>
            <div className="ocr-engines-list">
              {/* OCR.space */}
              <div className={`ocr-engine-item ${settings.ocr.engine === 'ocrspace' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">OCR.space</span>
                    <span className="engine-badge free">免费 25000次/月</span>
                  </div>
                  <p className="engine-desc">免费额度最高，支持 25+ 语言</p>
                  <div className="api-key-input-wrapper">
                    <input 
                      type={showApiKeys.ocrspace ? "text" : "password"}
                      className="setting-input compact"
                      placeholder="API Key"
                      value={settings.ocr.ocrspaceKey || ''}
                      onChange={(e) => updateSetting('ocr', 'ocrspaceKey', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button 
                      type="button"
                      className="api-key-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowApiKeys(prev => ({ ...prev, ocrspace: !prev.ocrspace }));
                      }}
                      title={showApiKeys.ocrspace ? "隐藏" : "显示"}
                    >
                      {showApiKeys.ocrspace ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div className="engine-actions">
                  <button 
                    className={`btn ${settings.ocr.engine === 'ocrspace' ? 'active' : ''} ${!settings.ocr.ocrspaceKey ? 'disabled' : ''}`}
                    onClick={() => {
                      if (settings.ocr.ocrspaceKey) {
                        updateSetting('ocr', 'engine', 'ocrspace');
                        if (setOcrEngine) setOcrEngine('ocrspace');
                      } else {
                        notify('请先配置 API Key', 'warning');
                      }
                    }}
                  >
                    {settings.ocr.engine === 'ocrspace' ? '✓ 使用中' : '使用'}
                  </button>
                </div>
              </div>

              {/* Google Vision */}
              <div className={`ocr-engine-item ${settings.ocr.engine === 'google-vision' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">Google Vision</span>
                    <span className="engine-badge free">免费 1000次/月</span>
                  </div>
                  <p className="engine-desc">识别效果最好，支持 200+ 语言</p>
                  <div className="api-key-input-wrapper">
                    <input 
                      type={showApiKeys.googleVision ? "text" : "password"}
                      className="setting-input compact"
                      placeholder="API Key"
                      value={settings.ocr.googleVisionKey || ''}
                      onChange={(e) => updateSetting('ocr', 'googleVisionKey', e.target.value)}
                    />
                    <button 
                      type="button"
                      className="api-key-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowApiKeys(prev => ({ ...prev, googleVision: !prev.googleVision }));
                      }}
                      title={showApiKeys.googleVision ? "隐藏" : "显示"}
                    >
                      {showApiKeys.googleVision ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div className="engine-actions">
                  <button 
                    className={`btn ${settings.ocr.engine === 'google-vision' ? 'active' : ''} ${!settings.ocr.googleVisionKey ? 'disabled' : ''}`}
                    onClick={() => {
                      if (settings.ocr.googleVisionKey) {
                        updateSetting('ocr', 'engine', 'google-vision');
                        if (setOcrEngine) setOcrEngine('google-vision');
                      } else {
                        notify('请先配置 API Key', 'warning');
                      }
                    }}
                  >
                    {settings.ocr.engine === 'google-vision' ? '✓ 使用中' : '使用'}
                  </button>
                </div>
              </div>

              {/* Azure OCR */}
              <div className={`ocr-engine-item ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">Azure OCR</span>
                    <span className="engine-badge free">免费 5000次/月</span>
                  </div>
                  <p className="engine-desc">微软认知服务，手写识别强</p>
                  <div className="api-key-input-wrapper">
                    <input 
                      type={showApiKeys.azure ? "text" : "password"}
                      className="setting-input compact"
                      placeholder="API Key"
                      value={settings.ocr.azureKey || ''}
                      onChange={(e) => updateSetting('ocr', 'azureKey', e.target.value)}
                    />
                    <button 
                      type="button"
                      className="api-key-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowApiKeys(prev => ({ ...prev, azure: !prev.azure }));
                      }}
                      title={showApiKeys.azure ? "隐藏" : "显示"}
                    >
                      {showApiKeys.azure ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                    <input 
                      type="text"
                      className="setting-input compact"
                      placeholder="Endpoint (https://xxx.cognitiveservices.azure.com/)"
                      value={settings.ocr.azureEndpoint || ''}
                      onChange={(e) => updateSetting('ocr', 'azureEndpoint', e.target.value)}
                    />
                  </div>
                </div>
                <div className="engine-actions">
                  <button 
                    className={`btn ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''} ${!(settings.ocr.azureKey && settings.ocr.azureEndpoint) ? 'disabled' : ''}`}
                    onClick={() => {
                      if (settings.ocr.azureKey && settings.ocr.azureEndpoint) {
                        updateSetting('ocr', 'engine', 'azure-ocr');
                        if (setOcrEngine) setOcrEngine('azure-ocr');
                      } else {
                        notify('请先配置 API Key 和 Endpoint', 'warning');
                      }
                    }}
                  >
                    {settings.ocr.engine === 'azure-ocr' ? '✓ 使用中' : '使用'}
                  </button>
                </div>
              </div>

              {/* 百度 OCR */}
              <div className={`ocr-engine-item ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">百度 OCR</span>
                    <span className="engine-badge free">免费 1000次/月</span>
                  </div>
                  <p className="engine-desc">国内访问快，中文识别准确</p>
                  <div className="api-key-input-wrapper">
                    <input 
                      type={showApiKeys.baidu ? "text" : "password"}
                      className="setting-input compact"
                      placeholder="API Key"
                      value={settings.ocr.baiduApiKey || ''}
                      onChange={(e) => updateSetting('ocr', 'baiduApiKey', e.target.value)}
                    />
                    <button 
                      type="button"
                      className="api-key-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowApiKeys(prev => ({ ...prev, baidu: !prev.baidu }));
                      }}
                      title={showApiKeys.baidu ? "隐藏" : "显示"}
                    >
                      {showApiKeys.baidu ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                    <input 
                      type={showApiKeys.baiduSecret ? "text" : "password"}
                      className="setting-input compact"
                      placeholder="Secret Key"
                      value={settings.ocr.baiduSecretKey || ''}
                      onChange={(e) => updateSetting('ocr', 'baiduSecretKey', e.target.value)}
                    />
                    <button 
                      type="button"
                      className="api-key-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowApiKeys(prev => ({ ...prev, baiduSecret: !prev.baiduSecret }));
                      }}
                      title={showApiKeys.baiduSecret ? "隐藏" : "显示"}
                    >
                      {showApiKeys.baiduSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div className="engine-actions">
                  <button 
                    className={`btn ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''} ${!(settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey) ? 'disabled' : ''}`}
                    onClick={() => {
                      if (settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey) {
                        updateSetting('ocr', 'engine', 'baidu-ocr');
                        if (setOcrEngine) setOcrEngine('baidu-ocr');
                      } else {
                        notify('请先配置 API Key 和 Secret Key', 'warning');
                      }
                    }}
                  >
                    {settings.ocr.engine === 'baidu-ocr' ? '✓ 使用中' : '使用'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      case 'interface':
        return (
          <div className="setting-content">
            <h3>界面设置</h3>
            <div className="setting-group">
              <label className="setting-label">主题</label>
              <div className="theme-selector">
                <button className={`theme-option ${settings.interface.theme==='light'?'active':''}`} onClick={()=>{updateSetting('interface','theme','light'); document.documentElement.setAttribute('data-theme','light');}}><Sun size={16}/>浅色</button>
                <button className={`theme-option ${settings.interface.theme==='dark'?'active':''}`} onClick={()=>{updateSetting('interface','theme','dark'); document.documentElement.setAttribute('data-theme','dark');}}><Moon size={16}/>深色</button>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">字体大小: {settings.interface.fontSize}px</label>
              <input type="range" className="setting-range" min="12" max="24" value={settings.interface.fontSize} onChange={(e)=>updateSetting('interface','fontSize',parseInt(e.target.value))} />
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="setting-content about-section">
            <div className="app-info">
              <Zap size={48} className="app-icon"/>
              <h2>T-Translate Core</h2>
              <p>版本 1.0.0</p>
            </div>
            <div className="info-cards">
                <div className="info-card">
                    <h4>关于</h4>
                    <p>基于 Electron + React + Local LLM 的离线翻译工具。</p>
                </div>
            </div>
            <div className="about-actions">
                <button className="link-button" onClick={()=>window.electron?.shell.openExternal('https://github.com')}><GitBranch size={16}/> GitHub</button>
            </div>
          </div>
        );

      case 'glassWindow':
        return (
          <div className="setting-content">
            <h3>翻译玻璃窗设置</h3>
            <p className="setting-description">配置悬浮翻译窗口的行为和外观</p>
            
            <div className="setting-group">
              <label className="setting-label">锁定目标语言</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.glassWindow.lockTargetLang ? 'active' : ''}`}
                  onClick={() => updateSetting('glassWindow', 'lockTargetLang', !settings.glassWindow.lockTargetLang)}
                >
                  {settings.glassWindow.lockTargetLang ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.glassWindow.lockTargetLang ? '始终翻译成目标语言' : '根据原文自动切换（可能导致回译）'}
                </span>
              </div>
              <p className="setting-hint">建议开启，避免中英文来回切换</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">智能检测</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.glassWindow.smartDetect ? 'active' : ''}`}
                  onClick={() => updateSetting('glassWindow', 'smartDetect', !settings.glassWindow.smartDetect)}
                >
                  {settings.glassWindow.smartDetect ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.glassWindow.smartDetect ? '自动跳过未变化的内容' : '每次都重新识别翻译'}
                </span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">OCR 引擎</label>
              <div className="setting-hint-inline">
                使用全局 OCR 设置（当前：{settings.ocr.engine === 'llm-vision' ? 'LLM Vision' : 
                  settings.ocr.engine === 'windows-ocr' ? 'Windows OCR' :
                  settings.ocr.engine === 'paddle-ocr' ? 'PaddleOCR' :
                  settings.ocr.engine === 'rapid-ocr' ? 'RapidOCR' :
                  settings.ocr.engine}）
                <button 
                  className="link-button"
                  onClick={() => setActiveTab('ocr')}
                  style={{marginLeft: '8px'}}
                >
                  前往设置 →
                </button>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">默认透明度</label>
              <div className="setting-row">
                <input
                  type="range"
                  className="setting-range"
                  min="30"
                  max="100"
                  value={Math.round(settings.glassWindow.defaultOpacity * 100)}
                  onChange={(e) => updateSetting('glassWindow', 'defaultOpacity', parseInt(e.target.value) / 100)}
                />
                <span className="range-value">{Math.round(settings.glassWindow.defaultOpacity * 100)}%</span>
              </div>
              <p className="setting-hint">在玻璃窗中点击小横条可实时调节</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">窗口选项</label>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.glassWindow.rememberPosition}
                    onChange={(e) => updateSetting('glassWindow', 'rememberPosition', e.target.checked)}
                  />
                  <span>记住窗口位置</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.glassWindow.autoPin}
                    onChange={(e) => updateSetting('glassWindow', 'autoPin', e.target.checked)}
                  />
                  <span>默认置顶显示</span>
                </label>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">快捷键</label>
              <div className="shortcut-info">
                <div className="shortcut-item">
                  <kbd>Ctrl+Alt+G</kbd>
                  <span>打开/关闭玻璃窗口</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Space</kbd>
                  <span>手动截图识别</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Esc</kbd>
                  <span>退出字幕模式/关闭窗口</span>
                </div>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">使用说明</label>
              <div className="info-box">
                <p><strong>普通模式：</strong>点击 📷 截图识别当前区域</p>
                <p><strong>字幕模式：</strong>点击 🎬 开启实时字幕翻译</p>
                <p><strong>首次使用字幕模式：</strong>需要先框选视频原字幕区域</p>
              </div>
            </div>
          </div>
        );

      case 'selection':
        return (
          <div className="setting-content">
            <h3>划词翻译设置</h3>
            <p className="setting-description">选中文字后显示翻译按钮，点击即可翻译</p>
            
            <div className="setting-group">
              <label className="setting-label">启用划词翻译</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.selection.enabled ? 'active' : ''}`}
                  onClick={async () => {
                    // 先调用主进程切换状态
                    const newState = await window.electron?.selection?.toggle?.();
                    // 同步到设置
                    updateSetting('selection', 'enabled', newState);
                  }}
                >
                  {settings.selection.enabled ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.selection.enabled ? '选中文字后显示翻译按钮' : '已禁用划词翻译'}
                </span>
              </div>
              <p className="setting-hint">也可以点击系统托盘图标快速切换</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">按钮自动消失时间</label>
              <div className="setting-row">
                <input
                  type="range"
                  className="setting-range"
                  min="2000"
                  max="10000"
                  step="1000"
                  value={settings.selection.triggerTimeout}
                  onChange={(e) => updateSetting('selection', 'triggerTimeout', parseInt(e.target.value))}
                />
                <span className="range-value">{settings.selection.triggerTimeout / 1000}秒</span>
              </div>
              <p className="setting-hint">划词后翻译按钮自动消失的时间</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">默认显示原文</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.selection.showSourceByDefault ? 'active' : ''}`}
                  onClick={() => updateSetting('selection', 'showSourceByDefault', !settings.selection.showSourceByDefault)}
                >
                  {settings.selection.showSourceByDefault ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.selection.showSourceByDefault ? '翻译结果默认显示原文对照' : '只显示翻译结果'}
                </span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">复制后自动关闭</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.selection.autoCloseOnCopy ? 'active' : ''}`}
                  onClick={() => updateSetting('selection', 'autoCloseOnCopy', !settings.selection.autoCloseOnCopy)}
                >
                  {settings.selection.autoCloseOnCopy ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.selection.autoCloseOnCopy ? '点击复制后自动关闭翻译窗口' : '复制后保持窗口打开'}
                </span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">字符数限制</label>
              <div className="setting-row double">
                <div className="input-with-label">
                  <label>最小</label>
                  <input
                    type="number"
                    className="setting-input small"
                    value={settings.selection.minChars}
                    onChange={(e) => updateSetting('selection', 'minChars', parseInt(e.target.value) || 2)}
                    min="1"
                    max="10"
                  />
                </div>
                <div className="input-with-label">
                  <label>最大</label>
                  <input
                    type="number"
                    className="setting-input small"
                    value={settings.selection.maxChars}
                    onChange={(e) => updateSetting('selection', 'maxChars', parseInt(e.target.value) || 500)}
                    min="50"
                    max="2000"
                  />
                </div>
              </div>
              <p className="setting-hint">少于最小或超过最大字符数的选中内容不会触发翻译</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">使用说明</label>
              <div className="help-box">
                <p><strong>划词翻译流程：</strong></p>
                <ol>
                  <li>用鼠标选中需要翻译的文字</li>
                  <li>松开鼠标后，旁边出现翻译按钮</li>
                  <li>点击按钮开始翻译</li>
                  <li>翻译完成后显示结果卡片</li>
                </ol>
                <p style={{marginTop: '8px'}}><strong>快捷操作：</strong></p>
                <ul>
                  <li>拖动标题栏移动窗口</li>
                  <li>右下角调整大小</li>
                  <li>点击「原文」显示原文对照</li>
                  <li>点击「复制」或直接选中文字复制</li>
                  <li>按 ESC 或右键关闭</li>
                </ul>
              </div>
            </div>
          </div>
        );

      default: return null;
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-sidebar">
        <div className="settings-nav">
          <button className={`nav-item ${activeSection==='connection'?'active':''}`} onClick={()=>setActiveSection('connection')}><Wifi size={18}/><span>连接</span></button>
          <button className={`nav-item ${activeSection==='providers'?'active':''}`} onClick={()=>setActiveSection('providers')}><Server size={18}/><span>翻译源</span></button>
          <button className={`nav-item ${activeSection==='translation'?'active':''}`} onClick={()=>setActiveSection('translation')}><Globe size={18}/><span>翻译</span></button>
          <button className={`nav-item ${activeSection==='document'?'active':''}`} onClick={()=>setActiveSection('document')}><FileText size={18}/><span>文档</span></button>
          <button className={`nav-item ${activeSection==='glassWindow'?'active':''}`} onClick={()=>setActiveSection('glassWindow')}><Layers size={18}/><span>玻璃窗</span></button>
          <button className={`nav-item ${activeSection==='selection'?'active':''}`} onClick={()=>setActiveSection('selection')}><MousePointer size={18}/><span>划词</span></button>
          <button className={`nav-item ${activeSection==='privacy'?'active':''}`} onClick={()=>setActiveSection('privacy')}><Shield size={18}/><span>隐私</span></button>
          <button className={`nav-item ${activeSection==='ocr'?'active':''}`} onClick={()=>setActiveSection('ocr')}><Eye size={18}/><span>OCR</span></button>
          <button className={`nav-item ${activeSection==='interface'?'active':''}`} onClick={()=>setActiveSection('interface')}><Palette size={18}/><span>界面</span></button>
          <button className={`nav-item ${activeSection==='about'?'active':''}`} onClick={()=>setActiveSection('about')}><Info size={18}/><span>关于</span></button>
        </div>
        <div className="settings-actions">
            <button className="action-button" onClick={exportSettings}><Download size={14}/> 导出</button>
            <label className="action-button"><Upload size={14}/> 导入 <input type="file" accept=".json" onChange={importSettings} style={{display:'none'}}/></label>
            <button className="action-button danger" onClick={()=>resetSettings()}><RefreshCw size={14}/> 重置</button>
        </div>
      </div>

      <div className="settings-content-wrapper">
        {renderSettingContent()}
        <div className="settings-footer">
            <button className="save-button" onClick={saveSettings} disabled={isSaving}>
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <Save size={16}/>}
                {isSaving ? ' 保存中...' : ' 保存设置'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;