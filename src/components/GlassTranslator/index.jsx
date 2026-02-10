// src/components/GlassTranslator/index.jsx
// 玻璃翻译窗口 - 纯 UI 组件
// 所有业务逻辑已移至 services/pipeline.js
//
// 支持散点模式（子玻璃板）

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, Loader2, AlertCircle, ChevronDown, GripHorizontal, History, Clock } from 'lucide-react';
import useSessionStore, { STATUS, DISPLAY_MODE } from '../../stores/session.js';
import useConfigStore from '../../stores/config.js';
import pipeline from '../../services/pipeline.js';
import ChildGlassPane from './ChildGlassPane.jsx';
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
    // 子玻璃板状态
    displayMode,
    childPanes,
    frozenPanes,
    // Actions
    updateChildPanePosition,
    freezeChildPane,
    removeChildPane,
    closeFrozenPane,
    clearChildPanes,
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
  const [showToolbar, setShowToolbar] = useState(false);  // 工具栏显示状态
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);  // 历史记录面板
  const [hasOverflow, setHasOverflow] = useState(false);
  const [theme, setTheme] = useState('light'); // 主题状态
  const [glassBounds, setGlassBounds] = useState(null);  // 玻璃窗口边界
  const [isPassThrough, setIsPassThrough] = useState(false);  // 穿透模式
  const [historyItems, setHistoryItems] = useState([]);  // 历史记录
  
  // ========== Refs ==========
  const contentRef = useRef(null);
  const toolbarTimerRef = useRef(null);  // 工具栏隐藏计时器
  const glassRef = useRef(null);  // 玻璃窗口 ref
  const passThroughRef = useRef(false);  // 穿透模式 ref（避免闭包问题）
  const showHistoryPanelRef = useRef(false);  // 历史面板状态 ref
  const savedOpacityRef = useRef(0.85);  // 保存的透明度（穿透模式恢复用）
  
  // 同步 ref
  useEffect(() => {
    showHistoryPanelRef.current = showHistoryPanel;
  }, [showHistoryPanel]);
  
  // 同步透明度到 ref
  useEffect(() => {
    savedOpacityRef.current = glassOpacity;
  }, [glassOpacity]);

  // ========== 初始化 ==========
  useEffect(() => {
    // 初始化 pipeline
    pipeline.init();
    
    // 加载设置
    loadSettings();
    
    // 加载主题（优先使用 theme IPC，回退到 store）
    const loadTheme = async () => {
      try {
        if (window.electron?.theme?.sync) {
          const result = await window.electron.theme.sync();
          if (result?.success && result.theme) {
            setTheme(result.theme);
            document.documentElement.setAttribute('data-theme', result.theme);
            return;
          }
        }
        // 回退：从 store 读取
        const settings = await window.electron?.store?.get?.('settings') || {};
        const savedTheme = settings.interface?.theme || localStorage.getItem('theme') || 'light';
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
      } catch (e) {
        logger.debug('Failed to load theme:', e);
      }
    };
    loadTheme();
    
    // 获取内容区边界（用于子玻璃板拖动检测）
    const updateContentBounds = () => {
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        const newBounds = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        setGlassBounds(newBounds);
      }
    };
    
    // 初始获取 + 定时更新
    updateContentBounds();
    const boundsInterval = setInterval(updateContentBounds, 500);
    
    // 键盘事件
    const handleKeyDown = async (e) => {
      // Alt 键按下 → 进入穿透模式
      if (e.key === 'Alt' && !passThroughRef.current) {
        passThroughRef.current = true;
        try {
          await window.electron?.glass?.setPassThrough?.(true);
          // 不再使用窗口透明度，改用 CSS 控制
          // await window.electron?.glass?.setOpacity?.(0.3);
        } catch (err) {
          logger.error('Failed to enter pass-through mode:', err);
        }
        // 强制更新 UI
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: true }));
        return;
      }
      
      if (e.key === 'Escape') {
        // 优先级：历史面板 > 散点模式子玻璃板 > 关闭窗口
        if (showHistoryPanelRef.current) {
          setShowHistoryPanel(false);
        } else if (displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0) {
          clearChildPanes();
        } else {
          handleClose();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        captureAndTranslate();
      } else if (e.key === 'h' && (e.ctrlKey || e.metaKey)) {
        // Ctrl+H 打开/关闭历史面板
        e.preventDefault();
        if (showHistoryPanelRef.current) {
          setShowHistoryPanel(false);
        } else {
          // 加载历史记录
          try {
            const history = await window.electron?.glass?.getHistory?.(20);
            setHistoryItems(history || []);
          } catch (err) {
            logger.error('Failed to load history:', err);
          }
          setShowHistoryPanel(true);
        }
      }
    };
    
    // Alt 键释放 → 退出穿透模式
    const handleKeyUp = async (e) => {
      if (e.key === 'Alt' && passThroughRef.current) {
        passThroughRef.current = false;
        try {
          await window.electron?.glass?.setPassThrough?.(false);
          // 不再使用窗口透明度
        } catch (err) {
          logger.error('Failed to exit pass-through mode:', err);
        }
        // 强制更新 UI
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: false }));
      }
    };
    
    // 窗口失焦时也要退出穿透模式
    const handleBlur = async () => {
      if (passThroughRef.current) {
        passThroughRef.current = false;
        try {
          await window.electron?.glass?.setPassThrough?.(false);
          // 不再使用窗口透明度
        } catch (err) {
          logger.error('Failed to exit pass-through mode on blur:', err);
        }
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: false }));
      }
    };
    
    // 右键清除子玻璃板
    const handleContextMenu = (e) => {
      if (displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0) {
        e.preventDefault();
        clearChildPanes();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('contextmenu', handleContextMenu);
    
    // 监听穿透模式变化（用于更新 UI）
    const handlePassThroughChange = (e) => {
      setIsPassThrough(e.detail);
    };
    window.addEventListener('passthrough-change', handlePassThroughChange);
    
    // 监听设置变化（包括主题）
    let unsubscribeSettings = null;
    if (window.electron?.glass?.onSettingsChanged) {
      unsubscribeSettings = window.electron.glass.onSettingsChanged((newSettings) => {
        loadSettings();
        // 同步主题（只在有明确的主题设置时更新）
        const newTheme = newSettings?.interface?.theme;
        if (newTheme && ['light', 'dark', 'fresh'].includes(newTheme)) {
          setTheme(newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
        }
      });
    }
    
    // 监听主题 IPC 广播（来自 theme.js 的统一广播）
    let unsubscribeTheme = null;
    if (window.electron?.theme?.onChanged) {
      unsubscribeTheme = window.electron.theme.onChanged((newTheme) => {
        if (newTheme && ['light', 'dark', 'fresh'].includes(newTheme)) {
          setTheme(newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
        }
      });
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('passthrough-change', handlePassThroughChange);
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
      if (unsubscribeSettings) unsubscribeSettings();
      if (unsubscribeTheme) unsubscribeTheme();
      if (boundsInterval) clearInterval(boundsInterval);
    };
  }, []);

  // ========== 监听内容溢出 ==========
  useEffect(() => {
    if (contentRef.current) {
      const { scrollHeight, clientHeight } = contentRef.current;
      setHasOverflow(scrollHeight > clientHeight + 10);
    }
  }, [translatedText]);

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

  // ========== UI 事件处理 ==========
  const handleMouseEnterWindow = () => {
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    setShowToolbar(true);
  };

  const handleMouseLeaveWindow = () => {
    // 延迟隐藏，避免误触
    toolbarTimerRef.current = setTimeout(() => {
      setShowToolbar(false);
      setShowOpacitySlider(false);  // 同时关闭透明度滑块
    }, 300);
  };

  const handleClose = async () => {
    // 先关闭所有独立子窗口
    try {
      await window.electron?.glass?.closeAllChildWindows?.();
    } catch (e) {
      logger.error('Failed to close child windows:', e);
    }
    
    window.electron?.glass?.close?.();
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

  // ========== 子玻璃板事件处理 ==========
  
  /**
   * 点击内容区空白处清除子玻璃板
   */
  const handleContentClick = useCallback((e) => {
    // 只有点击容器本身（不是子玻璃板）才清除
    if (
      e.target === e.currentTarget || 
      e.target.classList.contains('scattered-panes-container')
    ) {
      if (displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0) {
        clearChildPanes();
      }
    }
  }, [displayMode, childPanes.length, clearChildPanes]);

  /**
   * 子玻璃板位置变化
   */
  const handleChildPanePositionChange = useCallback((id, position) => {
    updateChildPanePosition(id, position);
  }, [updateChildPanePosition]);

  /**
   * 冻结子玻璃板（双击触发）→ 创建独立窗口
   * v9: 改为双击触发，不再是拖出边界触发
   * @param {string} id - 子玻璃板 ID
   * @param {object} viewportPos - 视口坐标 { viewportX, viewportY }
   */
  const handleChildPaneFreeze = useCallback(async (id, viewportPos) => {
    // 获取子玻璃板信息
    const pane = childPanes.find(p => p.id === id);
    if (!pane) return;
    
    // 获取窗口位置，计算屏幕坐标
    const windowBounds = await window.electron?.glass?.getBounds?.();
    if (!windowBounds) {
      logger.error('Cannot get window bounds');
      return;
    }
    
    // 使用传入的视口坐标，转换为屏幕坐标
    // 视口坐标是相对于窗口左上角的，需要加上窗口在屏幕上的位置
    const screenX = windowBounds.x + (viewportPos?.viewportX ?? pane.bbox.x);
    const screenY = windowBounds.y + (viewportPos?.viewportY ?? pane.bbox.y);
    
    logger.debug('Creating child window at screen:', { screenX, screenY, viewportPos, windowBounds });
    
    // 创建独立窗口 - 传递文本长度让主进程计算合适的大小
    const result = await window.electron?.glass?.createChildWindow?.({
      id: pane.id,
      text: pane.translatedText || pane.sourceText,
      x: screenX,
      y: screenY,
      // 不再传递固定大小，让主进程根据文本长度计算
      theme: theme,
    });
    
    if (result?.success) {
      // 从 childPanes 中移除（不再使用 frozenPanes）
      removeChildPane(id);
      logger.debug('Created independent child window:', id);
    } else {
      logger.error('Failed to create child window:', result?.error);
      // 失败时回退到内部冻结
      freezeChildPane(id);
    }
  }, [childPanes, theme, removeChildPane, freezeChildPane]);

  // ========== 穿透模式 ==========
  
  /**
   * 进入穿透模式
   * - 窗口变透明
   * - 鼠标可穿透（除了冻结的子玻璃板）
   */
  const enterPassThroughMode = useCallback(async () => {
    if (passThroughRef.current) return;
    
    passThroughRef.current = true;
    setIsPassThrough(true);
    
    logger.debug('Enter pass-through mode');
    
    try {
      // 设置窗口穿透
      await window.electron?.glass?.setPassThrough?.(true);
      // 降低透明度
      await window.electron?.glass?.setOpacity?.(0.3);
    } catch (e) {
      logger.error('Failed to enter pass-through mode:', e);
    }
  }, []);
  
  /**
   * 退出穿透模式
   */
  const exitPassThroughMode = useCallback(async () => {
    if (!passThroughRef.current) return;
    
    passThroughRef.current = false;
    setIsPassThrough(false);
    
    logger.debug('Exit pass-through mode');
    
    try {
      // 取消穿透
      await window.electron?.glass?.setPassThrough?.(false);
      // 恢复透明度
      await window.electron?.glass?.setOpacity?.(glassOpacity);
    } catch (e) {
      logger.error('Failed to exit pass-through mode:', e);
    }
  }, [glassOpacity]);

  // ========== 历史记录 ==========
  
  /**
   * 切换历史记录面板
   */
  const toggleHistoryPanel = useCallback(async () => {
    if (showHistoryPanel) {
      setShowHistoryPanel(false);
    } else {
      // 加载历史记录
      await loadHistory();
      setShowHistoryPanel(true);
    }
  }, [showHistoryPanel]);
  
  /**
   * 加载历史记录
   */
  const loadHistory = useCallback(async () => {
    try {
      const history = await window.electron?.glass?.getHistory?.(20);
      setHistoryItems(history || []);
    } catch (e) {
      logger.error('Failed to load history:', e);
      setHistoryItems([]);
    }
  }, []);
  
  /**
   * 选择历史记录项
   */
  const selectHistoryItem = useCallback((item) => {
    // 设置翻译结果
    if (item.translated) {
      const session = useSessionStore.getState();
      session.setSourceText(item.source || '');
      session.setResult(item.translated);
    }
    setShowHistoryPanel(false);
  }, []);

  // ========== 核心功能（调用 pipeline）==========
  const captureAndTranslate = useCallback(async () => {
    try {
      // 使用内容区的实际边界来截图，避免坐标偏移
      if (!contentRef.current) return;
      
      const contentRect = contentRef.current.getBoundingClientRect();
      // getBoundingClientRect 返回的是相对于视口的坐标
      // 在 Electron 无边框窗口中，视口就是窗口内容
      const windowBounds = await window.electron?.glass?.getBounds?.();
      if (!windowBounds) return;
      
      // 计算内容区在屏幕上的绝对位置
      const captureRect = {
        x: Math.round(windowBounds.x + contentRect.left),
        y: Math.round(windowBounds.y + contentRect.top),
        width: Math.round(contentRect.width),
        height: Math.round(contentRect.height),
      };
      
      logger.debug('Capture rect:', captureRect);
      logger.debug('Content rect:', contentRect);
      logger.debug('Window bounds:', windowBounds);
      
      await pipeline.runFromCapture(captureRect);
    } catch (error) {
      logger.error(' Capture failed:', error);
    }
  }, []);

  // ========== 渲染 ==========
  const isLoading = [STATUS.CAPTURING, STATUS.OCR_PROCESSING, STATUS.TRANSLATING].includes(status);

  return (
    <div 
      className={`glass-window ${showToolbar ? 'show-toolbar' : ''} ${isPassThrough ? 'pass-through' : ''} ${displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? 'scattered-mode' : ''}`}
      style={{ '--glass-opacity': glassOpacity }}
      data-theme={theme}
      onMouseEnter={handleMouseEnterWindow}
      onMouseLeave={handleMouseLeaveWindow}
    >
      {/* 顶部区域 */}
      <div className="glass-top-area">
        {/* 普通模式工具栏 */}
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
              <Camera size={12} />
            </button>
            
            <button 
              className={`toolbar-btn ${showHistoryPanel ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleHistoryPanel();
              }}
              title="历史记录 (Ctrl+H)"
            >
              <History size={12} />
            </button>
            
            <div 
              className="toolbar-handle"
              onClick={handleBarClick}
              title="点击调节透明度"
            >
              <GripHorizontal size={14} />
            </div>
          </div>
        
        {/* 关闭按钮 */}
        <button 
          className="glass-close-btn"
          onClick={handleClose}
          title="关闭 (Esc)"
        >
          <X size={12} />
        </button>
      </div>
      
      {/* 透明度滑块 */}
      {showOpacitySlider && (
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
      <div 
        className={`glass-content ${displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? 'scattered-mode' : ''}`}
        ref={contentRef}
        onClick={handleContentClick}
      >
        {status === STATUS.ERROR ? (
          <div className="glass-message error">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? (
          // 散点模式：显示子玻璃板
          <div className="scattered-panes-container">
            {childPanes.map((pane) => (
              <ChildGlassPane
                key={pane.id}
                pane={pane}
                parentBounds={glassBounds}
                onPositionChange={handleChildPanePositionChange}
                onFreeze={handleChildPaneFreeze}
                onClose={null}  // 未冻结的不显示关闭按钮
                theme={theme}
              />
            ))}
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
          </div>
        )}
      </div>
      
      {/* 滚动提示 */}
      {hasOverflow && displayMode !== DISPLAY_MODE.SCATTERED && (
        <button className="scroll-hint" onClick={scrollToBottom}>
          <ChevronDown size={14} />
          <span>更多</span>
        </button>
      )}
      
      {/* 冻结的子玻璃板（固定定位，可在窗口内自由移动） */}
      {frozenPanes.length > 0 && (
        <div className="frozen-panes-container">
          {frozenPanes.map((pane) => (
            <ChildGlassPane
              key={pane.id}
              pane={pane}
              parentBounds={null}  // 冻结的不需要检测是否拖出
              onPositionChange={handleChildPanePositionChange}
              onFreeze={null}  // 已经冻结了
              onClose={closeFrozenPane}
              theme={theme}
            />
          ))}
        </div>
      )}
      
      {/* 历史记录面板 */}
      {showHistoryPanel && (
        <div className="glass-history-panel">
          <div className="history-header">
            <span className="history-title">
              <Clock size={14} />
              历史记录
            </span>
            <button 
              className="history-close-btn"
              onClick={() => setShowHistoryPanel(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="history-list">
            {historyItems.length === 0 ? (
              <div className="history-empty">暂无历史记录</div>
            ) : (
              historyItems.map((item, index) => (
                <div 
                  key={item.id || index}
                  className="history-item"
                  onClick={() => selectHistoryItem(item)}
                >
                  <div className="history-source">{item.source?.slice(0, 50) || '...'}</div>
                  <div className="history-translated">{item.translated?.slice(0, 50) || '...'}</div>
                  <div className="history-meta">
                    {item.timestamp && new Date(item.timestamp).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      
      {/* 穿透模式指示器 */}
      {isPassThrough && (
        <div className="pass-through-indicator">
          <span>穿透模式 (松开 Alt 退出)</span>
        </div>
      )}
    </div>
  );
};

export default GlassTranslator;
