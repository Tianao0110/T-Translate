import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import translationService from '../../services/translation.js';
import ttsManager, { TTS_STATUS } from '../../services/tts/index.js';
import createLogger from '../../utils/logger.js';
import { getShortErrorMessage } from '../../utils/error-handler.js';
import { detectLanguage } from '../../utils/text.js';
import './styles.css';

import { PRIVACY_MODES, THEMES, LANGUAGE_CODES, selectionDefaults } from '@config/defaults';

const logger = createLogger('Selection');

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

const DEFAULT_SETTINGS = {
  triggerTimeout: 4000,
  showSourceByDefault: false,
  autoCloseOnCopy: false,
  minChars: 2,
  maxChars: 500,
  windowOpacity: 95,
};

const DEFAULT_TRANSLATION = {
  targetLanguage: 'zh',
  sourceLanguage: 'auto',
};

// Shared validation between trigger-click and CapsLock-direct paths.
// Throws so callers can catch and surface an i18n message.
function validateSelectionText(text, settings, t) {
  if (!text || /^[\s\r\n]+$/.test(text)) {
    throw new Error(t('selection.emptyContent', '选中内容为空'));
  }
  if (text.length < settings.minChars) {
    throw new Error(t('selection.tooShort', '文字太短（最少 {{min}} 字符）').replace('{{min}}', settings.minChars));
  }
  if (text.length > settings.maxChars) {
    throw new Error(t('selection.tooLong', '文字太长（最多 {{max}} 字符）').replace('{{max}}', settings.maxChars));
  }
  // Require at least one alphanumeric / CJK char so blank punctuation runs are skipped
  if (!/[\w一-鿿぀-ヿ가-힯]/.test(text)) {
    throw new Error(t('selection.noValidText', '选中内容无有效文字'));
  }
  // 10+ repeats of the same char usually means OCR/encoding garbage
  if (/(.)\1{10,}/.test(text)) {
    throw new Error(t('selection.possibleGarbage', '选中内容可能是乱码'));
  }
  // Skip file paths: Windows drive/UNC, common POSIX absolute, file:// URL
  if (/^(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|\/(?:Users|home|usr|var|etc|tmp)\/|file:\/\/)/.test(text)) {
    throw new Error(t('selection.isFilePath', '选中内容是文件路径'));
  }
}

const SelectionTranslator = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState('idle');
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [error, setError] = useState('');
  const [isOcrError, setIsOcrError] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [rect, setRect] = useState(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState(THEMES.LIGHT);
  const [showSource, setShowSource] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [triggerReady, setTriggerReady] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [windowId, setWindowId] = useState(null);
  const [initialBounds, setInitialBounds] = useState(null);
  const [freezeHint, setFreezeHint] = useState(false);

  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);

  const sizedRef = useRef(false);
  // Bumped on every adjustWindowToContent run; a later run supersedes an
  // in-flight one so overlapping passes can't fight over the final bounds.
  const positionTokenRef = useRef(0);

  const frozenRef = useRef(false); // mirror of isFrozen for timer callbacks
  const autoHideTimerRef = useRef(null);
  const triggerReadyTimerRef = useRef(null);
  const contentRef = useRef(null);
  const translateTextRef = useRef(null);
  // Phase B pass-through: when main grabbed text in Layer 3, payload carries it.
  // handleTriggerClick prefers this over a second GET_TEXT IPC roundtrip.
  const prefetchedTextRef = useRef(null);
  // Bumped by resetSession on every new session. Async translate paths capture
  // it and bail after their await if a newer session started, so a stale result
  // never overwrites a fresh trigger.
  const generationRef = useRef(0);
  // Work area of the display the selection happened on (from the main payload).
  // Placement clamps to THIS monitor's bounds+origin, not window.screen (which
  // is only the current display and carries no global offset).
  const screenBoundsRef = useRef(null);
  // True while adjustWindowToContent is moving the window programmatically, so
  // the drag-to-freeze poll doesn't mistake our own setBounds for a user drag.
  const isAdjustingRef = useRef(false);

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

  // Central per-session reset. The window is reused (hidden, not closed), so
  // every entry point must scrub the previous session or its state leaks across
  // selections (stale OCR-error button, mouse position, in-flight translation,
  // still-speaking TTS). Bumps the generation so pending async work self-cancels.
  const resetSession = () => {
    generationRef.current += 1;
    ttsManager.stop();
    if (autoHideTimerRef.current) { clearTimeout(autoHideTimerRef.current); autoHideTimerRef.current = null; }
    if (triggerReadyTimerRef.current) { clearTimeout(triggerReadyTimerRef.current); triggerReadyTimerRef.current = null; }
    setError('');
    setCopied(false);
    setIsOcrError(false);
  };

  useEffect(() => {
    const removeShowListener = window.electron?.selection?.onShowTrigger?.((data) => {
      // Frozen windows are detached overlays; new triggers spawn fresh windows instead
      if (frozenRef.current) {
        logger.debug('Window is frozen, ignoring show trigger');
        return;
      }

      resetSession();

      setMousePos({ x: data.mouseX, y: data.mouseY });
      setRect(data.rect);
      screenBoundsRef.current = data.screenBounds || null;

      if (data.theme) setTheme(data.theme);

      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);

      const newTranslation = { ...DEFAULT_TRANSLATION, ...data.translation };
      setTranslation(newTranslation);

      setShowSource(newSettings.showSourceByDefault);

      setMode('trigger');
      setSourceText('');
      setTranslatedText('');
      sizedRef.current = false;
      setIsFrozen(false);
      setInitialBounds(null);

      // Phase B pass-through: take Layer-3 text if present.
      // Null out after assignment so a stale value can't leak into next cycle.
      prefetchedTextRef.current = data.text || null;

      // Debounce: ignore clicks for 100ms so a fast mouse-up doesn't fire trigger
      setTriggerReady(false);
      triggerReadyTimerRef.current = setTimeout(() => {
        setTriggerReady(true);
      }, 100);

      // handleAutoHide re-checks frozenRef before hiding
      autoHideTimerRef.current = setTimeout(() => {
        handleAutoHide();
      }, newSettings.triggerTimeout);
    });

    // Three result modes:
    //   { isLoading: true }           -> spinner
    //   { text }                      -> received OCR text, run translation here
    //   { sourceText, translatedText }-> pre-translated, just display
    const removeShowResultListener = window.electron?.selection?.onShowResult?.(async (data) => {
      // Frozen cards are detached overlays — a screenshot result must not overwrite one.
      if (frozenRef.current) {
        logger.debug('Frozen window ignoring result event');
        return;
      }
      resetSession();
      // Screenshot path has no cursor anchor — (0,0) routes adjustWindowToContent
      // through the startDrag branch (keep the window where main positioned it).
      setMousePos({ x: 0, y: 0 });

      if (data.theme) setTheme(data.theme);

      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);

      if (data.isLoading) {
        logger.debug('Showing loading state');
        setSourceText('');
        setTranslatedText('');
        sizedRef.current = false;
        setIsFrozen(false);
        setInitialBounds(null);
        setMode('loading');
        return;
      }

      if (data.text && !data.translatedText) {
        logger.debug('Received OCR text, translating...');
        const gen = generationRef.current;
        if (data.targetLanguage) {
          setTranslation(prev => ({ ...prev, targetLanguage: data.targetLanguage }));
        }
        setSourceText(data.text);
        setShowSource(newSettings.showSourceByDefault);
        sizedRef.current = false;
        setIsFrozen(false);
        setInitialBounds(null);
        setMode('loading');

        try {
          // Pass langs explicitly — state update is async and won't be visible yet
          const overrideTargetLang = data.targetLanguage || data.translation?.targetLanguage || null;
          const overrideSourceLang = data.sourceLanguage || data.translation?.sourceLanguage || null;
          const translationResult = await translateTextRef.current(data.text, 0, overrideTargetLang, overrideSourceLang);
          if (gen !== generationRef.current) return; // superseded by a newer session
          setTranslatedText(translationResult);
          setError('');
          setMode('overlay');

          if (translationResult) {
            window.electron?.selection?.addToHistory?.({
              source: data.text,
              result: translationResult,
              timestamp: Date.now(),
              from: 'screenshot',
            });
          }
        } catch (err) {
          if (gen !== generationRef.current) return;
          setError(err.message || t('selection.translateFailed', '翻译失败'));
          setTranslatedText('');
          setMode('overlay');
        }
        return;
      }

      if (data.sourceText && data.translatedText) {
        logger.debug('Received translation result');
        setTranslation({
          targetLanguage: data.targetLanguage || 'zh',
          sourceLanguage: data.sourceLanguage || 'auto',
        });
        setShowSource(true);
        setSourceText(data.sourceText);
        setTranslatedText(data.translatedText);
        setIsOcrError(data.isOcrError === true); // override resetSession's clear
        setIsFrozen(false);
        // Don't reset sizedRef/initialBounds — caller already positioned us
        setMode('overlay');

        if (newSettings.triggerTimeout > 0) {
          autoHideTimerRef.current = setTimeout(() => {
            handleAutoHide();
          }, newSettings.triggerTimeout);
        }
      }
    });

    // Sticky direct path: main process detects CapsLock + selection and pushes
    // text directly. Skips the trigger-icon UX (loading -> overlay), but shares
    // settings/validation with the trigger-click path.
    const removeShowDirectListener = window.electron?.selection?.onShowDirect?.(async (data) => {
      logger.debug('SHOW_DIRECT received', { textLength: data?.text?.length });

      resetSession();
      // Direct path anchors at the selection point main captured (payload coords).
      setMousePos({ x: data.mouseX || 0, y: data.mouseY || 0 });
      screenBoundsRef.current = data.screenBounds || null;

      if (data.theme) setTheme(data.theme);
      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);
      const newTranslation = { ...DEFAULT_TRANSLATION, ...data.translation };
      setTranslation(newTranslation);
      setShowSource(newSettings.showSourceByDefault);

      setSourceText('');
      setTranslatedText('');
      sizedRef.current = false;
      setIsFrozen(false);
      setInitialBounds(null);
      setMode('loading');

      const gen = generationRef.current;
      try {
        const text = (data.text || '').trim();
        validateSelectionText(text, newSettings, t);

        setSourceText(text);

        const overrideTargetLang = newTranslation.targetLanguage || null;
        const overrideSourceLang = newTranslation.sourceLanguage || null;
        const translationResult = await translateTextRef.current(text, 0, overrideTargetLang, overrideSourceLang);
        if (gen !== generationRef.current) return; // superseded by a newer session
        setTranslatedText(translationResult);
        setError('');
        setMode('overlay');

        // from: 'hotkey' distinguishes this path in history vs 'selection' / 'screenshot'
        if (translationResult) {
          window.electron?.selection?.addToHistory?.({
            source: text,
            result: translationResult,
            timestamp: Date.now(),
            from: 'hotkey',
          });
        }
      } catch (err) {
        if (gen !== generationRef.current) return;
        logger.error('SHOW_DIRECT failed:', err);
        setError(err.message || t('selection.translateFailed', '翻译失败'));
        setTranslatedText('');
        setMode('overlay');
      }
    });

    const removeHideListener = window.electron?.selection?.onHide?.(() => {
      if (frozenRef.current) {
        logger.debug('Frozen window ignoring hide event');
        return;
      }
      ttsManager.stop();
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
    if (!triggerReady) {
      logger.debug('Trigger not ready yet, ignoring click');
      return;
    }

    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);

    // Snapshot the session so a new trigger arriving mid-fetch discards this result.
    const gen = generationRef.current;
    setMode('loading');

    try {
      // Phase B pass-through (see prefetchedTextRef comment). Fallback only
      // hits IPC if Layer 1/2 carried no text in the SHOW_TRIGGER payload.
      let text = prefetchedTextRef.current;
      prefetchedTextRef.current = null;
      if (!text) {
        const result = await window.electron?.selection?.getText?.(rect);
        text = result?.text;
      }
      if (gen !== generationRef.current) return; // superseded by a newer session
      if (!text) throw new Error(t('selection.noText', '未获取到文字'));
      text = text.trim();

      validateSelectionText(text, settings, t);

      setSourceText(text);
      const translationResult = await translateText(text);
      if (gen !== generationRef.current) return;
      setTranslatedText(translationResult);
      setError('');
      setMode('overlay');

      if (translationResult) {
        window.electron?.selection?.addToHistory?.({
          source: text,
          result: translationResult,
          timestamp: Date.now(),
          from: 'selection',
        });
      }
    } catch (err) {
      if (gen !== generationRef.current) return;
      setError(err.message || t('selection.translateFailed', '翻译失败'));
      setTranslatedText('');
      setMode('overlay');
    }
  };

  // Resize window to fit translated content, then reposition near mousePos.
  // Screenshot path has mousePos=(0,0); in that case only the size is adjusted.
  const adjustWindowToContent = async () => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    // Latest-wins guard: a re-run (e.g. toggling source) supersedes any pass
    // still waiting on its reflow timeout.
    const myToken = ++positionTokenRef.current;

    // Suppress the drag-to-freeze poll while we move the window ourselves.
    isAdjustingRef.current = true;

    const maxWidth = 400, minWidth = 160;
    const maxHeight = 350, minHeight = 65;
    const toolbarHeight = 36;

    // Clamp to the display the selection was on (origin-aware), not window.screen
    // — which is only the current monitor and drops multi-display offsets.
    const sb = screenBoundsRef.current;
    const originX = sb ? sb.x : 0;
    const originY = sb ? sb.y : 0;
    const sw = sb ? sb.width : (window.screen?.availWidth || 1920);
    const sh = sb ? sb.height : (window.screen?.availHeight || 1080);

    const hasValidMousePos = mousePos.x !== 0 || mousePos.y !== 0;

    const text = contentEl.innerText || '';
    const hasNewlines = text.includes('\n');

    // CJK chars take roughly 1.6x the width of Latin glyphs at the same font size
    const charCount = [...text].reduce((sum, ch) => sum + (/[一-鿿]/.test(ch) ? 1.6 : 1), 0);
    let width;
    if (hasNewlines || charCount > 40) {
      width = maxWidth;
    } else {
      width = Math.min(Math.max(charCount * 9 + 50, minWidth), maxWidth);
    }

    width = Math.round(width);

    // Anchor X (and the top Y) is computed ONCE and reused for both the measure
    // pass and the final pass, so the card can't shift horizontally between them.
    // Only Y is refined after height is known (flip above the cursor on overflow).
    let anchorX, topY;
    if (hasValidMousePos) {
      anchorX = mousePos.x - width / 2;
      if (anchorX < originX + 10) anchorX = originX + 10;
      if (anchorX + width > originX + sw - 10) anchorX = originX + sw - width - 10;
      anchorX = Math.round(anchorX);
      topY = Math.round(mousePos.y + 20);
    } else {
      const cb = await window.electron?.selection?.startDrag?.();
      anchorX = Math.round(cb?.x ?? 100);
      topY = Math.round(cb?.y ?? 100);
    }

    // Measure pass: lock width + tall height at the final X so content reflows.
    await window.electron?.selection?.setBounds?.({
      x: anchorX, y: topY, width, height: maxHeight
    });

    await new Promise(r => setTimeout(r, 20));
    if (positionTokenRef.current !== myToken) return; // superseded by a newer run

    // Temporarily allow content to size naturally so scrollHeight reflects real layout
    const origFlex = contentEl.style.flex;
    contentEl.style.flex = '0 0 auto';
    void contentEl.offsetHeight;

    const contentHeight = contentEl.scrollHeight;
    contentEl.style.flex = origFlex;

    const height = Math.min(Math.max(contentHeight + toolbarHeight + 16, minHeight), maxHeight);

    // Final pass: identical X/width, refine Y only.
    let y = topY;
    if (hasValidMousePos && y + height > originY + sh - 10) y = mousePos.y - height - 10;
    if (y < originY + 10) y = originY + 10;

    window.electron?.selection?.setBounds?.({
      x: anchorX, y: Math.round(y),
      width, height: Math.round(height)
    });

    // Let the bounds settle, then re-enable drag detection with the new position
    // as its baseline (see the drag poll's isAdjustingRef handling).
    setTimeout(() => {
      if (positionTokenRef.current === myToken) isAdjustingRef.current = false;
    }, 150);
  };

  useEffect(() => {
    // Fit the window to the card whenever we're in overlay mode — even on an
    // empty translation. Gating on (translatedText || error) meant an empty
    // result skipped the resize and the window stayed at the 40px trigger size.
    if (mode === 'overlay') {
      adjustWindowToContent();
    }
  }, [mode, translatedText, error, showSource]);

  const translateText = async (text, retryCount = 0, overrideTargetLang = null, overrideSourceLang = null) => {
    if (!translationService.initialized) {
      logger.debug('Initializing translation service...');
      await translationService.init();
    }

    // Override > state > default. Used by screenshot path which knows the lang
    // before the state hook update has propagated.
    let targetLang = overrideTargetLang || translation.targetLanguage || 'zh';
    const sourceLang = overrideSourceLang || translation.sourceLanguage || 'auto';

    // Selected text already in the target language would round-trip through
    // the provider unchanged ("translation" = the source text). The card has
    // no language picker, so flip to the other primary language — same
    // behavior as the floating window.
    if (detectLanguage(text) === targetLang) {
      targetLang = targetLang === 'zh' ? 'en' : 'zh';
      logger.debug(`Source already in target language, flipping to ${targetLang}`);
    }

    // Fetched per call, not at mount: this window is persistent (hide, not
    // close), so a cached mode would go stale when the user switches it.
    let privacyMode = PRIVACY_MODES.STANDARD;
    try {
      privacyMode = (await window.electron?.privacy?.getMode?.()) || PRIVACY_MODES.STANDARD;
    } catch (e) {
      logger.debug('Failed to get privacy mode, assuming standard:', e);
    }

    try {
      const result = await translationService.translate(text, {
        sourceLang: sourceLang,
        targetLang: targetLang,
        privacyMode: privacyMode,
        useCache: privacyMode !== PRIVACY_MODES.SECURE,
      });

      if (!result.success) {
        const errorMsg = getShortErrorMessage(result.error, { provider: result.provider });
        throw new Error(errorMsg);
      }

      if (!result.text) {
        throw new Error(t('selection.emptyResult', '翻译结果为空'));
      }

      return result.text;
    } catch (err) {
      // One automatic retry for transient network/fetch failures only
      if (retryCount < 1 && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('连接'))) {
        logger.debug('Retrying translation...');
        await new Promise(r => setTimeout(r, 1000));
        // Forward override langs on retry — otherwise retry would silently fall back to state
        return translateText(text, retryCount + 1, overrideTargetLang, overrideSourceLang);
      }

      const errorMsg = getShortErrorMessage(err);
      throw new Error(errorMsg);
    }
  };

  // Keep ref pointed at the latest translateText closure for timer callbacks
  useEffect(() => {
    translateTextRef.current = translateText;
  });

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!translatedText) return;

    window.electron?.clipboard?.writeText?.(translatedText);
    setCopied(true);

    if (settings.autoCloseOnCopy) {
      setTimeout(() => {
        ttsManager.stop();
        // Frozen cards live in the frozen pool — hide() would only conceal one,
        // leaving an invisible click-catcher; close it out properly.
        if (isFrozen && windowId) {
          window.electron?.selection?.closeFrozen?.(windowId);
        } else {
          window.electron?.selection?.hide?.();
        }
        setMode('idle');
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

    ttsManager.stop();

    // Frozen windows are tracked by ID in main; use the dedicated close channel
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

  const handleAutoHide = () => {
    if (frozenRef.current) {
      logger.debug('Window is pinned, skip auto-hide');
      return;
    }
    ttsManager.stop();
    setMode('idle');
    window.electron?.selection?.hide?.();
  };

  useEffect(() => {
    frozenRef.current = isFrozen;
  }, [isFrozen]);

  // Drag detection: -webkit-app-region: drag doesn't fire mouseup, so we poll
  // window bounds. When the user has moved the window >10px, freeze it into a
  // detached overlay so the next selection spawns a fresh trigger.
  useEffect(() => {
    if (mode !== 'overlay' || isFrozen) return;

    let lastCheckBounds = null;
    let checkCount = 0;
    const maxChecks = 100; // give up after 10s

    const checkInterval = setInterval(async () => {
      checkCount++;
      if (checkCount > maxChecks) {
        clearInterval(checkInterval);
        return;
      }

      try {
        const currentBounds = await window.electron?.selection?.startDrag?.();
        if (!currentBounds) return;

        // While adjustWindowToContent is moving the window, keep re-baselining so
        // its programmatic setBounds never reads as a user drag (which would
        // freeze a card the moment its content resized).
        if (isAdjustingRef.current) {
          lastCheckBounds = currentBounds;
          return;
        }

        if (!lastCheckBounds) {
          lastCheckBounds = currentBounds;
          setInitialBounds(currentBounds);
          return;
        }

        const dx = Math.abs(currentBounds.x - lastCheckBounds.x);
        const dy = Math.abs(currentBounds.y - lastCheckBounds.y);

        if (dx > 10 || dy > 10) {
          logger.debug('Window moved detected, freezing...');
          clearInterval(checkInterval);

          const result = await window.electron?.selection?.freeze?.();
          if (result?.success) {
            setIsFrozen(true);
            setWindowId(result.windowId);
            logger.debug(`Window ${result.windowId} frozen`);

            if (autoHideTimerRef.current) {
              clearTimeout(autoHideTimerRef.current);
              autoHideTimerRef.current = null;
            }
            // History was already recorded when this translation completed; the
            // store dedups on (source, result), so re-adding here is pure noise.
          } else if (result?.error === 'limit') {
            // Pinned-window cap reached: card stays active, tell the user why it
            // didn't detach instead of silently closing someone's pinned content.
            setFreezeHint(true);
            setTimeout(() => setFreezeHint(false), 2500);
          }
        }
      } catch (e) {}
    }, 100);

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
                {isOcrError && (
                  <button
                    className="sel-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.electron?.selection?.openOcrSettings?.();
                    }}
                  >
                    {t('floatingWindow.goToOcrSettings')}
                  </button>
                )}
              </>
            )}
          </div>

          {freezeHint && (
            <div className="sel-freeze-hint">
              {t('selection.freezeLimitHint', '固定窗口已达上限（最多 8 个）')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectionTranslator;
