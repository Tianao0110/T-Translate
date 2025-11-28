// src/components/TranslationPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Mic,
  MicOff,
  Camera,
  Image,
  FileText,
  Volume2,
  Copy,
  Download,
  RotateCcw,
  Sparkles,
  Loader2,
  ChevronDown,
  Clock,
  Zap,
  Shield,
  Eye,
  EyeOff,
  Lock
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import llmClient from '../utils/llm-client';
import '../styles/components/TranslationPanel.css';

/**
 * 翻译面板组件
 * 核心翻译功能界面
 */
const TranslationPanel = ({ onNotification }) => {
  // 状态
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [translationMode, setTranslationMode] = useState('standard'); // standard, secure, offline
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState({});
  
  // Store
  const {
    currentTranslation,
    setSourceText,
    setTranslatedText,
    setLanguages,
    translate,
    recognizeImage,
    clearCurrent,
    swapLanguages,
    addToFavorites,
    copyToClipboard,
    pasteFromClipboard
  } = useTranslationStore();

  // Refs
  const sourceTextareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  // 语言选项
  const languages = [
    { code: 'auto', name: '自动检测', flag: '🌐' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' }
  ];

  // 翻译模板
  const templates = [
    { id: 'general', name: '通用', icon: FileText },
    { id: 'technical', name: '技术', icon: Zap },
    { id: 'academic', name: '学术', icon: Sparkles },
    { id: 'business', name: '商务', icon: FileText },
    { id: 'casual', name: '口语', icon: Mic }
  ];

  // 初始化连接检查
  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000); // 每30秒检查一次
    return () => clearInterval(interval);
  }, []);

  // 检查连接状态
  const checkConnection = async () => {
    try {
      const result = await llmClient.testConnection();
      setIsConnected(result.success);
      setConnectionInfo({
        endpoint: 'localhost:1234',
        model: result.models?.[0]?.id || 'unknown',
        status: result.success ? 'connected' : 'disconnected'
      });
    } catch (error) {
      setIsConnected(false);
      setConnectionInfo({
        endpoint: 'localhost:1234',
        status: 'error',
        error: error.message
      });
    }
  };

  // 处理翻译
  const handleTranslate = async () => {
    if (!currentTranslation.sourceText.trim()) {
      onNotification('请输入要翻译的内容', 'warning');
      return;
    }

    if (!isConnected && translationMode !== 'offline') {
      onNotification('LM Studio 未连接，请检查连接或使用离线模式', 'error');
      return;
    }

    const result = await translate({
      template: 'general',
      secure: translationMode === 'secure'
    });

    if (result.success) {
      onNotification('翻译完成', 'success');
      
      // 记录到本地日志（隐私保护）
      if (translationMode === 'secure') {
        console.log('[SECURE MODE] Translation completed, no logging');
      }
    } else {
      onNotification('翻译失败: ' + result.error, 'error');
    }
  };

  // 处理文件拖放
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0];

    if (!file) return;

    // 检查文件类型
    if (file.type.startsWith('image/')) {
      // 图片 OCR
      const reader = new FileReader();
      reader.onload = async (event) => {
        const result = await recognizeImage(event.target.result);
        if (result.success) {
          onNotification('文字识别成功', 'success');
        } else {
          onNotification('识别失败: ' + result.error, 'error');
        }
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      // 文本文件
      const text = await file.text();
      setSourceText(text);
      onNotification('文件导入成功', 'success');
    } else {
      onNotification('不支持的文件类型', 'warning');
    }
  }, [recognizeImage, setSourceText, onNotification]);

  // 处理粘贴
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          const result = await recognizeImage(event.target.result);
          if (result.success) {
            onNotification('图片文字识别成功', 'success');
          }
        };
        
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, [recognizeImage, onNotification]);

  // 隐私保护面板
  const renderPrivacyPanel = () => {
    return (
      <div className="privacy-panel">
        <div className="privacy-header">
          <Shield size={20} className="privacy-icon" />
          <span>隐私与安全</span>
          <button 
            className="privacy-toggle"
            onClick={() => setShowPrivacyInfo(!showPrivacyInfo)}
          >
            {showPrivacyInfo ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        
        {showPrivacyInfo && (
          <div className="privacy-info">
            <div className="privacy-item">
              <Lock size={16} className="text-success" />
              <div>
                <strong>完全离线</strong>
                <p>所有翻译在本地完成，不上传任何数据</p>
              </div>
            </div>
            <div className="privacy-item">
              <Shield size={16} className="text-success" />
              <div>
                <strong>数据加密</strong>
                <p>历史记录使用 AES-256 加密存储</p>
              </div>
            </div>
            <div className="privacy-item">
              <Eye size={16} className="text-warning" />
              <div>
                <strong>隐私模式</strong>
                <p>启用后不保存翻译历史</p>
              </div>
            </div>
          </div>
        )}

        {/* 翻译模式选择 */}
        <div className="translation-modes">
          <button
            className={`mode-btn ${translationMode === 'standard' ? 'active' : ''}`}
            onClick={() => setTranslationMode('standard')}
            title="标准模式：正常保存历史"
          >
            <Zap size={16} />
            <span>标准</span>
          </button>
          <button
            className={`mode-btn ${translationMode === 'secure' ? 'active' : ''}`}
            onClick={() => setTranslationMode('secure')}
            title="安全模式：不保存敏感内容"
          >
            <Shield size={16} />
            <span>安全</span>
          </button>
          <button
            className={`mode-btn ${translationMode === 'offline' ? 'active' : ''}`}
            onClick={() => setTranslationMode('offline')}
            title="离线模式：使用本地缓存"
          >
            <Lock size={16} />
            <span>离线</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="translation-panel">
      {/* 隐私保护面板 */}
      {renderPrivacyPanel()}

      {/* 语言选择器 */}
      <div className="language-selector-bar">
        <div className="language-select-group">
          <select
            value={currentTranslation.sourceLanguage}
            onChange={(e) => setLanguages(e.target.value, null)}
            className="language-select"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>

          <button 
            className="swap-button"
            onClick={swapLanguages}
            disabled={currentTranslation.sourceLanguage === 'auto'}
            title="切换语言"
          >
            <RotateCcw size={18} />
          </button>

          <select
            value={currentTranslation.targetLanguage}
            onChange={(e) => setLanguages(null, e.target.value)}
            className="language-select"
          >
            {languages.filter(l => l.code !== 'auto').map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* 模板选择 */}
        <div className="template-selector">
          {templates.map(template => (
            <button
              key={template.id}
              className={`template-btn ${currentTranslation.metadata.template === template.id ? 'active' : ''}`}
              onClick={() => {/* 设置模板 */}}
              title={template.name}
            >
              <template.icon size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* 翻译区域 */}
      <div className="translation-areas">
        {/* 源文本区域 */}
        <div 
          className={`translation-box source-box ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        >
          <div className="box-toolbar">
            <span className="box-title">原文</span>
            <div className="box-actions">
              <button 
                className="action-btn"
                onClick={() => fileInputRef.current?.click()}
                title="上传文件"
              >
                <Image size={16} />
              </button>
              <button 
                className="action-btn"
                onClick={pasteFromClipboard}
                title="粘贴"
              >
                <FileText size={16} />
              </button>
              <button 
                className="action-btn"
                onClick={() => {/* 语音输入 */}}
                title="语音输入"
              >
                <Mic size={16} />
              </button>
              <button 
                className="action-btn"
                onClick={clearCurrent}
                title="清空"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          <textarea
            ref={sourceTextareaRef}
            className="translation-textarea"
            value={currentTranslation.sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onPaste={handlePaste}
            placeholder={dragOver ? '释放文件以导入...' : '输入要翻译的文本，或拖放文件...'}
            spellCheck={false}
          />

          <div className="box-footer">
            <span className="char-count">
              {currentTranslation.sourceText.length} 字符
            </span>
            {currentTranslation.sourceText && (
              <span className="word-count">
                约 {Math.ceil(currentTranslation.sourceText.length / 500)} 分钟阅读
              </span>
            )}
          </div>
        </div>

        {/* 翻译按钮 */}
        <div className="translation-controls">
          <button
            className={`translate-btn ${currentTranslation.status === 'translating' ? 'loading' : ''}`}
            onClick={handleTranslate}
            disabled={!currentTranslation.sourceText.trim() || currentTranslation.status === 'translating'}
          >
            {currentTranslation.status === 'translating' ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>翻译中...</span>
              </>
            ) : (
              <>
                <Send size={20} />
                <span>翻译</span>
                <kbd>Ctrl+Enter</kbd>
              </>
            )}
          </button>

          {/* 连接状态指示器 */}
          <div className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="indicator-dot"></div>
            <span>{isConnected ? 'LM Studio 已连接' : '离线模式'}</span>
          </div>
        </div>

        {/* 译文区域 */}
        <div className="translation-box target-box">
          <div className="box-toolbar">
            <span className="box-title">译文</span>
            <div className="box-actions">
              <button 
                className="action-btn"
                onClick={() => copyToClipboard('translated')}
                title="复制"
                disabled={!currentTranslation.translatedText}
              >
                <Copy size={16} />
              </button>
              <button 
                className="action-btn"
                onClick={addToFavorites}
                title="收藏"
                disabled={!currentTranslation.translatedText}
              >
                <Sparkles size={16} />
              </button>
              <button 
                className="action-btn"
                onClick={() => {/* 朗读 */}}
                title="朗读"
                disabled={!currentTranslation.translatedText}
              >
                <Volume2 size={16} />
              </button>
              <button 
                className="action-btn"
                onClick={() => {/* 导出 */}}
                title="导出"
                disabled={!currentTranslation.translatedText}
              >
                <Download size={16} />
              </button>
            </div>
          </div>

          <textarea
            className="translation-textarea"
            value={currentTranslation.translatedText}
            onChange={(e) => setTranslatedText(e.target.value)}
            placeholder="翻译结果将显示在这里..."
            spellCheck={false}
          />

          <div className="box-footer">
            {currentTranslation.translatedText && (
              <>
                <span className="char-count">
                  {currentTranslation.translatedText.length} 字符
                </span>
                {currentTranslation.metadata.duration && (
                  <span className="translation-time">
                    <Clock size={12} />
                    {(currentTranslation.metadata.duration / 1000).toFixed(1)}s
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md,.doc,.docx,.pdf"
        onChange={(e) => {/* 处理文件 */}}
        style={{ display: 'none' }}
      />

      {/* 安全提示 */}
      {translationMode === 'secure' && (
        <div className="security-notice">
          <Shield size={16} />
          <span>安全模式已启用 - 翻译内容不会被保存到历史记录</span>
        </div>
      )}
    </div>
  );
};

export default TranslationPanel;