// Floating-window translation pipeline: capture -> OCR -> (scattered or unified) -> translate.
// Owns dedupe-by-hash, target-language flip, and child-pane lifecycle.

import { ocrManager } from '../providers/ocr/index.js';
import translationService from './translation.js';
import useSessionStore, { DISPLAY_MODE, CHILD_PANE_STATUS } from '../stores/session.js';
import useConfigStore from '../stores/config.js';
import { calculateHash } from '../utils/image.js';
import { detectLanguage, cleanTranslationOutput, shouldTranslateText } from '../utils/text.js';
import { isProviderAllowed, isOcrEngineAllowed, PRIVACY_MODE_IDS } from '../config/privacy-modes.js';
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

async function getPrivacyMode() {
  try {
    if (window.electron?.privacy?.getMode) {
      return await window.electron.privacy.getMode();
    }
  } catch (e) {
    logger.debug('Failed to get privacy mode from main:', e.message);
  }
  return PRIVACY_MODE_IDS.STANDARD;
}

// Heuristic: are the OCR blocks scattered (e.g. UI labels, code annotations)
// vs a single vertically-aligned paragraph? Scattered => overlay one bubble per block.
function shouldUseScatteredMode(blocks) {
  if (!blocks || blocks.length === 0) return false;
  if (blocks.length === 1) return false;

  const hasCoordinates = blocks.some(b => b.bbox && b.bbox.width > 0);
  if (!hasCoordinates) return false;

  const validBlocks = blocks.filter(b => b.bbox && b.bbox.height > 0);
  if (validBlocks.length < 2) return false;

  const avgHeight = validBlocks.reduce((sum, b) => sum + b.bbox.height, 0) / validBlocks.length;

  const sorted = [...validBlocks].sort((a, b) => a.bbox.y - b.bbox.y);

  let isVerticallyAligned = true;
  let maxHorizontalOffset = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const verticalGap = curr.bbox.y - (prev.bbox.y + prev.bbox.height);

    const horizontalOffset = Math.abs(curr.bbox.x - prev.bbox.x);
    maxHorizontalOffset = Math.max(maxHorizontalOffset, horizontalOffset);

    // Gap > 2x line height OR significant overlap (-0.3 line height) breaks the column
    if (verticalGap > avgHeight * 2 || verticalGap < -avgHeight * 0.3) {
      isVerticallyAligned = false;
      break;
    }
  }

  // Horizontal scatter > 40% of avg block width means it's not a column
  const avgWidth = validBlocks.reduce((sum, b) => sum + b.bbox.width, 0) / validBlocks.length;
  if (maxHorizontalOffset > avgWidth * 0.4) {
    isVerticallyAligned = false;
  }

  return !isVerticallyAligned;
}

class TranslationPipeline {
  constructor() {
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;

    logger.debug('Initializing...');

    let llmEndpoint = 'http://localhost:1234/v1';
    try {
      const settings = await window.electron?.store?.get?.('settings') || {};
      llmEndpoint = settings.llm?.endpoint || llmEndpoint;
    } catch (e) {
      logger.debug('Failed to get LLM endpoint from settings:', e);
    }

    const config = useConfigStore.getState();
    await ocrManager.init({
      'rapid-ocr': {},
      'llm-vision': { endpoint: llmEndpoint },
    });
    ocrManager.setPriority(config.ocrPriority);

    this._initialized = true;
    logger.debug('Initialized');
  }

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
      // Frozen panes survive; transient ones are cleared each capture cycle
      session.clearChildPanes();

      // Force re-OCR even if the image is byte-identical to last cycle
      lastImageHash = '';
      lastText = '';

      session.startCapture();

      const captureResult = await window.electron?.floatingWindow?.captureRegion?.(captureOptions);
      if (!captureResult?.success) {
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
      // Dedupe key includes the target language: switching languages must
      // retranslate even when the captured frame is byte-identical.
      const hash = await calculateHash(imageData);
      const imageKey = `${hash}::${config.targetLanguage}`;
      if (imageKey === lastImageHash) {
        logger.debug('Image and target language unchanged, skipping');
        return { success: true, skipped: true };
      }
      lastImageHash = imageKey;

      session.startOcr();

      const ocrResult = await ocrManager.recognize(imageData, {
        engine: config.ocrEngine,
      });

      if (!ocrResult.success) {
        throw new Error(ocrResult.error || _t('svc.ocrFailed', 'OCR 失败'));
      }

      const text = ocrResult.text?.trim();
      if (!text) {
        session.setResult(_t('svc.noTextRecognized', '（未识别到文字）'));
        return { success: true, text: '' };
      }

      // Floating window needs per-line positioning => prefer rawBlocks.
      // Merged blocks are only used for the unified-mode single text body.
      const mergedBlocks = ocrResult.blocks || [];
      const rawBlocks = ocrResult.rawBlocks || mergedBlocks;
      const useScattered = shouldUseScatteredMode(rawBlocks);

      logger.debug(`Display mode: ${useScattered ? 'scattered' : 'unified'}`);
      logger.debug(`Raw blocks: ${rawBlocks.length}, Merged blocks: ${mergedBlocks.length}`);
      if (rawBlocks.length > 0) {
        logger.debug('First raw block bbox:', rawBlocks[0]?.bbox);
        logger.debug('Capture options:', captureOptions);
      }

      if (useScattered && rawBlocks.length > 0) {
        return await this.runScatteredMode(rawBlocks, captureOptions);
      }

      const textKey = `${text}::${config.targetLanguage}`;
      if (textKey === lastText) {
        logger.debug('Text and target language unchanged, skipping');
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

      const privacyMode = await getPrivacyMode();

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

          // If user hasn't pinned target lang and we detect same-as-source,
          // flip to the other primary lang so something useful is shown
          let targetLang = config.targetLanguage;
          if (!config.lockTargetLang && sourceLang === targetLang) {
            targetLang = targetLang === 'zh' ? 'en' : 'zh';
          }

          const result = await translationService.translate(text, {
            sourceLang,
            targetLang,
            mode: 'normal',
            privacyMode,
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
        currentState.addToHistory({
          source: allSource,
          translated: allTranslated,
          mode: 'scattered',
          blockCount: createdPanes.length,
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

      let targetLang = config.targetLanguage;
      if (!config.lockTargetLang && sourceLang === targetLang) {
        targetLang = targetLang === 'zh' ? 'en' : 'zh';
      }

      const mode = options.mode || 'normal';

      const privacyMode = await getPrivacyMode();

      if (privacyMode === PRIVACY_MODE_IDS.OFFLINE) {
        logger.debug('Offline mode - using local-llm only');
      }

      const result = await translationService.translate(text, {
        sourceLang,
        targetLang,
        mode,
        privacyMode,
      });

      if (!result.success) {
        throw new Error(result.error || _t('svc.translateFailed', '翻译失败'));
      }

      // cleanTranslationOutput strips LLM artifacts like trailing "Translation:" etc.
      const cleaned = cleanTranslationOutput(result.text, text);

      if (cleaned) {
        session.setResult(cleaned, result.provider);

        session.addToHistory({
          source: text,
          translated: cleaned,
          sourceLang,
          targetLang,
          provider: result.provider,
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

  resetCache() {
    lastImageHash = '';
    lastText = '';
  }
}

const pipeline = new TranslationPipeline();

export default pipeline;
export { TranslationPipeline, calculateHash, detectLanguage, cleanTranslationOutput, shouldTranslateText };
