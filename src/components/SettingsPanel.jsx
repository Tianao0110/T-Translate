// src/components/SettingsPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Globe,
  Shield,
  Zap,
  Database,
  Download,
  Upload,
  Moon,
  Sun,
  Monitor,
  Volume2,
  Keyboard,
  Info,
  AlertCircle,
  CheckCircle,
  WifiOff,
  Wifi,
  RefreshCw,
  Save,
  FolderOpen,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  GitBranch,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Terminal,
  Code2,
  Palette
} from 'lucide-react';
import llmClient from '../utils/llm-client';
import config from '../config/default';
import '../styles/components/SettingsPanel.css';

/**
 * 设置面板组件
 * 管理应用的所有配置选项
 */
const SettingsPanel = ({ onNotification }) => {
  // 设置状态
  const [settings, setSettings] = useState({
    // 连接设置
    connection: {
      endpoint: 'http://localhost:1234/v1',
      timeout: 60000,
      autoReconnect: true,
      reconnectInterval: 30000
    },
    // 翻译设置
    translation: {
      defaultSourceLang: 'auto',
      defaultTargetLang: 'zh',
      autoTranslate: false,
      translationDelay: 500,
      maxLength: 5000,
      template: 'general'
    },
    // OCR 设置
    ocr: {
      engine: 'tesseract',
      language: 'chi_sim+eng',
      autoDetect: true,
      imageQuality: 'high',
      preprocessImage: true
    },
    // 界面设置
    interface: {
      theme: 'light',
      fontSize: 14,
      fontFamily: 'system',
      compactMode: false,
      showLineNumbers: false,
      highlightSyntax: true
    },
    // 隐私设置
    privacy: {
      saveHistory: true,
      encryptHistory: false,
      autoDeleteDays: 0,
      secureMode: false,
      logLevel: 'info'
    },
    // 快捷键设置
    shortcuts: {
      translate: 'Ctrl+Enter',
      swapLanguages: 'Ctrl+L',
      clear: 'Ctrl+Shift+C',
      paste: 'Ctrl+V',
      copy: 'Ctrl+C'
    },
    // 高级设置
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
  const [showApiKey, setShowApiKey] = useState(false);
  const [models, setModels] = useState([]);

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  // 加载保存的设置
  const loadSettings = async () => {
    if (window.electron && window.electron.store) {
      try {
        const savedSettings = await window.electron.store.get('settings');
        if (savedSettings) {
          setSettings(prevSettings => ({
            ...prevSettings,
            ...savedSettings
          }));
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    } else {
      // 从 localStorage 加载
      const savedSettings = localStorage.getItem('settings');
      if (savedSettings) {
        try {
          setSettings(JSON.parse(savedSettings));
        } catch (error) {
          console.error('Failed to parse settings:', error);
        }
      }
    }
  };

  // 保存设置
  const saveSettings = async () => {
    setIsSaving(true);
    try {
      if (window.electron && window.electron.store) {
        await window.electron.store.set('settings', settings);
      } else {
        localStorage.setItem('settings', JSON.stringify(settings));
      }
      
      // 应用设置到 llmClient
      llmClient.updateConfig({
        endpoint: settings.connection.endpoint,
        timeout: settings.connection.timeout
      });

      onNotification('设置已保存', 'success');
    } catch (error) {
      console.error('Failed to save settings:', error);
      onNotification('保存设置失败', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // 测试连接
  const testConnection = async () => {
    setIsTesting(true);
    setConnectionStatus('testing');
    
    try {
      const result = await llmClient.testConnection();
      
      if (result.success) {
        setConnectionStatus('connected');
        setModels(result.models || []);
        onNotification('连接成功！已检测到 ' + result.models.length + ' 个模型', 'success');
      } else {
        setConnectionStatus('disconnected');
        onNotification('连接失败: ' + result.message, 'error');
      }
    } catch (error) {
      setConnectionStatus('error');
      onNotification('连接错误: ' + error.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  // 重置设置
  const resetSettings = (section = null) => {
    if (!confirm(section ? `确定要重置${section}设置吗？` : '确定要重置所有设置吗？')) {
      return;
    }

    if (section) {
      setSettings(prevSettings => ({
        ...prevSettings,
        [section]: config[section] || {}
      }));
      onNotification(`${section}设置已重置`, 'info');
    } else {
      // 重置所有设置
      loadDefaultSettings();
      onNotification('所有设置已重置为默认值', 'info');
    }
  };

  // 加载默认设置
  const loadDefaultSettings = () => {
    setSettings({
      connection: {
        endpoint: config.llm.endpoint,
        timeout: config.llm.timeout,
        autoReconnect: true,
        reconnectInterval: 30000
      },
      translation: {
        defaultSourceLang: config.translation.sourceLanguage,
        defaultTargetLang: config.translation.targetLanguage,
        autoTranslate: false,
        translationDelay: 500,
        maxLength: config.translation.batch.maxLength,
        template: 'general'
      },
      ocr: {
        engine: config.ocr.defaultEngine,
        language: config.ocr.tesseract.language,
        autoDetect: true,
        imageQuality: 'high',
        preprocessImage: true
      },
      interface: {
        theme: config.ui.theme,
        fontSize: config.ui.fontSize,
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
        logLevel: config.logging.level
      },
      shortcuts: config.shortcuts,
      advanced: {
        debugMode: config.dev.debugMode,
        experimentalFeatures: false,
        cacheSize: config.storage.cache.maxSize,
        maxHistoryItems: config.storage.history.maxItems,
        exportFormat: 'json'
      }
    });
  };

  // 导出设置
  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t-translate-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotification('设置已导出', 'success');
  };

  // 导入设置
  const importSettings = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        setSettings(imported);
        onNotification('设置已导入', 'success');
      } catch (error) {
        onNotification('导入失败: 无效的设置文件', 'error');
      }
    };
    reader.readAsText(file);
  };

  // 更新设置值
  const updateSetting = (section, key, value) => {
    setSettings(prevSettings => ({
      ...prevSettings,
      [section]: {
        ...prevSettings[section],
        [key]: value
      }
    }));
  };

  // 切换主题
  const toggleTheme = () => {
    const newTheme = settings.interface.theme === 'light' ? 'dark' : 'light';
    updateSetting('interface', 'theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  // 设置区块
  const sections = [
    { id: 'connection', label: '连接设置', icon: Wifi },
    { id: 'translation', label: '翻译设置', icon: Globe },
    { id: 'ocr', label: 'OCR 设置', icon: Eye },
    { id: 'interface', label: '界面设置', icon: Palette },
    { id: 'privacy', label: '隐私设置', icon: Shield },
    { id: 'shortcuts', label: '快捷键', icon: Keyboard },
    { id: 'advanced', label: '高级设置', icon: Settings },
    { id: 'about', label: '关于', icon: Info }
  ];

  // 渲染设置内容
  const renderSettingContent = () => {
    switch (activeSection) {
      case 'connection':
        return (
          <div className="setting-content">
            <h3>LM Studio 连接设置</h3>
            
            <div className="setting-group">
              <label className="setting-label">
                API 端点
                <span className="label-hint">LM Studio 服务地址</span>
              </label>
              <div className="input-group">
                <input
                  type="text"
                  className="setting-input"
                  value={settings.connection.endpoint}
                  onChange={(e) => updateSetting('connection', 'endpoint', e.target.value)}
                  placeholder="http://localhost:1234/v1"
                />
                <button 
                  className={`test-button ${connectionStatus}`}
                  onClick={testConnection}
                  disabled={isTesting}
                >
                  {isTesting ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : connectionStatus === 'connected' ? (
                    <CheckCircle size={16} />
                  ) : connectionStatus === 'disconnected' ? (
                    <WifiOff size={16} />
                  ) : (
                    <Wifi size={16} />
                  )}
                  {isTesting ? '测试中...' : '测试连接'}
                </button>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">
                超时时间（毫秒）
                <span className="label-hint">请求超时限制</span>
              </label>
              <input
                type="number"
                className="setting-input"
                value={settings.connection.timeout}
                onChange={(e) => updateSetting('connection', 'timeout', parseInt(e.target.value))}
                min="5000"
                max="300000"
                step="1000"
              />
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.connection.autoReconnect}
                  onChange={(e) => updateSetting('connection', 'autoReconnect', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">自动重连</span>
              </label>
            </div>

            {models.length > 0 && (
              <div className="setting-group">
                <label className="setting-label">可用模型</label>
                <div className="models-list">
                  {models.map((model, index) => (
                    <div key={index} className="model-item">
                      <Code2 size={16} />
                      <span>{model.id || model}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="connection-status-panel">
              <h4>连接状态</h4>
              <div className="status-item">
                <span>状态:</span>
                <span className={`status-value ${connectionStatus}`}>
                  {connectionStatus === 'connected' ? '已连接' :
                   connectionStatus === 'disconnected' ? '未连接' :
                   connectionStatus === 'testing' ? '测试中...' :
                   connectionStatus === 'error' ? '连接错误' : '未知'}
                </span>
              </div>
              <div className="status-item">
                <span>端点:</span>
                <span>{settings.connection.endpoint}</span>
              </div>
            </div>
          </div>
        );

      case 'translation':
        return (
          <div className="setting-content">
            <h3>翻译设置</h3>
            
            <div className="setting-group">
              <label className="setting-label">默认源语言</label>
              <select
                className="setting-select"
                value={settings.translation.defaultSourceLang}
                onChange={(e) => updateSetting('translation', 'defaultSourceLang', e.target.value)}
              >
                <option value="auto">自动检测</option>
                <option value="zh">中文</option>
                <option value="en">英语</option>
                <option value="ja">日语</option>
                <option value="ko">韩语</option>
                <option value="es">西班牙语</option>
                <option value="fr">法语</option>
                <option value="de">德语</option>
                <option value="ru">俄语</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-label">默认目标语言</label>
              <select
                className="setting-select"
                value={settings.translation.defaultTargetLang}
                onChange={(e) => updateSetting('translation', 'defaultTargetLang', e.target.value)}
              >
                <option value="zh">中文</option>
                <option value="en">英语</option>
                <option value="ja">日语</option>
                <option value="ko">韩语</option>
                <option value="es">西班牙语</option>
                <option value="fr">法语</option>
                <option value="de">德语</option>
                <option value="ru">俄语</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-label">默认翻译模板</label>
              <select
                className="setting-select"
                value={settings.translation.template}
                onChange={(e) => updateSetting('translation', 'template', e.target.value)}
              >
                <option value="general">通用</option>
                <option value="technical">技术文档</option>
                <option value="academic">学术论文</option>
                <option value="business">商务</option>
                <option value="casual">口语化</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-label">
                最大文本长度
                <span className="label-hint">单次翻译的最大字符数</span>
              </label>
              <input
                type="number"
                className="setting-input"
                value={settings.translation.maxLength}
                onChange={(e) => updateSetting('translation', 'maxLength', parseInt(e.target.value))}
                min="100"
                max="50000"
                step="100"
              />
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.translation.autoTranslate}
                  onChange={(e) => updateSetting('translation', 'autoTranslate', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">自动翻译（输入时自动翻译）</span>
              </label>
            </div>
          </div>
        );

      case 'ocr':
        return (
          <div className="setting-content">
            <h3>OCR 设置</h3>
            
            <div className="setting-group">
              <label className="setting-label">OCR 引擎</label>
              <select
                className="setting-select"
                value={settings.ocr.engine}
                onChange={(e) => updateSetting('ocr', 'engine', e.target.value)}
              >
                <option value="tesseract">Tesseract.js（本地）</option>
                <option value="llm-vision">LLM Vision（需要视觉模型）</option>
                <option value="rapid">RapidOCR（开发中）</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-label">识别语言</label>
              <select
                className="setting-select"
                value={settings.ocr.language}
                onChange={(e) => updateSetting('ocr', 'language', e.target.value)}
              >
                <option value="chi_sim+eng">中文简体 + 英文</option>
                <option value="chi_tra+eng">中文繁体 + 英文</option>
                <option value="eng">仅英文</option>
                <option value="jpn">日文</option>
                <option value="kor">韩文</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-label">图片质量</label>
              <select
                className="setting-select"
                value={settings.ocr.imageQuality}
                onChange={(e) => updateSetting('ocr', 'imageQuality', e.target.value)}
              >
                <option value="low">低质量（快速）</option>
                <option value="medium">中等质量</option>
                <option value="high">高质量（慢速）</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.ocr.autoDetect}
                  onChange={(e) => updateSetting('ocr', 'autoDetect', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">自动检测文字方向</span>
              </label>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.ocr.preprocessImage}
                  onChange={(e) => updateSetting('ocr', 'preprocessImage', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">预处理图片（提高识别率）</span>
              </label>
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
                <button
                  className={`theme-option ${settings.interface.theme === 'light' ? 'active' : ''}`}
                  onClick={() => {
                    updateSetting('interface', 'theme', 'light');
                    document.documentElement.setAttribute('data-theme', 'light');
                  }}
                >
                  <Sun size={20} />
                  <span>浅色</span>
                </button>
                <button
                  className={`theme-option ${settings.interface.theme === 'dark' ? 'active' : ''}`}
                  onClick={() => {
                    updateSetting('interface', 'theme', 'dark');
                    document.documentElement.setAttribute('data-theme', 'dark');
                  }}
                >
                  <Moon size={20} />
                  <span>深色</span>
                </button>
                <button
                  className={`theme-option ${settings.interface.theme === 'auto' ? 'active' : ''}`}
                  onClick={() => {
                    updateSetting('interface', 'theme', 'auto');
                  }}
                >
                  <Monitor size={20} />
                  <span>跟随系统</span>
                </button>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">
                字体大小
                <span className="label-value">{settings.interface.fontSize}px</span>
              </label>
              <input
                type="range"
                className="setting-range"
                value={settings.interface.fontSize}
                onChange={(e) => updateSetting('interface', 'fontSize', parseInt(e.target.value))}
                min="12"
                max="20"
                step="1"
              />
            </div>

            <div className="setting-group">
              <label className="setting-label">字体</label>
              <select
                className="setting-select"
                value={settings.interface.fontFamily}
                onChange={(e) => updateSetting('interface', 'fontFamily', e.target.value)}
              >
                <option value="system">系统默认</option>
                <option value="serif">衬线字体</option>
                <option value="sans-serif">无衬线字体</option>
                <option value="monospace">等宽字体</option>
              </select>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.interface.compactMode}
                  onChange={(e) => updateSetting('interface', 'compactMode', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">紧凑模式</span>
              </label>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.interface.showLineNumbers}
                  onChange={(e) => updateSetting('interface', 'showLineNumbers', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">显示行号</span>
              </label>
            </div>
          </div>
        );

      case 'privacy':
        return (
          <div className="setting-content">
            <h3>隐私设置</h3>
            
            <div className="privacy-notice">
              <Shield size={20} />
              <p>所有数据都存储在本地，不会上传到任何服务器</p>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.privacy.saveHistory}
                  onChange={(e) => updateSetting('privacy', 'saveHistory', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">保存翻译历史</span>
              </label>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.privacy.encryptHistory}
                  onChange={(e) => updateSetting('privacy', 'encryptHistory', e.target.checked)}
                  disabled={!settings.privacy.saveHistory}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">加密历史记录</span>
              </label>
            </div>

            <div className="setting-group">
              <label className="setting-label">
                自动删除历史
                <span className="label-hint">0 表示不自动删除</span>
              </label>
              <div className="input-group">
                <input
                  type="number"
                  className="setting-input"
                  value={settings.privacy.autoDeleteDays}
                  onChange={(e) => updateSetting('privacy', 'autoDeleteDays', parseInt(e.target.value))}
                  min="0"
                  max="365"
                  disabled={!settings.privacy.saveHistory}
                />
                <span className="input-suffix">天</span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.privacy.secureMode}
                  onChange={(e) => updateSetting('privacy', 'secureMode', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">
                  安全模式
                  <span className="label-hint">不保存任何敏感内容</span>
                </span>
              </label>
            </div>

            <div className="setting-group">
              <button className="danger-button" onClick={() => {
                if (confirm('确定要清除所有本地数据吗？此操作不可恢复。')) {
                  // 清除所有数据
                  localStorage.clear();
                  onNotification('所有本地数据已清除', 'success');
                }
              }}>
                <Trash2 size={16} />
                清除所有数据
              </button>
            </div>
          </div>
        );

      case 'shortcuts':
        return (
          <div className="setting-content">
            <h3>快捷键设置</h3>
            
            <div className="shortcuts-list">
              {Object.entries(settings.shortcuts).map(([key, value]) => (
                <div key={key} className="shortcut-item">
                  <span className="shortcut-label">
                    {key === 'translate' ? '翻译' :
                     key === 'swapLanguages' ? '切换语言' :
                     key === 'clear' ? '清空内容' :
                     key === 'paste' ? '粘贴' :
                     key === 'copy' ? '复制' : key}
                  </span>
                  <kbd className="shortcut-key">{value}</kbd>
                </div>
              ))}
            </div>

            <div className="shortcuts-note">
              <Info size={16} />
              <p>快捷键暂不支持自定义，将在后续版本中添加</p>
            </div>
          </div>
        );

      case 'advanced':
        return (
          <div className="setting-content">
            <h3>高级设置</h3>
            
            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.advanced.debugMode}
                  onChange={(e) => updateSetting('advanced', 'debugMode', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">调试模式</span>
              </label>
            </div>

            <div className="setting-group">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.advanced.experimentalFeatures}
                  onChange={(e) => updateSetting('advanced', 'experimentalFeatures', e.target.checked)}
                />
                <span className="switch-slider"></span>
                <span className="switch-label">实验性功能</span>
              </label>
            </div>

            <div className="setting-group">
              <label className="setting-label">
                缓存大小（MB）
                <span className="label-hint">翻译缓存的最大大小</span>
              </label>
              <input
                type="number"
                className="setting-input"
                value={settings.advanced.cacheSize}
                onChange={(e) => updateSetting('advanced', 'cacheSize', parseInt(e.target.value))}
                min="10"
                max="1000"
                step="10"
              />
            </div>

            <div className="setting-group">
              <label className="setting-label">
                最大历史记录数
                <span className="label-hint">保存的最大历史记录条数</span>
              </label>
              <input
                type="number"
                className="setting-input"
                value={settings.advanced.maxHistoryItems}
                onChange={(e) => updateSetting('advanced', 'maxHistoryItems', parseInt(e.target.value))}
                min="100"
                max="10000"
                step="100"
              />
            </div>

            <div className="setting-group">
              <label className="setting-label">导出格式</label>
              <select
                className="setting-select"
                value={settings.advanced.exportFormat}
                onChange={(e) => updateSetting('advanced', 'exportFormat', e.target.value)}
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="txt">纯文本</option>
              </select>
            </div>

            <div className="setting-group">
              <button 
                className="secondary-button"
                onClick={() => {
                  if (window.electron) {
                    window.electron.shell.openExternal('file://' + window.electron.app.getPath('userData'));
                  }
                }}
              >
                <FolderOpen size={16} />
                打开数据目录
              </button>
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="setting-content">
            <div className="about-section">
              <div className="app-info">
                <div className="app-icon">
                  <Zap size={48} />
                </div>
                <h2>T-Translate Core</h2>
                <p className="app-version">版本 1.0.0</p>
                <p className="app-description">
                  专业的离线翻译工具，支持本地 LLM 翻译和 OCR 文字识别
                </p>
              </div>

              <div className="info-cards">
                <div className="info-card">
                  <h4>关于本软件</h4>
                  <p>T-Translate Core 是一个完全离线的翻译工具，所有翻译都在本地完成，保护您的隐私安全。</p>
                </div>

                <div className="info-card">
                  <h4>技术栈</h4>
                  <ul>
                    <li>Electron + React</li>
                    <li>LM Studio (本地 LLM)</li>
                    <li>Tesseract.js (OCR)</li>
                    <li>Zustand (状态管理)</li>
                  </ul>
                </div>

                <div className="info-card">
                  <h4>开源协议</h4>
                  <p>MIT License</p>
                  <p>您可以自由使用、修改和分发本软件</p>
                </div>
              </div>

              <div className="about-actions">
                <button 
                  className="link-button"
                  onClick={() => window.electron?.shell.openExternal('https://github.com/yourusername/t-translate-core')}
                >
                  <GitBranch size={16} />
                  GitHub 仓库
                </button>
                <button 
                  className="link-button"
                  onClick={() => window.electron?.shell.openExternal('https://github.com/yourusername/t-translate-core/issues')}
                >
                  <HelpCircle size={16} />
                  报告问题
                </button>
                <button 
                  className="link-button"
                  onClick={() => window.electron?.shell.openExternal('https://github.com/yourusername/t-translate-core/wiki')}
                >
                  <ExternalLink size={16} />
                  使用文档
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-sidebar">
        <div className="settings-nav">
          {sections.map(section => (
            <button
              key={section.id}
              className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <section.icon size={18} />
              <span>{section.label}</span>
              <ChevronRight size={14} className="nav-arrow" />
            </button>
          ))}
        </div>

        <div className="settings-actions">
          <button className="action-button" onClick={exportSettings}>
            <Download size={16} />
            导出设置
          </button>
          <label className="action-button">
            <Upload size={16} />
            导入设置
            <input
              type="file"
              accept=".json"
              onChange={importSettings}
              style={{ display: 'none' }}
            />
          </label>
          <button 
            className="action-button danger"
            onClick={() => resetSettings()}
          >
            <RefreshCw size={16} />
            重置所有
          </button>
        </div>
      </div>

      <div className="settings-content">
        {renderSettingContent()}
        
        <div className="settings-footer">
          <button
            className="save-button"
            onClick={saveSettings}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={16} />
                保存设置
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;