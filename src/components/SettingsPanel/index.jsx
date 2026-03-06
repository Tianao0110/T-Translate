// src/components/SettingsPanel/index.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe, Shield, Zap, Download, Upload, Moon, Sun,
  Info, CheckCircle, Wifi, RefreshCw, AlertCircle,
  Save, Trash2, Eye, EyeOff, Lock, GitBranch,
  Code2, Palette, Layers, MousePointer, Server,
  FileText, Filter
} from 'lucide-react';
import translationService from '../../services/translation.js';
import { ocrManager } from '../../providers/ocr/index.js';
import useTranslationStore from '../../stores/translation-store';
import ProviderSettings from '../ProviderSettings';
import createLogger from '../../utils/logger.js';
import './styles.css';

// 从 constants.js 导入常量
import {
  defaultConfig,
  PRIVACY_MODES,
  PRIVACY_MODE_IDS,
  getModeFeatures,
  isFeatureEnabled,
  isProviderAllowed,
  SHORTCUT_LABELS,
  GLOBAL_SHORTCUT_KEYS,
  NAV_ITEMS,
  DEFAULT_SETTINGS,
  LANGUAGE_OPTIONS,
  migrateOldSettings
} from './constants.js';

// 拆分出的设置区块组件
import {
  OcrSection,
  InterfaceSection,
  GlassWindowSection,
  SelectionSection,
  PrivacySection,
  DocumentSection,
  TTSSection,
  AboutSection,
  ProvidersSection,
  TranslationSection
} from './sections/index.jsx'; 

// 日志实例
const logger = createLogger('Settings');

/**
 * 设置面板组件
 */
const SettingsPanel = ({ showNotification }) => {
  const { t } = useTranslation();
  
  // 兼容 props
  const notify = showNotification || ((msg, type) => logger.debug(`[${type}] ${msg}`));

  // 侧边栏菜单翻译映射
  const navLabels = {
    providers: t('settingsNav.providers'),
    translation: t('settingsNav.translation'),
    selection: t('settingsNav.selection'),
    glassWindow: t('settingsNav.glassWindow'),
    document: t('settingsNav.document'),
    ocr: t('settingsNav.ocr'),
    tts: t('settingsNav.tts'),
    interface: t('settingsNav.interface'),
    privacy: t('settingsNav.privacy'),
    about: t('settingsNav.about'),
  };
  
  const groupLabels = {
    'translation': t('settingsNav.groupTranslation'),
    'system': t('settingsNav.groupSystem'),
  };

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
  const [settingsReady, setSettingsReady] = useState(false); // settings 是否从磁盘加载完成
  const [isDirty, setIsDirty] = useState(false); // 是否有未保存的更改（简单标志）
  const isInitializingRef = useRef(true); // 是否正在初始化

  const [activeSection, setActiveSection] = useState('providers');
  const [connectionStatus, setConnectionStatus] = useState('unknown');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [models, setModels] = useState([]);
  const [showApiKeys, setShowApiKeys] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [editingShortcut, setEditingShortcut] = useState(null); // 正在编辑的快捷键
  const [simpleMode, setSimpleMode] = useState(() => {
    const saved = localStorage.getItem('settings-simple-mode');
    return saved === null ? true : saved === 'true';
  });

  // 简化：只要有操作就标记为 dirty
  const hasUnsavedChanges = isDirty;

  // 离开页面时提醒
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
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

  // 切换简洁/完整模式
  const toggleSimpleMode = useCallback(() => {
    setSimpleMode(prev => {
      const next = !prev;
      localStorage.setItem('settings-simple-mode', String(next));
      if (next) {
        const basicIds = NAV_ITEMS.filter(i => i.basic).map(i => i.id);
        if (!basicIds.includes(activeSection)) {
          setActiveSection(basicIds[0] || 'providers');
        }
      }
      return next;
    });
  }, [activeSection]);

  // 使用 useMemo 优化搜索过滤
  const { filteredNavItems, groupedNavItems } = useMemo(() => {
    let items = searchQuery.trim() 
      ? NAV_ITEMS.filter(item => {
          const query = searchQuery.toLowerCase();
          const translatedLabel = (navLabels[item.id] || item.id).toLowerCase();
          return translatedLabel.includes(query) ||
                 item.keywords.some(k => k.toLowerCase().includes(query));
        })
      : simpleMode
        ? NAV_ITEMS.filter(item => item.basic)
        : NAV_ITEMS;
    
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});
    
    return { filteredNavItems: items, groupedNavItems: grouped };
  }, [searchQuery, simpleMode, navLabels]);

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  // 监听划词翻译状态变化（来自快捷键或托盘）
  useEffect(() => {
    const handleSelectionStateChange = (enabled) => {
      logger.debug(' Selection state changed from main process:', enabled);
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
      
      // 3. 迁移旧格式（已包含与 DEFAULT_SETTINGS 的深度合并）
      const migratedSettings = migrateOldSettings(savedSettings);
      
      // 4. 合并设置
      let finalSettings;
      if (migratedSettings) {
        finalSettings = { 
          ...migratedSettings,  // migratedSettings 已经包含完整的默认值
          // 确保运行时状态覆盖
          ocr: {
            ...migratedSettings.ocr,
            ...runtimeState.ocr,
          },
          selection: {
            ...migratedSettings.selection,
            enabled: runtimeState.selectionEnabled,
          },
        };
        
        // 同步 OCR 引擎到 Store
        if (migratedSettings.ocr?.engine && setOcrEngine) {
          setOcrEngine(migratedSettings.ocr.engine);
        }
      } else {
        // 没有保存的设置，使用默认值 + 运行时状态
        finalSettings = {
          ...DEFAULT_SETTINGS,
          ocr: { ...DEFAULT_SETTINGS.ocr, ...runtimeState.ocr },
          selection: { ...DEFAULT_SETTINGS.selection, enabled: runtimeState.selectionEnabled }
        };
      }
      
      setSettings(finalSettings);
      setSettingsReady(true); // 磁盘数据已加载，子组件可以初始化
      setIsDirty(false); // 初始加载后没有未保存更改
      
      // 延迟关闭初始化标志，等待子组件完成初始化
      // ProviderSettings 初始化可能需要 100ms 等待 + 解密操作
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 500);
    } catch (error) {
      logger.error('Failed to load settings:', error);
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
      logger.debug('Platform detection failed:', e);
    }

    // 检测 OCR 引擎安装状态
    try {
      if (window.electron?.ocr?.checkInstalled) {
        const installedStatus = await window.electron.ocr.checkInstalled();
        state.ocr.rapidInstalled = installedStatus?.['rapid-ocr'] || false;
      }
    } catch (e) {
      logger.debug('OCR install check failed:', e);
    }

    // 获取划词翻译状态（从主进程获取实际状态）
    try {
      if (window.electron?.selection?.getEnabled) {
        const enabled = await window.electron.selection.getEnabled();
        state.selectionEnabled = enabled === true; // 确保是布尔值
        logger.debug(' Selection translate state from main process:', state.selectionEnabled);
      } else {
        logger.debug(' selection.getEnabled not available');
      }
    } catch (e) {
      logger.error(' Selection state check failed:', e);
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
        setIsDirty(false);
        setIsSaving(false);
        return;
      }
      
      // 使用点路径逐个 section 写入，避免读-改-写竞态
      // 每个 store.set('settings.xxx', value) 是原子操作，不会覆盖其他 section
      if (window.electron?.store) {
        const store = window.electron.store;
        
        // 连接设置
        if (settings.connection) {
          await store.set('settings.connection', settings.connection);
        }
        
        // 翻译设置（不覆盖 providers/providerConfigs，那些由 ProviderSettings 独立管理）
        if (settings.translation) {
          const { providers, providerConfigs, ...translationRest } = settings.translation;
          // 只写非 provider 的翻译设置字段
          for (const [key, value] of Object.entries(translationRest)) {
            await store.set(`settings.translation.${key}`, value);
          }
        }
        
        // 文档翻译
        if (settings.document) {
          await store.set('settings.document', settings.document);
        }
        
        // 玻璃窗口
        if (settings.glass) {
          await store.set('settings.glass', settings.glass);
        }
        
        // 划词翻译
        if (settings.selection) {
          await store.set('settings.selection', settings.selection);
        }
        
        // 快捷键
        if (settings.shortcuts) {
          await store.set('settings.shortcuts', settings.shortcuts);
        }
        
        // OCR（去掉运行时状态）
        if (settings.ocr) {
          const { isWindows, paddleInstalled, rapidInstalled, ...ocrToSave } = settings.ocr;
          await store.set('settings.ocr', ocrToSave);
        }
        
        // TTS
        if (settings.tts) {
          await store.set('settings.tts', settings.tts);
        }
        
        // 截图
        if (settings.screenshot) {
          await store.set('settings.screenshot', settings.screenshot);
        }
        
        // 界面设置（含主题）
        const currentTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
        await store.set('settings.interface', {
          ...settings.interface,
          theme: currentTheme,
        });
        
        // 顶层标量设置
        await store.set('settings.sourceLanguage', settings.sourceLanguage);
        await store.set('settings.targetLanguage', settings.targetLanguage);
        await store.set('settings.autoTranslate', settings.autoTranslate);
        await store.set('settings.streamOutput', settings.streamOutput);
        await store.set('settings.contextMemory', settings.contextMemory);
        await store.set('settings.termCorrection', settings.termCorrection);
        await store.set('settings.privacyMode', settings.privacyMode);
        await store.set('settings.saveHistory', settings.saveHistory);
        await store.set('settings.maxHistory', settings.maxHistory);
        await store.set('settings.cacheEnabled', settings.cacheEnabled);
        await store.set('settings.maxCache', settings.maxCache);
        await store.set('settings.theme', settings.theme);
        await store.set('settings.fontSize', settings.fontSize);
        await store.set('settings.debugMode', settings.debugMode);
      } else {
        localStorage.setItem('settings', JSON.stringify(settings));
      }
      
      // 同步 OCR 引擎到 Store
      if (setOcrEngine && settings.ocr?.engine) {
        setOcrEngine(settings.ocr.engine);
      }

      // 刷新 OCR Manager 配置
      if (settings.ocr) {
        try {
          ocrManager.updateConfigs(settings.ocr);
          logger.debug(' OCR configs updated');
        } catch (e) {
          logger.warn(' ocrManager update failed:', e);
        }
      }

      // 通知玻璃窗重新加载设置
      if (window.electron?.glass?.notifySettingsChanged) {
        await window.electron.glass.notifySettingsChanged();
      }

      // 只有非 providers tab 才显示通知（providers tab 有自己的通知）
      if (activeSection !== 'providers') {
        notify(t('settings.saved'), 'success');
      }
      
      setIsDirty(false);
    } catch (error) {
      logger.error('Failed to save settings:', error);
      notify(t('settings.saveFailed'), 'error');
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
        notify(t('connectionSettings.connectionSuccess', { count: result.models?.length || 0 }), 'success');
      } else {
        setConnectionStatus('disconnected');
        notify(t('connectionSettings.connectionFailed') + ': ' + (result.error || result.message || t('notify.unknownError')), 'error');
      }
    } catch (error) {
      setConnectionStatus('error');
      notify(t('connectionSettings.connectionError') + ': ' + error.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const resetSettings = (section = null) => {
    if (!window.confirm(section ? t('settings.resetSectionConfirm', { section }) : t('settings.resetAllConfirm'))) return;

    if (section) {
      // 部分重置 - 使用默认值覆盖指定部分
      if (DEFAULT_SETTINGS[section]) {
        setSettings(prev => ({
          ...prev,
          [section]: { ...DEFAULT_SETTINGS[section] }
        }));
        notify(t('settings.sectionReset', { section }), 'success');
      } else {
        notify(t('settings.sectionNotFound', { section }), 'error');
      }
    } else {
      // 全部重置
      localStorage.removeItem('settings');
      if (window.electron?.store) {
        window.electron.store.delete('settings');
      }
      setSettings({ ...DEFAULT_SETTINGS });
      notify(t('settings.allReset'), 'success');
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
    notify(t('settings.exported'), 'success');
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
          notify(t('settings.invalidFormat'), 'error');
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
        
        notify(t('settings.importedPleasesSave'), 'success');
      } catch (error) {
        logger.error('Import settings error:', error);
        notify(t('settings.invalidFile'), 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = null;
  };

  // 更新设置 - 使用 useCallback 优化
  // silent: 为 true 时不触发 isDirty（用于保存时的状态同步）
  const updateSetting = useCallback((section, key, value, silent = false) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
    // 只有在非 silent 且初始化完成后才标记为 dirty
    if (!silent && !isInitializingRef.current) {
      setIsDirty(true);
    }
  }, []);

  // 渲染设置内容
  const renderSettingContent = () => {
    switch (activeSection) {
      case 'providers':
        return (
          <ProvidersSection
            ref={providerSettingsRef}
            settings={settings}
            settingsReady={settingsReady}
            updateSetting={updateSetting}
            notify={notify}
          />
        );

        case 'document':
          return (
            <DocumentSection
              settings={settings}
              updateSetting={updateSetting}
            />
          );
        case 'privacy':
          return (
            <PrivacySection
              settings={settings}
              updateSetting={updateSetting}
              notify={notify}
            />
          );
      case 'ocr':
        return (
          <OcrSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            showApiKeys={showApiKeys}
            setShowApiKeys={setShowApiKeys}
            setOcrEngine={setOcrEngine}
          />
        );
      case 'tts':
        return (
          <TTSSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
          />
        );
      case 'interface':
        return (
          <InterfaceSection
            settings={settings}
            updateSetting={updateSetting}
            setSettings={setSettings}
            notify={notify}
            editingShortcut={editingShortcut}
            setEditingShortcut={setEditingShortcut}
          />
        );
      case 'about':
        return (
          <AboutSection notify={notify} resetSettings={resetSettings} />
        );

      case 'translation':
        return (
          <TranslationSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
            useStreamOutput={useStreamOutput}
            setUseStreamOutput={setUseStreamOutput}
            autoTranslate={autoTranslate}
            setAutoTranslate={setAutoTranslate}
            autoTranslateDelay={autoTranslateDelay}
            setAutoTranslateDelay={setAutoTranslateDelay}
          />
        );
      case 'glassWindow':
        return (
          <GlassWindowSection
            settings={settings}
            updateSetting={updateSetting}
            handleSectionChange={handleSectionChange}
          />
        );
      case 'selection':
        return (
          <SelectionSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
          />
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
            placeholder={t('settingsNav.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        
        
        <div className="settings-nav">
          {/* 动态渲染分组和导航项 */}
          {Object.entries(groupedNavItems).map(([group, items], groupIndex) => {
            if (items.length === 0) return null;
            return (
            <React.Fragment key={group}>
              {groupIndex > 0 && <div className="nav-divider" />}
              <div className="nav-group-title">{groupLabels[group] || group}</div>
              {items.map(item => {
                const Icon = item.icon;
                const isSearchMatch = searchQuery.trim() && (
                  (navLabels[item.id] || item.id).toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
                );
                return (
                  <button 
                    key={item.id}
                    className={`nav-item ${activeSection === item.id ? 'active' : ''} ${isSearchMatch ? 'search-match' : ''}`} 
                    onClick={() => handleSectionChange(item.id)}
                  >
                    <Icon size={16}/>
                    <span>{navLabels[item.id] || item.id}</span>
                  </button>
                );
              })}
            </React.Fragment>
            );
          })}
          
          {/* 搜索无结果提示 */}
          {filteredNavItems.length === 0 && (
            <div className="nav-empty">
              <p>{t('settingsNav.noMatch')}</p>
            </div>
          )}
        </div>
        <div className="settings-actions">
            <span className="mode-text-link" onClick={toggleSimpleMode}>
              {simpleMode ? t('settingsNav.simpleMode') : t('settingsNav.fullMode')}
            </span>
        </div>
      </div>

      <div className="settings-content-wrapper">
        <div key={activeSection} className="setting-content-animated">
          {renderSettingContent()}
        </div>
        {/* 只在有未保存更改时显示底部保存栏 */}
        {hasUnsavedChanges && (
          <div className="settings-footer">
            <div className="unsaved-indicator">
              {t('settingsNav.unsavedChanges')}
            </div>
            <button className="save-button" onClick={saveSettings} disabled={isSaving}>
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <Save size={16}/>}
                {isSaving ? ` ${t('settingsNav.saving')}` : ` ${t('settingsNav.saveChanges')}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel;
