import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, Volume2, VolumeX, X } from 'lucide-react';
import translationService from '../../services/translation.js';
import ttsManager, { TTS_STATUS } from '../../services/tts/index.js';
import createLogger from '../../utils/logger.js';
import { getShortErrorMessage } from '../../utils/error-handler.js';
import { detectLanguage } from '../../utils/text.js';
import './styles.css';

import { PRIVACY_MODES, THEMES } from '@config/defaults';

const logger = createLogger('Selection');

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
  // Require at least one letter/number in ANY script (Cyrillic, Greek, Arabic,
  // Thai, …), not just Latin+CJK — the old class rejected every supported
  // non-Latin-non-CJK language outright.
  if (!/[\p{L}\p{N}]/u.test(text)) {
    throw new Error(t('selection.noValidText', '选中内容无有效文字'));
  }
  // Very long single-char runs usually mean OCR/encoding garbage. Threshold kept
  // high so legit emphatic repetition ("哈哈哈…") and divider lines ("====")
  // aren't rejected.
  if (/(.)\1{30,}/.test(text)) {
    throw new Error(t('selection.possibleGarbage', '选中内容可能是乱码'));
  }
  // Skip file paths: Windows drive/UNC, common POSIX absolute, file:// URL
  if (/^(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|\/(?:Users|home|usr|var|etc|tmp)\/|file:\/\/)/.test(text)) {
    throw new Error(t('selection.isFilePath', '选中内容是文件路径'));
  }
}

const SelectionTranslator = () => {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState('idle');
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [error, setError] = useState('');
  const [isOcrError, setIsOcrError] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState(THEMES.LIGHT);
  const [showSource, setShowSource] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [triggerReady, setTriggerReady] = useState(false);
  const [triggerFailed, setTriggerFailed] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [windowId, setWindowId] = useState(null);
  const [freezeHint, setFreezeHint] = useState(false);
  const [cardHovered, setCardHovered] = useState(false);

  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);

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
  // Actual languages the last translation resolved to (after the same-language
  // flip). History metadata and TTS read this instead of the configured target,
  // which would otherwise mislabel/mis-voice flipped results.
  const lastResolvedLangsRef = useRef({ sourceLanguage: 'auto', targetLanguage: 'zh' });

  // Keep the document language in sync with the UI language (the static HTML
  // hardcoded a single lang; this popup is bilingual).
  useEffect(() => {
    if (i18n?.language) document.documentElement.lang = i18n.language;
  }, [i18n?.language]);

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
      // Speak in the language actually translated INTO (post-flip), not the
      // configured target — otherwise a flipped ja→en result gets a zh voice.
      const speakLang = lastResolvedLangsRef.current.targetLanguage || translation.targetLanguage;
      ttsManager.speak(translatedText, { lang: speakLang }).catch(e => {
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
    setTriggerFailed(false);
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
      screenBoundsRef.current = data.screenBounds || null;

      if (data.theme) setTheme(data.theme);
      if (data.settings?.language && i18n?.language !== data.settings.language) i18n.changeLanguage(data.settings.language);

      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);

      const newTranslation = { ...DEFAULT_TRANSLATION, ...data.translation };
      setTranslation(newTranslation);

      setShowSource(newSettings.showSourceByDefault);

      setMode('trigger');
      setTriggerFailed(data.failed === true); // sticky-direct empty capture → red+shake
      setSourceText('');
      setTranslatedText('');
      setIsFrozen(false);

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
      if (data.settings?.language && i18n?.language !== data.settings.language) i18n.changeLanguage(data.settings.language);

      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);

      // Error payload (e.g. loading watchdog timeout) — surface it instead of
      // silently doing nothing (this branch previously had no receiver).
      if (data.error) {
        logger.debug('Showing result error:', data.error);
        setSourceText('');
        setTranslatedText('');
        setError(data.error);
        setIsFrozen(false);
        setMode('overlay');
        return;
      }

      if (data.isLoading) {
        logger.debug('Showing loading state');
        setSourceText('');
        setTranslatedText('');
        setIsFrozen(false);
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
        setIsFrozen(false);
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
              sourceLanguage: lastResolvedLangsRef.current.sourceLanguage,
              targetLanguage: lastResolvedLangsRef.current.targetLanguage,
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
        // Caller already positioned us (screenshot bounds) — just show.
        setMode('overlay');
        // Auto-hide handled by the unified overlay effect (乙案), no per-path timer.
      }
    });

    // Sticky direct path: main process detects CapsLock + selection and pushes
    // text directly. Skips the trigger-icon UX (loading -> overlay), but shares
    // settings/validation with the trigger-click path.
    const removeShowDirectListener = window.electron?.selection?.onShowDirect?.(async (data) => {
      logger.debug('SHOW_DIRECT received', { phase: data?.phase, textLength: data?.text?.length });

      if (frozenRef.current) {
        logger.debug('Frozen window ignoring direct event');
        return;
      }

      resetSession();
      // Direct path anchors at the selection point main captured (payload coords).
      setMousePos({ x: data.mouseX || 0, y: data.mouseY || 0 });
      screenBoundsRef.current = data.screenBounds || null;

      if (data.theme) setTheme(data.theme);
      if (data.settings?.language && i18n?.language !== data.settings.language) i18n.changeLanguage(data.settings.language);
      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);
      const newTranslation = { ...DEFAULT_TRANSLATION, ...data.translation };
      setTranslation(newTranslation);
      setShowSource(newSettings.showSourceByDefault);

      setSourceText('');
      setTranslatedText('');
      setIsFrozen(false);
      setMode('loading');

      // 'capturing' phase: main is still grabbing the selection — just hold the
      // loading dot and wait for the follow-up 'translate' message.
      if (data.phase === 'capturing') return;

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
            sourceLanguage: lastResolvedLangsRef.current.sourceLanguage,
            targetLanguage: lastResolvedLangsRef.current.targetLanguage,
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

    // No keydown/ESC handler: the window is focusable:false (deliberate — it
    // must never steal focus), so it can't receive keyboard events. Closing is
    // via right-click, the ✕ button, click-outside, or auto-hide.

    return () => {
      if (removeShowListener) removeShowListener();
      if (removeShowResultListener) removeShowResultListener();
      if (removeShowDirectListener) removeShowDirectListener();
      if (removeHideListener) removeHideListener();
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
        const result = await window.electron?.selection?.getText?.();
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
          sourceLanguage: lastResolvedLangsRef.current.sourceLanguage,
          targetLanguage: lastResolvedLangsRef.current.targetLanguage,
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
  // keepPosition (frozen cards, screenshot path): resize in place at the current
  // window position — a frozen card was deliberately dragged somewhere by the
  // user, snapping it back to the selection anchor would undo that.
  const adjustWindowToContent = async (keepPosition = false) => {
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

    const hasValidMousePos = !keepPosition && (mousePos.x !== 0 || mousePos.y !== 0);

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

    if (positionTokenRef.current !== myToken) return; // superseded during the await above

    // Measure at the target width WITHOUT resizing the window: force the content
    // element's width, read its wrapped height synchronously, restore. The old
    // approach resized the window to maxHeight as a "measure pass" and shrank it
    // after — a visible balloon-then-shrink flash on every source toggle.
    const origWidth = contentEl.style.width;
    const origFlex = contentEl.style.flex;
    // border-box width the content will get inside the final window:
    // window width minus root padding (4px × 2) and card border (1px × 2).
    contentEl.style.width = `${width - 10}px`;
    contentEl.style.flex = '0 0 auto';
    void contentEl.offsetHeight;
    const contentHeight = contentEl.scrollHeight;
    contentEl.style.width = origWidth;
    contentEl.style.flex = origFlex;

    const height = Math.min(Math.max(contentHeight + toolbarHeight + 16, minHeight), maxHeight);

    // Single visible resize: geometry fully known, refine Y (flip above cursor
    // on bottom overflow) and apply once.
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
    // Frozen cards resize in place (keepPosition) instead of re-anchoring.
    if (mode === 'overlay') {
      adjustWindowToContent(isFrozen);
    }
  }, [mode, translatedText, error, showSource, isFrozen]);

  // Unified auto-hide for result cards (乙案): every overlay path hides after
  // triggerTimeout. Hovering the card pauses the countdown (effect early-returns
  // while hovered, reschedules the full timeout on leave); frozen cards exempt.
  useEffect(() => {
    if (mode !== 'overlay' || isFrozen || cardHovered) return;
    const timeout = settings.triggerTimeout || 4000;
    if (timeout <= 0) return;
    const timer = setTimeout(() => handleAutoHide(), timeout);
    return () => clearTimeout(timer);
  }, [mode, isFrozen, cardHovered, settings.triggerTimeout]);

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
    const detected = detectLanguage(text);
    if (detected === targetLang) {
      targetLang = targetLang === 'zh' ? 'en' : 'zh';
      logger.debug(`Source already in target language, flipping to ${targetLang}`);
    }

    // Record the languages actually used (post-flip) for history + TTS.
    lastResolvedLangsRef.current = {
      sourceLanguage: sourceLang !== 'auto' ? sourceLang : detected,
      targetLanguage: targetLang,
    };

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
      // One automatic retry for transient network failures only. Match common
      // markers in both languages rather than a single '连接' substring.
      if (retryCount < 1 && /fetch|network|timeout|ECONN|连接|超时|网络/i.test(err.message || '')) {
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
        <div
          className={`sel-trigger ${triggerReady ? 'ready' : ''} ${triggerFailed ? 'failed' : ''}`}
          onClick={handleTriggerClick}
          title={triggerFailed ? t('selection.retryHint', '未取到文字，点击重试') : undefined}
        >
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
          onMouseEnter={() => setCardHovered(true)}
          onMouseLeave={() => setCardHovered(false)}
          style={{ '--sel-opacity': (settings.windowOpacity || 95) / 100 }}
        >
          <div className="sel-toolbar">
            {isFrozen && (
              <span className="sel-frozen-badge" title={t('selection.frozenHint', '已固定 - 右键点击关闭')}>
                <Pin size={11} />
              </span>
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
              {ttsStatus === TTS_STATUS.SPEAKING ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <div className="sel-spacer" />
            <button className="sel-btn sel-btn-close" onClick={handleClose} title={t('selection.close', '关闭')}>
              <X size={13} />
            </button>
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
