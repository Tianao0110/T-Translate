// Glass overlay translation window. Pure UI shell over the session store;
// all capture/OCR/translate logic lives in services/pipeline.js.
// Supports scattered mode where each OCR block becomes its own child pane.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, X, Loader2, AlertCircle, ChevronDown, GripHorizontal, History, Clock } from 'lucide-react';
import useSessionStore, { STATUS, DISPLAY_MODE } from '../../stores/session.js';
import useConfigStore from '../../stores/config.js';
import pipeline from '../../services/pipeline.js';
import ChildGlassPane from './ChildGlassPane.jsx';
import createLogger from '../../utils/logger.js';
import './styles.css';

const logger = createLogger('Glass');

// Default OCR engine (llm-vision) needs a local vision model — new users without it
// hit this path. Keyword match triggers a "Go to OCR Settings" button on the error.
const OCR_ERROR_KEYWORDS = /ocr|vision|视觉|识别|视觉模型|qwen-vl|llava/i;
function isOcrRelatedError(msg) {
  return typeof msg === 'string' && OCR_ERROR_KEYWORDS.test(msg);
}

const GlassTranslator = () => {
  const { t } = useTranslation();

  const {
    status,
    translatedText,
    error,
    displayMode,
    childPanes,
    frozenPanes,
    notification,
    updateChildPanePosition,
    freezeChildPane,
    removeChildPane,
    closeFrozenPane,
    clearChildPanes,
    clearNotification,
    clear,
  } = useSessionStore();

  const {
    glassOpacity,
    targetLanguage,
    lockTargetLang,
    ocrEngine,
    setGlassOpacity,
    setTargetLanguage,
    setSourceLanguage,
    setLockTargetLang,
    setOcrEngine,
  } = useConfigStore();

  const [showToolbar, setShowToolbar] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [theme, setTheme] = useState('light');
  const [glassBounds, setGlassBounds] = useState(null);
  const [isPassThrough, setIsPassThrough] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);

  // Service-layer notifications (e.g. OCR engine fallback) bubble up via session store
  useEffect(() => {
    if (notification) {
      setToastMessage(notification);
      clearNotification();
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification, clearNotification]);

  const contentRef = useRef(null);
  const toolbarTimerRef = useRef(null);
  const glassRef = useRef(null);
  // Mirrors of state for closures inside event handlers (avoid stale-state bugs)
  const passThroughRef = useRef(false);
  const showHistoryPanelRef = useRef(false);
  const savedOpacityRef = useRef(0.85);

  useEffect(() => {
    showHistoryPanelRef.current = showHistoryPanel;
  }, [showHistoryPanel]);

  useEffect(() => {
    savedOpacityRef.current = glassOpacity;
  }, [glassOpacity]);

  useEffect(() => {
    pipeline.init();

    loadSettings();

    // Theme: prefer the IPC sync handshake, fall back to store, then localStorage
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
        const settings = await window.electron?.store?.get?.('settings') || {};
        const savedTheme = settings.interface?.theme || localStorage.getItem('theme') || 'light';
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
      } catch (e) {
        logger.debug('Failed to load theme:', e);
      }
    };
    loadTheme();

    // Track content-area bounds so child-pane drag detection knows the limits.
    // Poll because layout shifts (resize, scrollbar appearing) don't fire events.
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

    updateContentBounds();
    const boundsInterval = setInterval(updateContentBounds, 500);

    const handleKeyDown = async (e) => {
      // Alt = momentary pass-through (release reverts)
      if (e.key === 'Alt' && !passThroughRef.current) {
        passThroughRef.current = true;
        try {
          await window.electron?.glass?.setPassThrough?.(true);
        } catch (err) {
          logger.error('Failed to enter pass-through mode:', err);
        }
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: true }));
        return;
      }

      if (e.key === 'Escape') {
        // Read live state — this handler is registered once on mount and a
        // closure over render-scope state would be frozen at first render.
        const s = useSessionStore.getState();
        // ESC priority: history panel > scattered panes > close window
        if (showHistoryPanelRef.current) {
          setShowHistoryPanel(false);
        } else if (s.displayMode === DISPLAY_MODE.SCATTERED && s.childPanes.length > 0) {
          s.clearChildPanes();
        } else {
          handleClose();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        const s = useSessionStore.getState();
        // Space toggles between capture and clear depending on current state
        if (s.translatedText || (s.displayMode === DISPLAY_MODE.SCATTERED && s.childPanes.length > 0)) {
          s.clearChildPanes();
          s.clear();
        } else {
          captureAndTranslate();
        }
      } else if (e.key === 'h' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (showHistoryPanelRef.current) {
          setShowHistoryPanel(false);
        } else {
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

    const handleKeyUp = async (e) => {
      if (e.key === 'Alt' && passThroughRef.current) {
        passThroughRef.current = false;
        try {
          await window.electron?.glass?.setPassThrough?.(false);
        } catch (err) {
          logger.error('Failed to exit pass-through mode:', err);
        }
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: false }));
      }
    };

    // Window blur also exits pass-through, otherwise alt-tab leaves it stuck on
    const handleBlur = async () => {
      if (passThroughRef.current) {
        passThroughRef.current = false;
        try {
          await window.electron?.glass?.setPassThrough?.(false);
        } catch (err) {
          logger.error('Failed to exit pass-through mode on blur:', err);
        }
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: false }));
      }
    };

    const handleContextMenu = (e) => {
      const s = useSessionStore.getState();
      if (s.displayMode === DISPLAY_MODE.SCATTERED && s.childPanes.length > 0) {
        e.preventDefault();
        s.clearChildPanes();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('contextmenu', handleContextMenu);

    const handlePassThroughChange = (e) => {
      setIsPassThrough(e.detail);
    };
    window.addEventListener('passthrough-change', handlePassThroughChange);

    let unsubscribeSettings = null;
    if (window.electron?.glass?.onSettingsChanged) {
      unsubscribeSettings = window.electron.glass.onSettingsChanged((newSettings) => {
        loadSettings();
        const newTheme = newSettings?.interface?.theme;
        if (newTheme && ['light', 'dark', 'fresh'].includes(newTheme)) {
          setTheme(newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
        }
      });
    }

    // Theme IPC broadcast from main (so settings changes propagate without re-render)
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

  useEffect(() => {
    if (contentRef.current) {
      const { scrollHeight, clientHeight } = contentRef.current;
      setHasOverflow(scrollHeight > clientHeight + 10);
    }
  }, [translatedText]);

  const loadSettings = async () => {
    try {
      const settings = await window.electron?.glass?.getSettings?.();
      if (settings) {
        logger.debug('Loaded settings from main:', settings);

        if (settings.opacity !== undefined) {
          setGlassOpacity(settings.opacity);
        }

        if (settings.targetLanguage) {
          logger.debug('Syncing targetLanguage:', settings.targetLanguage);
          setTargetLanguage(settings.targetLanguage);
        }

        if (settings.sourceLanguage) {
          setSourceLanguage(settings.sourceLanguage);
        }

        if (settings.lockTargetLang !== undefined) {
          setLockTargetLang(settings.lockTargetLang);
        }

        if (settings.ocrEngine || settings.globalOcrEngine) {
          setOcrEngine(settings.ocrEngine || settings.globalOcrEngine);
        }
      }
    } catch (error) {
      logger.error('Load settings failed:', error);
    }
  };

  const handleMouseEnterWindow = () => {
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    setShowToolbar(true);
  };

  const handleMouseLeaveWindow = () => {
    // 300ms delay catches the "mouse slipped off edge" case so the toolbar
    // doesn't flicker when the cursor briefly leaves and re-enters
    toolbarTimerRef.current = setTimeout(() => {
      setShowToolbar(false);
      setShowOpacitySlider(false);
    }, 300);
  };

  const handleClose = async () => {
    // Close detached child windows first so they don't outlive the parent
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

  // Opacity is applied via CSS variable (--glass-opacity) so child panes stay opaque.
  // BrowserWindow.setOpacity would dim children too.
  const handleOpacityChange = async (e) => {
    const newOpacity = parseFloat(e.target.value);
    setGlassOpacity(newOpacity);
  };

  const scrollToBottom = () => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  // Capture screen region that maps to this glass window's content area.
  // Defined as a callback because the keyboard handler closes over it.
  const captureAndTranslate = useCallback(async () => {
    try {
      if (!contentRef.current) return;

      const contentRect = contentRef.current.getBoundingClientRect();
      const windowBounds = await window.electron?.glass?.getBounds?.();
      if (!windowBounds) return;

      // Window bounds are screen-absolute; contentRect is window-relative
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
      logger.error('Capture failed:', error);
    }
  }, []);

  const handleContentClick = useCallback((e) => {
    // Only fire toggle on bare-container clicks, not on child panes/text
    if (
      e.target === e.currentTarget ||
      e.target.classList.contains('scattered-panes-container') ||
      e.target.classList.contains('glass-message')
    ) {
      if (translatedText || (displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0)) {
        clearChildPanes();
        clear();
      } else {
        captureAndTranslate();
      }
    }
  }, [displayMode, childPanes.length, translatedText, clearChildPanes, clear, captureAndTranslate]);

  const handleChildPanePositionChange = useCallback((id, position) => {
    updateChildPanePosition(id, position);
  }, [updateChildPanePosition]);

  // Double-click detaches a scattered pane into its own OS-level window.
  // viewportPos comes from the child component's mouse handler.
  const handleChildPaneFreeze = useCallback(async (id, viewportPos) => {
    const pane = childPanes.find(p => p.id === id);
    if (!pane) return;

    const windowBounds = await window.electron?.glass?.getBounds?.();
    if (!windowBounds) {
      logger.error('Cannot get window bounds');
      return;
    }

    // viewport (relative to our window) -> screen-absolute
    const screenX = windowBounds.x + (viewportPos?.viewportX ?? pane.bbox.x);
    const screenY = windowBounds.y + (viewportPos?.viewportY ?? pane.bbox.y);

    logger.debug('Creating child window at screen:', { screenX, screenY, viewportPos, windowBounds });

    // Main process sizes the window from the text length
    const result = await window.electron?.glass?.createChildWindow?.({
      id: pane.id,
      text: pane.translatedText || pane.sourceText,
      x: screenX,
      y: screenY,
      theme: theme,
    });

    if (result?.success) {
      removeChildPane(id);
      logger.debug('Created independent child window:', id);
    } else {
      logger.error('Failed to create child window:', result?.error);
      // Falling back to internal freeze keeps the pane usable even when
      // BrowserWindow creation fails (e.g. low memory). Frozen panes render in
      // viewport space — pass the pane's viewport position, derived from the
      // container offset when the drag handler didn't supply one.
      const contentRect = contentRef.current?.getBoundingClientRect();
      const fallbackViewportPos = viewportPos
        ? { x: viewportPos.viewportX, y: viewportPos.viewportY }
        : contentRect
          ? { x: pane.bbox.x + contentRect.left, y: pane.bbox.y + contentRect.top }
          : undefined;
      freezeChildPane(id, fallbackViewportPos);
    }
  }, [childPanes, theme, removeChildPane, freezeChildPane]);

  const enterPassThroughMode = useCallback(async () => {
    if (passThroughRef.current) return;

    passThroughRef.current = true;
    setIsPassThrough(true);

    logger.debug('Enter pass-through mode');

    try {
      await window.electron?.glass?.setPassThrough?.(true);
    } catch (e) {
      logger.error('Failed to enter pass-through mode:', e);
    }
  }, []);

  const exitPassThroughMode = useCallback(async () => {
    if (!passThroughRef.current) return;

    passThroughRef.current = false;
    setIsPassThrough(false);

    logger.debug('Exit pass-through mode');

    try {
      await window.electron?.glass?.setPassThrough?.(false);
    } catch (e) {
      logger.error('Failed to exit pass-through mode:', e);
    }
  }, []);

  const toggleHistoryPanel = useCallback(async () => {
    if (showHistoryPanel) {
      setShowHistoryPanel(false);
    } else {
      await loadHistory();
      setShowHistoryPanel(true);
    }
  }, [showHistoryPanel]);

  const loadHistory = useCallback(async () => {
    try {
      const history = await window.electron?.glass?.getHistory?.(20);
      setHistoryItems(history || []);
    } catch (e) {
      logger.error('Failed to load history:', e);
      setHistoryItems([]);
    }
  }, []);

  const selectHistoryItem = useCallback((item) => {
    if (item.translated) {
      const session = useSessionStore.getState();
      session.setSourceText(item.source || '');
      session.setResult(item.translated);
    }
    setShowHistoryPanel(false);
  }, []);

  const isLoading = [STATUS.CAPTURING, STATUS.OCR_PROCESSING, STATUS.TRANSLATING].includes(status);

  return (
    <div
      className={`glass-window ${showToolbar ? 'show-toolbar' : ''} ${isPassThrough ? 'pass-through' : ''} ${displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? 'scattered-mode' : ''}`}
      style={{ '--glass-opacity': glassOpacity }}
      data-theme={theme}
      onMouseEnter={handleMouseEnterWindow}
      onMouseLeave={handleMouseLeaveWindow}
    >
      <div className="glass-top-area">
          <div className="glass-toolbar">
            <button
              className="toolbar-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                captureAndTranslate();
              }}
              disabled={isLoading}
              title={t('glass.captureSpace', '截图识别 (Space)')}
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
              title={t('glass.historyCtrlH', '历史记录 (Ctrl+H)')}
            >
              <History size={12} />
            </button>

            <div
              className="toolbar-handle"
              onClick={handleBarClick}
              title={t('glass.adjustOpacity', '点击调节透明度')}
            >
              <GripHorizontal size={14} />
            </div>
          </div>

        <button
          className="glass-close-btn"
          onClick={handleClose}
          title={t('glass.closeEsc', '关闭 (Esc)')}
        >
          <X size={12} />
        </button>
      </div>

      {showOpacitySlider && (
        <div className="opacity-popup" onMouseLeave={() => setShowOpacitySlider(false)}>
          <span className="opacity-label">{t('glass.opacity', '透明度')}</span>
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

      {toastMessage && (
        <div
          className={`glass-toast glass-toast-${toastMessage.type || 'info'}`}
          onClick={() => setToastMessage(null)}
        >
          <span>{toastMessage.message}</span>
        </div>
      )}

      <div
        className={`glass-content ${displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? 'scattered-mode' : ''}`}
        ref={contentRef}
        onClick={handleContentClick}
      >
        {status === STATUS.ERROR ? (
          <div className="glass-message error">
            <AlertCircle size={20} />
            <span>{error}</span>
            {isOcrRelatedError(error) && (
              <button
                className="glass-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  window.electron?.glass?.openMainSettings?.('ocr');
                }}
              >
                {t('glass.goToOcrSettings')}
              </button>
            )}
          </div>
        ) : displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? (
          <div className="scattered-panes-container">
            {childPanes.map((pane) => (
              <ChildGlassPane
                key={pane.id}
                pane={pane}
                parentBounds={glassBounds}
                onPositionChange={handleChildPanePositionChange}
                onFreeze={handleChildPaneFreeze}
                onClose={null}
                theme={theme}
              />
            ))}
          </div>
        ) : isLoading ? (
          <div className="glass-message loading">
            <Loader2 className="spin" size={24} />
            <span>
              {status === STATUS.CAPTURING && t('glass.capturing', '截图中...')}
              {status === STATUS.OCR_PROCESSING && t('glass.recognizing', '识别中...')}
              {status === STATUS.TRANSLATING && t('glass.translating', '翻译中...')}
            </span>
          </div>
        ) : translatedText ? (
          <div className="glass-result">{translatedText}</div>
        ) : (
          <div className="glass-message placeholder">
            <span>{t('glass.captureHint', '点击 📷 或按 Space 截图识别')}</span>
          </div>
        )}
      </div>

      {hasOverflow && displayMode !== DISPLAY_MODE.SCATTERED && (
        <button className="scroll-hint" onClick={scrollToBottom}>
          <ChevronDown size={14} />
          <span>{t('selection.more', '更多')}</span>
        </button>
      )}

      {frozenPanes.length > 0 && (
        <div className="frozen-panes-container">
          {frozenPanes.map((pane) => (
            <ChildGlassPane
              key={pane.id}
              pane={pane}
              parentBounds={null}
              onPositionChange={handleChildPanePositionChange}
              onFreeze={null}
              onClose={closeFrozenPane}
              theme={theme}
            />
          ))}
        </div>
      )}

      {showHistoryPanel && (
        <div className="glass-history-panel">
          <div className="history-header">
            <span className="history-title">
              <Clock size={14} />
              {t('history.title', '历史记录')}
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
              <div className="history-empty">{t('history.empty', '暂无历史记录')}</div>
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

      {isPassThrough && (
        <div className="pass-through-indicator">
          <span>{t('glass.passThroughMode')}</span>
        </div>
      )}
    </div>
  );
};

export default GlassTranslator;
