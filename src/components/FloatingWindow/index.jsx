// Floating translation overlay window. Pure UI shell over the session store;
// all capture/OCR/translate logic lives in services/pipeline.js.
// Supports scattered mode where each OCR block becomes its own child pane.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, X, Loader2, AlertCircle, ChevronDown, GripHorizontal, History, Clock, RefreshCw, Ghost, Brain } from 'lucide-react';
import useSessionStore, { STATUS, DISPLAY_MODE, CHILD_PANE_STATUS } from '../../stores/session.js';
import useConfigStore from '../../stores/config.js';
import pipeline from '../../services/pipeline.js';
import { resolveOverlaps } from '../../services/pane-layout.js';
import ChildPane from './ChildPane.jsx';
import AiActionIcon from '../shared/AiActionIcon.jsx';
import useAiActions from '../../hooks/use-ai-actions.js';
import { resolveActionLabel } from '../../services/ai-action-runner.js';
import createLogger from '../../utils/logger.js';
import './styles.css';

const logger = createLogger('FloatingWindow');

// Default OCR engine (llm-vision) needs a local vision model — new users without it
// hit this path. Keyword match triggers a "Go to OCR Settings" button on the error.
const OCR_ERROR_KEYWORDS = /ocr|vision|视觉|识别|视觉模型|qwen-vl|llava/i;
function isOcrRelatedError(msg) {
  return typeof msg === 'string' && OCR_ERROR_KEYWORDS.test(msg);
}

// Labels for the layout badge (pref lives in settings > 悬浮窗口 > 显示模式)
const MODE_LABEL_KEYS = {
  auto: ['floatingWindow.modeAuto', '自动'],
  scattered: ['floatingWindow.modeScattered', '散点'],
  unified: ['floatingWindow.modeUnified', '整段'],
};

const FloatingWindow = () => {
  const { t, i18n } = useTranslation();

  const {
    status,
    sourceText,
    translatedText,
    error,
    displayMode,
    childPanes,
    frozenPanes,
    modeInfo,
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
    floatingOpacity,
    targetLanguage,
    ocrEngine,
    understandMode,
    setUnderstandMode,
    setFloatingOpacity,
    setFloatingDisplayMode,
    setTargetLanguage,
    setSourceLanguage,
    setSameLanguageBehavior,
    setOcrEngine,
  } = useConfigStore();

  const [showToolbar, setShowToolbar] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [theme, setTheme] = useState('light');
  const [floatingWindowBounds, setFloatingBounds] = useState(null);
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

  // AI actions run on the recognized source text, not the translation — a
  // summary of a summary compounds whatever the translator got wrong. When a
  // vision model is configured they run on the capture itself instead.
  const attachAiResult = useCallback((payload) => {
    window.electron?.floatingWindow?.attachAiResult?.(payload);
  }, []);
  const ai = useAiActions('floating', attachAiResult);
  const captureImage = pipeline.getLastCaptureImage(sourceText);
  const aiActions = ai.availableActions({
    displayMode,
    text: sourceText,
    hasImage: !!captureImage,
    understandMode,
  });

  const runAction = useCallback(async (action) => {
    const result = await ai.run(
      action,
      {
        sourceText,
        translatedText,
        sourceLanguage: 'auto',
        targetLanguage,
        imageData: pipeline.getLastCaptureImage(sourceText),
      },
      theme
    );
    if (!result.success) {
      setToastMessage({ message: result.error, type: 'error' });
      setTimeout(() => setToastMessage(null), 5000);
    }
  }, [ai, sourceText, translatedText, targetLanguage, theme]);

  const contentRef = useRef(null);
  const toolbarTimerRef = useRef(null);
  const rootRef = useRef(null);
  // Mirrors of state for closures inside event handlers (avoid stale-state bugs)
  const passThroughRef = useRef(false);
  const showHistoryPanelRef = useRef(false);
  const savedOpacityRef = useRef(0.85);
  // Sticky pass-through survives blur (unlike the momentary Alt hold);
  // regionIgnoreRef tracks the current setIgnoreMouseEvents state so the
  // mousemove-driven region toggle only IPCs on boundary crossings.
  const [stickyPassThrough, setStickyPassThrough] = useState(false);
  const stickyPassThroughRef = useRef(false);
  const regionIgnoreRef = useRef(false);
  const exitStickyRef = useRef(null);

  useEffect(() => {
    showHistoryPanelRef.current = showHistoryPanel;
  }, [showHistoryPanel]);

  useEffect(() => {
    savedOpacityRef.current = floatingOpacity;
  }, [floatingOpacity]);

  useEffect(() => {
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
        setFloatingBounds(newBounds);
      }
    };

    updateContentBounds();
    const boundsInterval = setInterval(updateContentBounds, 500);

    const handleKeyDown = async (e) => {
      // Alt = momentary pass-through (release reverts)
      if (e.key === 'Alt' && !passThroughRef.current) {
        passThroughRef.current = true;
        try {
          await window.electron?.floatingWindow?.setPassThrough?.(true);
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
        // ESC priority: sticky pass-through > history panel > scattered panes > close
        if (stickyPassThroughRef.current) {
          exitStickyRef.current?.();
        } else if (showHistoryPanelRef.current) {
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
            const history = await window.electron?.floatingWindow?.getHistory?.(20);
            setHistoryItems(history || []);
          } catch (err) {
            logger.error('Failed to load history:', err);
          }
          setShowHistoryPanel(true);
        }
      }
    };

    // Alt keyup / blur end only the MOMENTARY hold — sticky mode must survive
    // both (losing focus on every click-through is its whole reason to exist).
    const handleKeyUp = async (e) => {
      if (e.key === 'Alt' && passThroughRef.current && !stickyPassThroughRef.current) {
        passThroughRef.current = false;
        try {
          await window.electron?.floatingWindow?.setPassThrough?.(false);
        } catch (err) {
          logger.error('Failed to exit pass-through mode:', err);
        }
        window.dispatchEvent(new CustomEvent('passthrough-change', { detail: false }));
      }
    };

    // Window blur also exits the Alt hold, otherwise alt-tab leaves it stuck on
    const handleBlur = async () => {
      if (passThroughRef.current && !stickyPassThroughRef.current) {
        passThroughRef.current = false;
        try {
          await window.electron?.floatingWindow?.setPassThrough?.(false);
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
    if (window.electron?.floatingWindow?.onSettingsChanged) {
      unsubscribeSettings = window.electron.floatingWindow.onSettingsChanged((newSettings) => {
        // Stack + OCR reloads are main-process-internal now — this channel
        // only carries the window's UI settings (opacity/engine/theme/langs).
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
      const settings = await window.electron?.floatingWindow?.getSettings?.();
      if (settings) {
        logger.debug('Loaded settings from main:', settings);

        if (settings.opacity !== undefined) {
          setFloatingOpacity(settings.opacity);
        }

        if (settings.targetLanguage) {
          logger.debug('Syncing targetLanguage:', settings.targetLanguage);
          setTargetLanguage(settings.targetLanguage);
        }

        // The pipeline auto-detects the actual text language per capture; the
        // configured source is mirrored only so 'swap' knows the other side.
        if (settings.sourceLanguage) {
          setSourceLanguage(settings.sourceLanguage);
        }

        if (settings.sameLanguageBehavior) {
          setSameLanguageBehavior(settings.sameLanguageBehavior);
        }

        if (settings.ocrEngine) {
          setOcrEngine(settings.ocrEngine);
        }

        // Display-mode pref lives in the settings page. On change, re-layout
        // the stashed capture immediately so the switch is visible without a
        // fresh screenshot (no-ops when nothing was captured yet).
        if (settings.displayMode) {
          const prev = useConfigStore.getState().floatingDisplayMode;
          if (settings.displayMode !== prev) {
            setFloatingDisplayMode(settings.displayMode);
            pipeline.rerunLastCapture();
          }
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
      // Sticky pass-through keeps the top strip visible — it is the exit.
      if (stickyPassThroughRef.current) return;
      setShowToolbar(false);
      setShowOpacitySlider(false);
    }, 300);
  };

  const handleClose = async () => {
    setAutoRefresh(false);

    // Close detached child windows first so they don't outlive the parent
    try {
      await window.electron?.floatingWindow?.closeAllChildWindows?.();
    } catch (e) {
      logger.error('Failed to close child windows:', e);
    }

    window.electron?.floatingWindow?.close?.();
  };

  const handleBarClick = () => {
    setShowOpacitySlider(prev => !prev);
  };

  // Manual title-bar drag. -webkit-app-region is dead on this transparent
  // frameless window (E42, installed builds too), so track the pointer and
  // stream window positions to main. Interactive islands (buttons, toolbar,
  // opacity popup) are excluded so their clicks keep working.
  const handleTitleBarMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .floating-toolbar, .opacity-popup, .refresh-popup')) return;
    e.preventDefault();

    // Dragging the window means the watched region is about to change —
    // stop the auto-refresh loop (user re-arms it after repositioning).
    setAutoRefresh(false);
    setShowRefreshPicker(false);

    // Grab offset inside the window; window.screenX/Y and e.screenX/Y share the
    // same DIP coordinate space, matching BrowserWindow.setBounds.
    const offsetX = e.screenX - window.screenX;
    const offsetY = e.screenY - window.screenY;

    // Lock the size for the whole drag (fetched once): re-deriving it per frame
    // accumulates fractional-DPI rounding and the window grows while dragging.
    let dragSize = null;
    window.electron?.floatingWindow?.getBounds?.().then((b) => {
      if (b && Number.isFinite(b.width)) dragSize = { width: b.width, height: b.height };
    }).catch(() => {});

    let pending = null;
    let raf = 0;
    const onMove = (ev) => {
      pending = { x: ev.screenX - offsetX, y: ev.screenY - offsetY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // Hold moves until the locked size arrives (resolves within a frame or
        // two) — a bare position update would re-round the size and drift it.
        if (pending && dragSize) {
          window.electron?.floatingWindow?.moveTo?.(pending.x, pending.y, dragSize.width, dragSize.height);
        }
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Opacity is applied via CSS variable (--floating-opacity) so child panes stay
  // opaque; the IPC call persists it window-locally so it survives relaunch
  // and settings-changed broadcasts.
  const handleOpacityChange = async (e) => {
    const newOpacity = parseFloat(e.target.value);
    setFloatingOpacity(newOpacity);
    try {
      await window.electron?.floatingWindow?.setOpacity?.(newOpacity);
    } catch (err) {
      logger.debug('Failed to persist opacity:', err.message);
    }
  };

  const scrollToBottom = () => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  // Capture screen region that maps to this floating window's content area.
  // Defined as a callback because the keyboard handler closes over it.
  // keepDedup=true (auto-refresh) skips work on unchanged frames; manual
  // captures (space/button/global hotkey) force a fresh translate.
  const captureAndTranslate = useCallback(async ({ keepDedup = false } = {}) => {
    try {
      // A manual capture (button/Space/global hotkey) takes over — stop the
      // auto-refresh loop instead of fighting it.
      if (!keepDedup) setAutoRefresh(false);
      if (!contentRef.current) return;

      const contentRect = contentRef.current.getBoundingClientRect();
      const windowBounds = await window.electron?.floatingWindow?.getBounds?.();
      if (!windowBounds) return;

      // Window bounds are screen-absolute; contentRect is window-relative
      const captureRect = {
        x: Math.round(windowBounds.x + contentRect.left),
        y: Math.round(windowBounds.y + contentRect.top),
        width: Math.round(contentRect.width),
        height: Math.round(contentRect.height),
        keepDedup,
      };

      await pipeline.runFromCapture(captureRect);
    } catch (error) {
      logger.error('Capture failed:', error);
    }
  }, []);

  // Auto-refresh: re-capture the region on a timer so a live-updating area
  // (Teams captions, video subtitles) stays translated hands-free without the
  // window ever taking focus. Flow per user spec: click the button → pick an
  // interval → it starts; moving the window, a manual capture, or closing
  // stops it (an explicit start each session, never auto-resumed). Silent
  // dedupe in the pipeline means unchanged frames cost nothing and don't
  // touch the UI. Intervals sized for OCR+LLM latency — 1.5s was faster than
  // a full recognize+translate round trip.
  const AUTO_REFRESH_INTERVALS = [2, 3, 5, 10];
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showRefreshPicker, setShowRefreshPicker] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('floating-auto-refresh-interval'), 10);
      return AUTO_REFRESH_INTERVALS.includes(saved) ? saved : 3;
    } catch { return 3; }
  });

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (document.hidden) return; // window hidden — nothing to capture
      captureAndTranslate({ keepDedup: true });
    }, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, captureAndTranslate]);

  // Button: running → stop; idle → open the interval picker.
  const handleAutoRefreshClick = useCallback(() => {
    if (autoRefresh) {
      setAutoRefresh(false);
    } else {
      setShowRefreshPicker((prev) => !prev);
    }
  }, [autoRefresh]);

  const startAutoRefresh = useCallback((seconds) => {
    setRefreshInterval(seconds);
    try { localStorage.setItem('floating-auto-refresh-interval', String(seconds)); } catch { /* ignore */ }
    setShowRefreshPicker(false);
    setAutoRefresh(true);
  }, []);

  // Global-hotkey re-capture: fires while another app holds focus, so the
  // target never loses foreground (the whole point vs the in-window Space key).
  useEffect(() => {
    const off = window.electron?.floatingWindow?.onTriggerCapture?.(() => {
      captureAndTranslate({ keepDedup: false });
    });
    return () => { if (off) off(); };
  }, [captureAndTranslate]);

  const handleContentClick = useCallback((e) => {
    // Any pass-through flavor: content clicks belong to the app below, never
    // trigger a capture (the old accidental-recognition complaint).
    if (passThroughRef.current) return;
    // Only fire toggle on bare-container clicks, not on child panes/text
    if (
      e.target === e.currentTarget ||
      e.target.classList.contains('scattered-panes-container') ||
      e.target.classList.contains('floating-message')
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

  // De-overlap pass: pane frames (padding/min-width/translated text) are
  // bigger than the OCR line boxes they anchor to, so tightly stacked blocks
  // produce unreadable overlaps. Once a batch settles (no pane pending or
  // translating — sizes are locked then), measure the real rendered frames
  // and let the layout policy (pane-layout.js: significant collisions only,
  // minimal bidirectional shift, capped drift) decide the moves. Runs once
  // per batch so it never fights the user's own drags.
  const deoverlapKeyRef = useRef('');
  useEffect(() => {
    if (displayMode !== DISPLAY_MODE.SCATTERED || childPanes.length < 2) return;
    const busy = childPanes.some(
      (p) => p.status === CHILD_PANE_STATUS.PENDING || p.status === CHILD_PANE_STATUS.TRANSLATING
    );
    if (busy) return;
    const batchKey = childPanes.map((p) => p.id).join('|');
    if (deoverlapKeyRef.current === batchKey) return;
    deoverlapKeyRef.current = batchKey;

    const rects = childPanes
      .map((p) => {
        const el = document.querySelector(`[data-pane-id="${p.id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id: p.id, x: p.bbox.x, y: p.bbox.y, w: r.width, h: r.height };
      })
      .filter(Boolean);

    for (const [id, y] of resolveOverlaps(rects)) {
      updateChildPanePosition(id, { y });
    }
  }, [childPanes, displayMode, updateChildPanePosition]);

  // Double-click detaches a scattered pane into its own OS-level window.
  // viewportPos comes from the child component's mouse handler.
  const handleChildPaneFreeze = useCallback(async (id, viewportPos) => {
    const pane = childPanes.find(p => p.id === id);
    if (!pane) return;

    const windowBounds = await window.electron?.floatingWindow?.getBounds?.();
    if (!windowBounds) {
      logger.error('Cannot get window bounds');
      return;
    }

    // viewport (relative to our window) -> screen-absolute
    const screenX = windowBounds.x + (viewportPos?.viewportX ?? pane.bbox.x);
    const screenY = windowBounds.y + (viewportPos?.viewportY ?? pane.bbox.y);

    logger.debug('Creating child window at screen:', { screenX, screenY, viewportPos, windowBounds });

    // Main process sizes the window from the text length
    const result = await window.electron?.floatingWindow?.createChildWindow?.({
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

  // Sticky pass-through: content clicks fall through to the app below while
  // the top strip stays clickable — the forwarded mousemove stream drives
  // setIgnoreMouseEvents by cursor region. Unlike the Alt hold this needs no
  // focus, so it survives the very click-through it exists for (manga flow:
  // page the reader through the overlay, auto-refresh re-translates).
  const enterStickyPassThrough = useCallback(async () => {
    stickyPassThroughRef.current = true;
    passThroughRef.current = true;
    setStickyPassThrough(true);
    setIsPassThrough(true);
    setShowToolbar(true);
    regionIgnoreRef.current = true;
    try {
      await window.electron?.floatingWindow?.setPassThrough?.(true);
    } catch (e) {
      logger.error('Failed to enter sticky pass-through:', e);
    }
  }, []);

  const exitStickyPassThrough = useCallback(async () => {
    stickyPassThroughRef.current = false;
    passThroughRef.current = false;
    setStickyPassThrough(false);
    setIsPassThrough(false);
    regionIgnoreRef.current = false;
    try {
      await window.electron?.floatingWindow?.setPassThrough?.(false);
    } catch (e) {
      logger.error('Failed to exit sticky pass-through:', e);
    }
  }, []);

  useEffect(() => {
    exitStickyRef.current = exitStickyPassThrough;
  }, [exitStickyPassThrough]);

  const toggleStickyPassThrough = useCallback(() => {
    if (stickyPassThroughRef.current) {
      exitStickyPassThrough();
    } else {
      enterStickyPassThrough();
    }
  }, [enterStickyPassThrough, exitStickyPassThrough]);

  // Region toggle: over the top strip → accept mouse (toolbar clickable),
  // below it → ignore (clicks pass through). Only IPC on boundary crossings.
  useEffect(() => {
    if (!stickyPassThrough) return;
    const onMove = (e) => {
      const topEl = document.querySelector('.floating-top-area');
      const boundary = topEl ? topEl.getBoundingClientRect().bottom : 30;
      const wantIgnore = e.clientY > boundary;
      if (wantIgnore !== regionIgnoreRef.current) {
        regionIgnoreRef.current = wantIgnore;
        try {
          window.electron?.floatingWindow?.setPassThrough?.(wantIgnore);
        } catch { /* window may be closing */ }
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [stickyPassThrough]);

  const enterPassThroughMode = useCallback(async () => {
    if (passThroughRef.current) return;

    passThroughRef.current = true;
    setIsPassThrough(true);

    logger.debug('Enter pass-through mode');

    try {
      await window.electron?.floatingWindow?.setPassThrough?.(true);
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
      await window.electron?.floatingWindow?.setPassThrough?.(false);
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
      const history = await window.electron?.floatingWindow?.getHistory?.(20);
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

  // Result-area badge, shown only where it carries information: auto mode
  // (which way did the heuristic decide) and the forced-scattered fallback
  // (engine gave no coordinates). A user-pinned mode needs no echo.
  const modeLabel = (m) => t(...(MODE_LABEL_KEYS[m] || MODE_LABEL_KEYS.auto));
  const modeChipText = !modeInfo
    ? ''
    : modeInfo.pref === 'auto'
      ? `${modeLabel('auto')} · ${modeLabel(modeInfo.effective)}`
      : modeInfo.fellBack
        ? `${modeLabel(modeInfo.pref)} → ${modeLabel(modeInfo.effective)}`
        : '';
  const modeChipTitle = modeInfo?.fellBack
    ? t('floatingWindow.modeFallbackHint', '引擎未返回文字坐标，已按整段显示')
    : undefined;

  return (
    <div
      className={`floating-window ${showToolbar ? 'show-toolbar' : ''} ${isPassThrough && !stickyPassThrough ? 'pass-through' : ''} ${stickyPassThrough ? 'pass-through-sticky' : ''} ${displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? 'scattered-mode' : ''}`}
      style={{ '--floating-opacity': floatingOpacity }}
      data-theme={theme}
      onMouseEnter={handleMouseEnterWindow}
      onMouseLeave={handleMouseLeaveWindow}
    >
      <div className="floating-top-area" onMouseDown={handleTitleBarMouseDown}>
          <div className="floating-toolbar">
            <button
              className="toolbar-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                captureAndTranslate();
              }}
              disabled={isLoading}
              title={t('floatingWindow.captureSpace', '截图识别 (Space)')}
            >
              <Camera size={12} />
            </button>

            <button
              className={`toolbar-btn ${autoRefresh ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAutoRefreshClick();
              }}
              title={autoRefresh
                ? t('floatingWindow.autoRefreshRunning', '自动刷新中（{{s}}s），点击停止', { s: refreshInterval })
                : t('floatingWindow.autoRefresh', '自动刷新（盯住区域循环截译，目标不失焦）')}
            >
              <RefreshCw size={12} className={autoRefresh ? 'spinning-slow' : undefined} />
            </button>

            <button
              className={`toolbar-btn ${stickyPassThrough ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleStickyPassThrough();
              }}
              title={stickyPassThrough
                ? t('floatingWindow.passThroughOn', '穿透中，点击退出（内容区点击直达下层应用）')
                : t('floatingWindow.passThroughToggle', '鼠标穿透：内容区点击直达下层应用，顶栏保持可点')}
            >
              <Ghost size={12} />
            </button>

            <button
              className={`toolbar-btn ${showHistoryPanel ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleHistoryPanel();
              }}
              title={t('floatingWindow.historyCtrlH', '历史记录 (Ctrl+H)')}
            >
              <History size={12} />
            </button>

            {ai.capabilities.text || ai.capabilities.vision ? (
              <button
                className={`toolbar-btn ${understandMode ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setUnderstandMode(!understandMode);
                }}
                title={understandMode
                  ? t('floatingWindow.understandModeOn', '理解模式已开，点击关闭')
                  : t('floatingWindow.understandMode', '理解模式：对这块内容再做一层理解')}
              >
                <Brain size={12} />
              </button>
            ) : null}

            {aiActions.map((action) => (
              <button
                key={action.id}
                className="toolbar-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  runAction(action);
                }}
                disabled={ai.runningId === action.id}
                title={ai.pathFor(action, !!captureImage) === 'vision'
                  ? `${resolveActionLabel(action, i18n.language)} · ${t('aiActions.sendsCapture', '会把这张截图发给视觉模型')}`
                  : resolveActionLabel(action, i18n.language)}
              >
                {ai.runningId === action.id
                  ? <Loader2 size={12} className="spin" />
                  : <AiActionIcon name={action.icon} size={12} />}
              </button>
            ))}

            <div
              className="toolbar-handle"
              onClick={handleBarClick}
              title={t('floatingWindow.adjustOpacity', '点击调节透明度')}
            >
              <GripHorizontal size={14} />
            </div>
          </div>

        <button
          className="floating-close-btn"
          onClick={handleClose}
          title={t('floatingWindow.closeEsc', '关闭 (Esc)')}
        >
          <X size={12} />
        </button>
      </div>

      {showOpacitySlider && (
        <div className="opacity-popup" onMouseLeave={() => setShowOpacitySlider(false)}>
          <span className="opacity-label">{t('floatingWindow.opacity', '透明度')}</span>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={floatingOpacity}
            onChange={handleOpacityChange}
          />
          <span className="opacity-value">{Math.round(floatingOpacity * 100)}%</span>
        </div>
      )}

      {showRefreshPicker && (
        <div className="refresh-popup" onMouseLeave={() => setShowRefreshPicker(false)}>
          <span className="opacity-label">{t('floatingWindow.autoRefreshInterval', '刷新间隔')}</span>
          {AUTO_REFRESH_INTERVALS.map((s) => (
            <button
              key={s}
              className={`refresh-interval-btn ${s === refreshInterval ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startAutoRefresh(s);
              }}
            >
              {s}s
            </button>
          ))}
        </div>
      )}

      {toastMessage && (
        <div
          className={`floating-toast floating-toast-${toastMessage.type || 'info'}`}
          onClick={() => setToastMessage(null)}
        >
          <span>{toastMessage.message}</span>
        </div>
      )}

      <div
        className={`floating-content ${displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? 'scattered-mode' : ''}`}
        ref={contentRef}
        onClick={handleContentClick}
      >
        {status === STATUS.ERROR ? (
          <div className="floating-message error">
            <AlertCircle size={20} />
            <span>{error}</span>
            {isOcrRelatedError(error) && (
              <button
                className="floating-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  window.electron?.floatingWindow?.openMainSettings?.('ocr');
                }}
              >
                {t('floatingWindow.goToOcrSettings')}
              </button>
            )}
          </div>
        ) : displayMode === DISPLAY_MODE.SCATTERED && childPanes.length > 0 ? (
          <div className="scattered-panes-container">
            {modeChipText && (
              <div className="mode-indicator in-scattered" title={modeChipTitle}>{modeChipText}</div>
            )}
            {childPanes.map((pane) => (
              <ChildPane
                key={pane.id}
                pane={pane}
                parentBounds={floatingWindowBounds}
                onPositionChange={handleChildPanePositionChange}
                onFreeze={handleChildPaneFreeze}
                onClose={null}
                theme={theme}
              />
            ))}
          </div>
        ) : isLoading ? (
          <div className="floating-message loading">
            <Loader2 className="spin" size={24} />
            <span>
              {status === STATUS.CAPTURING && t('floatingWindow.capturing', '截图中...')}
              {status === STATUS.OCR_PROCESSING && t('floatingWindow.recognizing', '识别中...')}
              {status === STATUS.TRANSLATING && t('floatingWindow.translating', '翻译中...')}
            </span>
          </div>
        ) : translatedText ? (
          <div className="floating-result">
            {modeChipText && (
              <div className="mode-indicator" title={modeChipTitle}>{modeChipText}</div>
            )}
            {translatedText}
          </div>
        ) : (
          <div className="floating-message placeholder">
            <span>{t('floatingWindow.captureHint', '点击 📷 或按 Space 截图识别')}</span>
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
            <ChildPane
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
        <div className="floating-history-panel">
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
          <span>
            {stickyPassThrough
              ? t('floatingWindow.passThroughSticky', '穿透中 · 顶栏可点击退出 (Esc)')
              : t('floatingWindow.passThroughMode')}
          </span>
        </div>
      )}
    </div>
  );
};

export default FloatingWindow;
