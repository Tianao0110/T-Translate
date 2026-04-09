// src/components/SelectionTranslator.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import translationService from '../../services/translation.js';
import ttsManager, { TTS_STATUS } from '../../services/tts/index.js';
import createLogger from '../../utils/logger.js';
import { getShortErrorMessage } from '../../utils/error-handler.js';
import './styles.css';

// 从配置中心导入常量
import { PRIVACY_MODES, THEMES, LANGUAGE_CODES, selectionDefaults } from '@config/defaults';

// 日志实例
const logger = createLogger('Selection');

// 语言代码映射（用于显示）
const LANG_MAP = {
  'zh': 'Simplified Chinese',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'fr': 'French',
  'de': 'German',
  'es': 'Spanish',
  'ru': 'Russian',
  'auto': 'auto'
};

// 默认设置
const DEFAULT_SETTINGS = {
  triggerTimeout: 4000,
  showSourceByDefault: false,
  autoCloseOnCopy: false,
  minChars: 2,
  maxChars: 500,
  windowOpacity: 95,  // 窗口透明度
};

const DEFAULT_TRANSLATION = {
  targetLanguage: 'zh',
  sourceLanguage: 'auto',
};

const SelectionTranslator = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState('idle');
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [error, setError] = useState('');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [rect, setRect] = useState(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState(THEMES.LIGHT);
  const [showSource, setShowSource] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [triggerReady, setTriggerReady] = useState(false);  // 圆点是否就绪可点击
  const [privacyMode, setPrivacyMode] = useState(PRIVACY_MODES.STANDARD); // 隐私模式
  const [isFrozen, setIsFrozen] = useState(false); // 是否已冻结（拖动后变成独立窗口）
  const [windowId, setWindowId] = useState(null); // 当前窗口 ID
  const [initialBounds, setInitialBounds] = useState(null); // 初始位置，用于检测是否移动
  
  // TTS 状态
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);

  const sizedRef = useRef(false);

  const frozenRef = useRef(false);  // 用于定时器回调中访问最新的 isFrozen 状态
  const autoHideTimerRef = useRef(null);
  const triggerReadyTimerRef = useRef(null);  // 圆点就绪计时器
  const contentRef = useRef(null);  // 内容区域引用，用于测量实际大小
  const translateTextRef = useRef(null);  // 存储最新的翻译函数引用

  // TTS 初始化
  useEffect(() => {
    ttsManager.init().catch(e => {
      logger.debug('TTS init failed:', e.message);
    });
    
    ttsManager.onStatusChange((status) => {
      setTtsStatus(status);
    });
    
    return () => {
      ttsManager.stop();
    };
  }, []);

  // 朗读译文
  const speakTranslation = useCallback(() => {
    if (!translatedText?.trim()) return;
    
    if (ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
    } else {
      ttsManager.speak(translatedText, { lang: translation.targetLanguage }).catch(e => {
        logger.error('TTS error:', e);
      });
    }
  }, [translatedText, translation.targetLanguage, ttsStatus]);

  // 获取隐私模式
  useEffect(() => {
    const getPrivacyMode = async () => {
      try {
        if (window.electron?.privacy?.getMode) {
          const mode = await window.electron.privacy.getMode();
          setPrivacyMode(mode);
        }
      } catch (e) {
        logger.debug('Failed to get privacy mode:', e);
      }
    };
    getPrivacyMode();
  }, []);

  useEffect(() => {
    const removeShowListener = window.electron?.selection?.onShowTrigger?.((data) => {
      // 如果窗口已冻结，忽略所有新的触发事件
      if (frozenRef.current) {
        logger.debug('Window is frozen, ignoring show trigger');
        return;
      }
      
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (triggerReadyTimerRef.current) clearTimeout(triggerReadyTimerRef.current);
      
      setMousePos({ x: data.mouseX, y: data.mouseY });
      setRect(data.rect);
      
      // 应用主题
      if (data.theme) setTheme(data.theme);
      
      // 应用设置
      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);
      
      // 应用翻译设置（与主程序一致）
      const newTranslation = { ...DEFAULT_TRANSLATION, ...data.translation };
      setTranslation(newTranslation);
      
      // 根据设置决定是否默认显示原文
      setShowSource(newSettings.showSourceByDefault);
      
      setMode('trigger');
      setError('');
      setSourceText('');
      setTranslatedText('');
      setCopied(false);
      sizedRef.current = false;
      setIsFrozen(false);  // 重置固定状态
      setInitialBounds(null);  // 重置初始位置
      
      // 圆点就绪延迟（防止松开鼠标时误触）
      setTriggerReady(false);
      triggerReadyTimerRef.current = setTimeout(() => {
        setTriggerReady(true);
      }, 100);  // 100ms 后才能点击
      
      // 使用设置中的自动消失时间（固定模式下不自动隐藏）
      autoHideTimerRef.current = setTimeout(() => {
        // 注意：这里无法直接访问最新的 isFrozen 状态
        // 所以在 handleAutoHide 中检查
        handleAutoHide();
      }, newSettings.triggerTimeout);
    });
    
    // 监听截图翻译联动
    // 支持三种模式：
    // 1. { isLoading: true } - 显示加载状态
    // 2. { text: "..." } - 收到 OCR 文字，自己翻译
    // 3. { sourceText, translatedText } - 直接显示结果（保留兼容）
    const removeShowResultListener = window.electron?.selection?.onShowResult?.(async (data) => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (triggerReadyTimerRef.current) clearTimeout(triggerReadyTimerRef.current);
      
      // 应用主题
      if (data.theme) setTheme(data.theme);
      
      // 应用设置
      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);
      
      // 模式 1: 加载状态
      if (data.isLoading) {
        logger.debug('Showing loading state');
        setSourceText('');
        setTranslatedText('');
        setError('');
        setCopied(false);
        sizedRef.current = false;
        setIsFrozen(false);
        setInitialBounds(null);
        setMode('loading');
        return;
      }
      
      // 模式 2: 收到 OCR 文字，自己翻译（复用划词翻译的流程）
      if (data.text && !data.translatedText) {
        logger.debug('Received OCR text, translating...');
        // 使用传入的目标语言（截图翻译从主窗口设置读取）
        if (data.targetLanguage) {
          setTranslation(prev => ({ ...prev, targetLanguage: data.targetLanguage }));
        }
        setSourceText(data.text);
        setShowSource(newSettings.showSourceByDefault);
        setError('');
        setCopied(false);
        sizedRef.current = false;
        setIsFrozen(false);
        setInitialBounds(null);
        // 保持 loading 状态，开始翻译
        setMode('loading');
        
        try {
          // 直接传入目标语言，不依赖异步 state 更新
          const overrideLang = data.targetLanguage || data.translation?.targetLanguage || null;
          const translationResult = await translateTextRef.current(data.text, 0, overrideLang);
          setTranslatedText(translationResult);
          setError('');
          setMode('overlay');
          
          // 添加到历史记录
          if (translationResult) {
            window.electron?.selection?.addToHistory?.({
              source: data.text,
              result: translationResult,
              timestamp: Date.now(),
              from: 'screenshot',
            });
          }
        } catch (err) {
          setError(err.message || t('selection.translateFailed', '翻译失败'));
          setTranslatedText('');
          setMode('overlay');
        }
        return;
      }
      
      // 模式 3: 直接显示结果（截图翻译、OCR 错误等）
      if (data.sourceText && data.translatedText) {
        logger.debug('Received translation result');
        setTranslation({
          targetLanguage: data.targetLanguage || 'zh',
          sourceLanguage: data.sourceLanguage || 'auto',
        });
        setShowSource(true);
        setSourceText(data.sourceText);
        setTranslatedText(data.translatedText);
        setError('');
        setCopied(false);
        setIsFrozen(false);
        // 不重置 sizedRef 和 initialBounds，窗口已经在截图位置
        setMode('overlay');
        
        if (newSettings.triggerTimeout > 0) {
          autoHideTimerRef.current = setTimeout(() => {
            handleAutoHide();
          }, newSettings.triggerTimeout);
        }
      }
    });
    
    // hotkey 直出路径（v0.2.4）
    // 与 onShowResult Mode 2 类似（已有 text，直接翻译显示），但语义独立：
    // - 不会和截图 OCR 联动混淆
    // - 跳过 trigger 模式，直接进 loading → translating → overlay
    // - 失败时也直接进 overlay 显示错误（不等用户点图标）
    const removeShowDirectListener = window.electron?.selection?.onShowDirect?.(async (data) => {
      logger.debug('SHOW_DIRECT received', { textLength: data?.text?.length });

      // 取消任何已排好的 auto-hide / trigger-ready 计时器
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (triggerReadyTimerRef.current) clearTimeout(triggerReadyTimerRef.current);

      // 应用主题和设置
      if (data.theme) setTheme(data.theme);
      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);

      // 直接进 loading 态（跳过 trigger / icon 模式）
      setSourceText(data.text || '');
      setTranslatedText('');
      setError('');
      setCopied(false);
      sizedRef.current = false;
      setIsFrozen(false);
      setInitialBounds(null);
      setMode('loading');

      // 翻译（复用 translateTextRef）
      if (!data.text || !data.text.trim()) {
        // 上层 handleHotkeyDirectPath 不应该送空 text 进来（它会预先检查）
        // 但万一发生，进 error 态而不是死锁在 loading
        setError(t('selection.noText', '未获取到文字'));
        setMode('overlay');
        return;
      }

      try {
        const overrideLang = data.targetLanguage || null;
        const translationResult = await translateTextRef.current(data.text, 0, overrideLang);
        setTranslatedText(translationResult);
        setError('');
        setMode('overlay');

        // 加入历史记录（标记 from: 'hotkey' 区分于 selection 和 screenshot）
        if (translationResult) {
          window.electron?.selection?.addToHistory?.({
            source: data.text,
            result: translationResult,
            timestamp: Date.now(),
            from: 'hotkey',
          });
        }
      } catch (err) {
        logger.error('SHOW_DIRECT translation failed:', err);
        setError(err.message || t('selection.translateFailed', '翻译失败'));
        setTranslatedText('');
        setMode('overlay');
      }
    });

    const removeHideListener = window.electron?.selection?.onHide?.(() => {
      // 冻结窗口忽略 hide 事件
      if (frozenRef.current) {
        logger.debug('Frozen window ignoring hide event');
        return;
      }
      setMode('idle');
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (triggerReadyTimerRef.current) clearTimeout(triggerReadyTimerRef.current);
    });
    
    const handleKey = (e) => {
      if (e.code === 'Escape') {
        setMode('idle');
        window.electron?.selection?.hide?.();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      if (removeShowListener) removeShowListener();
      if (removeShowResultListener) removeShowResultListener();
      if (removeShowDirectListener) removeShowDirectListener();
      if (removeHideListener) removeHideListener();
      window.removeEventListener('keydown', handleKey);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (triggerReadyTimerRef.current) clearTimeout(triggerReadyTimerRef.current);
    };
  }, []);

  const handleTriggerClick = async () => {
    // 防手抖：圆点未就绪时不响应点击
    if (!triggerReady) {
      logger.debug('Trigger not ready yet, ignoring click');
      return;
    }
    
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    
    // 窗口大小已统一为 40x40，直接切换到 loading 状态
    setMode('loading');
    
    try {
      const result = await window.electron?.selection?.getText?.(rect);
      if (!result?.text) throw new Error(t('selection.noText', '未获取到文字'));
      
      const text = result.text.trim();
      
      // === 内容校验 ===
      
      // 1. 检查是否为空或纯空白
      if (!text || /^[\s\r\n]+$/.test(text)) {
        throw new Error(t('selection.emptyContent', '选中内容为空'));
      }
      
      // 2. 检查字符数限制
      if (text.length < settings.minChars) {
        throw new Error(t('selection.tooShort', '文字太短（最少 {{min}} 字符）').replace('{{min}}', settings.minChars));
      }
      if (text.length > settings.maxChars) {
        throw new Error(t('selection.tooLong', '文字太长（最多 {{max}} 字符）').replace('{{max}}', settings.maxChars));
      }
      
      // 3. 过滤纯符号（必须包含至少一个字母、数字或中日韩文字）
      // \w = 字母数字下划线, \u4e00-\u9fff = 中文, \u3040-\u30ff = 日文假名, \uac00-\ud7af = 韩文
      if (!/[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) {
        throw new Error(t('selection.noValidText', '选中内容无有效文字'));
      }
      
      // 4. 过滤可能的乱码（同一字符重复超过 10 次）
      if (/(.)\1{10,}/.test(text)) {
        throw new Error(t('selection.possibleGarbage', '选中内容可能是乱码'));
      }
      
      // 5. 过滤文件路径（通常不需要翻译）
      if (/^[A-Za-z]:\\|^\/(?:home|usr|var|etc|tmp)\/|^file:\/\//.test(text)) {
        throw new Error(t('selection.isFilePath', '选中内容是文件路径'));
      }
      
      setSourceText(text);
      const translationResult = await translateText(text);
      setTranslatedText(translationResult);
      setError('');
      setMode('overlay');
      
      // 添加到历史记录
      if (translationResult) {
        window.electron?.selection?.addToHistory?.({
          source: text,
          result: translationResult,
          timestamp: Date.now(),
          from: 'selection', // 标记来源
        });
      }
      
      // 窗口大小由 useEffect 自动调整
    } catch (err) {
      setError(err.message || t('selection.translateFailed', '翻译失败'));
      setTranslatedText('');
      setMode('overlay');
      // 窗口大小由 useEffect 自动调整
    }
  };

  // 自适应窗口大小
  const adjustWindowToContent = async () => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    
    const maxWidth = 400, minWidth = 160;
    const maxHeight = 350, minHeight = 65;
    const toolbarHeight = 36;
    
    const sw = window.screen?.availWidth || 1920;
    const sh = window.screen?.availHeight || 1080;

    // 截图模式：mousePos 未设置，只调整大小不重新定位
    const hasValidMousePos = mousePos.x !== 0 || mousePos.y !== 0;

    // 获取文本
    const text = contentEl.innerText || '';
    const hasNewlines = text.includes('\n');
    
    // 计算宽度：根据字符数估算
    const charCount = [...text].reduce((sum, ch) => sum + (/[\u4e00-\u9fff]/.test(ch) ? 1.6 : 1), 0);
    let width;
    if (hasNewlines || charCount > 40) {
      width = maxWidth;
    } else {
      width = Math.min(Math.max(charCount * 9 + 50, minWidth), maxWidth);
    }
    
    // 先设置宽度，让内容换行
    if (hasValidMousePos) {
      await window.electron?.selection?.setBounds?.({
        x: Math.round(mousePos.x - width / 2),
        y: Math.round(mousePos.y + 20),
        width: width, height: maxHeight
      });
    } else {
      // 截图模式：只调整宽高，保持原位置
      const currentBounds = await window.electron?.selection?.startDrag?.();
      if (currentBounds) {
        await window.electron?.selection?.setBounds?.({
          x: currentBounds.x, y: currentBounds.y,
          width: width, height: maxHeight
        });
      }
    }
    
    await new Promise(r => setTimeout(r, 20));
    
    // 临时设置 height: auto 来测量真实高度
    const origFlex = contentEl.style.flex;
    contentEl.style.flex = '0 0 auto';
    void contentEl.offsetHeight;
    
    const contentHeight = contentEl.scrollHeight;
    contentEl.style.flex = origFlex;
    
    // 计算最终高度
    let height = Math.min(Math.max(contentHeight + toolbarHeight + 16, minHeight), maxHeight);
    
    if (hasValidMousePos) {
      let x = mousePos.x - width / 2;
      let y = mousePos.y + 20;
      if (x < 10) x = 10;
      if (x + width > sw - 10) x = sw - width - 10;
      if (y + height > sh - 10) y = mousePos.y - height - 10;
      if (y < 10) y = 10;
      window.electron?.selection?.setBounds?.({
        x: Math.round(x), y: Math.round(y),
        width: Math.round(width), height: Math.round(height)
      });
    } else {
      const cb = await window.electron?.selection?.startDrag?.();
      if (cb) {
        window.electron?.selection?.setBounds?.({
          x: cb.x, y: cb.y,
          width: Math.round(width), height: Math.round(height)
        });
      }
    }
  };
  
  // 内容渲染后调整窗口大小
  useEffect(() => {
    if (mode === 'overlay' && (translatedText || error)) {
      adjustWindowToContent();
    }
  }, [mode, translatedText, error, showSource]);

  // 使用 translationService 进行翻译
  const translateText = async (text, retryCount = 0, overrideTargetLang = null) => {
    // 确保翻译服务已初始化
    if (!translationService.initialized) {
      logger.debug('Initializing translation service...');
      await translationService.init();
    }
    
    // 优先使用传入的目标语言（截图翻译等场景），否则用 state
    const targetLang = overrideTargetLang || translation.targetLanguage || 'zh';
    
    try {
      // 使用 translationService 进行翻译（传递隐私模式）
      const result = await translationService.translate(text, {
        sourceLang: 'auto',
        targetLang: targetLang,
        privacyMode: privacyMode, // 传递隐私模式
      });
      
      if (!result.success) {
        // 使用友好错误消息
        const errorMsg = getShortErrorMessage(result.error, { provider: result.provider });
        throw new Error(errorMsg);
      }
      
      if (!result.text) {
        throw new Error(t('selection.emptyResult', '翻译结果为空'));
      }
      
      return result.text;
    } catch (err) {
      // 网络错误自动重试一次
      if (retryCount < 1 && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('连接'))) {
        logger.debug('Retrying translation...');
        await new Promise(r => setTimeout(r, 1000));
        return translateText(text, retryCount + 1, overrideTargetLang);
      }
      
      // 使用 error-handler 转换错误消息
      const errorMsg = getShortErrorMessage(err);
      throw new Error(errorMsg);
    }
  };
  
  // 保持 translateTextRef 是最新的函数引用
  useEffect(() => {
    translateTextRef.current = translateText;
  });

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!translatedText) return;
    
    window.electron?.clipboard?.writeText?.(translatedText);
    setCopied(true);
    
    // 如果设置了复制后自动关闭
    if (settings.autoCloseOnCopy) {
      setTimeout(() => {
        setMode('idle');
        window.electron?.selection?.hide?.();
      }, 300);
    } else {
      setTimeout(() => setCopied(false), 1200);
    }
  };

  const toggleSource = (e) => {
    e.stopPropagation();
    setShowSource(!showSource);
  };

  const handleClose = async (e) => {
    if (e) e.preventDefault();
    
    // 如果是冻结窗口，使用特殊的关闭方法
    if (isFrozen && windowId) {
      logger.debug(`Closing frozen window ${windowId}`);
      await window.electron?.selection?.closeFrozen?.(windowId);
    } else {
      window.electron?.selection?.hide?.();
    }
    
    setMode('idle');
    setIsFrozen(false);
    setWindowId(null);
  };

  // 自动隐藏处理（检查是否固定）
  const handleAutoHide = () => {
    // 使用 ref 获取最新状态
    if (frozenRef.current) {
      logger.debug('Window is pinned, skip auto-hide');
      return;
    }
    setMode('idle');
    window.electron?.selection?.hide?.();
  };

  // 同步 isFrozen 到 ref（用于定时器回调）
  useEffect(() => {
    frozenRef.current = isFrozen;
  }, [isFrozen]);

  // 使用定时器检测窗口位置变化（因为 -webkit-app-region: drag 不触发 mouseup）
  useEffect(() => {
    if (mode !== 'overlay' || isFrozen) return;
    
    let lastCheckBounds = null;
    let checkCount = 0;
    const maxChecks = 100; // 最多检测 10 秒
    
    const checkInterval = setInterval(async () => {
      checkCount++;
      if (checkCount > maxChecks) {
        clearInterval(checkInterval);
        return;
      }
      
      try {
        const currentBounds = await window.electron?.selection?.startDrag?.();
        if (!currentBounds) return;
        
        // 第一次，保存初始位置
        if (!lastCheckBounds) {
          lastCheckBounds = currentBounds;
          setInitialBounds(currentBounds);
          return;
        }
        
        // 检测是否移动
        const dx = Math.abs(currentBounds.x - lastCheckBounds.x);
        const dy = Math.abs(currentBounds.y - lastCheckBounds.y);
        
        if (dx > 10 || dy > 10) {
          logger.debug('Window moved detected, freezing...');
          clearInterval(checkInterval);
          
          // 调用主进程冻结窗口
          const result = await window.electron?.selection?.freeze?.();
          if (result?.success) {
            setIsFrozen(true);
            setWindowId(result.windowId);
            logger.debug(`Window ${result.windowId} frozen`);
            
            // 清除自动隐藏定时器
            if (autoHideTimerRef.current) {
              clearTimeout(autoHideTimerRef.current);
              autoHideTimerRef.current = null;
            }
            
            // 保存到历史
            if (sourceText && translatedText) {
              window.electron?.selection?.addToHistory?.({
                source: sourceText,
                result: translatedText,
                timestamp: Date.now(),
                from: 'selection-frozen',
              });
            }
          }
        }
      } catch (e) {
        // 忽略错误
      }
    }, 100); // 每 100ms 检查一次
    
    return () => clearInterval(checkInterval);
  }, [mode, isFrozen, sourceText, translatedText]);

  if (mode === 'idle') return null;

  return (
    <div className="sel-root" data-theme={theme}>
      {mode === 'trigger' && (
        <div className={`sel-trigger ${triggerReady ? 'ready' : ''}`} onClick={handleTriggerClick}>
          <span className="sel-trigger-text">T</span>
        </div>
      )}
      
      {mode === 'loading' && (
        <div className="sel-loading">
          <div className="sel-spinner" />
        </div>
      )}
      
      {mode === 'overlay' && (
        <div 
          className={`sel-card ${copied ? 'copied' : ''} ${isFrozen ? 'frozen' : ''}`} 
          onContextMenu={handleClose}
          style={{ '--sel-opacity': (settings.windowOpacity || 95) / 100 }}
        >
          <div className="sel-toolbar">
            {isFrozen && (
              <span className="sel-frozen-badge" title={t('selection.frozenHint', '已固定 - 右键点击关闭')}>📌</span>
            )}
            <button className={`sel-btn ${showSource ? 'active' : ''}`} onClick={toggleSource} title={t('selection.showSource', '显示原文')}>
              {t('translation.source', '原文')}
            </button>
            <button className={`sel-btn ${copied ? 'success' : ''}`} onClick={handleCopy} title={t('selection.copyTarget', '复制译文')}>
              {copied ? t('translation.copied', '已复制') : t('translation.copy', '复制')}
            </button>
            <button 
              className={`sel-btn ${ttsStatus === TTS_STATUS.SPEAKING ? 'active' : ''}`} 
              onClick={speakTranslation} 
              disabled={!translatedText}
              title={ttsStatus === TTS_STATUS.SPEAKING ? t('translation.stopSpeak', '停止朗读') : t('translation.speak', '朗读')}
            >
              {ttsStatus === TTS_STATUS.SPEAKING ? '🔇' : '🔊'}
            </button>
            <div className="sel-spacer" />
            <button className="sel-btn sel-btn-close" onClick={handleClose} title={t('selection.closeEsc', '关闭 (ESC)')}>✕</button>
          </div>
          
          <div className="sel-content" ref={contentRef}>
            {error ? (
              <div className="sel-error">{error}</div>
            ) : (
              <>
                {showSource && sourceText && (
                  <div className="sel-source">{sourceText}</div>
                )}
                <div className="sel-text">{translatedText}</div>
              </>
            )}
          </div>


        </div>
      )}
    </div>
  );
};

export default SelectionTranslator;
