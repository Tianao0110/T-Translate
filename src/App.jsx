// src/App.jsx - 完整修复版
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  FileText, Settings, History, Moon, Sun, Copy, Download, Upload,
  RefreshCw, AlertCircle, CheckCircle, ChevronLeft, ChevronRight,
  X, Trash2, Info, HelpCircle
} from 'lucide-react';

// 确保你项目里有这些文件，如果没有，需要把相关的 import 和调用注释掉
import translator from './services/translator'; 
import ocrManager from './services/ocr-manager';
import llmClient from './utils/llm-client';
import './styles/App.css';

function App() {
  // ========== 1. 状态管理 ==========
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

  // ========== 2. 初始化与副作用 ==========
  useEffect(() => {
    // 启动初始化
    initializeApp();
    
    // 加载设置和历史
    loadSettings();
    loadTranslationHistory();

    // 绑定全局快捷键
    const handleGlobalKeyDown = (e) => {
      // Ctrl + Enter: 触发翻译
      if (e.ctrlKey && e.key === 'Enter') {
        if (activeTab === 'translate') {
          // 这里使用 Ref 或者 document.querySelector 来触发按钮点击
          // 避免闭包导致无法获取最新的 sourceText
          const translateBtn = document.querySelector('.translate-button');
          if (translateBtn && !translateBtn.disabled) translateBtn.click();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    const timer = setTimeout(() => {
      console.log("T-Translate 启动完成");
      if (window) {
        window.__APP_LOADED__ = true;
        window.dispatchEvent(new Event('app-ready'));
      }
    }, 100);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []); // 空依赖数组，只执行一次

  const initializeApp = async () => {
    console.log('Initializing T-Translate...');
    testLLMConnectionOnce();
    
    try {
      if (ocrManager && ocrManager.init) {
        await ocrManager.init();
        console.log('OCR Manager initialized');
      }
    } catch (error) {
      console.error('OCR initialization failed:', error);
    }
  };

  // ========== 3. 功能逻辑函数 (之前缺失的部分都在这里) ==========

  // 加载设置
  const loadSettings = () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  };

  // 加载历史
  const loadTranslationHistory = () => {
    try {
      const history = localStorage.getItem('translationHistory');
      if (history) {
        setTranslationHistory(JSON.parse(history));
      }
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  // 保存历史到本地存储
  const saveHistoryToLocal = (newHistory) => {
    localStorage.setItem('translationHistory', JSON.stringify(newHistory));
  };

  // 核心功能：翻译
  const handleTranslate = async () => {
    if (!sourceText.trim()) return;
    
    setIsTranslating(true);
    try {
      // 1. 调用翻译服务
      const result = await translator.translate(sourceText, {
        from: sourceLanguage,
        to: targetLanguage
      });
      if (result && result.translated) {
        setTranslatedText(result.translated); 
      } else {
        // 如果结果里没有 translated 字段，可能是 llmClient 返回了原始对象
        // 尝试兜底显示（调试用）
        console.warn("翻译结果结构异常:", result);
        setTranslatedText(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      }
      
      // 添加到历史记录
      const newHistoryItem = {
        ...result, 
        id: Date.now(),
        timestamp: new Date()
      };
      
      const newHistory = [newHistoryItem, ...translationHistory].slice(0, 50);
      setTranslationHistory(newHistory);
      if (saveHistoryToLocal) saveHistoryToLocal(newHistory);
      
    } catch (error) {
      console.error('Translation failed:', error);
      showNotification('翻译失败: ' + (error.message || '未知错误'), 'error');
    } finally {
      setIsTranslating(false);
    }
  };

  // 修复报错的核心：切换语言
  const switchLanguages = () => {
    // 逻辑：如果当前是自动检测，切换后目标变成英文(或者保持默认)
    // 否则直接交换
    const newSource = targetLanguage;
    const newTarget = sourceLanguage === 'auto' ? 'en' : sourceLanguage;

    setSourceLanguage(newSource);
    setTargetLanguage(newTarget);

    // 同时也交换文本框的内容
    setSourceText(translatedText);
    setTranslatedText(sourceText);
  };

  // 导出功能
  const exportTranslation = () => {
    if (!translatedText) return;
    const element = document.createElement("a");
    const file = new Blob([`原文:\n${sourceText}\n\n译文:\n${translatedText}`], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `translation_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(element); 
    element.click();
    document.body.removeChild(element);
  };

  // 复制功能
  const copyTranslation = async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      showNotification('译文已复制到剪贴板', 'success');
    } catch (err) {
      showNotification('复制失败', 'error');
    }
  };

  // 清空内容
  const clearContent = () => {
    setSourceText('');
    setTranslatedText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    // 聚焦回输入框
    if (sourceTextRef.current) sourceTextRef.current.focus();
  };

  // 清空历史
  const clearHistory = () => {
    if (window.confirm('确定要清空所有翻译历史吗？')) {
      setTranslationHistory([]);
      localStorage.removeItem('translationHistory');
      showNotification('历史记录已清空', 'success');
    }
  };

  // 文件上传处理
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // 简单文件大小限制 (例如 1MB)
    if (file.size > 1024 * 1024) {
      showNotification('文件过大，请上传 1MB 以内的文本文件', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setSourceText(content);
      showNotification(`已导入: ${file.name}`, 'success');
    };
    reader.onerror = () => showNotification('读取文件失败', 'error');
    
    reader.readAsText(file); // 默认按 UTF-8 读取
    event.target.value = null; // 重置 input
  };

  // ========== 4. 辅助函数 ==========

  const testLLMConnectionOnce = async () => {
    try {
      const result = await llmClient.testConnection();
      setIsConnected(result.success);
      setConnectionStatus(result.success ? 'connected' : 'disconnected');
      if (!result.success) {
        showNotification('LM Studio 未连接', 'warning');
      } else {
        showNotification('LM Studio 连接成功', 'success');
      }
    } catch (error) {
      setIsConnected(false);
      setConnectionStatus('error');
    }
  };

  const testLLMConnection = async () => {
    setConnectionStatus('checking');
    try {
      const result = await llmClient.testConnection();
      setIsConnected(result.success);
      setConnectionStatus(result.success ? 'connected' : 'disconnected');
      showNotification(result.success ? '连接成功' : '连接失败', result.success ? 'success' : 'error');
    } catch (error) {
      setIsConnected(false);
      setConnectionStatus('error');
      showNotification('连接出错', 'error');
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // ========== 5. 界面渲染 (JSX) ==========
  return (
    <div className={`app ${theme} no-titlebar`}>
      <div className="app-content">
        {/* 侧边栏 */}
        <div className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          <button 
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? '展开' : '收起'}
          >
            {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>

          <nav className="sidebar-nav">
            <button
              className={`sidebar-item ${activeTab === 'translate' ? 'active' : ''}`}
              onClick={() => setActiveTab('translate')}
              title="翻译"
            >
              <FileText size={20} />
              {!isSidebarCollapsed && <span>翻译</span>}
            </button>
            
            <button
              className={`sidebar-item ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
              title="历史"
            >
              <History size={20} />
              {!isSidebarCollapsed && <span>历史</span>}
            </button>
            
            <button
              className={`sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
              title="设置"
            >
              <Settings size={20} />
              {!isSidebarCollapsed && <span>设置</span>}
            </button>
          </nav>

          <div className="sidebar-footer">
            <button
              className="sidebar-theme-toggle"
              onClick={toggleTheme}
              title="切换主题"
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
              {!isSidebarCollapsed && (
                <span>{theme === 'light' ? '深色' : '浅色'}</span>
              )}
            </button>
          </div>
        </div>

        {/* 主面板 */}
        <div className="main-panel">
          {/* A. 翻译页面 */}
          {activeTab === 'translate' && (
            <div className="translate-panel">
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
                  
                  {/* 这里就是之前报错的地方，现在 switchLanguages 已经定义了 */}
                  <button 
                    className="switch-button"
                    onClick={switchLanguages}
                    disabled={sourceLanguage === 'auto'}
                    title="切换语言"
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
                    title="导入文件"
                  >
                    <Upload size={18} />
                    <span>导入</span>
                  </button>
                  <button 
                    className="toolbar-button"
                    onClick={exportTranslation}
                    disabled={!translatedText}
                    title="导出翻译"
                  >
                    <Download size={18} />
                    <span>导出</span>
                  </button>
                  <button 
                    className="toolbar-button"
                    onClick={clearContent}
                    title="清空内容"
                  >
                    <X size={18} />
                    <span>清空</span>
                  </button>
                </div>
              </div>

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
                    <button
                      className="icon-button"
                      onClick={copyTranslation}
                      disabled={!translatedText}
                      title="复制译文"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <textarea
                    className="translate-textarea"
                    value={translatedText}
                    onChange={(e) => setTranslatedText(e.target.value)}
                    placeholder="翻译结果将显示在这里..."
                    readOnly
                  />
                </div>
              </div>
            </div>
          )}

          {/* B. 历史页面 */}
          {activeTab === 'history' && (
            <div className="history-panel">
              <div className="panel-header">
                <h2>翻译历史</h2>
                {translationHistory.length > 0 && (
                  <button 
                    className="clear-button"
                    onClick={clearHistory}
                  >
                    <Trash2 size={16} />
                    清空历史
                  </button>
                )}
              </div>
              
              <div className="history-list">
                {translationHistory.length > 0 ? (
                  translationHistory.map((item, index) => {
                    // 安全处理：确保 from 和 to 是字符串
                    const fromLang = typeof item.from === 'object' ? 'auto' : item.from;
                    const toLang = typeof item.to === 'object' ? 'zh' : item.to;
                    
                    return (
                      <div key={item.id || index} className="history-item">
                        <div className="history-header">
                          <span className="history-lang">
                            {languages.find(l=>l.code===fromLang)?.name || fromLang} 
                            {' -> '} 
                            {languages.find(l=>l.code===toLang)?.name || toLang}
                          </span>
                          <span className="history-time">
                            {/* 安全处理时间戳 */}
                            {new Date(item.timestamp || Date.now()).toLocaleString()}
                          </span>
                        </div>
                        <div className="history-content">
                          <div className="history-original">
                            {/* 关键修复：检查类型，如果是对象则不渲染或转换 */}
                            {typeof item.original === 'string' 
                              ? item.original 
                              : (item.original?.original || JSON.stringify(item.original))}
                          </div>
                          <div className="history-translated">
                            {/* 关键修复：检查类型，如果是对象则提取 translated 字段 */}
                            {typeof item.translated === 'string' 
                              ? item.translated 
                              : (item.translated?.translated || "数据格式错误")}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <History size={48} />
                    <p>暂无翻译历史</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* C. 设置页面 */}
          {activeTab === 'settings' && (
            <div className="settings-panel">
              <h2>设置</h2>
              
              <div className="setting-group">
                <h3>快捷键</h3>
                <div className="shortcut-list">
                  <div className="shortcut-item">
                    <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
                    <span>翻译</span>
                  </div>
                  {/* 注意：Ctrl+L 一般是浏览器定位栏，网页版可能需要 e.preventDefault() */}
                  <div className="shortcut-item">
                    <kbd>Ctrl</kbd> + <kbd>L</kbd>
                    <span>切换语言 (暂未绑定)</span>
                  </div>
                </div>
              </div>

              <div className="setting-group">
                <h3>外观设置</h3>
                <div className="setting-item">
                  <label>主题模式</label>
                  <span className="setting-value">
                    {theme === 'light' ? '浅色模式' : '深色模式'}
                  </span>
                </div>
              </div>

              <div className="setting-group">
                <h3>LM Studio 连接</h3>
                <div className="setting-item">
                  <label>端点地址</label>
                  <input 
                    type="text" 
                    defaultValue="http://localhost:1234/v1"
                    className="setting-input"
                  />
                </div>
                <div className="setting-item">
                  <label>连接状态</label>
                  <span className={`connection-badge ${connectionStatus}`}>
                    {connectionStatus === 'connected' ? '已连接' :
                     connectionStatus === 'checking' ? '检查中...' : '未连接'}
                  </span>
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
                <h3>关于</h3>
                <div className="about-content">
                  <p><strong>T-Translate</strong></p>
                  <p>版本: 1.0.0</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 通知组件 */}
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.type === 'success' && <CheckCircle size={16} />}
          {notification.type === 'error' && <AlertCircle size={16} />}
          {notification.type === 'warning' && <AlertCircle size={16} />}
          {notification.type === 'info' && <Info size={16} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* 隐藏的文件输入框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.json"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
    </div>
  );
}

export default App;