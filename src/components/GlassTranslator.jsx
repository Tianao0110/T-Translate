// src/components/GlassTranslator.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RefreshCw, MousePointer2, Hand, Pin, PinOff,
  X, Copy, Star, Loader2, AlertCircle, Minus, Plus, Check
} from 'lucide-react';

// 导入 OCR 和 LLM 服务
import ocrManager from '../services/ocr-manager';
import llmClient from '../utils/llm-client';

// 生成唯一 ID
const generateId = () => `glass-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * 翻译玻璃窗组件 - 双层窗口版本
 * 截图时显示缓存的上一次结果，新结果准备好后替换
 */
const GlassTranslator = () => {
  // 当前显示的翻译结果（用于显示）
  const [displayText, setDisplayText] = useState('');
  // 正在处理的翻译结果（后台处理）
  const [pendingText, setPendingText] = useState('');
  // OCR 识别的原文
  const [ocrText, setOcrText] = useState('');
  // 检测到的源语言
  const [detectedSourceLang, setDetectedSourceLang] = useState('');
  
  const [status, setStatus] = useState('idle'); // idle, capturing, recognizing, translating, done, error
  const [errorMessage, setErrorMessage] = useState('');
  const [isHidden, setIsHidden] = useState(false);
  
  // 控制状态
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isPassThrough, setIsPassThrough] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  const [opacity, setOpacity] = useState(0.85);
  const [showControls, setShowControls] = useState(true);
  
  // 从全局设置读取的配置
  const [refreshInterval, setRefreshInterval] = useState(3000);
  const [smartDetect, setSmartDetect] = useState(true);
  const [streamOutput, setStreamOutput] = useState(true);
  const [ocrEngine, setOcrEngine] = useState('llm-vision');
  const [targetLanguage, setTargetLanguage] = useState('zh');
  
  // 反馈状态
  const [copySuccess, setCopySuccess] = useState(false);
  const [favoriteSuccess, setFavoriteSuccess] = useState(false);
  
  // Refs
  const refreshTimerRef = useRef(null);
  const isCapturingRef = useRef(false);
  const containerRef = useRef(null);
  const lastImageHashRef = useRef(null);
  const lastOcrTextRef = useRef('');
  const settingsRef = useRef({});

  // 初始化
  useEffect(() => {
    loadSettings();
    initOCR();
    setupCaptureListeners();
    
    // 键盘快捷键
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        captureAndRecognize();
      } else if (e.code === 'Escape') {
        handleClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, []);

  // 初始化 OCR
  const initOCR = async () => {
    try {
      await ocrManager.init(ocrEngine);
      console.log('[Glass] OCR 初始化成功');
    } catch (error) {
      console.error('[Glass] OCR 初始化失败:', error);
    }
  };

  // 设置截图时隐藏/显示监听
  const setupCaptureListeners = () => {
    if (window.electron?.glass?.onHideForCapture) {
      window.electron.glass.onHideForCapture(() => {
        setIsHidden(true);
      });
    }
    if (window.electron?.glass?.onShowAfterCapture) {
      window.electron.glass.onShowAfterCapture(() => {
        setIsHidden(false);
      });
    }
  };

  // 自动刷新控制
  useEffect(() => {
    // 清除之前的定时器
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    
    // 只有在自动刷新开启时才启动定时器
    if (autoRefresh) {
      console.log('[Glass] 启动自动刷新，间隔:', refreshInterval, 'ms');
      refreshTimerRef.current = setInterval(() => {
        // 检查状态，防止重叠
        if (!isCapturingRef.current) {
          captureAndRecognize();
        }
      }, refreshInterval);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [autoRefresh, refreshInterval]);

  // 加载设置（从 main 进程获取合并后的设置）
  const loadSettings = async () => {
    try {
      console.log('[Glass] Loading settings...');
      
      if (window.electron?.glass?.getSettings) {
        const settings = await window.electron.glass.getSettings();
        console.log('[Glass] Received settings:', settings);
        
        if (settings) {
          setRefreshInterval(settings.refreshInterval ?? 3000);
          setSmartDetect(settings.smartDetect ?? true);
          setStreamOutput(settings.streamOutput ?? true);
          setOcrEngine(settings.ocrEngine ?? 'llm-vision');
          setOpacity(settings.opacity ?? settings.defaultOpacity ?? 0.85);
          setIsPinned(settings.isPinned ?? settings.autoPin ?? true);
          setTargetLanguage(settings.targetLanguage ?? 'zh');
          
          // 保存到 ref 供闭包使用
          settingsRef.current = settings;
          
          console.log('[Glass] Settings applied:', {
            refreshInterval: settings.refreshInterval,
            smartDetect: settings.smartDetect,
            streamOutput: settings.streamOutput,
            ocrEngine: settings.ocrEngine,
            targetLanguage: settings.targetLanguage
          });
        }
      } else {
        console.warn('[Glass] glass.getSettings not available');
      }
    } catch (error) {
      console.error('[Glass] Failed to load settings:', error);
    }
  };

  // 保存设置
  const saveSettings = useCallback(async (newSettings) => {
    if (window.electron?.glass?.saveSettings) {
      await window.electron.glass.saveSettings(newSettings);
    }
  }, []);

  // 简单的图像哈希（用于检测变化）
  const simpleImageHash = (dataUrl) => {
    if (!dataUrl) return null;
    return dataUrl.slice(100, 200);
  };

  // 截图并识别（双层窗口：显示层保持不变，后台处理新内容）
  const captureAndRecognize = useCallback(async () => {
    if (isCapturingRef.current) {
      console.log('[Glass] Already capturing, skip');
      return;
    }

    isCapturingRef.current = true;
    // 不改变 displayText，用户看到的是上一次结果
    setStatus('capturing');
    setErrorMessage('');

    try {
      if (!window.electron?.glass?.captureRegion) {
        throw new Error('截图功能不可用');
      }
      
      const bounds = await window.electron.glass.getBounds();
      if (!bounds) {
        throw new Error('无法获取窗口位置');
      }
      
      const controlBarHeight = 40;
      
      // 请求截图（此时窗口会短暂隐藏，但 displayText 保持显示）
      const result = await window.electron.glass.captureRegion({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height - controlBarHeight
      });
      
      if (result.success && result.imageData) {
        // 智能检测：检查图像是否变化
        const newHash = simpleImageHash(result.imageData);
        if (smartDetect && autoRefresh && newHash === lastImageHashRef.current) {
          console.log('[Glass] Image unchanged, skip OCR');
          setStatus('done');
          isCapturingRef.current = false;
          return;
        }
        lastImageHashRef.current = newHash;
        
        // OCR 识别
        setStatus('recognizing');
        const ocrResult = await ocrManager.recognize(result.imageData, {
          engine: ocrEngine
        });
        
        if (ocrResult.success && ocrResult.text) {
          const recognizedText = ocrResult.text.trim();
          
          // 智能检测：检查文字是否变化
          if (smartDetect && autoRefresh && recognizedText === lastOcrTextRef.current) {
            console.log('[Glass] Text unchanged, skip translation');
            setStatus('done');
            isCapturingRef.current = false;
            return;
          }
          lastOcrTextRef.current = recognizedText;
          setOcrText(recognizedText);
          
          // 检测源语言
          const sourceLang = detectLanguage(recognizedText);
          setDetectedSourceLang(sourceLang);
          
          if (recognizedText.length > 0) {
            setStatus('translating');
            
            // 翻译（结果会更新到 pendingText 或直接到 displayText）
            const translationResult = await translateText(recognizedText, sourceLang);
            
            if (translationResult.success) {
              // 翻译完成，更新显示层
              setDisplayText(translationResult.text);
              setStatus('done');
            } else {
              throw new Error(translationResult.error || '翻译失败');
            }
          } else {
            setDisplayText('（未识别到文字）');
            setStatus('done');
          }
        } else {
          throw new Error(ocrResult.error || 'OCR 识别失败');
        }
      } else {
        throw new Error(result.error || '截图失败');
      }
    } catch (error) {
      console.error('[Glass] Capture error:', error);
      setErrorMessage(error.message);
      setStatus('error');
    } finally {
      // 确保重置标志位
      isCapturingRef.current = false;
    }
  }, [ocrEngine, autoRefresh, smartDetect, streamOutput, targetLanguage]);

  // 检测源语言
  const detectLanguage = (text) => {
    // 简单检测：如果包含大量中文字符，认为是中文
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    const ratio = chineseChars.length / text.length;
    return ratio > 0.3 ? 'zh' : 'en';
  };

  // 翻译文本（支持流式/普通模式）
  const translateText = async (text, sourceLang) => {
    // 决定翻译方向：中文→英文，其他→目标语言
    const targetLang = sourceLang === 'zh' ? 'en' : targetLanguage;
    
    const langNames = {
      'zh': '中文',
      'en': '英文',
      'ja': '日文',
      'ko': '韩文',
      'fr': '法文',
      'de': '德文',
      'es': '西班牙文',
      'ru': '俄文'
    };
    
    const targetLangName = langNames[targetLang] || targetLang;
    
    const systemPrompt = `你是一个专业翻译助手。请将以下文本翻译成${targetLangName}。

重要要求：
1. 保留原文的格式和排版（包括换行、列表、段落等）
2. 只输出翻译结果，不要添加任何解释
3. 如果原文有编号列表，翻译后也要保持编号列表格式`;

    console.log('[Glass] Translating:', { streamOutput, sourceLang, targetLang });

    try {
      if (streamOutput) {
        // 流式输出 - 直接更新 displayText
        let fullText = '';
        
        const stream = llmClient.streamChat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]);
        
        for await (const chunk of stream) {
          fullText += chunk;
          setDisplayText(fullText); // 流式更新显示层
        }
        
        if (fullText) {
          return { success: true, text: fullText.trim(), targetLang };
        } else {
          throw new Error('翻译响应为空');
        }
      } else {
        // 普通模式 - 完成后一次性更新
        const result = await llmClient.chatCompletion([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]);
        
        if (result?.content) {
          return { success: true, text: result.content.trim(), targetLang };
        } else {
          throw new Error('翻译响应为空');
        }
      }
    } catch (error) {
      console.error('[Glass] Translation error:', error);
      return { success: false, error: error.message };
    }
  };

  // 手动刷新
  const handleRefresh = () => {
    captureAndRecognize();
  };

  // 切换自动刷新
  const toggleAutoRefresh = () => {
    const newValue = !autoRefresh;
    setAutoRefresh(newValue);
    if (!newValue) {
      // 关闭自动刷新时重置状态
      isCapturingRef.current = false;
    }
  };

  // 切换穿透模式
  const togglePassThrough = useCallback(() => {
    const newValue = !isPassThrough;
    
    // 先禁用穿透，确保状态能正确切换
    if (window.electron?.glass?.setIgnoreMouse) {
      window.electron.glass.setIgnoreMouse(false);
    }
    
    // 更新状态
    setIsPassThrough(newValue);
    
    // 设置穿透模式
    if (window.electron?.glass?.setPassThrough) {
      window.electron.glass.setPassThrough(newValue);
    }
    
    // 穿透模式下始终显示控制栏
    if (newValue) {
      setShowControls(true);
    }
  }, [isPassThrough]);

  // 鼠标移动处理 - 穿透模式下动态切换
  const handleMouseMove = useCallback((e) => {
    if (!isPassThrough) return;
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    
    // 控制栏高度 40px
    const controlBarTop = rect.height - 40;
    const mouseY = e.clientY - rect.top;
    
    // 鼠标在控制栏区域时，禁用穿透
    const inControlBar = mouseY >= controlBarTop;
    
    if (window.electron?.glass?.setIgnoreMouse) {
      // 在控制栏区域时不穿透，其他区域穿透
      window.electron.glass.setIgnoreMouse(!inControlBar);
    }
  }, [isPassThrough]);

  // 鼠标离开窗口
  const handleMouseLeave = useCallback(() => {
    if (isPassThrough && window.electron?.glass?.setIgnoreMouse) {
      // 鼠标离开时恢复穿透
      window.electron.glass.setIgnoreMouse(true);
    }
  }, [isPassThrough]);

  // 切换置顶
  const togglePinned = () => {
    const newValue = !isPinned;
    setIsPinned(newValue);
    if (window.electron?.glass?.setAlwaysOnTop) {
      window.electron.glass.setAlwaysOnTop(newValue);
    }
    saveSettings({ isPinned: newValue });
  };

  // 调节透明度
  const adjustOpacity = (delta) => {
    const newOpacity = Math.max(0.3, Math.min(1, opacity + delta));
    setOpacity(newOpacity);
    saveSettings({ opacity: newOpacity });
  };

  // 复制翻译结果
  const handleCopy = async () => {
    if (displayText) {
      try {
        if (window.electron?.clipboard?.writeText) {
          await window.electron.clipboard.writeText(displayText);
        } else {
          await navigator.clipboard.writeText(displayText);
        }
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500);
        console.log('[Glass] Copied to clipboard');
      } catch (error) {
        console.error('[Glass] Copy failed:', error);
      }
    }
  };

  // 收藏（包含完整信息以支持 AI 标签等功能）
  const handleFavorite = async () => {
    if (displayText && ocrText) {
      try {
        const favoriteItem = {
          id: generateId(),
          sourceText: ocrText,
          translatedText: displayText,
          sourceLanguage: detectedSourceLang || 'auto',
          targetLanguage: detectedSourceLang === 'zh' ? 'en' : targetLanguage,
          timestamp: Date.now(),
          tags: [],  // 空标签，可以后续通过 AI 生成
          folderId: null,
          isStyleReference: false,
          source: 'glass-translator'  // 标记来源
        };
        
        console.log('[Glass] Adding to favorites:', favoriteItem);
        
        if (window.electron?.glass?.addToFavorites) {
          await window.electron.glass.addToFavorites(favoriteItem);
          setFavoriteSuccess(true);
          setTimeout(() => setFavoriteSuccess(false), 1500);
          console.log('[Glass] Added to favorites successfully');
        }
      } catch (error) {
        console.error('[Glass] Favorite failed:', error);
      }
    }
  };

  // 关闭窗口
  const handleClose = () => {
    // 先停止自动刷新
    setAutoRefresh(false);
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
    }
    
    if (window.electron?.glass?.close) {
      window.electron.glass.close();
    }
  };

  // 获取状态显示文字
  const getStatusText = () => {
    switch (status) {
      case 'capturing': return '截图中...';
      case 'recognizing': return '识别中...';
      case 'translating': return '翻译中...';
      case 'done': return '';
      case 'error': return errorMessage;
      default: return '点击 🔄 开始';
    }
  };

  // 是否正在加载
  const isLoading = ['capturing', 'recognizing', 'translating'].includes(status);

  return (
    <div 
      ref={containerRef}
      className={`glass-container ${isPassThrough ? 'pass-through-mode' : ''} ${isHidden ? 'capturing-mode' : ''}`}
      style={{ '--glass-opacity': opacity }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => {
        if (!isPassThrough) setShowControls(false);
        handleMouseLeave();
      }}
      onMouseMove={handleMouseMove}
    >
      {/* 拖动区域 */}
      <div className="glass-drag-region" />

      {/* 翻译结果区域 - 双层窗口：始终显示 displayText */}
      <div className="glass-content">
        {status === 'error' ? (
          <div className="glass-error">
            <AlertCircle size={20} />
            <span>{errorMessage}</span>
          </div>
        ) : displayText ? (
          <>
            <div className="glass-text">
              {displayText}
            </div>
            {/* 加载指示器（覆盖在文字上方） */}
            {isLoading && (
              <div className="glass-loading-overlay">
                <Loader2 className="spinning" size={16} />
                <span>{getStatusText()}</span>
              </div>
            )}
          </>
        ) : isLoading ? (
          <div className="glass-loading">
            <Loader2 className="spinning" size={24} />
            <span>{getStatusText()}</span>
          </div>
        ) : (
          <div className="glass-placeholder">
            <span>🔲 将窗口移动到要翻译的区域</span>
            <span>点击 🔄 或按 Space 开始识别</span>
          </div>
        )}
      </div>

      {/* 底部控制栏 */}
      <div className={`glass-controls ${showControls ? 'visible' : ''}`}>
        <div className="controls-left">
          {/* 自动刷新 */}
          <button
            className={`control-btn ${autoRefresh ? 'active' : ''}`}
            onClick={toggleAutoRefresh}
            title={autoRefresh ? '暂停自动刷新' : '开启自动刷新'}
          >
            {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
            <span>{autoRefresh ? '自动' : '手动'}</span>
          </button>

          {/* 手动刷新 */}
          <button
            className="control-btn"
            onClick={handleRefresh}
            disabled={isLoading}
            title="刷新 (Space)"
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>

          {/* 穿透模式 */}
          <button
            className={`control-btn ${isPassThrough ? 'active' : ''}`}
            onClick={togglePassThrough}
            title={isPassThrough ? '关闭穿透' : '开启穿透'}
          >
            {isPassThrough ? <Hand size={14} /> : <MousePointer2 size={14} />}
          </button>

          {/* 置顶 */}
          <button
            className={`control-btn ${isPinned ? 'active' : ''}`}
            onClick={togglePinned}
            title={isPinned ? '取消置顶' : '置顶'}
          >
            {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
        </div>

        <div className="controls-center">
          {/* 状态显示 */}
          {status !== 'done' && status !== 'idle' && (
            <span className="status-text">{getStatusText()}</span>
          )}
        </div>

        <div className="controls-right">
          {/* 透明度调节 */}
          <button
            className="control-btn small"
            onClick={() => adjustOpacity(-0.1)}
            title="减少透明度"
          >
            <Minus size={12} />
          </button>
          <button
            className="control-btn small"
            onClick={() => adjustOpacity(0.1)}
            title="增加透明度"
          >
            <Plus size={12} />
          </button>

          {/* 复制 */}
          <button
            className={`control-btn ${copySuccess ? 'success' : ''}`}
            onClick={handleCopy}
            disabled={!displayText}
            title="复制"
          >
            {copySuccess ? <Check size={14} /> : <Copy size={14} />}
          </button>

          {/* 收藏 */}
          <button
            className={`control-btn ${favoriteSuccess ? 'success' : ''}`}
            onClick={handleFavorite}
            disabled={!displayText || !ocrText}
            title="收藏"
          >
            {favoriteSuccess ? <Check size={14} /> : <Star size={14} />}
          </button>

          {/* 关闭 */}
          <button
            className="control-btn close"
            onClick={handleClose}
            title="关闭 (Esc)"
          >
            <X size={14} />
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
