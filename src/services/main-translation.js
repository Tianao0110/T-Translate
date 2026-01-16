// src/services/main-translation.js
// 主窗口翻译服务 - Service 层（精简版）
//
// 职责：
// - 主窗口的 UI 状态管理
// - 调用 translationService 进行翻译
// - 历史记录管理
// - OCR 识别处理
//
// 重构说明：
// - 移除了对 translator.js 的依赖
// - 所有翻译逻辑统一走 translationService（门面）
// - 本模块只负责 UI 状态更新和历史管理
//
// 调用关系：
// TranslationPanel → translation-store → mainTranslation → translationService → providers

import { v4 as uuidv4 } from 'uuid';
import translationService from './translation.js';
import { ocrManager } from '../providers/ocr/index.js';
import useTranslationStore from '../stores/translation-store.js';

// 从配置中心导入常量
import { PRIVACY_MODES, TRANSLATION_STATUS } from '@config/defaults';

/**
 * 主窗口翻译服务
 */
class MainTranslationService {
  constructor() {
    this._isTranslating = false;
  }

  /**
   * 执行翻译（统一入口）
   * 根据 store 中的 useStreamOutput 设置决定是否流式输出
   * 
   * @param {object} options - 翻译选项
   * @returns {Promise<{success: boolean, translated?: string, error?: string}>}
   */
  async execute(options = {}) {
    const state = useTranslationStore.getState();
    const { useStreamOutput, translationMode } = state;

    if (useStreamOutput) {
      return this.streamTranslate(options);
    } else {
      return this.translate(options);
    }
  }

  /**
   * 流式翻译（打字机效果）
   * @param {object} options - 翻译选项
   * @returns {Promise<{success: boolean, translated?: string, error?: string}>}
   */
  async streamTranslate(options = {}) {
    const state = useTranslationStore.getState();
    const mode = state.translationMode;
    const { sourceText, sourceLanguage, targetLanguage } = state.currentTranslation;

    if (!sourceText.trim()) {
      return { success: false, error: '请输入要翻译的文本' };
    }

    const startTime = Date.now();
    const translationId = uuidv4();

    // 更新状态：开始翻译
    useTranslationStore.setState((draft) => {
      draft.currentTranslation.status = TRANSLATION_STATUS.TRANSLATING;
      draft.currentTranslation.error = null;
      draft.currentTranslation.translatedText = '';
      draft.currentTranslation.id = translationId;
    });

    try {
      // 调用 translationService 的流式翻译
      const result = await translationService.translateStream(
        sourceText,
        {
          sourceLang: sourceLanguage,
          targetLang: targetLanguage,
          template: options.template || state.currentTranslation.metadata.template,
          privacyMode: mode,
          useCache: mode !== PRIVACY_MODES.SECURE,
        },
        // onChunk 回调：实时更新 UI
        (fullText) => {
          useTranslationStore.setState((draft) => {
            draft.currentTranslation.translatedText = fullText;
          });
        }
      );

      const duration = Date.now() - startTime;

      if (result.success) {
        // 完成后更新状态
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

          // 初始化版本管理 - 原始翻译作为 v1
          const originalVersion = {
            id: 'v1',
            type: 'original',
            text: result.text,
            createdAt: Date.now(),
          };
          draft.currentTranslation.versions = [originalVersion];
          draft.currentTranslation.currentVersionId = 'v1';

          // 添加到历史（非无痕模式）
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
        throw new Error(result.error || '翻译失败');
      }

    } catch (error) {
      console.error('[MainTranslation] Stream translation error:', error);
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = TRANSLATION_STATUS.ERROR;
        draft.currentTranslation.error = error.message;
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * 非流式翻译
   * @param {object} options - 翻译选项
   * @returns {Promise<{success: boolean, translated?: string, error?: string}>}
   */
  async translate(options = {}) {
    const state = useTranslationStore.getState();
    const mode = state.translationMode;
    const { sourceText, sourceLanguage, targetLanguage } = state.currentTranslation;

    if (!sourceText.trim()) {
      return { success: false, error: '请输入要翻译的文本' };
    }

    const startTime = Date.now();
    const translationId = uuidv4();

    // 更新状态：开始翻译
    useTranslationStore.setState((draft) => {
      draft.currentTranslation.status = TRANSLATION_STATUS.TRANSLATING;
      draft.currentTranslation.error = null;
      draft.currentTranslation.id = translationId;
    });

    try {
      // 调用 translationService（不是 translator）
      const result = await translationService.translate(sourceText, {
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
        template: options.template || state.currentTranslation.metadata.template,
        privacyMode: mode,
        useCache: mode !== PRIVACY_MODES.SECURE,
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

          // 初始化版本管理
          const originalVersion = {
            id: 'v1',
            type: 'original',
            text: result.text,
            createdAt: Date.now(),
          };
          draft.currentTranslation.versions = [originalVersion];
          draft.currentTranslation.currentVersionId = 'v1';

          // 添加到历史（非无痕模式）
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
        throw new Error(result.error || '翻译失败');
      }

    } catch (error) {
      console.error('[MainTranslation] Translation error:', error);
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = TRANSLATION_STATUS.ERROR;
        draft.currentTranslation.error = error.message;
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量翻译
   * @param {string[]} texts - 文本数组
   * @param {object} options - 选项
   * @returns {Promise<Array<{success: boolean, text?: string, error?: string}>>}
   */
  async batchTranslate(texts, options = {}) {
    const state = useTranslationStore.getState();

    // 初始化队列
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

      // 更新当前项状态
      useTranslationStore.setState((draft) => {
        const queueItem = draft.queue.find((q) => q.id === item.id);
        if (queueItem) queueItem.status = 'processing';
      });

      try {
        // 使用 translationService
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

  /**
   * OCR 识别
   * @param {string} image - 图片数据（base64 或 URL）
   * @param {object} options - 选项
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
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
      });

      if (result.success) {
        useTranslationStore.setState((draft) => {
          draft.ocrStatus.isProcessing = false;
          draft.ocrStatus.lastResult = result;
          if (options.autoSetSource !== false) {
            draft.currentTranslation.sourceText = result.text;
          }
        });

        return { success: true, text: result.text, engine: result.engine };
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

  /**
   * 添加到历史记录（内部方法）
   * @param {object} draft - immer draft
   * @param {object} item - 历史记录项
   */
  _addToHistory(draft, item) {
    // 检查是否已存在相同内容
    const exists = draft.history.some(
      (h) => h.sourceText === item.sourceText && h.translatedText === item.translatedText
    );

    if (!exists) {
      draft.history.unshift(item);

      if (draft.history.length > draft.historyLimit) {
        draft.history = draft.history.slice(0, draft.historyLimit);
      }

      // 更新统计
      draft.statistics.totalTranslations++;
      draft.statistics.totalCharacters += item.sourceText?.length || 0;

      // 更新今日统计
      const today = new Date().toDateString();
      const historyToday = draft.history.filter(
        (h) => new Date(h.timestamp).toDateString() === today
      );
      draft.statistics.todayTranslations = historyToday.length;
    }
  }

  /**
   * 获取缓存统计（透传）
   */
  getCacheStats() {
    return translationService.getCacheStats();
  }

  /**
   * 清空缓存（透传）
   */
  clearCache(level = 'all') {
    translationService.clearCache(level);
  }
}

// 单例导出
const mainTranslation = new MainTranslationService();

export default mainTranslation;
export { MainTranslationService };
