// src/components/SettingsPanel.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Globe, Shield, Zap, Download, Upload, Moon, Sun,
  Info, CheckCircle, Wifi, RefreshCw, AlertCircle,
  Save, Trash2, Eye, EyeOff, Lock, GitBranch,
  Code2, Palette, Layers, MousePointer, Server,
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
    // 应用内快捷键
    translate: 'Ctrl+Enter',
    swapLanguages: 'Ctrl+L',
    clear: 'Ctrl+Shift+C',
    paste: 'Ctrl+V',
    copy: 'Ctrl+C',
    // 全局快捷键（需要同步到主进程）
    screenshot: 'Alt+Q',
    toggleWindow: 'Ctrl+Shift+W',
    glassWindow: 'Ctrl+Alt+G',
    selectionTranslate: 'Ctrl+Shift+T',
  },
  dev: { debugMode: false },
  storage: { cache: { maxSize: 100 }, history: { maxItems: 1000 } }
};

/**
 * 隐私模式配置
 * 定义每个模式下的行为规则
 * 这是全局状态，影响所有功能模块
 */
const PRIVACY_MODES = {
  standard: {
    id: 'standard',
    name: '标准模式',
    icon: 'Zap',
    color: '#3b82f6',
    description: '功能全开，自动保存历史记录',
    features: {
      saveHistory: true,        // 保存历史记录
      useCache: true,           // 使用翻译缓存
      onlineApi: true,          // 允许在线API
      analytics: true,          // 统计数据
      autoSave: true,           // 自动保存设置
      selectionTranslate: true, // 划词翻译
      glassWindow: true,        // 玻璃窗口
      documentTranslate: true,  // 文档翻译
      exportData: true,         // 导出数据
    },
    allowedProviders: null,     // null表示全部允许
    allowedOcrEngines: null,    // null表示全部允许
  },
  secure: {
    id: 'secure',
    name: '无痕模式',
    icon: 'Shield',
    color: '#f59e0b',
    description: '不保存任何记录，关闭窗口即清除',
    features: {
      saveHistory: false,       // 不保存历史
      useCache: false,          // 不使用缓存（每次都重新翻译）
      onlineApi: true,          // 允许在线API
      analytics: false,         // 不统计数据
      autoSave: false,          // 不自动保存
      selectionTranslate: true, // 划词翻译（但不保存）
      glassWindow: true,        // 玻璃窗口（但不保存）
      documentTranslate: true,  // 文档翻译（但不保存）
      exportData: false,        // 禁止导出（无数据可导出）
    },
    allowedProviders: null,
    allowedOcrEngines: null,
  },
  offline: {
    id: 'offline',
    name: '离线模式',
    icon: 'Lock',
    color: '#10b981',
    description: '完全离线，不发送任何网络请求',
    features: {
      saveHistory: true,        // 保存历史
      useCache: true,           // 使用缓存
      onlineApi: false,         // 禁止在线API（核心限制）
      analytics: true,          // 统计数据
      autoSave: true,           // 自动保存
      selectionTranslate: true, // 划词翻译
      glassWindow: true,        // 玻璃窗口
      documentTranslate: true,  // 文档翻译
      exportData: true,         // 允许导出
    },
    // 离线模式下仅允许本地翻译源
    allowedProviders: ['local-llm'],
    // 离线模式下仅允许本地OCR引擎
    allowedOcrEngines: ['llm-vision', 'rapid-ocr', 'windows-ocr'],
    // 离线模式下禁用的在线服务
    disabledServices: ['openai', 'deepl', 'gemini', 'deepseek', 'google-translate', 'ocr-space', 'google-vision', 'azure-ocr', 'baidu-ocr'],
  }
};

/**
 * 获取当前模式的功能配置
 */
const getModeFeatures = (mode) => {
  return PRIVACY_MODES[mode]?.features || PRIVACY_MODES.standard.features;
};

/**
 * 检查某功能在当前模式下是否可用
 */
const isFeatureEnabled = (mode, featureName) => {
  const features = getModeFeatures(mode);
  return features[featureName] !== false;
};

/**
 * 检查某翻译源在当前模式下是否可用
 */
const isProviderAllowed = (mode, providerId) => {
  const modeConfig = PRIVACY_MODES[mode];
  if (!modeConfig?.allowedProviders) return true; // null表示全部允许
  return modeConfig.allowedProviders.includes(providerId);
};

/**
 * 快捷键标签映射
 */
const SHORTCUT_LABELS = {
  // 应用内快捷键
  translate: '执行翻译',
  swapLanguages: '切换语言',
  clear: '清空内容',
  paste: '粘贴文本',
  copy: '复制结果',
  // 全局快捷键
  screenshot: '📷 截图翻译',
  toggleWindow: '🪟 显示/隐藏窗口',
  glassWindow: '🔮 玻璃窗口',
  selectionTranslate: '✏️ 划词翻译开关',
};

/**
 * 全局快捷键列表（需要同步到主进程）
 */
const GLOBAL_SHORTCUT_KEYS = ['screenshot', 'toggleWindow', 'glassWindow', 'selectionTranslate'];

/**
 * 导航项配置（静态数据，移到组件外部提高性能）
 */
const NAV_ITEMS = [
  { id: 'connection', icon: Wifi, label: 'LM Studio', group: '连接', keywords: ['连接', '端点', 'api', 'endpoint', 'lmstudio', '超时', 'timeout'] },
  { id: 'providers', icon: Server, label: '翻译源', group: '连接', keywords: ['翻译源', 'provider', 'openai', 'deepl', 'gemini', 'deepseek', '本地', 'api'] },
  { id: 'translation', icon: Globe, label: '翻译设置', group: '翻译', keywords: ['翻译', '语言', '源语言', '目标语言', '自动', 'stream', '流式'] },
  { id: 'document', icon: FileText, label: '文档翻译', group: '翻译', keywords: ['文档', 'pdf', 'docx', 'epub', 'srt', '字幕', '批量'] },
  { id: 'selection', icon: MousePointer, label: '划词翻译', group: '翻译', keywords: ['划词', '选中', '鼠标', '触发', '按钮'] },
  { id: 'glassWindow', icon: Layers, label: '玻璃窗口', group: '翻译', keywords: ['玻璃', '透明', '窗口', '置顶', 'glass'] },
  { id: 'ocr', icon: Eye, label: 'OCR 识别', group: '系统', keywords: ['ocr', '识别', '截图', '图片', '文字识别', 'rapidocr', 'llm'] },
  { id: 'interface', icon: Palette, label: '界面外观', group: '系统', keywords: ['界面', '主题', '深色', '浅色', '字体', '外观'] },
  { id: 'privacy', icon: Shield, label: '隐私模式', group: '系统', keywords: ['隐私', '安全', '模式', '历史', '记录'] },
  { id: 'about', icon: Info, label: '关于', group: '系统', keywords: ['关于', '版本', '信息', 'about'] },
];

/**
 * 默认设置状态
 */
const DEFAULT_SETTINGS = {
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
    isWindows: false,
    paddleInstalled: false,
    rapidInstalled: false,
    ocrspaceKey: '',
    googleVisionKey: '',
    azureKey: '',
    azureEndpoint: '',
    baiduApiKey: '',
    baiduSecretKey: '',
  },
  screenshot: {
    showConfirmButtons: true,
    autoCapture: false
  },
  glassWindow: {
    refreshInterval: 3000,
    smartDetect: true,
    streamOutput: true,
    ocrEngine: 'llm-vision',
    defaultOpacity: 0.85,
    rememberPosition: true,
    autoPin: true,
    lockTargetLang: true
  },
  selection: {
    enabled: false,
    triggerTimeout: 4000,
    showSourceByDefault: false,
    minChars: 2,
    maxChars: 500,
    autoCloseOnCopy: false,
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
};

/**
 * 迁移旧版设置格式
 */
const migrateOldSettings = (savedSettings) => {
  if (!savedSettings) return null;
  
  let migrated = { ...savedSettings };
  
  // 迁移旧格式：settings.providers -> settings.translation.providers
  if (savedSettings.providers?.list && !savedSettings.translation?.providers) {
    console.log('[Settings] Migrating old providers format...');
    migrated = {
      ...savedSettings,
      translation: {
        ...savedSettings.translation,
        providers: savedSettings.providers.list,
        providerConfigs: savedSettings.providers.configs,
        subtitleProvider: savedSettings.providers.subtitleProvider,
      }
    };
    delete migrated.providers;
  }
  
  return migrated;
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

  // 设置状态 - 使用外部默认值
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [initialSettings, setInitialSettings] = useState(null); // 用于检测未保存更改

  const [activeSection, setActiveSection] = useState('connection');
  const [connectionStatus, setConnectionStatus] = useState('unknown');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [models, setModels] = useState([]);
  const [showApiKeys, setShowApiKeys] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [editingShortcut, setEditingShortcut] = useState(null); // 正在编辑的快捷键

  // 检测是否有未保存的更改
  const hasUnsavedChanges = useMemo(() => {
    if (!initialSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(initialSettings);
  }, [settings, initialSettings]);

  // 离开页面时提醒
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '您有未保存的更改，确定要离开吗？';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // 切换设置页 - 使用 useCallback 优化
  const handleSectionChange = useCallback((section) => {
    if (section !== activeSection) {
      setActiveSection(section);
      setSearchQuery('');
    }
  }, [activeSection]);

  // 切换分组折叠状态
  const toggleGroup = useCallback((groupId) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  }, []);

  // 使用 useMemo 优化搜索过滤
  const { filteredNavItems, groupedNavItems } = useMemo(() => {
    const filtered = searchQuery.trim() 
      ? NAV_ITEMS.filter(item => {
          const query = searchQuery.toLowerCase();
          return item.label.toLowerCase().includes(query) ||
                 item.keywords.some(k => k.toLowerCase().includes(query));
        })
      : NAV_ITEMS;
    
    const grouped = filtered.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});
    
    return { filteredNavItems: filtered, groupedNavItems: grouped };
  }, [searchQuery]);

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  // 监听划词翻译状态变化（来自快捷键或托盘）
  useEffect(() => {
    const handleSelectionStateChange = (enabled) => {
      console.log('[Settings] Selection state changed from main process:', enabled);
      setSettings(prev => ({
        ...prev,
        selection: { ...prev.selection, enabled }
      }));
    };

    // 注册监听器
    let cleanup = null;
    if (window.electron?.ipc?.on) {
      cleanup = window.electron.ipc.on('selection-state-changed', handleSelectionStateChange);
    }

    // 清理
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const loadSettings = async () => {
    try {
      // 1. 检测运行时环境
      const runtimeState = await detectRuntimeState();
      
      // 2. 加载保存的设置
      let savedSettings = null;
      if (window.electron?.store) {
        savedSettings = await window.electron.store.get('settings');
      } else {
        const stored = localStorage.getItem('settings');
        savedSettings = stored ? JSON.parse(stored) : null;
      }
      
      // 3. 迁移旧格式
      const migratedSettings = migrateOldSettings(savedSettings);
      
      // 4. 合并设置
      let finalSettings;
      if (migratedSettings) {
        finalSettings = { 
          ...DEFAULT_SETTINGS, 
          ...migratedSettings,
          ocr: {
            ...DEFAULT_SETTINGS.ocr,
            ...migratedSettings.ocr,
            ...runtimeState.ocr,
          },
          selection: {
            ...DEFAULT_SETTINGS.selection,
            ...migratedSettings.selection,
            enabled: runtimeState.selectionEnabled,
          },
          translation: {
            ...DEFAULT_SETTINGS.translation,
            ...migratedSettings.translation,
          },
          // 确保快捷键配置完整（合并默认值和用户设置）
          shortcuts: {
            ...defaultConfig.shortcuts,
            ...migratedSettings.shortcuts,
          }
        };
        
        // 同步 OCR 引擎到 Store
        if (migratedSettings.ocr?.engine && setOcrEngine) {
          setOcrEngine(migratedSettings.ocr.engine);
        }
      } else {
        // 没有保存的设置，只更新运行时状态
        finalSettings = {
          ...DEFAULT_SETTINGS,
          ocr: { ...DEFAULT_SETTINGS.ocr, ...runtimeState.ocr },
          selection: { ...DEFAULT_SETTINGS.selection, enabled: runtimeState.selectionEnabled }
        };
      }
      
      setSettings(finalSettings);
      setInitialSettings(JSON.parse(JSON.stringify(finalSettings))); // 深拷贝保存初始状态
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  /**
   * 检测运行时环境状态
   */
  const detectRuntimeState = async () => {
    const state = {
      ocr: { isWindows: false, paddleInstalled: false, rapidInstalled: false },
      selectionEnabled: false
    };

    // 检测平台
    try {
      if (window.electron?.app?.getPlatform) {
        const platform = await window.electron.app.getPlatform();
        state.ocr.isWindows = platform === 'win32';
      } else if (window.nodeAPI?.process?.platform) {
        state.ocr.isWindows = window.nodeAPI.process.platform === 'win32';
      } else if (typeof navigator !== 'undefined') {
        state.ocr.isWindows = navigator.platform?.toLowerCase().includes('win') || 
                              navigator.userAgent?.toLowerCase().includes('windows');
      }
    } catch (e) {
      console.log('Platform detection failed:', e);
    }

    // 检测 OCR 引擎安装状态
    try {
      if (window.electron?.ocr?.checkInstalled) {
        const installedStatus = await window.electron.ocr.checkInstalled();
        state.ocr.rapidInstalled = installedStatus?.['rapid-ocr'] || false;
      }
    } catch (e) {
      console.log('OCR install check failed:', e);
    }

    // 获取划词翻译状态（从主进程获取实际状态）
    try {
      if (window.electron?.selection?.getEnabled) {
        const enabled = await window.electron.selection.getEnabled();
        state.selectionEnabled = enabled === true; // 确保是布尔值
        console.log('[Settings] Selection translate state from main process:', state.selectionEnabled);
      } else {
        console.log('[Settings] selection.getEnabled not available');
      }
    } catch (e) {
      console.error('[Settings] Selection state check failed:', e);
    }

    return state;
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
      
      // 保存到存储
      if (window.electron?.store) {
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
      
      // 更新初始设置状态（用于检测未保存更改）
      setInitialSettings(JSON.parse(JSON.stringify(settings)));
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
      // 先临时更新 translationService 的 endpoint
      const currentEndpoint = settings.connection.endpoint;
      
      const result = await translationService.testConnection(currentEndpoint);
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
    if (!window.confirm(section ? `重置 "${section}" 的设置？` : '重置所有设置？这将清除所有自定义配置。')) return;

    if (section) {
      // 部分重置 - 使用默认值覆盖指定部分
      if (DEFAULT_SETTINGS[section]) {
        setSettings(prev => ({
          ...prev,
          [section]: { ...DEFAULT_SETTINGS[section] }
        }));
        notify(`${section} 设置已重置`, 'success');
      } else {
        notify(`未找到 ${section} 的默认设置`, 'error');
      }
    } else {
      // 全部重置
      localStorage.removeItem('settings');
      if (window.electron?.store) {
        window.electron.store.delete('settings');
      }
      setSettings({ ...DEFAULT_SETTINGS });
      notify('所有设置已重置', 'success');
    }
  };

  const exportSettings = () => {
    // 添加版本信息便于后续兼容
    const exportData = {
      _version: '1.0',
      _exportedAt: new Date().toISOString(),
      ...settings
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t-translate-settings_${new Date().toISOString().slice(0, 10)}.json`;
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
        
        // 移除元数据字段
        const { _version, _exportedAt, ...settingsData } = imported;
        
        // 验证基本结构
        const requiredSections = ['connection', 'translation', 'ocr', 'interface'];
        const hasRequiredSections = requiredSections.some(s => settingsData[s]);
        
        if (!hasRequiredSections) {
          notify('设置文件格式不正确', 'error');
          return;
        }
        
        // 合并设置（保留未导入部分的默认值）
        setSettings(prev => {
          const merged = { ...prev };
          Object.keys(settingsData).forEach(key => {
            if (typeof settingsData[key] === 'object' && settingsData[key] !== null) {
              merged[key] = { ...prev[key], ...settingsData[key] };
            } else {
              merged[key] = settingsData[key];
            }
          });
          return merged;
        });
        
        notify('设置已导入，请保存以生效', 'success');
      } catch (error) {
        console.error('Import settings error:', error);
        notify('无效的设置文件', 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = null;
  };

  // 更新设置 - 使用 useCallback 优化
  const updateSetting = useCallback((section, key, value) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  }, []);

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
          const currentMode = useTranslationStore.getState().translationMode || 'standard';
          const modeConfig = PRIVACY_MODES[currentMode];
          
          return (
            <div className="setting-content">
              <h3>隐私与安全模式</h3>
              <p className="setting-description">选择适合您需求的工作模式，不同模式下可用功能不同</p>
              
              {/* 当前模式状态提示 */}
              <div className={`current-mode-banner mode-${currentMode}`}>
                <div className="mode-banner-icon">
                  {currentMode === 'standard' && <Zap size={20} />}
                  {currentMode === 'secure' && <Shield size={20} />}
                  {currentMode === 'offline' && <Lock size={20} />}
                </div>
                <div className="mode-banner-info">
                  <span className="mode-banner-label">当前模式</span>
                  <span className="mode-banner-name">{modeConfig?.name}</span>
                </div>
              </div>
              
              {/* 模式选择卡片 */}
              <div className="mode-selection-grid">
                {Object.values(PRIVACY_MODES).map((mode) => {
                  const isSelected = currentMode === mode.id;
                  const IconComponent = mode.icon === 'Zap' ? Zap : mode.icon === 'Shield' ? Shield : Lock;
                  
                  return (
                    <div 
                      key={mode.id}
                      className={`mode-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        updateSetting('privacy', 'mode', mode.id); 
                        useTranslationStore.getState().setTranslationMode(mode.id);
                        // 通知主进程模式变更
                        window.electron?.privacy?.setMode?.(mode.id);
                        notify(`已切换到${mode.name}`, 'success');
                      }}
                    >
                      <div className="mode-icon"><IconComponent size={24} /></div>
                      <div className="mode-info">
                        <h4>{mode.name}</h4>
                        <p>{mode.description}</p>
                      </div>
                      {isSelected && <div className="mode-check"><CheckCircle size={18} /></div>}
                    </div>
                  );
                })}
              </div>

              {/* 当前模式功能说明 */}
              <div className="mode-features-panel">
                <h4>📋 当前模式功能说明</h4>
                <div className="feature-list">
                  <div className={`feature-item ${modeConfig?.features.saveHistory ? 'enabled' : 'disabled'}`}>
                    <span className="feature-icon">{modeConfig?.features.saveHistory ? '✓' : '✗'}</span>
                    <span className="feature-name">历史记录</span>
                    <span className="feature-status">{modeConfig?.features.saveHistory ? '保存' : '不保存'}</span>
                  </div>
                  <div className={`feature-item ${modeConfig?.features.useCache ? 'enabled' : 'disabled'}`}>
                    <span className="feature-icon">{modeConfig?.features.useCache ? '✓' : '✗'}</span>
                    <span className="feature-name">翻译缓存</span>
                    <span className="feature-status">{modeConfig?.features.useCache ? '启用' : '禁用'}</span>
                  </div>
                  <div className={`feature-item ${modeConfig?.features.onlineApi ? 'enabled' : 'disabled'}`}>
                    <span className="feature-icon">{modeConfig?.features.onlineApi ? '✓' : '✗'}</span>
                    <span className="feature-name">在线翻译API</span>
                    <span className="feature-status">{modeConfig?.features.onlineApi ? '允许' : '禁止'}</span>
                  </div>
                  <div className={`feature-item ${modeConfig?.features.analytics ? 'enabled' : 'disabled'}`}>
                    <span className="feature-icon">{modeConfig?.features.analytics ? '✓' : '✗'}</span>
                    <span className="feature-name">使用统计</span>
                    <span className="feature-status">{modeConfig?.features.analytics ? '收集' : '不收集'}</span>
                  </div>
                </div>
                
                {currentMode === 'offline' && (
                  <div className="mode-warning">
                    <AlertCircle size={16} />
                    <span>离线模式下仅可使用本地 LLM 翻译，在线翻译源（OpenAI、DeepL等）将被禁用</span>
                  </div>
                )}
                
                {currentMode === 'secure' && (
                  <div className="mode-warning secure">
                    <Shield size={16} />
                    <span>无痕模式下所有翻译记录仅存在于当前会话，关闭应用后自动清除</span>
                  </div>
                )}
              </div>

              {/* 数据管理 */}
              <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
                <h4 style={{marginBottom: '16px', color: 'var(--text-primary)'}}>🗂️ 数据管理</h4>
                
                <div className="setting-row">
                  <span>自动删除历史记录</span>
                  <div className="input-with-suffix">
                    <input
                      type="number"
                      className="setting-input small"
                      value={settings.privacy?.autoDeleteDays || 0}
                      onChange={(e) => updateSetting('privacy', 'autoDeleteDays', parseInt(e.target.value) || 0)}
                      min="0"
                      max="365"
                      disabled={currentMode === 'secure'}
                    />
                    <span className="input-suffix">天后</span>
                  </div>
                </div>
                <p className="setting-hint">设为 0 表示永不自动删除{currentMode === 'secure' ? '（无痕模式下此选项无效）' : ''}</p>
              </div>
  
              <div className="setting-group">
                <div className="danger-actions">
                  <button 
                    className="danger-button"
                    onClick={() => {
                      if (window.confirm('确定要清除所有翻译历史吗？')) {
                        useTranslationStore.getState().clearHistory?.();
                        notify('历史记录已清除', 'success');
                      }
                    }}
                  >
                    <Trash2 size={16} /> 清除历史记录
                  </button>
                  <button 
                    className="danger-button"
                    onClick={() => {
                      if (window.confirm('确定要清除所有本地数据吗？这将重置所有设置。')) {
                        localStorage.clear();
                        window.electron?.store?.clear?.();
                        window.location.reload();
                      }
                    }}
                  >
                    <Trash2 size={16} /> 清除所有数据
                  </button>
                </div>
              </div>
            </div>
          );
          
      case 'ocr':
        return (
          <div className="setting-content animate-fade-in">
            <h3>OCR 设置</h3>
            <p className="setting-description">配置文字识别引擎和语言</p>
            
            {/* 1. OCR 识别语言 */}
            <div className="setting-group">
              <label className="setting-label">识别语言</label>
              <select 
                className="setting-select" 
                value={settings.ocr.recognitionLanguage || 'auto'} 
                onChange={(e) => updateSetting('ocr', 'recognitionLanguage', e.target.value)}
              >
                <option value="auto">🔄 自动检测</option>
                <option value="zh-Hans">🇨🇳 简体中文</option>
                <option value="zh-Hant">🇹🇼 繁体中文</option>
                <option value="en">🇺🇸 英文</option>
                <option value="ja">🇯🇵 日文</option>
                <option value="ko">🇰🇷 韩文</option>
                <option value="fr">🇫🇷 法文</option>
                <option value="de">🇩🇪 德文</option>
                <option value="es">🇪🇸 西班牙文</option>
                <option value="ru">🇷🇺 俄文</option>
              </select>
              <p className="setting-hint">
                选择"自动检测"时，将根据翻译设置自动选择
              </p>
            </div>
            
            {/* 2. 截图设置 */}
            <div className="setting-group">
              <label className="setting-toggle">
                <input 
                  type="checkbox" 
                  checked={settings.screenshot?.showConfirmButtons ?? true}
                  onChange={(e) => updateSetting('screenshot', 'showConfirmButtons', e.target.checked)}
                />
                <span>显示截图确认按钮</span>
              </label>
              <p className="setting-hint">
                启用后，选择区域后需点击确认或按 Enter 键
              </p>
            </div>

            {/* 3. 图片预处理设置 */}
            <div className="setting-group">
              <label className="setting-toggle">
                <input 
                  type="checkbox" 
                  checked={settings.ocr?.enablePreprocess ?? true}
                  onChange={(e) => updateSetting('ocr', 'enablePreprocess', e.target.checked)}
                />
                <span>自动放大小图片</span>
              </label>
              <p className="setting-hint">
                小字体（&lt;15px）识别率低，自动放大可提升准确率
              </p>
              {(settings.ocr?.enablePreprocess ?? true) && (
                <div className="sub-setting">
                  <label className="setting-label">放大倍数</label>
                  <select 
                    className="setting-select"
                    value={settings.ocr?.scaleFactor || 2}
                    onChange={(e) => updateSetting('ocr', 'scaleFactor', parseFloat(e.target.value))}
                    style={{width: '120px'}}
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
            <details className="setting-section" open={!collapsedGroups['ocr-local']}>
              <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-local'); }}>
                <span className="section-title">🚀 本地 OCR 引擎</span>
                <span className="section-hint">毫秒级响应，推荐优先使用</span>
              </summary>
              <div className="section-content">
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
              </div>
            </details>

            {/* 第二梯队：视觉大模型 */}
            <details className="setting-section" open={!collapsedGroups['ocr-vision']}>
              <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-vision'); }}>
                <span className="section-title">⚡ 视觉大模型</span>
                <span className="section-hint">深度识别，处理复杂场景</span>
              </summary>
              <div className="section-content">
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
              </div>
            </details>

            {/* 第三梯队：在线 OCR API */}
            <details className="setting-section" open={!collapsedGroups['ocr-online']}>
              <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-online'); }}>
                <span className="section-title">🌐 在线 OCR 服务</span>
                <span className="section-hint">精准模式，需联网</span>
              </summary>
              <div className="section-content">
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
            </details>
          </div>
        );
      case 'interface':
        return (
          <div className="setting-content">
            <h3>界面设置</h3>
            <p className="setting-description">自定义应用外观和显示效果</p>
            
            <div className="setting-group">
              <label className="setting-label">主题</label>
              <div className="theme-selector">
                <button 
                  className={`theme-option ${settings.interface.theme==='light'?'active':''}`} 
                  onClick={() => {
                    updateSetting('interface','theme','light'); 
                    document.documentElement.setAttribute('data-theme','light');
                  }}
                >
                  <Sun size={16}/>浅色
                </button>
                <button 
                  className={`theme-option ${settings.interface.theme==='dark'?'active':''}`} 
                  onClick={() => {
                    updateSetting('interface','theme','dark'); 
                    document.documentElement.setAttribute('data-theme','dark');
                  }}
                >
                  <Moon size={16}/>深色
                </button>
              </div>
              <p className="setting-hint">主题切换即时生效，无需保存</p>
            </div>
            
            <div className="setting-group">
              <label className="setting-label">字体大小: {settings.interface.fontSize}px</label>
              <input 
                type="range" 
                className="setting-range" 
                min="12" 
                max="20" 
                value={settings.interface.fontSize} 
                onChange={(e) => {
                  const size = parseInt(e.target.value);
                  updateSetting('interface','fontSize', size);
                  // 即时预览
                  document.documentElement.style.setProperty('--base-font-size', `${size}px`);
                }} 
              />
              <p className="setting-hint">调整翻译文本的显示大小</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">窗口透明度</label>
              <div className="setting-row">
                <input 
                  type="range" 
                  className="setting-range" 
                  min="50" 
                  max="100" 
                  value={(settings.interface.windowOpacity || 100)} 
                  onChange={(e) => updateSetting('interface','windowOpacity', parseInt(e.target.value))} 
                />
                <span className="range-value">{settings.interface.windowOpacity || 100}%</span>
              </div>
              <p className="setting-hint">调整主窗口透明度（需重启生效）</p>
            </div>

            <div className="setting-group">
              <label className="setting-toggle">
                <input 
                  type="checkbox" 
                  checked={settings.interface.compactMode || false}
                  onChange={(e) => updateSetting('interface', 'compactMode', e.target.checked)}
                />
                <span>紧凑模式</span>
              </label>
              <p className="setting-hint">减少界面元素间距，显示更多内容</p>
            </div>

            {/* 快捷键设置 */}
            <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
              <label className="setting-label">⌨️ 快捷键设置</label>
              <p className="setting-hint" style={{marginBottom: '12px'}}>点击快捷键可进行修改，按 Esc 取消。带 🌐 标记的为全局快捷键（系统级生效）</p>
              
              <div className="shortcut-editor">
                {/* 合并默认配置和用户设置，确保所有快捷键都显示 */}
                {Object.entries({ ...defaultConfig.shortcuts, ...settings.shortcuts }).map(([action, shortcut]) => {
                  const shortcutConfig = {
                    // 应用内快捷键
                    translate: { label: '执行翻译', global: false, icon: '⏎' },
                    swapLanguages: { label: '切换语言', global: false, icon: '🔄' },
                    clear: { label: '清空内容', global: false, icon: '🗑️' },
                    paste: { label: '粘贴文本', global: false, icon: '📋' },
                    copy: { label: '复制结果', global: false, icon: '📄' },
                    // 全局快捷键
                    screenshot: { label: '截图翻译', global: true, icon: '📷' },
                    toggleWindow: { label: '显示/隐藏窗口', global: true, icon: '🪟' },
                    glassWindow: { label: '玻璃窗口', global: true, icon: '🔮' },
                    selectionTranslate: { label: '划词翻译开关', global: true, icon: '✏️' },
                  };
                  
                  const config = shortcutConfig[action];
                  // 跳过未知的快捷键
                  if (!config) return null;
                  
                  // 开始编辑快捷键
                  const startEditing = async () => {
                    // 如果是全局快捷键，先暂停以防止编辑时误触发
                    if (config.global && window.electron?.shortcuts?.pause) {
                      await window.electron.shortcuts.pause(action);
                    }
                    setEditingShortcut(action);
                  };
                  
                  // 取消编辑（恢复原快捷键）
                  const cancelEditing = async () => {
                    setEditingShortcut(null);
                    // 如果是全局快捷键，恢复原来的注册
                    if (config.global && window.electron?.shortcuts?.resume) {
                      await window.electron.shortcuts.resume(action);
                    }
                  };
                  
                  // 完成编辑（更新快捷键）
                  const finishEditing = async (newShortcut) => {
                    updateSetting('shortcuts', action, newShortcut);
                    setEditingShortcut(null);
                    
                    // 如果是全局快捷键，通知主进程更新（update会注册新的）
                    if (config.global && window.electron?.shortcuts?.update) {
                      const result = await window.electron.shortcuts.update(action, newShortcut);
                      if (result?.success) {
                        notify(`全局快捷键已更新: ${config.label} → ${newShortcut}`, 'success');
                      } else {
                        notify(`快捷键更新失败: ${result?.error || '未知错误'}`, 'error');
                        // 恢复原快捷键
                        await window.electron.shortcuts.resume(action);
                      }
                    }
                  };
                  
                  return (
                    <div key={action} className={`shortcut-row ${config.global ? 'global' : ''}`}>
                      <span className="shortcut-action">
                        <span className="shortcut-icon">{config.icon}</span>
                        {config.global && <span className="global-badge">🌐</span>}
                        {config.label}
                      </span>
                      {editingShortcut === action ? (
                        <input
                          type="text"
                          className="shortcut-input"
                          value={shortcut}
                          autoFocus
                          onKeyDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (e.key === 'Escape') {
                              cancelEditing();
                              return;
                            }
                            
                            const keys = [];
                            if (e.ctrlKey) keys.push('Ctrl');
                            if (e.altKey) keys.push('Alt');
                            if (e.shiftKey) keys.push('Shift');
                            if (e.metaKey) keys.push('Meta');
                            
                            const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                            if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                              keys.push(key);
                            }
                            
                            if (keys.length > 0 && !['Control', 'Alt', 'Shift', 'Meta'].includes(keys[keys.length - 1])) {
                              const newShortcut = keys.join('+');
                              finishEditing(newShortcut);
                            }
                          }}
                          onBlur={() => cancelEditing()}
                          placeholder="按下快捷键..."
                        />
                      ) : (
                        <button
                          className="shortcut-key"
                          onClick={() => startEditing()}
                        >
                          {shortcut.split('+').map((k, i) => (
                            <kbd key={i}>{k}</kbd>
                          ))}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              
              <button 
                className="link-button" 
                style={{marginTop: '12px'}}
                onClick={() => {
                  updateSetting('shortcuts', null, defaultConfig.shortcuts);
                  setSettings(prev => ({ ...prev, shortcuts: defaultConfig.shortcuts }));
                  // 同步全局快捷键到主进程
                  if (window.electron?.shortcuts?.update) {
                    ['screenshot', 'toggleWindow', 'glassWindow', 'selectionTranslate'].forEach(action => {
                      window.electron.shortcuts.update(action, defaultConfig.shortcuts[action]);
                    });
                  }
                  notify('快捷键已重置为默认值', 'success');
                }}
              >
                <RefreshCw size={14} /> 重置为默认
              </button>
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="setting-content about-section">
            <div className="app-info">
              <Zap size={48} className="app-icon"/>
              <h2>T-Translate</h2>
              <p className="version-tag">v1.0.0</p>
              <p className="app-desc">智能离线翻译工具</p>
            </div>
            
            <div className="info-cards">
              <div className="info-card">
                <h4>🚀 核心特性</h4>
                <ul>
                  <li>本地 LLM 翻译，数据不出设备</li>
                  <li>多引擎 OCR 文字识别</li>
                  <li>PDF/DOCX/EPUB 文档翻译</li>
                  <li>划词翻译 + 玻璃窗口</li>
                </ul>
              </div>
              <div className="info-card">
                <h4>⚙️ 技术栈</h4>
                <ul>
                  <li>Electron + React 18</li>
                  <li>Zustand 状态管理</li>
                  <li>LM Studio / Ollama 后端</li>
                  <li>RapidOCR / LLM Vision</li>
                </ul>
              </div>
            </div>
            
            <div className="about-actions">
              <button 
                className="link-button" 
                onClick={() => window.electron?.shell?.openExternal?.('https://github.com/your-repo/t-translate')}
              >
                <GitBranch size={16}/> GitHub
              </button>
              <button 
                className="link-button"
                onClick={() => notify('检查更新功能开发中', 'info')}
              >
                <RefreshCw size={16}/> 检查更新
              </button>
            </div>
            
            <div className="about-footer">
              <p>Made with ❤️ for translators</p>
              <p className="copyright">© 2024-2025 T-Translate</p>
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
                  onClick={() => handleSectionChange('ocr')}
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
                    try {
                      // 调用主进程切换状态
                      const newState = await window.electron?.selection?.toggle?.();
                      console.log('[Settings] Selection toggle result:', newState);
                      // 同步到设置（使用主进程返回的实际状态）
                      if (typeof newState === 'boolean') {
                        updateSetting('selection', 'enabled', newState);
                        notify(newState ? '划词翻译已开启' : '划词翻译已关闭', 'success');
                      }
                    } catch (e) {
                      console.error('[Settings] Selection toggle error:', e);
                      notify('切换划词翻译失败', 'error');
                    }
                  }}
                >
                  {settings.selection.enabled ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.selection.enabled ? '选中文字后显示翻译按钮' : '已禁用划词翻译'}
                </span>
              </div>
              <p className="setting-hint">也可以使用快捷键 {settings.shortcuts?.selectionTranslate || 'Ctrl+Shift+T'} 快速切换</p>
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
        {/* 搜索框 */}
        <div className="settings-search">
          <input
            type="text"
            placeholder="搜索设置..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        
        <div className="settings-nav">
          {/* 动态渲染分组和导航项 */}
          {Object.entries(groupedNavItems).map(([group, items], groupIndex) => (
            <React.Fragment key={group}>
              {groupIndex > 0 && <div className="nav-divider" />}
              <div className="nav-group-title">{group}</div>
              {items.map(item => {
                const Icon = item.icon;
                const isSearchMatch = searchQuery.trim() && (
                  item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
                );
                return (
                  <button 
                    key={item.id}
                    className={`nav-item ${activeSection === item.id ? 'active' : ''} ${isSearchMatch ? 'search-match' : ''}`} 
                    onClick={() => handleSectionChange(item.id)}
                  >
                    <Icon size={16}/>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          
          {/* 搜索无结果提示 */}
          {filteredNavItems.length === 0 && (
            <div className="nav-empty">
              <p>未找到匹配的设置</p>
            </div>
          )}
        </div>
        <div className="settings-actions">
            <button className="action-button" onClick={exportSettings}><Download size={14}/> 导出</button>
            <label className="action-button"><Upload size={14}/> 导入 <input type="file" accept=".json" onChange={importSettings} style={{display:'none'}}/></label>
            <button className="action-button danger" onClick={()=>resetSettings()}><RefreshCw size={14}/> 重置</button>
        </div>
      </div>

      <div className="settings-content-wrapper">
        <div key={activeSection} className="setting-content-animated">
          {renderSettingContent()}
        </div>
        <div className="settings-footer">
            {/* 未保存更改提示 */}
            {hasUnsavedChanges && (
              <div className="unsaved-indicator">
                有未保存的更改
              </div>
            )}
            <button className="save-button" onClick={saveSettings} disabled={isSaving}>
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <Save size={16}/>}
                {isSaving ? ' 保存中...' : hasUnsavedChanges ? ' 保存更改' : ' 保存设置'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
