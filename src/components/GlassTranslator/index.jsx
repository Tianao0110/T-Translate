// src/components/GlassTranslator/index.jsx
// 玻璃翻译窗口 - 纯 UI 组件
// 所有业务逻辑已移至 services/pipeline.js
//
// 修复：loadSettings 现在会同步主窗口的目标语言

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Film, Monitor, X, Loader2, AlertCircle, ChevronDown, GripHorizontal } from 'lucide-react';
import useSessionStore, { STATUS } from '../../stores/session.js';
import useConfigStore from '../../stores/config.js';
import pipeline from '../../services/pipeline.js';
import createLogger from '../../utils/logger.js';
import './styles.css';

// 日志实例
const logger = createLogger('Glass');

/**
 * 玻璃翻译窗口组件
 * 职责：纯 UI 渲染，监听 store 变化
 */
const GlassTranslator = () => {
  // ========== Store 状态 ==========
  const {
    status,
    translatedText,
    error,
    subtitleMode,
    subtitleStatus,
    subtitleStats,
    prevSubtitle,
    currSubtitle,
    setSubtitleMode,
    setSubtitleStatus,
    clear,
  } = useSessionStore();
  
  const {
    glassOpacity,
    targetLanguage,
    lockTargetLang,
    ocrEngine,
    setGlassOpacity,
    setTargetLanguage,  // ← 新增：用于同步目标语言
    setSourceLanguage,  // ← 新增：用于同步源语言
    setLockTargetLang,  // ← 新增：用于同步锁定设置
    setOcrEngine,       // ← 新增：用于同步 OCR 引擎
  } = useConfigStore();

  // ========== 纯 UI 状态 ==========
  const [showCloseBtn, setShowCloseBtn] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [captureRect, setCaptureRect] = useState(null);
  const [theme, setTheme] = useState('light'); // 主题状态
  
  // ========== Refs ==========
  const contentRef = useRef(null);
  const closeBtnTimerRef = useRef(null);
  const subtitleTimerRef = useRef(null);

  // ========== 初始化 ==========
  useEffect(() => {
    // 初始化 pipeline
    pipeline.init();
    
    // 加载设置
    loadSettings();
    loadCaptureRect();
    
    // 加载主题
    const loadTheme = async () => {
      try {
        const settings = await window.electron?.store?.get?.('settings') || {};
        const savedTheme = settings.interface?.theme || 'light';
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
      } catch (e) {
        logger.debug('Failed to load theme:', e);
      }
    };
    loadTheme();
    
    // 键盘事件
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (subtitleMode) {
          exitSubtitleMode();
        } else {
          handleClose();
        }
      } else if (e.code === 'Space' && !subtitleMode) {
        e.preventDefault();
        captureAndTranslate();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    // 监听设置变化（包括主题）
    let unsubscribeSettings = null;
    if (window.electron?.glass?.onSettingsChanged) {
      unsubscribeSettings = window.electron.glass.onSettingsChanged((newSettings) => {
        loadSettings();
        // 同步主题
        if (newSettings?.interface?.theme) {
          setTheme(newSettings.interface.theme);
          document.documentElement.setAttribute('data-theme', newSettings.interface.theme);
        }
      });
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (subtitleTimerRef.current) clearInterval(subtitleTimerRef.current);
      if (closeBtnTimerRef.current) clearTimeout(closeBtnTimerRef.current);
      if (unsubscribeSettings) unsubscribeSettings();
    };
  }, []);

  // ========== 监听内容溢出 ==========
  useEffect(() => {
    if (contentRef.current) {
      const { scrollHeight, clientHeight } = contentRef.current;
      setHasOverflow(scrollHeight > clientHeight + 10);
    }
  }, [translatedText, currSubtitle]);

  // ========== 加载设置（修复版）==========
  const loadSettings = async () => {
    try {
      const settings = await window.electron?.glass?.getSettings?.();
      if (settings) {
        logger.debug(' Loaded settings from main:', settings);
        
        // 同步透明度
        if (settings.opacity !== undefined) {
          setGlassOpacity(settings.opacity);
        }
        
        // ========== 修复：同步目标语言 ==========
        if (settings.targetLanguage) {
          logger.debug(' Syncing targetLanguage:', settings.targetLanguage);
          setTargetLanguage(settings.targetLanguage);
        }
        
        // 同步源语言
        if (settings.sourceLanguage) {
          setSourceLanguage(settings.sourceLanguage);
        }
        
        // 同步锁定目标语言设置
        if (settings.lockTargetLang !== undefined) {
          setLockTargetLang(settings.lockTargetLang);
        }
        
        // 同步 OCR 引擎
        if (settings.ocrEngine || settings.globalOcrEngine) {
          setOcrEngine(settings.ocrEngine || settings.globalOcrEngine);
        }
        // ========== 修复结束 ==========
      }
    } catch (error) {
      logger.error(' Load settings failed:', error);
    }
  };

  const loadCaptureRect = async () => {
    try {
      const rect = await window.electron?.subtitle?.getCaptureRect?.();
      if (rect) setCaptureRect(rect);
    } catch (error) {
      logger.error(' Load capture rect failed:', error);
    }
  };

  // ========== UI 事件处理 ==========
  const handleMouseEnterTop = () => {
    if (closeBtnTimerRef.current) clearTimeout(closeBtnTimerRef.current);
    setShowCloseBtn(true);
  };

  const handleMouseLeaveTop = () => {
    closeBtnTimerRef.current = setTimeout(() => setShowCloseBtn(false), 800);
  };

  const handleClose = () => {
    if (subtitleMode) {
      exitSubtitleMode();
    } else {
      window.electron?.glass?.close?.();
    }
  };

  const handleBarClick = () => {
    setShowOpacitySlider(prev => !prev);
  };

  const handleOpacityChange = async (e) => {
    const newOpacity = parseFloat(e.target.value);
    setGlassOpacity(newOpacity);
    await window.electron?.glass?.setOpacity?.(newOpacity);
  };

  const scrollToBottom = () => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  // ========== 核心功能（调用 pipeline）==========
  const captureAndTranslate = useCallback(async () => {
    try {
      const bounds = await window.electron?.glass?.getBounds?.();
      if (!bounds) return;
      
      const topBarHeight = 40;
      await pipeline.runFromCapture({
        x: bounds.x,
        y: bounds.y + topBarHeight,
        width: bounds.width,
        height: bounds.height - topBarHeight,
      });
    } catch (error) {
      logger.error(' Capture failed:', error);
    }
  }, []);

  // ========== 字幕模式 ==========
  const toggleSubtitleMode = async () => {
    if (subtitleMode) {
      exitSubtitleMode();
    } else {
      await enterSubtitleMode();
    }
  };

  const enterSubtitleMode = async () => {
    // 检查是否有采集区
    if (!captureRect) {
      await openCaptureWindow();
      return;
    }
    
    setSubtitleMode(true);
    pipeline.resetCache();
    
    // 开始字幕循环
    subtitleTimerRef.current = setInterval(async () => {
      try {
        // 检查采集窗口是否可见
        const captureWindowVisible = await window.electron?.subtitle?.isCaptureWindowVisible?.();
        if (captureWindowVisible) {
          setSubtitleStatus('editing');
          return;
        }
        
        // 截取字幕区域
        const result = await window.electron?.subtitle?.captureRegion?.();
        if (result?.success) {
          await pipeline.processSubtitleFrame(result.imageData);
        }
      } catch (error) {
        logger.error('[Subtitle] Frame error:', error);
      }
    }, 1000);
  };

  const exitSubtitleMode = () => {
    if (subtitleTimerRef.current) {
      clearInterval(subtitleTimerRef.current);
      subtitleTimerRef.current = null;
    }
    setSubtitleMode(false);
    useSessionStore.getState().clearSubtitle();
  };

  const openCaptureWindow = async () => {
    try {
      const result = await window.electron?.subtitle?.toggleCaptureWindow?.();
      if (result?.rect) {
        setCaptureRect(result.rect);
      }
    } catch (error) {
      logger.error(' Open capture window failed:', error);
    }
  };

  // ========== 渲染 ==========
  const isLoading = [STATUS.CAPTURING, STATUS.OCR_PROCESSING, STATUS.TRANSLATING].includes(status);

  return (
    <div 
      className={`glass-window ${subtitleMode ? 'subtitle-mode' : ''}`}
      style={{ '--glass-opacity': subtitleMode ? 0 : glassOpacity }}
      data-theme={theme}
    >
      {/* 顶部区域 */}
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                captureAndTranslate();
              }}
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSubtitleMode();
              }}
              title={captureRect ? '开始字幕模式' : '设置字幕采集区'}
            >
              <Film size={16} />
            </button>
          </div>
        )}
        
        {/* 字幕模式顶部 */}
        {subtitleMode && (
          <div className="subtitle-top-bar">
            <div 
              className={`subtitle-status-dot ${subtitleStatus}`} 
              title={
                subtitleStatus === 'listening' ? '监听中' :
                subtitleStatus === 'recognizing' ? '识别中' :
                subtitleStatus === 'translating' ? '翻译中' :
                subtitleStatus === 'editing' ? '编辑采集区中（暂停）' : '空闲'
              } 
            />
            
            <button 
              className="toolbar-btn subtitle-capture-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openCaptureWindow();
              }}
              title="编辑字幕采集区"
            >
              <Monitor size={16} />
            </button>
          </div>
        )}
        
        {/* 关闭按钮 */}
        <button 
          className={`glass-close-btn ${showCloseBtn || subtitleMode ? 'visible' : ''}`}
          onClick={handleClose}
          title={subtitleMode ? '退出字幕模式 (Esc)' : '关闭 (Esc)'}
        >
          <X size={14} />
        </button>
      </div>
      
      {/* 透明度滑块 */}
      {showOpacitySlider && !subtitleMode && (
        <div className="opacity-popup" onMouseLeave={() => setShowOpacitySlider(false)}>
          <span className="opacity-label">透明度</span>
          <input 
            type="range" 
            min="0.3" 
            max="1" 
            step="0.05" 
            value={glassOpacity}
            onChange={handleOpacityChange}
          />
          <span className="opacity-value">{Math.round(glassOpacity * 100)}%</span>
        </div>
      )}
      
      {/* 内容区域 */}
      <div className="glass-content" ref={contentRef}>
        {status === STATUS.ERROR ? (
          <div className="glass-message error">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : subtitleMode ? (
          <div className="subtitle-display">
            {subtitleStatus === 'editing' ? (
              <div className="subtitle-editing">编辑采集区中，字幕暂停...</div>
            ) : (
              <>
                {prevSubtitle && <div className="subtitle-prev">{prevSubtitle}</div>}
                {currSubtitle && <div className="subtitle-curr">{currSubtitle}</div>}
                {!currSubtitle && !prevSubtitle && (
                  <div className="subtitle-waiting">等待字幕...</div>
                )}
              </>
            )}
          </div>
        ) : isLoading ? (
          <div className="glass-message loading">
            <Loader2 className="spin" size={24} />
            <span>
              {status === STATUS.CAPTURING && '截图中...'}
              {status === STATUS.OCR_PROCESSING && '识别中...'}
              {status === STATUS.TRANSLATING && '翻译中...'}
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
      
      {/* 滚动提示 */}
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
