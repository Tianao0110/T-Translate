// Floating-window translation pipeline: capture -> OCR -> (scattered or unified) -> translate.
// Owns dedupe-by-hash, same-language behavior, and child-pane lifecycle.

import translationService from './stack-client.js';
import useSessionStore, { DISPLAY_MODE, CHILD_PANE_STATUS } from '../stores/session.js';
import useConfigStore from '../stores/config.js';
import { resolveDisplayMode } from './display-mode.js';
import { calculateHash } from '../utils/image.js';
import { detectLanguage, resolveSameLanguageTarget, cleanTranslationOutput, shouldTranslateText } from '../utils/text.js';
import createLogger from '../utils/logger.js';
import { getShortErrorMessage } from '../utils/error-handler.js';
import i18n from '../i18n.js';

const logger = createLogger('Pipeline');

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

// Used to skip OCR/translate when the same image/text comes back from a refresh tick
let lastImageHash = '';
let lastText = '';
let captureInFlight = false;
// Last processed capture, kept so a display-mode toggle can re-layout
// immediately without asking the user to re-capture. Dies with the renderer
// (the floating window is destroyed on close, not hidden).
let lastCapture = null;

// Forward a floating-window translation into the main window's history store.
// The old session.addToHistory only wrote an in-memory list nothing read, so
// floating-window translations never appeared in any history view.
function addToMainHistory(item) {
  try {
    window.electron?.floatingWindow?.addToHistory?.({ source: 'floating', ...item });
  } catch (e) {
    logger.debug('History forward failed:', e.message);
  }
}

// Scattered-vs-unified decision (heuristic + manual override) lives in
// display-mode.js so it stays pure and unit-testable.

class TranslationPipeline {
  // No init/refreshOcrConfigs anymore: OCR engines, their configs (with vault
  // secrets), and settings-save reloads all live in the main-process stack —
  // this persistent window can't pin stale keys by construction.

  async runFromCapture(captureOptions = {}) {
    // Single-flight: a second capture while one is running would un-hide the
    // floating window mid-screenshot (the IPC handler's opacity dance) and
    // interleave session state.
    if (captureInFlight) {
      logger.debug('Capture already in flight, ignoring');
      return { success: false, skipped: true };
    }
    captureInFlight = true;

    const session = useSessionStore.getState();

    try {
      // Auto-refresh ticks (keepDedup) run SILENTLY until content actually
      // changes: no pane clearing, no "capturing" state, dedupe keys intact.
      // The old behavior reset the UI every tick, which read as "it restarts
      // recognition before the previous one finished". Manual captures keep
      // the explicit feedback and force a re-OCR of identical frames.
      if (!captureOptions.keepDedup) {
        // Frozen panes survive; transient ones are cleared each capture cycle
        session.clearChildPanes();
        lastImageHash = '';
        lastText = '';
        session.startCapture();
      }

      const captureResult = await window.electron?.floatingWindow?.captureRegion?.(captureOptions);
      if (!captureResult?.success) {
        // A failed silent tick must not flash an error banner every interval.
        if (captureOptions.keepDedup) {
          logger.debug('Auto-refresh capture failed silently:', captureResult?.error);
          return { success: false, skipped: true };
        }
        throw new Error(captureResult?.error || _t('screenshot.failed', '截图失败'));
      }

      return await this.runFromImage(captureResult.imageData, {
        ...captureOptions,
        scaleFactor: captureResult.scaleFactor,
      });

    } catch (error) {
      logger.error('Capture error:', error);
      const errorMsg = getShortErrorMessage(error);
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      captureInFlight = false;
    }
  }

  async runFromImage(imageData, captureOptions = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();

    try {
      lastCapture = { imageData, options: { ...captureOptions } };

      // Dedupe key includes target language AND display-mode pref: switching
      // either must re-run even when the captured frame is byte-identical
      // (same precedent as targetLanguage — a mode toggle would otherwise be
      // swallowed as "content unchanged").
      const modePref = config.floatingDisplayMode || 'auto';
      const hash = await calculateHash(imageData);
      const imageKey = `${hash}::${config.targetLanguage}::${modePref}`;
      if (imageKey === lastImageHash) {
        logger.debug('Image, target language and display mode unchanged, skipping');
        return { success: true, skipped: true };
      }
      lastImageHash = imageKey;

      // Silent tick just detected real change — NOW reset the transient panes
      // (deferred from runFromCapture so unchanged ticks never touch the UI).
      if (captureOptions.keepDedup) {
        session.clearChildPanes();
      }

      session.startOcr();

      // Engine allowlist is injected by the main-process facade from the live
      // privacy mode; priority is per-request now (a shared manager instance
      // must not inherit this window's ordering globally).
      const ocrResult = await translationService.ocr.recognize(imageData, {
        engine: config.ocrEngine,
        priority: config.ocrPriority,
      });

      if (!ocrResult.success) {
        throw new Error(ocrResult.error || _t('svc.ocrFailed', 'OCR 失败'));
      }

      const text = ocrResult.text?.trim();
      if (!text) {
        session.setResult(_t('svc.noTextRecognized', '（未识别到文字）'));
        return { success: true, text: '' };
      }

      // Judgment runs on raw per-line boxes; pane granularity comes from the
      // resolver (merged paragraphs per bubble, raw blocks for word piles).
      const mergedBlocks = ocrResult.blocks || [];
      const rawBlocks = ocrResult.rawBlocks || mergedBlocks;
      // Capture frame in the same physical-pixel space as the OCR boxes —
      // the sparse-coverage rule (manga bubbles over imagery) needs it.
      const sf = captureOptions.scaleFactor || 1;
      const frame = captureOptions.width > 0 && captureOptions.height > 0
        ? { width: captureOptions.width * sf, height: captureOptions.height * sf }
        : null;
      const { useScattered, fellBack, blocks } = resolveDisplayMode(modePref, rawBlocks, mergedBlocks, frame);
      session.setModeInfo({
        pref: modePref,
        effective: useScattered ? 'scattered' : 'unified',
        fellBack,
      });

      logger.debug(`Display mode: ${useScattered ? 'scattered' : 'unified'} (pref: ${modePref})`);
      logger.debug(`Raw blocks: ${rawBlocks.length}, Merged blocks: ${mergedBlocks.length}, Pane blocks: ${blocks?.length ?? 0}`);
      if (rawBlocks.length > 0) {
        logger.debug('First raw block bbox:', rawBlocks[0]?.bbox);
        logger.debug('Capture options:', captureOptions);
      }

      if (useScattered) {
        return await this.runScatteredMode(blocks, captureOptions);
      }

      const textKey = `${text}::${config.targetLanguage}::${modePref}`;
      if (textKey === lastText) {
        logger.debug('Text, target language and display mode unchanged, skipping');
        return { success: true, skipped: true };
      }
      lastText = textKey;

      // Skip translation entirely for content that's already in target lang or trivial
      if (!shouldTranslateText(text)) {
        session.setResult(text);
        return { success: true, text };
      }

      session.setSourceText(text);

      return await this.runFromText(text);

    } catch (error) {
      logger.error('Image processing error:', error);
      const errorMsg = getShortErrorMessage(error, { context: 'ocr' });
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  // Spawns one child pane per OCR block, positioned over the original text
  async runScatteredMode(blocks, captureOptions = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();

    try {
      // OCR returns physical pixels of the captured display; CSS needs logical
      // px. Prefer the capture-time scaleFactor — our own devicePixelRatio can
      // belong to a different monitor in mixed-DPI setups.
      const scaleFactor = captureOptions.scaleFactor || window.devicePixelRatio || 1;
      logger.debug(`ScaleFactor for coordinate conversion: ${scaleFactor}`);

      const validBlocks = blocks
        .filter(b =>
          b.text?.trim() &&
          b.bbox &&
          b.bbox.width > 0 &&
          b.bbox.height > 0
        )
        .map(b => ({
          ...b,
          bbox: {
            x: Math.round(b.bbox.x / scaleFactor),
            y: Math.round(b.bbox.y / scaleFactor),
            width: Math.round(b.bbox.width / scaleFactor),
            height: Math.round(b.bbox.height / scaleFactor),
          }
        }));

      if (validBlocks.length === 0) {
        session.setResult(_t('svc.noValidTextRecognized', '（未识别到有效文字）'));
        return { success: true, text: '' };
      }

      logger.debug(`Valid blocks count: ${validBlocks.length}`);
      if (validBlocks.length > 0) {
        logger.debug(`First block:`, {
          text: validBlocks[0].text?.substring(0, 50),
          bbox: validBlocks[0].bbox,
          mergedCount: validBlocks[0].mergedCount,
        });
      }

      // blocks here are already merged in main process
      session.setDisplayMode(DISPLAY_MODE.SCATTERED);
      const createdPanes = session.setChildPanes(validBlocks);
      session.setStatus('translating');

      // Cap concurrency: more than 2 concurrent LLM calls causes UI jank on
      // typical local setups (each call ties up the GPU briefly)
      const CONCURRENCY_LIMIT = 2;
      const translatePane = async (pane, index) => {
        const paneId = pane.id;

        try {
          session.updateChildPane(paneId, { status: CHILD_PANE_STATUS.TRANSLATING });

          const text = pane.sourceText.trim();

          if (!shouldTranslateText(text)) {
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.DONE,
              translatedText: text,
            });
            return;
          }

          const sourceLang = detectLanguage(text);

          const { targetLang, passthrough } = resolveSameLanguageTarget(
            sourceLang, config.targetLanguage, config.sameLanguageBehavior, config.sourceLanguage
          );
          if (passthrough) {
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.DONE,
              translatedText: text,
            });
            return;
          }

          // Privacy fields no longer travel from here — the main-process
          // facade injects the live mode (SECURE keeps screen-capture text out
          // of every cache layer at the single enforcement point).
          const result = await translationService.translate(text, {
            sourceLang,
            targetLang,
            mode: 'normal',
          });

          if (result.success && result.text) {
            const cleaned = cleanTranslationOutput(result.text, text);
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.DONE,
              translatedText: cleaned || result.text,
            });
          } else {
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.ERROR,
              error: result.error || _t('svc.translateFailed', '翻译失败'),
            });
          }
        } catch (error) {
          logger.error(`Block ${index} translation error:`, error);
          session.updateChildPane(paneId, {
            status: CHILD_PANE_STATUS.ERROR,
            error: getShortErrorMessage(error),
          });
        }
      };

      for (let i = 0; i < createdPanes.length; i += CONCURRENCY_LIMIT) {
        const batch = createdPanes.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map((pane, idx) => translatePane(pane, i + idx)));
      }

      session.setStatus('success');

      // History entry merges all panes into one item so a refresh tick is one row
      const currentState = useSessionStore.getState();
      const allSource = createdPanes.map(p => p.sourceText).join('\n');
      const allTranslated = currentState.childPanes
        .map(p => p.translatedText)
        .filter(Boolean)
        .join('\n');

      if (allTranslated) {
        addToMainHistory({
          sourceText: allSource,
          translatedText: allTranslated,
          targetLanguage: config.targetLanguage,
        });
      }

      return { success: true, mode: 'scattered', blockCount: createdPanes.length };

    } catch (error) {
      logger.error('Scattered mode error:', error);
      const errorMsg = getShortErrorMessage(error);
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  async runFromText(text, options = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();

    try {
      session.startTranslation();

      const sourceLang = detectLanguage(text);

      const { targetLang, passthrough } = resolveSameLanguageTarget(
        sourceLang, config.targetLanguage, config.sameLanguageBehavior, config.sourceLanguage
      );
      if (passthrough) {
        // Already in the target language: show the original, skip the provider
        // and history (an untranslated echo is not a record).
        session.setResult(text);
        return { success: true, text, provider: null };
      }

      const mode = options.mode || 'normal';

      const result = await translationService.translate(text, {
        sourceLang,
        targetLang,
        mode,
      });

      if (!result.success) {
        throw new Error(result.error || _t('svc.translateFailed', '翻译失败'));
      }

      // cleanTranslationOutput strips LLM artifacts like trailing "Translation:" etc.
      const cleaned = cleanTranslationOutput(result.text, text);

      if (cleaned) {
        session.setResult(cleaned, result.provider);

        addToMainHistory({
          sourceText: text,
          translatedText: cleaned,
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
        });
      }

      return { success: true, text: cleaned, provider: result.provider };

    } catch (error) {
      logger.error('Translation error:', error);
      const errorMsg = getShortErrorMessage(error, { context: 'translation' });
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  // Re-process the last capture (display-mode toggle re-layout). keepDedup
  // reuses the silent-tick path: transient panes are only cleared once the
  // dedupe key confirms a real change — which a mode switch guarantees.
  async rerunLastCapture() {
    if (!lastCapture || captureInFlight) {
      return { success: false, skipped: true };
    }
    captureInFlight = true;
    try {
      return await this.runFromImage(lastCapture.imageData, {
        ...lastCapture.options,
        keepDedup: true,
      });
    } finally {
      captureInFlight = false;
    }
  }

  resetCache() {
    lastImageHash = '';
    lastText = '';
    lastCapture = null;
  }
}

const pipeline = new TranslationPipeline();

export default pipeline;
export { TranslationPipeline, calculateHash, detectLanguage, cleanTranslationOutput, shouldTranslateText };
