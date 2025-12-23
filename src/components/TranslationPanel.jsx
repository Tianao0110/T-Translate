// src/components/TranslationPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Mic, MicOff, Camera, Image, FileText, Volume2, Copy, Download,
  RotateCcw, Sparkles, Loader2, ChevronDown, Clock, Zap, Shield, Eye, EyeOff, Lock
} from 'lucide-react';

import useTranslationStore from '../stores/translation-store';
import llmClient from '../utils/llm-client';
import '../styles/components/TranslationPanel.css'; 

/**
 * 翻译面板组件 (功能增强版)
 */
const TranslationPanel = ({ showNotification }) => {
  // 兼容性处理：父组件可能传的是 showNotification 或 onNotification
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // ========== 本地 UI 状态 ==========
  const [isRecording, setIsRecording] = useState(false);
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [translationMode, setTranslationMode] = useState('standard'); // standard, secure, offline
  const [isConnected, setIsConnected] = useState(false);
  
  // ========== Zustand Store ==========
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
    pasteFromClipboard,
    // 如果 Store 里没有专门设置模板的 action，我们可以直接修改 metadata (如果是 immer) 
    // 或者在 translate 时传入
  } = useTranslationStore();

  // Refs
  const sourceTextareaRef = useRef(null);
  const fileInputRef = useRef(null);

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

  // [UI 状态] 当前选中的模板 (UI state, 传给 translate 函数)
  const [selectedTemplate, setSelectedTemplate] = useState('general');

  // 初始化连接检查
  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000); 
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    try {
      const result = await llmClient.testConnection();
      setIsConnected(result.success);
    } catch (error) {
      setIsConnected(false);
    }
  };

  // 处理翻译
  const handleTranslate = async () => {
    if (!currentTranslation.sourceText.trim()) {
      notify('请输入要翻译的内容', 'warning');
      return;
    }

    if (!isConnected && translationMode !== 'offline') {
      notify('LM Studio 未连接，请检查连接或使用离线模式', 'error');
      // 注意：这里我们不强制 return，允许用户尝试（也许连接刚恢复）
    }

    // 调用 Store 的 translate Action
    const result = await translate({
      template: selectedTemplate,
      // 如果是安全模式，可以传递给 service 层不记录历史 (需要 service 支持，目前 store 已有部分逻辑)
      saveHistory: translationMode !== 'secure' 
    });

    if (result.success) {
      // 成功不打扰，或者显示个轻提示
      // notify('翻译完成', 'success');
      if (translationMode === 'secure') {
        console.log('[SECURE] Translation done, history skipped.');
      }
    } else {
      notify('翻译失败: ' + result.error, 'error');
    }
  };

  // 处理文件拖放
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      // 图片 OCR
      const reader = new FileReader();
      reader.onload = async (event) => {
        notify('正在识别图片文字...', 'info');
        const result = await recognizeImage(event.target.result);
        if (result.success) {
          notify('文字识别成功', 'success');
        } else {
          notify('识别失败: ' + result.error, 'error');
        }
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      // 文本文件
      const text = await file.text();
      setSourceText(text);
      notify('文件导入成功', 'success');
    } else {
      notify('不支持的文件类型', 'warning');
    }
  }, [recognizeImage, setSourceText, notify]);

  // 处理 Input 文件选择
  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        notify('正在识别...', 'info');
        const result = await recognizeImage(event.target.result);
        if (result.success) notify('识别成功', 'success');
        else notify('识别失败', 'error');
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSourceText(e.target.result);
        notify('导入成功', 'success');
      };
      reader.readAsText(file);
    }
    e.target.value = null;
  };

  // 处理粘贴
  const handlePaste = useCallback(async (e) => {
    // 优先处理粘贴的文本
    // 如果剪贴板里有图片，再处理图片
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // 阻止默认粘贴（否则输入框可能出现乱码）
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async (event) => {
          notify('发现剪贴板图片，正在识别...', 'info');
          const result = await recognizeImage(event.target.result);
          if (result.success) notify('识别成功', 'success');
        };
        reader.readAsDataURL(blob);
        break; 
      }
    }
    // 如果是普通文本，textarea 默认行为会处理，不需要我们干预
  }, [recognizeImage, notify]);

  // 渲染隐私面板
  const renderPrivacyPanel = () => (
    <div className="privacy-panel">
      <div className="privacy-header">
        <div className="privacy-title">
           <Shield size={18} className="text-primary" />
           <span>隐私模式</span>
        </div>
        <button 
          className="privacy-toggle"
          onClick={() => setShowPrivacyInfo(!showPrivacyInfo)}
          title="显示详情"
        >
          {showPrivacyInfo ? <ChevronDown size={16} /> : <InfoIcon size={16} />}
        </button>
      </div>
      
      {showPrivacyInfo && (
        <div className="privacy-info">
          <div className="privacy-item">
            <Lock size={14} className="text-success" />
            <span>完全离线：数据不上传云端</span>
          </div>
          <div className="privacy-item">
            <Shield size={14} className="text-success" />
            <span>加密存储：AES-256 保护历史</span>
          </div>
        </div>
      )}

      <div className="translation-modes">
        <button
          className={`mode-btn ${translationMode === 'standard' ? 'active' : ''}`}
          onClick={() => setTranslationMode('standard')}
          title="标准模式"
        >
          <Zap size={14} /> <span>标准</span>
        </button>
        <button
          className={`mode-btn ${translationMode === 'secure' ? 'active' : ''}`}
          onClick={() => setTranslationMode('secure')}
          title="不保存历史"
        >
          <Shield size={14} /> <span>无痕</span>
        </button>
        <button
          className={`mode-btn ${translationMode === 'offline' ? 'active' : ''}`}
          onClick={() => setTranslationMode('offline')}
          title="强制离线"
        >
          <Lock size={14} /> <span>离线</span>
        </button>
      </div>
    </div>
  );

  // 这里为了图标显示，定义一个小组件
  const InfoIcon = ({size}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;

  return (
    <div className="translation-panel">
      
      {/* 顶部工具栏 (语言 + 模板) */}
      <div className="language-selector-bar">
        <div className="language-select-group">
          <select
            value={currentTranslation.sourceLanguage || ''}
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
            <RotateCcw size={16} />
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

        {/* 模板选择器 */}
        <div className="template-selector">
          {templates.map(template => (
            <button
              key={template.id}
              className={`template-btn ${selectedTemplate === template.id ? 'active' : ''}`}
              onClick={() => setSelectedTemplate(template.id)}
              title={template.name}
            >
              <template.icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* 翻译主区域 (左右分栏) */}
      <div className="translation-areas">
        {/* 左侧：原文 */}
        <div 
          className={`translation-box source-box ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        >
          <div className="box-toolbar">
            <span className="box-title">原文</span>
            <div className="box-actions">
              <button className="action-btn" onClick={() => fileInputRef.current?.click()} title="导入">
                <Image size={15} />
              </button>
              <button className="action-btn" onClick={pasteFromClipboard} title="粘贴">
                <FileText size={15} />
              </button>
              <button className="action-btn" onClick={clearCurrent} title="清空">
                <RotateCcw size={15} />
              </button>
            </div>
          </div>

          <textarea
            ref={sourceTextareaRef}
            className="translation-textarea"
            value={currentTranslation.sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onPaste={handlePaste}
            placeholder={dragOver ? '释放文件以导入...' : '输入要翻译的文本...'}
            spellCheck={false}
            // 绑定快捷键 Ctrl+Enter
            onKeyDown={(e) => { if(e.ctrlKey && e.key === 'Enter') handleTranslate(); }}
          />

          <div className="box-footer">
            <span className="char-count">{(currentTranslation.sourceText || '').length} 字符</span>
          </div>
        </div>

        {/* 中间：翻译按钮 */}
        <div className="translation-controls">
          <button
            className={`translate-btn ${currentTranslation.status === 'translating' ? 'loading' : ''}`}
            onClick={handleTranslate}
            disabled={!currentTranslation.sourceText.trim() || currentTranslation.status === 'translating'}
          >
            {currentTranslation.status === 'translating' ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>翻译中</span>
              </>
            ) : (
              <>
                <Send size={18} />
                <span>翻译</span>
              </>
            )}
          </button>
          
          <div className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="indicator-dot"></div>
            <span>{isConnected ? '在线' : '离线'}</span>
          </div>
        </div>

        {/* 右侧：译文 */}
        <div className="translation-box target-box">
          <div className="box-toolbar">
            <span className="box-title">译文</span>
            <div className="box-actions">
              <button 
                className="action-btn" 
                onClick={() => copyToClipboard('translated') && notify('已复制', 'success')}
                disabled={!currentTranslation.translatedText}
                title="复制"
              >
                <Copy size={15} />
              </button>
              <button 
                className="action-btn" 
                onClick={() => addToFavorites() && notify('已收藏', 'success')}
                disabled={!currentTranslation.translatedText}
                title="收藏"
              >
                <Sparkles size={15} />
              </button>
              <button 
                className="action-btn" 
                title="导出 (未实现)"
                disabled={!currentTranslation.translatedText}
              >
                <Download size={15} />
              </button>
            </div>
          </div>

          <textarea
            className="translation-textarea"
            value={currentTranslation.translatedText}
            onChange={(e) => setTranslatedText(e.target.value)}
            placeholder="等待翻译..."
            spellCheck={false}
          />

          <div className="box-footer">
            {currentTranslation.translatedText && (
              <>
                <span className="char-count">{(currentTranslation.translatedText || '').length} 字符</span>
                {currentTranslation.metadata.duration && (
                  <span className="translation-time">
                    <Clock size={12} style={{marginRight:4}}/>
                    {(currentTranslation.metadata.duration / 1000).toFixed(2)}s
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 隐藏的文件 Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md,.doc,.docx"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />
    </div>
  );
};

export default TranslationPanel;