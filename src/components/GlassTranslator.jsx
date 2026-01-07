// src/components/GlassTranslator.jsx
// 玻璃翻译窗口 - v30 (修复透明度和采集区)
import React, { useState, useEffect, useRef } from 'react';
import { Camera, Film, Square, X, Loader2, AlertCircle, ChevronDown, GripHorizontal, Monitor } from 'lucide-react';

import ocrManager from '../services/ocr-manager';
import llmClient from '../utils/llm-client';

const GlassTranslator = () => {
  // ========== 核心状态 ==========
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | capturing | recognizing | translating | error | subtitle
  const [errorMessage, setErrorMessage] = useState('');
  
  // ========== 设置（从主程序同步）==========
  const [opacity, setOpacity] = useState(0.85);
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [lockTargetLang, setLockTargetLang] = useState(true);
  const [ocrEngine, setOcrEngine] = useState('llm-vision');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  
  // ========== UI 状态 ==========
  const [showCloseBtn, setShowCloseBtn] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const closeBtnTimerRef = useRef(null);
  
  // ========== 字幕模式 ==========
  const [subtitleMode, setSubtitleMode] = useState(false);
  const [subtitleStats, setSubtitleStats] = useState({
    status: 'idle', // idle | listening | recognizing | translating
    skipped: 0,
    processed: 0,
  });
  const [prevSubtitle, setPrevSubtitle] = useState('');
  const [currSubtitle, setCurrSubtitle] = useState('');
  const currSubtitleRef = useRef('');
  const [captureRect, setCaptureRect] = useState(null);
  
  // ========== Refs ==========
  const contentRef = useRef(null);
  const isCapturingRef = useRef(false);
  const lastImageHashRef = useRef(null);
  const lastTextRef = useRef('');
  
  // 字幕模式 Refs
  const subtitleTimerRef = useRef(null);
  const subtitleWorkerRef = useRef(null);
  const lastSubtitleHashRef = useRef(null);
  const lastSubtitleTextRef = useRef('');
  const subtitleFrameCountRef = useRef(0);
  const subtitleStartTimeRef = useRef(null);

  // ========== 初始化 ==========
  useEffect(() => {
    loadSettings();
    initOCR();
    initSubtitleWorker();
    loadCaptureRect();
    
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (!subtitleMode) {
          captureAndTranslate();
        }
      } else if (e.code === 'Escape') {
        if (subtitleMode) {
          stopSubtitleMode();
        } else {
          handleClose();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    // 监听采集区更新
    let unsubscribe = null;
    if (window.electron?.subtitle?.onCaptureRectUpdated) {
      unsubscribe = window.electron.subtitle.onCaptureRectUpdated((rect) => {
        setCaptureRect(rect);
      });
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (subtitleWorkerRef.current) {
        subtitleWorkerRef.current.terminate();
      }
      if (unsubscribe) unsubscribe();
      if (closeBtnTimerRef.current) clearTimeout(closeBtnTimerRef.current);
    };
  }, []);

  // ========== 检查内容溢出 ==========
  useEffect(() => {
    const checkOverflow = () => {
      if (contentRef.current) {
        const { scrollHeight, clientHeight } = contentRef.current;
        setHasOverflow(scrollHeight > clientHeight);
      }
    };
    checkOverflow();
  }, [translatedText, currSubtitle]);

  // ========== 加载设置 ==========
  const loadSettings = async () => {
    try {
      if (!window.electron?.glass?.getSettings) return;
      const settings = await window.electron.glass.getSettings();
      if (settings) {
        setOpacity(settings.opacity ?? 0.85);
        setTargetLanguage(settings.targetLanguage ?? 'zh');
        setLockTargetLang(settings.lockTargetLang ?? true);
        setOcrEngine(settings.ocrEngine ?? settings.globalOcrEngine ?? 'llm-vision');
        setSourceLanguage(settings.sourceLanguage ?? 'auto');
      }
    } catch (error) {
      console.error('[Glass] Load settings failed:', error);
    }
  };

  const initOCR = async () => {
    try {
      await ocrManager.init(ocrEngine);
    } catch (error) {
      console.error('[Glass] OCR init failed:', error);
    }
  };

  const loadCaptureRect = async () => {
    try {
      if (!window.electron?.subtitle?.getCaptureRect) return;
      const rect = await window.electron.subtitle.getCaptureRect();
      if (rect) setCaptureRect(rect);
    } catch (error) {
      console.error('[Glass] Load capture rect failed:', error);
    }
  };

  // ========== 关闭按钮显示逻辑 ==========
  const handleMouseEnterTop = () => {
    if (closeBtnTimerRef.current) {
      clearTimeout(closeBtnTimerRef.current);
    }
    setShowCloseBtn(true);
  };

  const handleMouseLeaveTop = () => {
    closeBtnTimerRef.current = setTimeout(() => {
      setShowCloseBtn(false);
    }, 2000);
  };

  const handleClose = () => {
    if (subtitleMode) {
      stopSubtitleMode();
    } else {
      window.electron?.glass?.close?.();
    }
  };

  // ========== 小横条点击透明度 ==========
  const handleBarClick = () => {
    setShowOpacitySlider(!showOpacitySlider);
  };

  const handleOpacityChange = async (e) => {
    const newOpacity = parseFloat(e.target.value);
    setOpacity(newOpacity);
    // 实时设置窗口透明度
    if (window.electron?.glass?.setOpacity) {
      await window.electron.glass.setOpacity(newOpacity);
    }
  };

  // ========== 采集区设置 ==========
  const openCaptureWindow = async () => {
    console.log('[Glass] Opening capture window...');
    try {
      if (window.electron?.subtitle?.toggleCaptureWindow) {
        const result = await window.electron.subtitle.toggleCaptureWindow();
        console.log('[Glass] toggleCaptureWindow result:', result);
      } else {
        console.error('[Glass] toggleCaptureWindow not available in window.electron.subtitle');
        console.log('[Glass] window.electron:', window.electron);
        console.log('[Glass] window.electron.subtitle:', window.electron?.subtitle);
      }
    } catch (e) {
      console.error('[Glass] Failed to open capture window:', e);
    }
  };

  // ========== 截图识别 ==========
  const captureAndTranslate = async () => {
    if (isCapturingRef.current || subtitleMode) return;
    
    isCapturingRef.current = true;
    setStatus('capturing');
    setErrorMessage('');
    
    try {
      const bounds = await window.electron.glass.getBounds();
      if (!bounds) throw new Error('无法获取窗口位置');
      
      // 顶部工具栏高度
      const topBarHeight = 40;
      
      const result = await window.electron.glass.captureRegion({
        x: bounds.x,
        y: bounds.y + topBarHeight,
        width: bounds.width,
        height: bounds.height - topBarHeight
      });
      
      if (!result.success) throw new Error(result.error || '截图失败');
      
      // OCR
      setStatus('recognizing');
      const ocrResult = await ocrManager.recognize(result.imageData, { 
        engine: ocrEngine,
        settings: { sourceLanguage, recognitionLanguage: 'auto' }
      });
      
      if (!ocrResult.success) throw new Error(ocrResult.error || 'OCR 失败');
      
      const text = ocrResult.text?.trim();
      if (!text) {
        setTranslatedText('（未识别到文字）');
        setStatus('idle');
        isCapturingRef.current = false;
        return;
      }
      
      setSourceText(text);
      
      // 翻译
      setStatus('translating');
      const sourceLang = detectLanguage(text);
      let actualTargetLang = targetLanguage;
      if (!lockTargetLang && sourceLang === targetLanguage) {
        actualTargetLang = targetLanguage === 'zh' ? 'en' : 'zh';
      }
      
      const langNames = { 'zh': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어' };
      const response = await llmClient.chatCompletion([
        { role: 'system', content: `翻译成${langNames[actualTargetLang] || actualTargetLang}，只输出翻译结果：` },
        { role: 'user', content: text }
      ]);
      
      const translatedResult = response?.content?.trim() || '';
      if (translatedResult) {
        setTranslatedText(translatedResult);
        // 保存历史
        if (window.electron?.glass?.addToHistory) {
          await window.electron.glass.addToHistory({
            id: `glass-${Date.now()}`,
            source: text,
            translated: translatedResult,
            sourceLang,
            targetLang: actualTargetLang,
            timestamp: Date.now(),
          });
        }
      }
      
      setStatus('idle');
    } catch (error) {
      console.error('[Glass] Capture error:', error);
      setErrorMessage(error.message);
      setStatus('error');
    } finally {
      isCapturingRef.current = false;
    }
  };

  // ========== 字幕模式 ==========
  const initSubtitleWorker = () => {
    const workerCode = `
      function calculateDHash(imageData, width, height) {
        const resizedWidth = 9, resizedHeight = 8;
        const grayscale = new Uint8Array(resizedWidth * resizedHeight);
        const xRatio = width / resizedWidth;
        const yRatio = height / resizedHeight;
        
        for (let y = 0; y < resizedHeight; y++) {
          for (let x = 0; x < resizedWidth; x++) {
            const srcX = Math.floor(x * xRatio);
            const srcY = Math.floor(y * yRatio);
            const idx = (srcY * width + srcX) * 4;
            const r = imageData[idx], g = imageData[idx + 1], b = imageData[idx + 2];
            grayscale[y * resizedWidth + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          }
        }
        
        let hash = '';
        for (let y = 0; y < resizedHeight; y++) {
          for (let x = 0; x < resizedWidth - 1; x++) {
            hash += grayscale[y * resizedWidth + x] > grayscale[y * resizedWidth + x + 1] ? '1' : '0';
          }
        }
        return hash;
      }
      
      function hammingDistance(hash1, hash2) {
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
          if (hash1[i] !== hash2[i]) distance++;
        }
        return distance;
      }
      
      function textSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0) return 100;
        
        let prev = Array.from({length: str2.length + 1}, (_, i) => i);
        let curr = new Array(str2.length + 1);
        
        for (let i = 1; i <= str1.length; i++) {
          curr[0] = i;
          for (let j = 1; j <= str2.length; j++) {
            const cost = str1[i-1] === str2[j-1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j-1] + 1, prev[j-1] + cost);
          }
          [prev, curr] = [curr, prev];
        }
        
        return Math.round((1 - prev[str2.length] / maxLen) * 100);
      }
      
      self.onmessage = function(e) {
        const { type, data, id } = e.data;
        let result;
        
        switch (type) {
          case 'CALCULATE_HASH':
            result = { hash: calculateDHash(data.imageData, data.width, data.height) };
            break;
          case 'COMPARE_HASH':
            const distance = hammingDistance(data.hash1, data.hash2);
            result = { isSimilar: distance <= data.threshold, distance };
            break;
          case 'COMPARE_TEXT':
            const similarity = textSimilarity(data.text1, data.text2);
            result = { isSimilar: similarity >= data.threshold, similarity };
            break;
        }
        
        self.postMessage({ id, result });
      };
    `;
    
    try {
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      subtitleWorkerRef.current = new Worker(URL.createObjectURL(blob));
    } catch (e) {
      console.error('[Glass] Failed to create subtitle worker:', e);
    }
  };

  const sendToWorker = (type, data) => {
    return new Promise((resolve, reject) => {
      if (!subtitleWorkerRef.current) {
        reject(new Error('Worker not initialized'));
        return;
      }
      
      const id = Math.random().toString(36).substr(2, 9);
      const handler = (e) => {
        if (e.data.id === id) {
          subtitleWorkerRef.current.removeEventListener('message', handler);
          resolve(e.data.result);
        }
      };
      subtitleWorkerRef.current.addEventListener('message', handler);
      subtitleWorkerRef.current.postMessage({ type, data, id });
    });
  };

  const toggleSubtitleMode = async () => {
    if (subtitleMode) {
      stopSubtitleMode();
    } else {
      // 检查是否设置了采集区（必须有有效的坐标）
      const hasValidCaptureRect = captureRect && 
        captureRect.x !== undefined && 
        captureRect.y !== undefined &&
        captureRect.width > 0 && 
        captureRect.height > 0;
      
      console.log('[Glass] toggleSubtitleMode, captureRect:', captureRect, 'valid:', hasValidCaptureRect);
      
      if (!hasValidCaptureRect) {
        // 自动打开采集区设置窗口
        await openCaptureWindow();
        return;
      }
      startSubtitleMode();
    }
  };

  const startSubtitleMode = () => {
    if (subtitleMode) return;
    
    console.log('[Glass] Starting subtitle mode...');
    setSubtitleMode(true);
    setStatus('subtitle');
    setTranslatedText('');
    setPrevSubtitle('');
    setCurrSubtitle('');
    currSubtitleRef.current = '';
    
    subtitleFrameCountRef.current = 0;
    subtitleStartTimeRef.current = Date.now();
    lastSubtitleHashRef.current = null;
    lastSubtitleTextRef.current = '';
    
    setSubtitleStats({ status: 'listening', skipped: 0, processed: 0 });
    
    subtitleTimerRef.current = setInterval(subtitleCaptureLoop, 500); // 2fps
  };

  const stopSubtitleMode = async () => {
    if (!subtitleMode) return;
    
    console.log('[Glass] Stopping subtitle mode...');
    
    if (subtitleTimerRef.current) {
      clearInterval(subtitleTimerRef.current);
      subtitleTimerRef.current = null;
    }
    
    setSubtitleMode(false);
    setStatus('idle');
    
    // 保留最后的翻译结果
    if (currSubtitleRef.current) {
      setTranslatedText(currSubtitleRef.current);
    }
    
    setPrevSubtitle('');
    setCurrSubtitle('');
    currSubtitleRef.current = '';
    setSubtitleStats({ status: 'idle', skipped: 0, processed: 0 });
    
    // 自动关闭采集区窗口
    try {
      const visible = await window.electron?.subtitle?.isCaptureWindowVisible?.();
      if (visible) {
        await window.electron.subtitle.toggleCaptureWindow();
      }
    } catch (e) {
      console.error('[Glass] Failed to close capture window:', e);
    }
  };

  const subtitleCaptureLoop = async () => {
    if (isCapturingRef.current || !captureRect) return;
    
    isCapturingRef.current = true;
    subtitleFrameCountRef.current++;
    
    try {
      const result = await window.electron.subtitle.captureRegion();
      if (!result.success) {
        isCapturingRef.current = false;
        return;
      }
      
      // 解析 base64 图片数据
      let imageData;
      try {
        const base64Data = result.imageData.split(',')[1] || result.imageData;
        const binaryString = atob(base64Data);
        imageData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          imageData[i] = binaryString.charCodeAt(i);
        }
      } catch (e) {
        console.error('[Subtitle] Failed to parse image data:', e);
        isCapturingRef.current = false;
        return;
      }
      
      // 计算哈希比较
      const hashResult = await sendToWorker('CALCULATE_HASH', {
        imageData,
        width: captureRect.width,
        height: captureRect.height
      });
      
      if (lastSubtitleHashRef.current) {
        const compareResult = await sendToWorker('COMPARE_HASH', {
          hash1: hashResult.hash,
          hash2: lastSubtitleHashRef.current,
          threshold: 10
        });
        
        if (compareResult.isSimilar) {
          setSubtitleStats(prev => ({ ...prev, status: 'listening', skipped: prev.skipped + 1 }));
          isCapturingRef.current = false;
          return;
        }
      }
      
      lastSubtitleHashRef.current = hashResult.hash;
      setSubtitleStats(prev => ({ ...prev, status: 'recognizing' }));
      
      // OCR
      const ocrResult = await ocrManager.recognize(result.imageData, { engine: 'rapid-ocr', preprocess: true });
      if (!ocrResult.success || !ocrResult.text?.trim()) {
        setSubtitleStats(prev => ({ ...prev, status: 'listening' }));
        isCapturingRef.current = false;
        return;
      }
      
      const text = ocrResult.text.trim();
      
      // 文本相似度检查
      if (lastSubtitleTextRef.current) {
        const textCompare = await sendToWorker('COMPARE_TEXT', {
          text1: text,
          text2: lastSubtitleTextRef.current,
          threshold: 80
        });
        if (textCompare.isSimilar) {
          setSubtitleStats(prev => ({ ...prev, status: 'listening' }));
          isCapturingRef.current = false;
          return;
        }
      }
      
      lastSubtitleTextRef.current = text;
      
      // 输入检查
      if (!shouldTranslateText(text)) {
        setSubtitleStats(prev => ({ ...prev, status: 'listening' }));
        isCapturingRef.current = false;
        return;
      }
      
      setSubtitleStats(prev => ({ ...prev, status: 'translating', processed: prev.processed + 1 }));
      
      // 翻译
      const sourceLang = detectLanguage(text);
      let actualTargetLang = targetLanguage;
      if (!lockTargetLang && sourceLang === targetLanguage) {
        actualTargetLang = targetLanguage === 'zh' ? 'en' : 'zh';
      }
      
      const messages = buildSubtitleMessages(text, actualTargetLang);
      const response = await llmClient.chatCompletion(messages);
      const cleanedResult = cleanTranslationOutput(response?.content?.trim() || '', text);
      
      if (cleanedResult) {
        const prevCurr = currSubtitleRef.current;
        if (prevCurr && prevCurr !== cleanedResult) {
          setPrevSubtitle(prevCurr);
        }
        currSubtitleRef.current = cleanedResult;
        setCurrSubtitle(cleanedResult);
      }
      
      setSubtitleStats(prev => ({ ...prev, status: 'listening' }));
    } catch (error) {
      console.error('[Subtitle] Error:', error);
      setSubtitleStats(prev => ({ ...prev, status: 'listening' }));
    } finally {
      isCapturingRef.current = false;
    }
  };

  // ========== 辅助函数 ==========
  const detectLanguage = (text) => {
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    return chineseChars.length / text.length > 0.3 ? 'zh' : 'en';
  };

  const shouldTranslateText = (text) => {
    if (!text) return false;
    const clean = text.trim();
    if (clean.length < 2) return false;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(clean)) return false;
    if (/译[：:]/.test(clean)) return false;
    return true;
  };

  const buildSubtitleMessages = (text, targetLang) => {
    const langNames = { 'zh': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어' };
    const targetName = langNames[targetLang] || targetLang;
    
    const examples = targetLang === 'zh' ? [
      { user: "Hello world", assistant: "你好世界" },
      { user: "It's a nice day.", assistant: "今天天气不错。" },
      { user: "123 #$% noise", assistant: "" },
    ] : [
      { user: "你好世界", assistant: "Hello world" },
      { user: "今天天气不错。", assistant: "It's a nice day." },
      { user: "123 测试#$", assistant: "" },
    ];
    
    return [
      { role: "system", content: `Subtitle translator. Output ${targetName} only. No explanations. Empty for gibberish.` },
      ...examples.flatMap(ex => [
        { role: "user", content: ex.user },
        { role: "assistant", content: ex.assistant }
      ]),
      { role: "user", content: text }
    ];
  };

  const cleanTranslationOutput = (result, originalText) => {
    if (!result) return '';
    let text = result;
    text = text.replace(/^(1\.|2\.|Rule\s*\d+|System:|Translation:|翻译[：:])\s*/gi, '');
    text = text.replace(/\s*（[^）]*）/g, '').replace(/\s*\([^)]*\)/g, '');
    text = text.replace(/^["'「」『』""'']+|["'「」『』""'']+$/g, '');
    return text.trim();
  };

  const scrollToBottom = () => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  // ========== 渲染 ==========
  const isLoading = ['capturing', 'recognizing', 'translating'].includes(status);

  return (
    <div 
      className={`glass-window ${subtitleMode ? 'subtitle-mode' : ''}`}
      style={{ '--glass-opacity': subtitleMode ? 0 : opacity }}
    >
      {/* 顶部区域 - 鼠标移入显示关闭按钮 */}
      <div 
        className="glass-top-area"
        onMouseEnter={handleMouseEnterTop}
        onMouseLeave={handleMouseLeaveTop}
      >
        {/* 普通模式工具栏 */}
        {!subtitleMode && (
          <div className="glass-toolbar">
            <button 
              className="toolbar-btn"
              onClick={captureAndTranslate}
              disabled={isLoading}
              title="截图识别 (Space)"
            >
              <Camera size={16} />
            </button>
            
            <div 
              className="toolbar-handle"
              onClick={handleBarClick}
              title="点击调节透明度"
            >
              <GripHorizontal size={20} />
            </div>
            
            <button 
              className={`toolbar-btn ${captureRect ? 'has-capture' : ''}`}
              onClick={toggleSubtitleMode}
              title={captureRect ? '开始字幕模式' : '设置字幕采集区'}
            >
              <Film size={16} />
            </button>
          </div>
        )}
        
        {/* 字幕模式顶部：状态点 + 采集区按钮 */}
        {subtitleMode && (
          <div className="subtitle-top-bar">
            <div className={`subtitle-status-dot ${subtitleStats.status}`} title={
              subtitleStats.status === 'listening' ? '监听中' :
              subtitleStats.status === 'recognizing' ? '识别中' : '翻译中'
            } />
            
            <button 
              className="toolbar-btn subtitle-capture-btn"
              onClick={openCaptureWindow}
              title="编辑字幕采集区"
            >
              <Monitor size={16} />
            </button>
          </div>
        )}
        
        {/* 关闭按钮 - 右上角 */}
        <button 
          className={`glass-close-btn ${showCloseBtn || subtitleMode ? 'visible' : ''}`}
          onClick={handleClose}
          title={subtitleMode ? '退出字幕模式 (Esc)' : '关闭 (Esc)'}
        >
          <X size={14} />
        </button>
      </div>
      
      {/* 透明度滑块弹窗 */}
      {showOpacitySlider && !subtitleMode && (
        <div className="opacity-popup" onMouseLeave={() => setShowOpacitySlider(false)}>
          <span className="opacity-label">透明度</span>
          <input 
            type="range" 
            min="0.3" 
            max="1" 
            step="0.05" 
            value={opacity}
            onChange={handleOpacityChange}
          />
          <span className="opacity-value">{Math.round(opacity * 100)}%</span>
        </div>
      )}
      
      {/* 内容区域 */}
      <div className="glass-content" ref={contentRef}>
        {status === 'error' ? (
          <div className="glass-message error">
            <AlertCircle size={20} />
            <span>{errorMessage}</span>
          </div>
        ) : subtitleMode ? (
          <div className="subtitle-display">
            {prevSubtitle && (
              <div className="subtitle-prev" key={`prev-${prevSubtitle}`}>{prevSubtitle}</div>
            )}
            {currSubtitle && (
              <div className="subtitle-curr" key={`curr-${currSubtitle}`}>{currSubtitle}</div>
            )}
            {!currSubtitle && !prevSubtitle && (
              <div className="subtitle-waiting">等待字幕...</div>
            )}
          </div>
        ) : isLoading ? (
          <div className="glass-message loading">
            <Loader2 className="spin" size={24} />
            <span>
              {status === 'capturing' && '截图中...'}
              {status === 'recognizing' && '识别中...'}
              {status === 'translating' && '翻译中...'}
            </span>
          </div>
        ) : translatedText ? (
          <div className="glass-result">{translatedText}</div>
        ) : (
          <div className="glass-message placeholder">
            <span>点击 📷 或按 Space 截图识别</span>
            <span>点击 🎬 开启字幕模式</span>
          </div>
        )}
      </div>
      
      {/* 更多提示 */}
      {hasOverflow && !subtitleMode && (
        <button className="scroll-hint" onClick={scrollToBottom}>
          <ChevronDown size={14} />
          <span>更多</span>
        </button>
      )}
    </div>
  );
};

export default GlassTranslator;
