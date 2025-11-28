// src/App.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  FileText, 
  Settings, 
  History, 
  Globe,
  Zap,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  X,
  Menu,
  Copy,
  Download,
  Upload,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import translator from './services/translator';
import ocrManager from './services/ocr-manager';
import llmClient from './utils/llm-client';
import './styles/App.css';

/**
 * 主应用组件
 */
function App() {
  // 状态管理
  const [activeTab, setActiveTab] = useState('translate');
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [theme, setTheme] = useState('light');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [ocrEngine, setOcrEngine] = useState('tesseract');
  const [translationHistory, setTranslationHistory] = useState([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [notification, setNotification] = useState(null);

  // Refs
  const fileInputRef = useRef(null);
  const sourceTextRef = useRef(null);

  // 语言选项
  const languages = [
    { code: 'auto', name: '自动检测' },
    { code: 'zh', name: '中文' },
    { code: 'en', name: '英语' },
    { code: 'ja', name: '日语' },
    { code: 'ko', name: '韩语' },
    { code: 'es', name: '西班牙语' },
    { code: 'fr', name: '法语' },
    { code: 'de', name: '德语' },
    { code: 'ru', name: '俄语' },
    { code: 'pt', name: '葡萄牙语' }
  ];

  // 初始化
  useEffect(() => {
    initializeApp();
    setupEventListeners();
    loadSettings();
	const timer = setTimeout(() => {
      console.log("🚀 发送启动信号...");
      window.__APP_LOADED__ = true; // 设置标记
      window.dispatchEvent(new Event('app-ready')); // 发送事件
    }, 100);
    
    return () => {
      cleanupEventListeners();
    };
  }, []);

  // 初始化应用
  const initializeApp = async () => {
    console.log('Initializing T-Translate Core...');
    
    // 测试 LM Studio 连接
    testLLMConnection();
    
    // 初始化 OCR
    try {
      await ocrManager.init();
      console.log('OCR Manager initialized');
    } catch (error) {
      console.error('OCR initialization failed:', error);
      showNotification('OCR 初始化失败', 'error');
    }
    
    // 加载翻译历史
    loadTranslationHistory();
  };

  // 测试 LLM 连接
  const testLLMConnection = async () => {
    setConnectionStatus('checking');
    try {
      const result = await llmClient.testConnection();
      setIsConnected(result.success);
      setConnectionStatus(result.success ? 'connected' : 'disconnected');
      
      if (!result.success) {
        showNotification('LM Studio 未连接，请启动 LM Studio 并加载模型', 'warning');
      } else {
        showNotification('LM Studio 连接成功', 'success');
      }
    } catch (error) {
      setIsConnected(false);
      setConnectionStatus('error');
      showNotification('连接测试失败', 'error');
    }
  };

  // 设置事件监听
  const setupEventListeners = () => {
    // 监听菜单事件
    window.addEventListener('menu-action', handleMenuAction);
    window.addEventListener('import-file', handleImportFile);
    
    // 监听快捷键
    document.addEventListener('keydown', handleKeyDown);
  };

  // 清理事件监听
  const cleanupEventListeners = () => {
    window.removeEventListener('menu-action', handleMenuAction);
    window.removeEventListener('import-file', handleImportFile);
    document.removeEventListener('keydown', handleKeyDown);
  };

  // 处理菜单动作
  const handleMenuAction = (event) => {
    const action = event.detail;
    console.log('Menu action:', action);
    
    switch (action) {
      case 'new-translation':
        clearContent();
        break;
      case 'export-translation':
        exportTranslation();
        break;
      case 'capture-translate':
        captureAndTranslate();
        break;
      case 'quick-translate':
        quickTranslate();
        break;
      case 'switch-language':
        switchLanguages();
        break;
      case 'clear-content':
        clearContent();
        break;
      case 'open-settings':
        setIsSettingsOpen(true);
        break;
      case 'show-shortcuts':
        showShortcuts();
        break;
      default:
        console.log('Unknown menu action:', action);
    }
  };

  // 处理文件导入
  const handleImportFile = async (event) => {
    const filePath = event.detail;
    console.log('Importing file:', filePath);
    
    if (window.electron) {
      const result = await window.electron.fs.readFile(filePath);
      if (result.success) {
        setSourceText(result.data);
        showNotification('文件导入成功', 'success');
      } else {
        showNotification('文件导入失败: ' + result.error, 'error');
      }
    }
  };

  // 处理快捷键
  const handleKeyDown = (event) => {
    // Ctrl+Enter 翻译
    if (event.ctrlKey && event.key === 'Enter') {
      handleTranslate();
    }
    // Ctrl+L 切换语言
    else if (event.ctrlKey && event.key === 'l') {
      event.preventDefault();
      switchLanguages();
    }
  };

  // 加载设置
  const loadSettings = async () => {
    if (window.electron && window.electron.store) {
      const savedTheme = await window.electron.store.get('theme', 'light');
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
      
      const savedOcrEngine = await window.electron.store.get('ocrEngine', 'tesseract');
      setOcrEngine(savedOcrEngine);
      
      const savedSourceLang = await window.electron.store.get('sourceLanguage', 'auto');
      setSourceLanguage(savedSourceLang);
      
      const savedTargetLang = await window.electron.store.get('targetLanguage', 'zh');
      setTargetLanguage(savedTargetLang);
    }
  };

  // 加载翻译历史
  const loadTranslationHistory = () => {
    const history = translator.getHistory({ limit: 20 });
    setTranslationHistory(history.items);
  };

  // 主翻译函数
  const handleTranslate = async () => {
    if (!sourceText.trim()) {
      showNotification('请输入要翻译的内容', 'warning');
      return;
    }
    
    if (!isConnected) {
      showNotification('请先连接 LM Studio', 'error');
      return;
    }
    
    setIsTranslating(true);
    setTranslatedText('');
    
    try {
      const result = await translator.translate(sourceText, {
        from: sourceLanguage,
        to: targetLanguage,
        template: 'general'
      });
      
      if (result.success) {
        setTranslatedText(result.translated);
        loadTranslationHistory(); // 刷新历史
        showNotification('翻译完成', 'success');
      } else {
        showNotification('翻译失败: ' + result.error, 'error');
      }
    } catch (error) {
      console.error('Translation error:', error);
      showNotification('翻译出错: ' + error.message, 'error');
    } finally {
      setIsTranslating(false);
    }
  };

  // 切换语言
  const switchLanguages = () => {
    if (sourceLanguage !== 'auto') {
      setSourceLanguage(targetLanguage);
      setTargetLanguage(sourceLanguage);
      
      // 交换文本
      const temp = sourceText;
      setSourceText(translatedText);
      setTranslatedText(temp);
    }
  };

  // 清空内容
  const clearContent = () => {
    setSourceText('');
    setTranslatedText('');
  };

  // 复制翻译结果
  const copyTranslation = () => {
    if (translatedText) {
      if (window.electron) {
        window.electron.clipboard.writeText(translatedText);
      } else {
        navigator.clipboard.writeText(translatedText);
      }
      showNotification('已复制到剪贴板', 'success');
    }
  };

  // 导出翻译
  const exportTranslation = async () => {
    if (!translatedText) {
      showNotification('没有可导出的内容', 'warning');
      return;
    }
    
    const content = `原文:\n${sourceText}\n\n译文:\n${translatedText}`;
    
    if (window.electron) {
      const result = await window.electron.dialog.showSaveDialog({
        defaultPath: `translation-${Date.now()}.txt`,
        filters: [
          { name: '文本文件', extensions: ['txt'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      
      if (!result.canceled) {
        await window.electron.fs.writeFile(result.filePath, content);
        showNotification('导出成功', 'success');
      }
    }
  };

  // 快速翻译（从剪贴板）
  const quickTranslate = async () => {
    if (window.electron) {
      const text = await window.electron.clipboard.readText();
      if (text) {
        setSourceText(text);
        handleTranslate();
      }
    }
  };

  // 截图翻译
  const captureAndTranslate = async () => {
    showNotification('截图功能开发中...', 'info');
    // TODO: 实现截图功能
  };

  // 显示快捷键
  const showShortcuts = () => {
    const shortcuts = `
快捷键列表：
- Ctrl+Enter - 翻译
- Ctrl+L - 切换语言
- Ctrl+N - 新建翻译
- Ctrl+S - 导出翻译
- Ctrl+Shift+T - 截图翻译
- Ctrl+Q - 快速翻译
- Ctrl+, - 打开设置
    `;
    alert(shortcuts);
  };

  // 显示通知
  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // 处理文件上传
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setSourceText(e.target.result);
      showNotification('文件加载成功', 'success');
    };
    reader.onerror = () => {
      showNotification('文件读取失败', 'error');
    };
    reader.readAsText(file);
  };

  // 切换主题
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    
    if (window.electron && window.electron.store) {
      window.electron.store.set('theme', newTheme);
    }
  };

  return (
    <div className="app">
      {/* 标题栏 */}
      <div className="titlebar">
        <div className="titlebar-drag-region">
          <span className="app-title">T-Translate Core</span>
        </div>
        <div className="titlebar-controls">
          <button onClick={toggleTheme} className="titlebar-button">
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          {window.electron && (
            <>
              <button 
                onClick={() => window.electron.window.minimize()} 
                className="titlebar-button"
              >
                <Minimize2 size={16} />
              </button>
              <button 
                onClick={() => window.electron.window.maximize()} 
                className="titlebar-button"
              >
                <Maximize2 size={16} />
              </button>
              <button 
                onClick={() => window.electron.window.close()} 
                className="titlebar-button close"
              >
                <X size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="app-content">
        {/* 侧边栏 */}
        <div className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          <button 
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          >
            <Menu size={20} />
          </button>
          
          <nav className="sidebar-nav">
            <button
              className={`sidebar-item ${activeTab === 'translate' ? 'active' : ''}`}
              onClick={() => setActiveTab('translate')}
            >
              <FileText size={20} />
              {!isSidebarCollapsed && <span>翻译</span>}
            </button>
            <button
              className={`sidebar-item ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              <History size={20} />
              {!isSidebarCollapsed && <span>历史</span>}
            </button>
            <button
              className={`sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={20} />
              {!isSidebarCollapsed && <span>设置</span>}
            </button>
          </nav>

          {/* 连接状态 */}
          <div className="connection-status">
            <div className={`status-indicator ${connectionStatus}`}>
              <Zap size={16} />
            </div>
            {!isSidebarCollapsed && (
              <span className="status-text">
                {connectionStatus === 'connected' ? 'LM Studio 已连接' :
                 connectionStatus === 'checking' ? '检查连接...' : 
                 'LM Studio 未连接'}
              </span>
            )}
          </div>
        </div>

        {/* 主面板 */}
        <div className="main-panel">
          {activeTab === 'translate' && (
            <div className="translate-panel">
              {/* 工具栏 */}
              <div className="toolbar">
                <div className="language-selector">
                  <select
                    value={sourceLanguage}
                    onChange={(e) => setSourceLanguage(e.target.value)}
                    className="language-select"
                  >
                    {languages.map(lang => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  
                  <button 
                    className="switch-button"
                    onClick={switchLanguages}
                    disabled={sourceLanguage === 'auto'}
                  >
                    <RefreshCw size={18} />
                  </button>
                  
                  <select
                    value={targetLanguage}
                    onChange={(e) => setTargetLanguage(e.target.value)}
                    className="language-select"
                  >
                    {languages.filter(l => l.code !== 'auto').map(lang => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="toolbar-actions">
                  <button 
                    className="toolbar-button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={18} />
                    导入
                  </button>
                  <button 
                    className="toolbar-button"
                    onClick={exportTranslation}
                    disabled={!translatedText}
                  >
                    <Download size={18} />
                    导出
                  </button>
                  <button 
                    className="toolbar-button"
                    onClick={clearContent}
                  >
                    <X size={18} />
                    清空
                  </button>
                </div>
              </div>

              {/* 翻译区域 */}
              <div className="translate-content">
                <div className="translate-box">
                  <div className="box-header">
                    <span>原文</span>
                    <span className="char-count">{sourceText.length} 字</span>
                  </div>
                  <textarea
                    ref={sourceTextRef}
                    className="translate-textarea"
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    placeholder="输入要翻译的文本..."
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault();
                        handleTranslate();
                      }
                    }}
                  />
                </div>

                <div className="translate-actions">
                  <button
                    className={`translate-button ${isTranslating ? 'loading' : ''}`}
                    onClick={handleTranslate}
                    disabled={isTranslating || !sourceText.trim()}
                  >
                    {isTranslating ? '翻译中...' : '翻译 (Ctrl+Enter)'}
                  </button>
                </div>

                <div className="translate-box">
                  <div className="box-header">
                    <span>译文</span>
                    <div className="box-actions">
                      <button
                        className="icon-button"
                        onClick={copyTranslation}
                        disabled={!translatedText}
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="translate-textarea"
                    value={translatedText}
                    onChange={(e) => setTranslatedText(e.target.value)}
                    placeholder="翻译结果将显示在这里..."
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="history-panel">
              <h2>翻译历史</h2>
              <div className="history-list">
                {translationHistory.length > 0 ? (
                  translationHistory.map((item, index) => (
                    <div key={item.id || index} className="history-item">
                      <div className="history-header">
                        <span className="history-lang">
                          {item.from} → {item.to}
                        </span>
                        <span className="history-time">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="history-content">
                        <div className="history-original">{item.original}</div>
                        <div className="history-translated">{item.translated}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <History size={48} />
                    <p>暂无翻译历史</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="settings-panel">
              <h2>设置</h2>
              <div className="settings-content">
                <div className="setting-group">
                  <h3>连接设置</h3>
                  <div className="setting-item">
                    <label>LM Studio 端点</label>
                    <input 
                      type="text" 
                      defaultValue="http://localhost:1234/v1"
                      className="setting-input"
                    />
                  </div>
                  <button 
                    className="setting-button"
                    onClick={testLLMConnection}
                  >
                    测试连接
                  </button>
                </div>

                <div className="setting-group">
                  <h3>OCR 设置</h3>
                  <div className="setting-item">
                    <label>OCR 引擎</label>
                    <select 
                      value={ocrEngine}
                      onChange={(e) => setOcrEngine(e.target.value)}
                      className="setting-select"
                    >
                      <option value="tesseract">Tesseract.js</option>
                      <option value="llm-vision">LLM Vision</option>
                    </select>
                  </div>
                </div>

                <div className="setting-group">
                  <h3>界面设置</h3>
                  <div className="setting-item">
                    <label>主题</label>
                    <select 
                      value={theme}
                      onChange={(e) => {
                        const newTheme = e.target.value;
                        setTheme(newTheme);
                        document.documentElement.setAttribute('data-theme', newTheme);
                      }}
                      className="setting-select"
                    >
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 通知 */}
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          <AlertCircle size={16} />
          <span>{notification.message}</span>
        </div>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.doc,.docx"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
    </div>
  );
}

export default App;