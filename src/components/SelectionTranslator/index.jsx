import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, Volume2, VolumeX, X, Loader2 } from 'lucide-react';
import translationService from '../../translation/stack-client.js';
import ttsManager, { TTS_STATUS } from '../../tts/index.js';
import AiActionIcon from '../shared/AiActionIcon.jsx';
import useAiActions from '../../ai/use-ai-actions.js';
import { resolveActionLabel } from '../../ai/ai-action-runner.js';
import createLogger from '../../core/logger.js';
import { getShortErrorMessage } from '../../core/error-handler.js';
import { detectLanguage, resolveSameLanguageTarget } from '../../core/text.js';
import './styles.css';

import { THEMES } from '../../config/constants.js';

const logger = createLogger('Selection');

const DEFAULT_SETTINGS = {
  triggerTimeout: 4000,
  showSourceByDefault: false,
  autoCloseOnCopy: false,
  minChars: 2,
  maxChars: 2000,
  windowOpacity: 95,
  rainbowWindow: false,
};

const DEFAULT_TRANSLATION = {
  targetLanguage: 'zh',
  sourceLanguage: 'auto',
  sameLanguageBehavior: 'original',
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
  // At least one letter / number in any script.
  if (!/[\p{L}\p{N}]/u.test(text)) {
    throw new Error(t('selection.noValidText', '选中内容无有效文字'));
  }
  // Very long single-char runs are OCR / encoding garbage (threshold high
  // enough for emphatic repetition and divider lines).
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
  // Non-fatal hint riding on screenshot results (e.g. vision engine degraded).
  const [notice, setNotice] = useState('');
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
  // in-flight one.
  const positionTokenRef = useRef(0);

  const frozenRef = useRef(false); // mirror of isFrozen for timer callbacks
  const autoHideTimerRef = useRef(null);
  const triggerReadyTimerRef = useRef(null);
  const contentRef = useRef(null);
  const translateTextRef = useRef(null);
  // Phase B pass-through: text main already grabbed, carried by the payload.
  const prefetchedTextRef = useRef(null);
  // Bumped by resetSession; async paths bail when a newer session started.
  const generationRef = useRef(0);
  // Work area of the display the selection happened on; placement clamps to it.
  const screenBoundsRef = useRef(null);
  // True while adjustWindowToContent is moving the window programmatically.
  const isAdjustingRef = useRef(false);
  // Actual languages the last translation resolved to (after the
  // same-language flip); history metadata and TTS read this.
  const lastResolvedLangsRef = useRef({ sourceLanguage: 'auto', targetLanguage: 'zh' });

  // Keep the document language in sync with the UI language.
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
      // Speak in the language actually translated into (post-flip).
      const speakLang = lastResolvedLangsRef.current.targetLanguage || translation.targetLanguage;
      ttsManager.speak(translatedText, { lang: speakLang }).catch(e => {
        logger.error('TTS error:', e);
      });
    }
  }, [translatedText, translation.targetLanguage, ttsStatus]);

  // Central per-session reset (the window is reused): every entry point
  // scrubs the previous session and bumps the generation.
  const resetSession = () => {
    generationRef.current += 1;
    ttsManager.stop();
    if (autoHideTimerRef.current) { clearTimeout(autoHideTimerRef.current); autoHideTimerRef.current = null; }
    if (triggerReadyTimerRef.current) { clearTimeout(triggerReadyTimerRef.current); triggerReadyTimerRef.current = null; }
    setError('');
    setCopied(false);
    setIsOcrError(false);
    setNotice('');
    setTriggerFailed(false);
  };

  // Degrade hint is transient: auto-clears 3 s after it shows.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(id);
  }, [notice]);

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

      // Phase B pass-through: take the prefetched text if present, once.
      prefetchedTextRef.current = data.text || null;

      // Debounce: ignore clicks for 100 ms after show.
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
      // Screenshot path has no cursor anchor: (0,0) keeps the window where
      // main positioned it.
      setMousePos({ x: 0, y: 0 });
      // Work area of the capture's display, for clamping the grown card.
      if (data.screenBounds) screenBoundsRef.current = data.screenBounds;

      if (data.theme) setTheme(data.theme);
      if (data.settings?.language && i18n?.language !== data.settings.language) i18n.changeLanguage(data.settings.language);

      const newSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      setSettings(newSettings);

      // Error payload (e.g. loading watchdog timeout).
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
        if (data.notice) setNotice(data.notice);
        setSourceText(data.text);
        setShowSource(newSettings.showSourceByDefault);
        setIsFrozen(false);
        setMode('loading');

        try {
          // Pass langs explicitly — state update is async and won't be visible yet
          const overrideTargetLang = data.targetLanguage || data.translation?.targetLanguage || null;
          const overrideSourceLang = data.sourceLanguage || data.translation?.sourceLanguage || null;
          const overrideBehavior = data.sameLanguageBehavior || data.translation?.sameLanguageBehavior || null;
          const translationResult = await translateTextRef.current(data.text, 0, overrideTargetLang, overrideSourceLang, overrideBehavior);
          if (gen !== generationRef.current) return; // superseded by a newer session
          setTranslatedText(translationResult);
          setError('');
          setMode('overlay');

          if (translationResult && !lastResolvedLangsRef.current.passthrough) {
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
        // Auto-hide is handled by the unified overlay effect.
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
        const overrideBehavior = newTranslation.sameLanguageBehavior || null;
        const translationResult = await translateTextRef.current(text, 0, overrideTargetLang, overrideSourceLang, overrideBehavior);
        if (gen !== generationRef.current) return; // superseded by a newer session
        setTranslatedText(translationResult);
        setError('');
        setMode('overlay');

        // from: 'hotkey' distinguishes this path in history vs 'selection' / 'screenshot'
        if (translationResult && !lastResolvedLangsRef.current.passthrough) {
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

    // No settings-changed listener (the stack reloads itself in the main
    // process; UI settings arrive with each show) and no keydown handler (the
    // window is focusable:false).

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
      // Prefetched text first; IPC only when the payload carried none.
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

      if (translationResult && !lastResolvedLangsRef.current.passthrough) {
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

  // Resize the window to fit the content, then reposition near mousePos.
  // keepPosition (frozen cards, screenshot path): resize in place.
  // Geometry notes: docs/design/renderer.md §3.
  const adjustWindowToContent = async (keepPosition = false) => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    // Latest-wins guard.
    const myToken = ++positionTokenRef.current;

    // Suppress the drag-to-freeze poll while we move the window ourselves.
    isAdjustingRef.current = true;

    const maxWidth = 400, minWidth = 160;
    const maxHeight = 350, minHeight = 65;
    const toolbarHeight = 36;

    // Clamp to the display the selection was on (origin-aware).
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

    // Anchor X (and the top Y) is computed once for both passes; only Y is
    // refined after the height is known.
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

    // Measure at the target width without resizing the window.
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

    // Single visible resize: refine Y (flip above the cursor on bottom
    // overflow) and apply once.
    let y = topY;
    if (hasValidMousePos && y + height > originY + sh - 10) y = mousePos.y - height - 10;
    if (y < originY + 10) y = originY + 10;

    // Off-screen guard for the final geometry (the keepPosition path grows
    // from the loading spot).
    let finalX = anchorX;
    if (finalX + width > originX + sw - 10) finalX = originX + sw - width - 10;
    if (finalX < originX + 10) finalX = originX + 10;
    let finalY = Math.round(y);
    if (finalY + height > originY + sh - 10) finalY = originY + sh - height - 10;
    if (finalY < originY + 10) finalY = originY + 10;

    window.electron?.selection?.setBounds?.({
      x: Math.round(finalX), y: finalY,
      width, height: Math.round(height)
    });

    // Let the bounds settle, then re-enable drag detection with the new
    // position as its baseline.
    setTimeout(() => {
      if (positionTokenRef.current === myToken) isAdjustingRef.current = false;
    }, 150);
  };

  useEffect(() => {
    // Fit the window to the card whenever we're in overlay mode, even on an
    // empty translation. Frozen cards resize in place. isFrozen is read via
    // ref, not a dependency (docs/design/renderer.md §3).
    if (mode === 'overlay') {
      adjustWindowToContent(frozenRef.current);
    }
  }, [mode, translatedText, error, showSource]);

  // Unified auto-hide for result cards: every overlay path hides after
  // triggerTimeout; hovering pauses the countdown; frozen cards exempt.
  useEffect(() => {
    if (mode !== 'overlay' || isFrozen || cardHovered) return;
    const timeout = settings.triggerTimeout || 4000;
    if (timeout <= 0) return;
    const timer = setTimeout(() => handleAutoHide(), timeout);
    return () => clearTimeout(timer);
  }, [mode, isFrozen, cardHovered, settings.triggerTimeout]);

  const translateText = async (text, retryCount = 0, overrideTargetLang = null, overrideSourceLang = null, overrideBehavior = null) => {
    // Override > state > default.
    const requestedTarget = overrideTargetLang || translation.targetLanguage || 'zh';
    const sourceLang = overrideSourceLang || translation.sourceLanguage || 'auto';
    const behavior = overrideBehavior || translation.sameLanguageBehavior || 'original';

    // Text already in the target language: per
    // settings.translation.sameLanguageBehavior (resolveSameLanguageTarget).
    const detected = detectLanguage(text);
    const resolved = resolveSameLanguageTarget(detected, requestedTarget, behavior, sourceLang);
    const targetLang = resolved.targetLang;

    // Record the languages actually used (post-resolve) for history + TTS;
    // passthrough also gates history.
    lastResolvedLangsRef.current = {
      sourceLanguage: sourceLang !== 'auto' ? sourceLang : detected,
      targetLanguage: targetLang,
      passthrough: resolved.passthrough,
    };

    if (resolved.passthrough) {
      logger.debug('Source already in target language, showing original');
      return text;
    }

    try {
      // Privacy fields are injected by the main-process facade.
      const result = await translationService.translate(text, {
        sourceLang: sourceLang,
        targetLang: targetLang,
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
      // One automatic retry for transient network failures only.
      if (retryCount < 1 && /fetch|network|timeout|ECONN|连接|超时|网络/i.test(err.message || '')) {
        logger.debug('Retrying translation...');
        await new Promise(r => setTimeout(r, 1000));
        // Forward override langs on retry.
        return translateText(text, retryCount + 1, overrideTargetLang, overrideSourceLang, overrideBehavior);
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
        // Frozen cards live in the frozen pool: close, not hide.
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

  // AI actions read the selected text, not the translation.
  const attachAiResultFromCard = useCallback((payload) => {
    window.electron?.selection?.attachAiResult?.(payload);
  }, []);
  const ai = useAiActions('selection', attachAiResultFromCard);
  const aiActions = ai.availableActions({ displayMode: 'unified', text: sourceText });
  const aiTargetLanguage = translation.targetLanguage || 'zh';
  const aiResult = ai.expandedFor(sourceText, aiTargetLanguage);

  // The source text and every AI result share one panel above the
  // translation: opening either closes the other.
  const toggleSource = (e) => {
    e.stopPropagation();
    ai.collapse();
    setShowSource(!showSource || !!aiResult);
  };

  const runAiActionFromCard = async (e, action) => {
    e.stopPropagation();
    setShowSource(false);
    const result = await ai.toggle(
      action,
      {
        sourceText,
        translatedText,
        sourceLanguage: lastResolvedLangsRef.current.sourceLanguage,
        // The configured target, not the resolved one.
        targetLanguage: aiTargetLanguage,
      }
    );
    if (!result.success) setNotice(result.error);
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

  // Drag detection by polling window bounds: a move > 10 px freezes the
  // card into a detached overlay.
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

        // Re-baseline while adjustWindowToContent is moving the window.
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
          } else if (result?.error === 'limit') {
            // Pinned-window cap reached: the card stays active and says why.
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
    <div className={`sel-root${settings.rainbowWindow ? ' sel-rainbow' : ''}`} data-theme={theme}>
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
            <button className={`sel-btn ${showSource && !aiResult ? 'active' : ''}`} onClick={toggleSource} title={t('selection.showSource', '显示原文')}>
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
            {aiActions.map((action) => (
              <button
                key={action.id}
                className={`sel-btn ${aiResult?.actionId === action.id ? 'active' : ''}`}
                onClick={(e) => runAiActionFromCard(e, action)}
                disabled={ai.runningId === action.id}
                title={resolveActionLabel(action, i18n.language)}
              >
                {ai.runningId === action.id
                  ? <Loader2 size={13} className="sel-spin" />
                  : <AiActionIcon name={action.icon} size={13} />}
              </button>
            ))}
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
                {notice && (
                  <div className="sel-notice">{notice}</div>
                )}
                {/* One panel above the translation, shared by the source text
                    and every AI result: opening either closes the other, so the
                    card grows by at most one block and there is a single place
                    to look. It also means a result is never a card of its own
                    that could be fed back into another action. */}
                {aiResult ? (
                  <div className="sel-ai">
                    <div className="sel-ai-label">{aiResult.label}</div>
                    <div className="sel-ai-text">{aiResult.content}</div>
                  </div>
                ) : showSource && sourceText ? (
                  <div className="sel-source">{sourceText}</div>
                ) : null}
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
