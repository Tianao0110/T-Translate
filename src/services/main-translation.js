// Main-window translation service. Wires UI store state to translationService
// and ocrManager, drives status transitions, and writes history.
// Call graph: TranslationPanel -> translation-store -> this -> translationService -> providers

import { v4 as uuidv4 } from 'uuid';
import translationService from './translation.js';
import { ocrManager } from '../providers/ocr/index.js';
import useTranslationStore from '../stores/translation-store.js';

import { PRIVACY_MODES, TRANSLATION_STATUS } from '@config/defaults';
import { getPrivacyModeConfig } from '../config/privacy-modes.js';
import createLogger from '../utils/logger.js';
import i18n from '../i18n.js';
const logger = createLogger('MainTranslation');

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

class MainTranslationService {
  constructor() {
    this._isTranslating = false;
  }

  // Picks stream vs one-shot based on user preference in the store
  async execute(options = {}) {
    const state = useTranslationStore.getState();
    const { useStreamOutput, translationMode } = state;

    if (useStreamOutput) {
      return this.streamTranslate(options);
    } else {
      return this.translate(options);
    }
  }

  async streamTranslate(options = {}) {
    const state = useTranslationStore.getState();
    const mode = state.translationMode;
    const { sourceText, sourceLanguage, targetLanguage } = state.currentTranslation;

    if (!sourceText.trim()) {
      return { success: false, error: _t('translation.enterText', '请输入要翻译的文本') };
    }

    const startTime = Date.now();
    const translationId = uuidv4();

    useTranslationStore.setState((draft) => {
      draft.currentTranslation.status = TRANSLATION_STATUS.TRANSLATING;
      draft.currentTranslation.error = null;
      draft.currentTranslation.translatedText = '';
      draft.currentTranslation.id = translationId;
    });

    try {
      const glossaryTerms = useTranslationStore.getState().getGlossaryTerms?.() || [];

      const result = await translationService.translateStream(
        sourceText,
        {
          sourceLang: sourceLanguage,
          targetLang: targetLanguage,
          template: options.template || state.currentTranslation.metadata.template,
          privacyMode: mode,
          useCache: mode !== PRIVACY_MODES.SECURE,
          glossaryTerms,
        },
        // Per-chunk UI update for typewriter effect
        (fullText) => {
          useTranslationStore.setState((draft) => {
            draft.currentTranslation.translatedText = fullText;
          });
        }
      );

      const duration = Date.now() - startTime;

      if (result.success) {
        useTranslationStore.setState((draft) => {
          draft.currentTranslation.status = TRANSLATION_STATUS.SUCCESS;
          draft.currentTranslation.translatedText = result.text;
          draft.currentTranslation.metadata = {
            timestamp: Date.now(),
            duration,
            model: result.provider,
            template: options.template || draft.currentTranslation.metadata.template,
            fromCache: result.fromCache,
          };

          if (result.glossaryReplacements?.length > 0) {
            draft.currentTranslation.glossaryApplied = {
              replacements: result.glossaryReplacements,
              originalText: result.originalText,
            };
          } else {
            draft.currentTranslation.glossaryApplied = null;
          }

          // Seed version list with the original translation as v1
          const originalVersion = {
            id: 'v1',
            type: 'original',
            text: result.text,
            createdAt: Date.now(),
          };
          draft.currentTranslation.versions = [originalVersion];
          draft.currentTranslation.currentVersionId = 'v1';

          if (mode !== PRIVACY_MODES.SECURE && result.text) {
            this._addToHistory(draft, {
              id: translationId,
              sourceText,
              translatedText: result.text,
              sourceLanguage,
              targetLanguage,
              timestamp: Date.now(),
              duration,
              model: result.provider,
            });
          }
        });

        return { success: true, translated: result.text };
      } else {
        throw new Error(result.error || _t('svc.translateFailed', '翻译失败'));
      }

    } catch (error) {
      logger.error('Stream translation error:', error);
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = TRANSLATION_STATUS.ERROR;
        draft.currentTranslation.error = error.message;
      });
      return { success: false, error: error.message };
    }
  }

  async translate(options = {}) {
    const state = useTranslationStore.getState();
    const mode = state.translationMode;
    const { sourceText, sourceLanguage, targetLanguage } = state.currentTranslation;

    if (!sourceText.trim()) {
      return { success: false, error: _t('translation.enterText', '请输入要翻译的文本') };
    }

    const startTime = Date.now();
    const translationId = uuidv4();

    useTranslationStore.setState((draft) => {
      draft.currentTranslation.status = TRANSLATION_STATUS.TRANSLATING;
      draft.currentTranslation.error = null;
      draft.currentTranslation.id = translationId;
    });

    try {
      const glossaryTerms = useTranslationStore.getState().getGlossaryTerms?.() || [];

      const result = await translationService.translate(sourceText, {
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
        template: options.template || state.currentTranslation.metadata.template,
        privacyMode: mode,
        useCache: mode !== PRIVACY_MODES.SECURE,
        glossaryTerms,
      });

      const duration = Date.now() - startTime;

      if (result.success) {
        useTranslationStore.setState((draft) => {
          draft.currentTranslation.translatedText = result.text;
          draft.currentTranslation.status = TRANSLATION_STATUS.SUCCESS;
          draft.currentTranslation.metadata = {
            timestamp: Date.now(),
            duration,
            model: result.provider,
            template: options.template || draft.currentTranslation.metadata.template,
            fromCache: result.fromCache,
          };

          if (result.glossaryReplacements?.length > 0) {
            draft.currentTranslation.glossaryApplied = {
              replacements: result.glossaryReplacements,
              originalText: result.originalText,
            };
          } else {
            draft.currentTranslation.glossaryApplied = null;
          }

          const originalVersion = {
            id: 'v1',
            type: 'original',
            text: result.text,
            createdAt: Date.now(),
          };
          draft.currentTranslation.versions = [originalVersion];
          draft.currentTranslation.currentVersionId = 'v1';

          if (mode !== PRIVACY_MODES.SECURE) {
            this._addToHistory(draft, {
              id: translationId,
              sourceText,
              translatedText: result.text,
              sourceLanguage,
              targetLanguage,
              timestamp: Date.now(),
              duration,
              model: result.provider,
            });
          }
        });

        return { success: true, translated: result.text };
      } else {
        throw new Error(result.error || _t('svc.translateFailed', '翻译失败'));
      }

    } catch (error) {
      logger.error('Translation error:', error);
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = TRANSLATION_STATUS.ERROR;
        draft.currentTranslation.error = error.message;
      });
      return { success: false, error: error.message };
    }
  }

  async batchTranslate(texts, options = {}) {
    const state = useTranslationStore.getState();

    const queue = texts.map((text) => ({
      id: uuidv4(),
      text,
      status: 'pending',
      result: null,
    }));

    useTranslationStore.setState((draft) => {
      draft.queue = queue;
      draft.isProcessingQueue = true;
    });

    const results = [];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      useTranslationStore.setState((draft) => {
        const queueItem = draft.queue.find((q) => q.id === item.id);
        if (queueItem) queueItem.status = 'processing';
      });

      try {
        const result = await translationService.translate(item.text, {
          sourceLang: state.currentTranslation.sourceLanguage,
          targetLang: state.currentTranslation.targetLanguage,
          template: options.template,
          privacyMode: state.translationMode,
          useCache: state.translationMode !== PRIVACY_MODES.SECURE,
        });

        useTranslationStore.setState((draft) => {
          const queueItem = draft.queue.find((q) => q.id === item.id);
          if (queueItem) {
            queueItem.status = 'completed';
            queueItem.result = result.text;
          }
        });

        results.push({ success: true, text: result.text });

      } catch (error) {
        useTranslationStore.setState((draft) => {
          const queueItem = draft.queue.find((q) => q.id === item.id);
          if (queueItem) {
            queueItem.status = TRANSLATION_STATUS.ERROR;
            queueItem.error = error.message;
          }
        });

        results.push({ success: false, error: error.message });
      }

      if (options.onProgress) {
        options.onProgress(i + 1, texts.length);
      }
    }

    useTranslationStore.setState((draft) => {
      draft.isProcessingQueue = false;
    });

    return results;
  }

  async recognizeImage(image, options = {}) {
    if (!ocrManager) {
      return { success: false, error: 'OCR not initialized' };
    }

    const state = useTranslationStore.getState();

    useTranslationStore.setState((draft) => {
      draft.ocrStatus.isProcessing = true;
      draft.ocrStatus.error = null;
    });

    try {
      const result = await ocrManager.recognize(image, {
        engine: state.ocrStatus.engine,
        ...options,
        // Last so no call site can widen the engine set beyond the privacy mode
        allowedEngines: getPrivacyModeConfig(state.translationMode).allowedOcrEngines || undefined,
      });

      if (result.success) {
        useTranslationStore.setState((draft) => {
          draft.ocrStatus.isProcessing = false;
          draft.ocrStatus.lastResult = result;
          if (options.autoSetSource !== false) {
            draft.currentTranslation.sourceText = result.text;
          }
          // Surface LLM-Vision fallback so the user knows they're on a different engine.
          // Two variants: hard-lock (repeated failures disabled it) vs soft (model doesn't support vision).
          if (result.fallbackFrom === 'llm-vision') {
            draft.ocrStatus.fallbackNotice = ocrManager.isVisionLocked()
              ? _t('ocr.visionLocked', 'LLM Vision has been disabled due to repeated failures. Switched to local OCR. Re-enable in Settings > OCR.')
              : _t('ocr.visionFallback', 'Current model does not support vision. Using local OCR instead.');
          }
        });

        return { success: true, text: result.text, engine: result.engine, fallbackFrom: result.fallbackFrom };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      useTranslationStore.setState((draft) => {
        draft.ocrStatus.isProcessing = false;
        draft.ocrStatus.error = error.message;
      });

      return { success: false, error: error.message };
    }
  }

  _addToHistory(draft, item) {
    // De-dupe on (source, translated) so retries don't double-log
    const exists = draft.history.some(
      (h) => h.sourceText === item.sourceText && h.translatedText === item.translatedText
    );

    if (!exists) {
      draft.history.unshift(item);

      if (draft.history.length > draft.historyLimit) {
        draft.history = draft.history.slice(0, draft.historyLimit);
      }

      draft.statistics.totalTranslations++;
      draft.statistics.totalCharacters += item.sourceText?.length || 0;

      const today = new Date().toDateString();
      const historyToday = draft.history.filter(
        (h) => new Date(h.timestamp).toDateString() === today
      );
      draft.statistics.todayTranslations = historyToday.length;
    }
  }

  getCacheStats() {
    return translationService.getCacheStats();
  }

  clearCache(level = 'all') {
    translationService.clearCache(level);
  }
}

const mainTranslation = new MainTranslationService();

export default mainTranslation;
export { MainTranslationService };
