// src/components/GlassTranslator.jsx
// 玻璃翻译窗口 - v25
import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, RefreshCw, Pin, PinOff,
  X, Copy, Star, Loader2, AlertCircle, Minus, Plus, Check,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight
} from 'lucide-react';

import ocrManager from '../services/ocr-manager';
import llmClient from '../utils/llm-client';

const generateId = () => `glass-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// 支持的语言列表
const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
];

const GlassTranslator = () => {
  // 翻译内容
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [detectedSourceLang, setDetectedSourceLang] = useState('');
  
  // 状态
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // 控制
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  const [opacity, setOpacity] = useState(0.85);
  
  // 主题
  const [theme, setTheme] = useState('light');
  
  // 滚动状态
  const [hasOverflow, setHasOverflow] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  
  // 设置
  const [refreshInterval, setRefreshInterval] = useState(3000);
  const [smartDetect, setSmartDetect] = useState(true);
  const [streamOutput, setStreamOutput] = useState(true);
  const [ocrEngine, setOcrEngine] = useState('llm-vision');  // 将从全局设置加载
  const [sourceLanguage, setSourceLanguage] = useState('auto');  // 原文语言
  const [targetLanguage, setTargetLanguage] = useState('en');
  
  // 反馈
  const [copySuccess, setCopySuccess] = useState(false);
  const [favoriteSuccess, setFavoriteSuccess] = useState(false);
  
  // Refs
  const contentRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const isCapturingRef = useRef(false);
  const lastImageHashRef = useRef(null);
  const lastTextRef = useRef('');

  // 初始化
  useEffect(() => {
    loadSettings();
    initOCR();
    
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleRefresh();
      } else if (e.code === 'Escape') {
        handleClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 自动刷新
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(() => {
        if (!isCapturingRef.current) {
          captureAndTranslate();
        }
      }, refreshInterval);
    }
    
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [autoRefresh, refreshInterval]);

  const initOCR = async () => {
    try {
      await ocrManager.init(ocrEngine);
    } catch (error) {
      console.error('[Glass] OCR init failed:', error);
    }
  };

  const loadSettings = async () => {
    try {
      if (!window.electron?.glass?.getSettings) return;
      
      const settings = await window.electron.glass.getSettings();
      if (settings) {
        setRefreshInterval(settings.refreshInterval ?? 3000);
        setSmartDetect(settings.smartDetect ?? true);
        setStreamOutput(settings.streamOutput ?? true);
        // 使用全局 OCR 设置
        setOcrEngine(settings.ocrEngine ?? settings.globalOcrEngine ?? 'llm-vision');
        setSourceLanguage(settings.sourceLanguage ?? 'auto');
        setOpacity(settings.opacity ?? 0.85);
        setIsPinned(settings.isPinned ?? true);
        setTargetLanguage(settings.targetLanguage ?? 'en');
        // 加载主题
        setTheme(settings.theme ?? 'light');
      }
    } catch (error) {
      console.error('[Glass] Load settings failed:', error);
    }
  };

  const saveSettings = async (newSettings) => {
    if (window.electron?.glass?.saveSettings) {
      await window.electron.glass.saveSettings(newSettings);
    }
  };

  const imageHash = (dataUrl) => {
    if (!dataUrl) return null;
    return dataUrl.slice(100, 300);
  };

  const detectLanguage = (text) => {
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    return chineseChars.length / text.length > 0.3 ? 'zh' : 'en';
  };

  // 截图并翻译
  const captureAndTranslate = async () => {
    if (isCapturingRef.current) return;
    
    isCapturingRef.current = true;
    setStatus('capturing');
    setErrorMessage('');
    
    try {
      const bounds = await window.electron.glass.getBounds();
      if (!bounds) throw new Error('无法获取窗口位置');
      
      // 底部控制栏高度
      const bottomBarHeight = 44;
      
      const result = await window.electron.glass.captureRegion({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height - bottomBarHeight
      });
      
      if (!result.success) throw new Error(result.error || '截图失败');
      
      // 智能检测
      const hash = imageHash(result.imageData);
      if (smartDetect && autoRefresh && hash === lastImageHashRef.current) {
        setStatus('done');
        isCapturingRef.current = false;
        return;
      }
      lastImageHashRef.current = hash;
      
      // OCR - 传递语言设置以便自动选择识别语言
      setStatus('recognizing');
      const ocrResult = await ocrManager.recognize(result.imageData, { 
        engine: ocrEngine,
        settings: {
          sourceLanguage: sourceLanguage,
          recognitionLanguage: 'auto',  // 使用自动模式
        }
      });
      
      if (!ocrResult.success) throw new Error(ocrResult.error || 'OCR 失败');
      
      const text = ocrResult.text?.trim();
      if (!text) {
        setTranslatedText('（未识别到文字）');
        setStatus('done');
        isCapturingRef.current = false;
        return;
      }
      
      if (smartDetect && autoRefresh && text === lastTextRef.current) {
        setStatus('done');
        isCapturingRef.current = false;
        return;
      }
      lastTextRef.current = text;
      setSourceText(text);
      
      const sourceLang = detectLanguage(text);
      setDetectedSourceLang(sourceLang);
      
      // 翻译 - 使用用户选择的目标语言
      setStatus('translating');
      // 如果源语言和目标语言相同，自动切换
      const actualTargetLang = sourceLang === targetLanguage 
        ? (targetLanguage === 'zh' ? 'en' : 'zh')
        : targetLanguage;
      
      const langNames = {
        'zh': '中文', 'en': '英文', 'ja': '日文', 'ko': '韩文',
        'fr': '法文', 'de': '德文', 'es': '西班牙文', 'ru': '俄文'
      };
      
      // OCR 纠错翻译 Prompt
      const systemPrompt = `你是一个具备 OCR 纠错能力的专业翻译助手。

以下文本是从图像中通过 OCR 技术识别出来的，可能包含识别错误，例如：
- 字符混淆（如 '0' 和 'O'、'1' 和 'l'、'rn' 和 'm'）
- 多余或缺失的空格
- 断开的单词或句子
- 复杂排版导致的乱码

任务：将这段 OCR 文本翻译成${langNames[actualTargetLang] || actualTargetLang}。

处理流程：
1. 首先根据上下文默默纠正明显的 OCR 错误
2. 然后将纠正后的文本自然地翻译
3. 只输出最终翻译结果，不要解释

规则：
- 静默修复 OCR 错误，不要提及
- 保持原文的意思和语气
- 使用自然流畅的语言
- 如果某个词无法辨认，根据上下文推断或优雅地跳过

只输出翻译结果，不要任何前言或注释。`;

      let finalText = '';
      
      if (streamOutput) {
        setTranslatedText('');
        const stream = llmClient.streamChat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]);
        
        for await (const chunk of stream) {
          finalText += chunk;
          setTranslatedText(finalText);
        }
      } else {
        const response = await llmClient.chatCompletion([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]);
        finalText = response?.content?.trim() || '';
        setTranslatedText(finalText);
      }
      
      setStatus('done');
      
      // 添加到历史记录
      if (finalText && window.electron?.glass?.addToHistory) {
        try {
          await window.electron.glass.addToHistory({
            id: generateId(),
            sourceText: text,
            translatedText: finalText,
            sourceLanguage: sourceLang,
            targetLanguage: actualTargetLang,
            timestamp: Date.now(),
            source: 'glass-translator'
          });
        } catch (e) {
          console.error('[Glass] History error:', e);
        }
      }
      
    } catch (error) {
      console.error('[Glass] Error:', error);
      
      // 友好错误提示
      let friendlyMessage = error.message;
      if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
        friendlyMessage = '无法连接翻译服务，请确保 LM Studio 已启动';
      } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        friendlyMessage = '翻译超时，模型可能正在加载中';
      } else if (error.message.includes('Invalid') || error.message.includes('format')) {
        friendlyMessage = '翻译响应格式错误，请检查模型是否正常';
      }
      
      setErrorMessage(friendlyMessage);
      setStatus('error');
    } finally {
      isCapturingRef.current = false;
    }
  };

  const handleRefresh = () => captureAndTranslate();
  
  const toggleAutoRefresh = () => setAutoRefresh(!autoRefresh);
  
  const togglePinned = () => {
    const newValue = !isPinned;
    setIsPinned(newValue);
    window.electron?.glass?.setAlwaysOnTop?.(newValue);
    saveSettings({ isPinned: newValue });
  };

  const adjustOpacity = (delta) => {
    const newOpacity = Math.max(0.3, Math.min(1, opacity + delta));
    setOpacity(newOpacity);
    saveSettings({ opacity: newOpacity });
  };

  const handleCopy = async () => {
    if (!translatedText) return;
    try {
      if (window.electron?.clipboard?.writeText) {
        await window.electron.clipboard.writeText(translatedText);
      } else {
        await navigator.clipboard.writeText(translatedText);
      }
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    } catch (error) {
      console.error('[Glass] Copy failed:', error);
    }
  };

  const handleFavorite = async () => {
    if (!translatedText || !sourceText) return;
    try {
      if (window.electron?.glass?.addToFavorites) {
        await window.electron.glass.addToFavorites({
          id: generateId(),
          sourceText,
          translatedText,
          sourceLanguage: detectedSourceLang || 'auto',
          targetLanguage,
          timestamp: Date.now(),
          tags: [],
          folderId: null,
          isStyleReference: false,
          source: 'glass-translator'
        });
        setFavoriteSuccess(true);
        setTimeout(() => setFavoriteSuccess(false), 1500);
      }
    } catch (error) {
      console.error('[Glass] Favorite failed:', error);
    }
  };

  const handleClose = () => window.electron?.glass?.close?.();

  // 左右切换语言
  const switchLanguage = (direction) => {
    const currentIndex = LANGUAGES.findIndex(l => l.code === targetLanguage);
    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = LANGUAGES.length - 1;
    if (newIndex >= LANGUAGES.length) newIndex = 0;
    const newLang = LANGUAGES[newIndex].code;
    setTargetLanguage(newLang);
    saveSettings({ targetLanguage: newLang });
    
    // 同步到主程序
    if (window.electron?.glass?.syncTargetLanguage) {
      window.electron.glass.syncTargetLanguage(newLang);
    }
  };

  // 检测内容是否溢出
  const checkOverflow = () => {
    if (contentRef.current) {
      const el = contentRef.current;
      const overflow = el.scrollHeight > el.clientHeight;
      setHasOverflow(overflow);
      setCanScrollUp(el.scrollTop > 0);
      setCanScrollDown(el.scrollTop < el.scrollHeight - el.clientHeight - 1);
    }
  };

  // 内容变化时检测溢出
  useEffect(() => {
    checkOverflow();
  }, [translatedText]);

  // 控制栏滚动
  const handleToolbarScroll = (e) => {
    if (contentRef.current) {
      contentRef.current.scrollTop += e.deltaY;
      checkOverflow();
    }
  };

  // 按钮滚动
  const scrollContent = (delta) => {
    if (contentRef.current) {
      contentRef.current.scrollTop += delta;
      checkOverflow();
    }
  };

  const isLoading = ['capturing', 'recognizing', 'translating'].includes(status);
  
  const getStatusText = () => {
    switch (status) {
      case 'capturing': return '截图中...';
      case 'recognizing': return '识别中...';
      case 'translating': return '翻译中...';
      default: return '';
    }
  };

  const currentLang = LANGUAGES.find(l => l.code === targetLanguage) || LANGUAGES[0];

  return (
    <div className="glass-window" style={{ '--glass-opacity': opacity }} data-theme={theme}>
      {/* 整个内容区域可拖动 */}
      <div className="glass-drag-area" />
      
      {/* 悬浮关闭按钮（始终可见） */}
      <button className="glass-close-float" onClick={handleClose} title="关闭 (Esc)">
        <X size={14} />
      </button>
      
      {/* 内容区域 */}
      <div className="glass-body">
        {status === 'error' ? (
          <div className="glass-message error">
            <AlertCircle size={20} />
            <span>{errorMessage}</span>
          </div>
        ) : translatedText ? (
          <div className="glass-result" ref={contentRef}>
            {translatedText}
          </div>
        ) : isLoading ? (
          <div className="glass-message loading">
            <Loader2 className="spin" size={24} />
            <span>{getStatusText()}</span>
          </div>
        ) : (
          <div className="glass-message placeholder">
            <span>将窗口移动到要翻译的区域</span>
            <span>点击 🔄 或按 Space 开始</span>
          </div>
        )}
      </div>

      {/* 底部控制栏 - 可滚动内容 */}
      <div className="glass-toolbar" onWheel={handleToolbarScroll}>
        <div className="toolbar-left">
          {/* 语言选择器 - 左右切换 */}
          <div className="lang-switcher">
            <button
              className="btn sm"
              onClick={() => switchLanguage(-1)}
              title="上一个语言"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="lang-display" title={currentLang.name}>
              {currentLang.flag} {currentLang.code.toUpperCase()}
            </span>
            <button
              className="btn sm"
              onClick={() => switchLanguage(1)}
              title="下一个语言"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <button
            className={`btn ${autoRefresh ? 'active' : ''}`}
            onClick={toggleAutoRefresh}
            title={autoRefresh ? '暂停' : '自动刷新'}
          >
            {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <button
            className="btn"
            onClick={handleRefresh}
            disabled={isLoading}
            title="刷新 (Space)"
          >
            <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
          </button>

          <button
            className={`btn ${isPinned ? 'active' : ''}`}
            onClick={togglePinned}
            title={isPinned ? '取消置顶' : '置顶'}
          >
            {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
        </div>

        {/* 中间：滚动控制（内容超出时显示） */}
        {hasOverflow && (
          <div className="toolbar-center">
            <button 
              className="btn sm scroll-btn" 
              onClick={() => scrollContent(-50)}
              disabled={!canScrollUp}
              title="向上滚动"
            >
              <ChevronUp size={14} />
            </button>
            <button 
              className="btn sm scroll-btn" 
              onClick={() => scrollContent(50)}
              disabled={!canScrollDown}
              title="向下滚动"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        <div className="toolbar-right">
          <button className="btn sm" onClick={() => adjustOpacity(-0.1)} title="减少透明度">
            <Minus size={12} />
          </button>
          <button className="btn sm" onClick={() => adjustOpacity(0.1)} title="增加透明度">
            <Plus size={12} />
          </button>

          <button
            className={`btn ${copySuccess ? 'success' : ''}`}
            onClick={handleCopy}
            disabled={!translatedText}
            title="复制"
          >
            {copySuccess ? <Check size={14} /> : <Copy size={14} />}
          </button>

          <button
            className={`btn ${favoriteSuccess ? 'success' : ''}`}
            onClick={handleFavorite}
            disabled={!translatedText || !sourceText}
            title="收藏"
          >
            {favoriteSuccess ? <Check size={14} /> : <Star size={14} />}
          </button>
        </div>
      </div>

      {/* 缩放手柄 */}
      <div className="resize-handle resize-n" />
      <div className="resize-handle resize-s" />
      <div className="resize-handle resize-e" />
      <div className="resize-handle resize-w" />
      <div className="resize-handle resize-ne" />
      <div className="resize-handle resize-nw" />
      <div className="resize-handle resize-se" />
      <div className="resize-handle resize-sw" />
    </div>
  );
};

export default GlassTranslator;
