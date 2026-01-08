// src/services/main-translation.js
// 主窗口翻译服务 - Service 层
//
// 职责：
// - 主窗口的翻译业务逻辑
// - 流式翻译处理
// - 批量翻译处理
// - OCR 识别处理
// - 历史记录和统计更新
//
// 调用关系：
// TranslationPanel → mainTranslation → translator/translationService → providers
//                                    ↘ translation-store (写入结果)

import { v4 as uuidv4 } from 'uuid';
import translator from './translator.js';
import { ocrManager } from '../providers/ocr/index.js';
import useTranslationStore from '../stores/translation-store.js';

/**
 * 主窗口翻译服务
 */
class MainTranslationService {
  constructor() {
    this._isTranslating = false;
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
      draft.currentTranslation.status = 'translating';
      draft.currentTranslation.error = null;
      draft.currentTranslation.translatedText = '';
      draft.currentTranslation.id = translationId;
    });

    try {
      // 调用 translator 的流式翻译
      const stream = translator.streamTranslate(sourceText, {
        from: sourceLanguage,
        to: targetLanguage,
        template: options.template || state.currentTranslation.metadata.template,
        saveHistory: mode !== 'secure',
      });

      let fullText = '';

      // 逐步接收 chunk 并更新 UI
      for await (const chunk of stream) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (chunk.chunk) {
          fullText = chunk.fullText;
          // 实时更新译文
          useTranslationStore.setState((draft) => {
            draft.currentTranslation.translatedText = fullText;
          });
        }

        if (chunk.done) {
          break;
        }
      }

      const duration = Date.now() - startTime;

      // 完成后更新状态和历史
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = 'success';
        draft.currentTranslation.metadata = {
          timestamp: Date.now(),
          duration,
          model: null,
          template: options.template || draft.currentTranslation.metadata.template,
        };

        // 初始化版本管理 - 原始翻译作为 v1
        const originalVersion = {
          id: 'v1',
          type: 'original',
          text: fullText,
          createdAt: Date.now(),
        };
        draft.currentTranslation.versions = [originalVersion];
        draft.currentTranslation.currentVersionId = 'v1';

        // 添加到历史（非无痕模式）
        if (mode !== 'secure' && fullText) {
          this._addToHistory(draft, {
            id: translationId,
            sourceText,
            translatedText: fullText,
            sourceLanguage,
            targetLanguage,
            timestamp: Date.now(),
            duration,
            model: null,
          });
        }
      });

      return { success: true, translated: fullText };
    } catch (error) {
      console.error('[MainTranslation] Stream translation error:', error);
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = 'error';
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
      draft.currentTranslation.status = 'translating';
      draft.currentTranslation.error = null;
      draft.currentTranslation.id = translationId;
    });

    try {
      const result = await translator.translate(sourceText, {
        from: sourceLanguage,
        to: targetLanguage,
        template: options.template || state.currentTranslation.metadata.template,
        ...options,
      });

      // 清洗结果
      let finalTranslatedText = '';
      let finalModel = null;

      if (result && result.translated) {
        finalTranslatedText = typeof result.translated === 'string'
          ? result.translated
          : JSON.stringify(result.translated);
        finalModel = result.model;
      } else if (typeof result === 'string') {
        finalTranslatedText = result;
      } else {
        finalTranslatedText = JSON.stringify(result);
      }

      if (result.success || finalTranslatedText) {
        const duration = Date.now() - startTime;

        useTranslationStore.setState((draft) => {
          draft.currentTranslation.translatedText = finalTranslatedText;
          draft.currentTranslation.status = 'success';
          draft.currentTranslation.metadata = {
            timestamp: Date.now(),
            duration,
            model: finalModel,
            template: options.template || draft.currentTranslation.metadata.template,
          };

          // 初始化版本管理
          const originalVersion = {
            id: 'v1',
            type: 'original',
            text: finalTranslatedText,
            createdAt: Date.now(),
          };
          draft.currentTranslation.versions = [originalVersion];
          draft.currentTranslation.currentVersionId = 'v1';

          // 添加到历史（非无痕模式）
          if (mode !== 'secure') {
            this._addToHistory(draft, {
              id: translationId,
              sourceText,
              translatedText: finalTranslatedText,
              sourceLanguage: result.from || sourceLanguage,
              targetLanguage,
              timestamp: Date.now(),
              duration,
              model: finalModel,
            });
          }
        });

        return { success: true, translated: finalTranslatedText };
      } else {
        throw new Error(result.error || '翻译失败');
      }
    } catch (error) {
      console.error('[MainTranslation] Translation error:', error);
      useTranslationStore.setState((draft) => {
        draft.currentTranslation.status = 'error';
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
        const result = await translator.translate(item.text, {
          from: state.currentTranslation.sourceLanguage,
          to: state.currentTranslation.targetLanguage,
          ...options,
        });

        const finalText = result?.translated
          ? (typeof result.translated === 'string' ? result.translated : JSON.stringify(result.translated))
          : JSON.stringify(result);

        useTranslationStore.setState((draft) => {
          const queueItem = draft.queue.find((q) => q.id === item.id);
          if (queueItem) {
            queueItem.status = 'completed';
            queueItem.result = finalText;
          }
        });

        results.push({ success: true, text: finalText });
      } catch (error) {
        useTranslationStore.setState((draft) => {
          const queueItem = draft.queue.find((q) => q.id === item.id);
          if (queueItem) {
            queueItem.status = 'error';
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
   * 执行翻译（根据设置选择流式或非流式）
   * @param {object} options - 翻译选项
   */
  async execute(options = {}) {
    const { useStreamOutput } = useTranslationStore.getState();

    if (useStreamOutput) {
      return this.streamTranslate(options);
    } else {
      return this.translate(options);
    }
  }

  /**
   * 添加到历史记录（内部方法）
   * @param {object} draft - immer draft
   * @param {object} item - 历史记录项
   */
  _addToHistory(draft, item) {
    draft.history.unshift(item);

    if (draft.history.length > draft.historyLimit) {
      draft.history = draft.history.slice(0, draft.historyLimit);
    }

    // 更新统计
    draft.statistics.totalTranslations++;
    draft.statistics.totalCharacters += (item.sourceText?.length || 0);

    // 更新今日统计
    const today = new Date().toDateString();
    const historyToday = draft.history.filter(
      (h) => new Date(h.timestamp).toDateString() === today
    );
    draft.statistics.todayTranslations = historyToday.length;
  }
}

// 单例导出
const mainTranslation = new MainTranslationService();

export default mainTranslation;
export { MainTranslationService };
