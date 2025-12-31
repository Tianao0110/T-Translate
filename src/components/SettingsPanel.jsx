// src/components/SettingsPanel.jsx
import React, { useState, useEffect } from 'react';
import {
  Settings, Globe, Shield, Zap, Database, Download, Upload, Moon, Sun, Monitor,
  Volume2, Keyboard, Info, AlertCircle, CheckCircle, WifiOff, Wifi, RefreshCw,
  Save, FolderOpen, Trash2, Eye, EyeOff, Lock, Unlock, GitBranch, HelpCircle,
  ExternalLink, ChevronRight, Terminal, Code2, Palette, Layers, MousePointer
} from 'lucide-react';
import llmClient from '../utils/llm-client';
import translator from '../services/translator';
import useTranslationStore from '../stores/translation-store';
import '../styles/components/SettingsPanel.css'; 

/**
 * 默认配置 (内联，防止 import 报错)
 */
const defaultConfig = {
  llm: { endpoint: 'http://localhost:1234/v1', timeout: 60000 },
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh', batch: { maxLength: 5000 } },
  ocr: { defaultEngine: 'tesseract', tesseract: { language: 'chi_sim+eng' } },
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
      template: 'general'
    },
    ocr: {
      engine: 'llm-vision',
      language: 'chi_sim+eng',
      autoDetect: true,
      imageQuality: 'high',
      preprocessImage: true
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
      autoPin: true              // 默认置顶
    },
    selection: {
      enabled: true,             // 启用划词翻译
      triggerIcon: 'dot',        // 触发图标类型: dot | translate | custom
      triggerSize: 24,           // 触发图标大小
      triggerColor: '#3b82f6',   // 触发图标颜色
      customIconPath: '',        // 自定义图标路径
      hoverDelay: 300,           // 悬停触发延迟（毫秒）
      triggerTimeout: 5000,      // 触发点消失时间（毫秒）
      resultTimeout: 3000,       // 结果框自动关闭时间（毫秒）
      minChars: 2,               // 最小字符数
      maxChars: 500              // 最大字符数
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

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // 优先从 Electron Store 读取
      if (window.electron && window.electron.store) {
        const savedSettings = await window.electron.store.get('settings');
        if (savedSettings) {
          setSettings(prev => ({ ...prev, ...savedSettings }));
          // 同步 OCR 引擎到 Store
          if (savedSettings.ocr?.engine && setOcrEngine) {
            setOcrEngine(savedSettings.ocr.engine);
          }
        }
      } else {
        const savedSettings = localStorage.getItem('settings');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          setSettings(parsed);
          // 同步 OCR 引擎到 Store
          if (parsed.ocr?.engine && setOcrEngine) {
            setOcrEngine(parsed.ocr.engine);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      if (window.electron && window.electron.store) {
        await window.electron.store.set('settings', settings);
      } else {
        localStorage.setItem('settings', JSON.stringify(settings));
      }
      
      // 应用设置到各个模块
      if (llmClient.updateConfig) {
        llmClient.updateConfig({
          endpoint: settings.connection.endpoint,
          timeout: settings.connection.timeout
        });
      }
      
      // 同步 OCR 引擎到 Store
      if (setOcrEngine) {
        setOcrEngine(settings.ocr.engine);
      }

      notify('设置已保存', 'success');
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
    
    // 临时更新客户端配置进行测试
    if (llmClient.updateConfig) {
        llmClient.updateConfig({ endpoint: settings.connection.endpoint });
    }

    try {
      const result = await llmClient.testConnection();
      if (result.success) {
        setConnectionStatus('connected');
        setModels(result.models || []);
        notify(`连接成功！检测到 ${result.models?.length || 0} 个模型`, 'success');
      } else {
        setConnectionStatus('disconnected');
        notify('连接失败: ' + result.message, 'error');
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
                  当前缓存: {translator.getCacheStats().valid} 条 / 最大 {translator.getCacheStats().maxSize} 条
                  <br />
                  自动过期: {translator.getCacheStats().ttlDays} 天
                </p>
                <button 
                  className="danger-button"
                  onClick={() => {
                    if (window.confirm('确定要清除所有翻译缓存吗？')) {
                      translator.clearCache();
                      notify('翻译缓存已清除', 'success');
                      setActiveSection('translation'); // 刷新显示
                    }
                  }}
                >
                  <Trash2 size={16} /> 清除翻译缓存
                </button>
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
            <div className="setting-group">
              <label className="setting-label">OCR 引擎</label>
              <select 
                className="setting-select" 
                value={settings.ocr.engine} 
                onChange={(e) => {
                  updateSetting('ocr', 'engine', e.target.value);
                  // 实时同步到 Store
                  if (setOcrEngine) {
                    setOcrEngine(e.target.value);
                  }
                }}
              >
                <option value="llm-vision">LLM Vision (推荐)</option>
                <option value="tesseract">Tesseract.js (本地/隐私模式)</option>
              </select>
              <p className="setting-hint">
                {settings.ocr.engine === 'llm-vision' 
                  ? 'LLM Vision 自动识别语言，质量更高' 
                  : 'Tesseract 完全本地运行，适合隐私模式'}
              </p>
            </div>
            {settings.ocr.engine === 'tesseract' && (
              <div className="setting-group">
                <label className="setting-label">识别语言</label>
                <select className="setting-select" value={settings.ocr.language} onChange={(e)=>updateSetting('ocr','language',e.target.value)}>
                  <option value="chi_sim+eng">中英文混合</option>
                  <option value="eng">仅英文</option>
                  <option value="chi_sim">仅中文</option>
                  <option value="jpn">日文</option>
                  <option value="kor">韩文</option>
                </select>
                <p className="setting-hint">仅 Tesseract 引擎使用此设置</p>
              </div>
            )}
            
            <h3 style={{marginTop: '24px'}}>截图设置</h3>
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
                启用后，选择区域后需点击确认按钮或按 Enter 键确认；禁用后直接截图
              </p>
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
              <label className="setting-label">自动刷新间隔</label>
              <div className="setting-row">
                <input
                  type="range"
                  className="setting-range"
                  min="1000"
                  max="10000"
                  step="500"
                  value={settings.glassWindow.refreshInterval}
                  onChange={(e) => updateSetting('glassWindow', 'refreshInterval', parseInt(e.target.value))}
                />
                <span className="range-value">{settings.glassWindow.refreshInterval / 1000}秒</span>
              </div>
              <p className="setting-hint">开启自动刷新时，每隔此时间重新识别并翻译</p>
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
              <label className="setting-label">流式输出</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.glassWindow.streamOutput ? 'active' : ''}`}
                  onClick={() => updateSetting('glassWindow', 'streamOutput', !settings.glassWindow.streamOutput)}
                >
                  {settings.glassWindow.streamOutput ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.glassWindow.streamOutput ? '翻译结果逐字显示' : '翻译完成后一次性显示'}
                </span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">OCR 引擎</label>
              <select
                className="setting-select"
                value={settings.glassWindow.ocrEngine}
                onChange={(e) => updateSetting('glassWindow', 'ocrEngine', e.target.value)}
              >
                <option value="llm-vision">LLM Vision（更准确）</option>
                <option value="tesseract">Tesseract（更快速）</option>
              </select>
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
            </div>

            <div className="setting-group">
              <label className="setting-label">其他选项</label>
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
                  <span>手动刷新</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Esc</kbd>
                  <span>关闭窗口</span>
                </div>
              </div>
            </div>
          </div>
        );

      case 'selection':
        return (
          <div className="setting-content">
            <h3>划词翻译设置</h3>
            <p className="setting-description">选中文字后自动显示翻译触发点</p>
            
            <div className="setting-group">
              <label className="setting-label">启用划词翻译</label>
              <div className="toggle-wrapper">
                <button
                  className={`toggle-button ${settings.selection.enabled ? 'active' : ''}`}
                  onClick={() => {
                    updateSetting('selection', 'enabled', !settings.selection.enabled);
                    // 通知主进程切换状态
                    window.electron?.ipcRenderer?.invoke?.('selection:toggle');
                  }}
                >
                  {settings.selection.enabled ? '开启' : '关闭'}
                </button>
                <span className="toggle-description">
                  {settings.selection.enabled ? '选中文字后显示翻译触发点' : '已禁用划词翻译'}
                </span>
              </div>
              <p className="setting-hint">也可以点击系统托盘图标快速切换</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">触发图标样式</label>
              <select
                className="setting-select"
                value={settings.selection.triggerIcon}
                onChange={(e) => updateSetting('selection', 'triggerIcon', e.target.value)}
              >
                <option value="dot">圆点</option>
                <option value="translate">翻译图标</option>
                <option value="custom">自定义图标</option>
              </select>
            </div>

            {settings.selection.triggerIcon === 'custom' && (
              <div className="setting-group">
                <label className="setting-label">自定义图标路径</label>
                <input
                  type="text"
                  className="setting-input"
                  value={settings.selection.customIconPath}
                  onChange={(e) => updateSetting('selection', 'customIconPath', e.target.value)}
                  placeholder="图标文件路径 (PNG/SVG)"
                />
              </div>
            )}

            <div className="setting-group">
              <label className="setting-label">触发图标大小</label>
              <div className="setting-row">
                <input
                  type="range"
                  className="setting-range"
                  min="16"
                  max="48"
                  value={settings.selection.triggerSize}
                  onChange={(e) => updateSetting('selection', 'triggerSize', parseInt(e.target.value))}
                />
                <span className="range-value">{settings.selection.triggerSize}px</span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">触发图标颜色</label>
              <div className="setting-row">
                <input
                  type="color"
                  className="setting-color"
                  value={settings.selection.triggerColor}
                  onChange={(e) => updateSetting('selection', 'triggerColor', e.target.value)}
                />
                <span className="color-value">{settings.selection.triggerColor}</span>
              </div>
            </div>

            <div className="setting-group">
              <label className="setting-label">悬停触发延迟</label>
              <div className="setting-row">
                <input
                  type="range"
                  className="setting-range"
                  min="100"
                  max="1000"
                  step="100"
                  value={settings.selection.hoverDelay}
                  onChange={(e) => updateSetting('selection', 'hoverDelay', parseInt(e.target.value))}
                />
                <span className="range-value">{settings.selection.hoverDelay}ms</span>
              </div>
              <p className="setting-hint">鼠标悬停在触发图标上多久后开始翻译</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">触发点消失时间</label>
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
              <p className="setting-hint">无操作后触发点自动消失的时间</p>
            </div>

            <div className="setting-group">
              <label className="setting-label">结果框自动关闭</label>
              <div className="setting-row">
                <input
                  type="range"
                  className="setting-range"
                  min="1000"
                  max="10000"
                  step="1000"
                  value={settings.selection.resultTimeout}
                  onChange={(e) => updateSetting('selection', 'resultTimeout', parseInt(e.target.value))}
                />
                <span className="range-value">{settings.selection.resultTimeout / 1000}秒</span>
              </div>
              <p className="setting-hint">鼠标移出结果框后自动关闭的时间</p>
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
              <div className="shortcut-info">
                <div className="shortcut-item">
                  <span className="step">1</span>
                  <span>在任意应用中选中文字</span>
                </div>
                <div className="shortcut-item">
                  <span className="step">2</span>
                  <span>鼠标悬停在出现的触发点上</span>
                </div>
                <div className="shortcut-item">
                  <span className="step">3</span>
                  <span>自动翻译并显示结果</span>
                </div>
                <div className="shortcut-item">
                  <kbd>左键点击</kbd>
                  <span>关闭结果框</span>
                </div>
                <div className="shortcut-item">
                  <kbd>右键拖动</kbd>
                  <span>移动结果框位置</span>
                </div>
                <div className="shortcut-item">
                  <kbd>双击结果</kbd>
                  <span>复制译文</span>
                </div>
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
          <button className={`nav-item ${activeSection==='translation'?'active':''}`} onClick={()=>setActiveSection('translation')}><Globe size={18}/><span>翻译</span></button>
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