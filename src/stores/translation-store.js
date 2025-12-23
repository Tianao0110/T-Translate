// src/stores/translation-store.js
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { v4 as uuidv4 } from "uuid";

// 引入服务
import translator from "../services/translator";
import ocrManager from "../services/ocr-manager";

/**
 * 翻译状态管理 (完整修复版)
 * 使用 Zustand 进行状态管理
 */
const useTranslationStore = create(
  persist(
    immer((set, get) => ({
      // ==================== 1. 状态 (保留原样) ====================
      // 当前翻译任务
      translationMode: "standard", // 'standard' | 'secure' | 'offline'
      currentTranslation: {
        id: null,
        sourceText: "",
        translatedText: "",
        sourceLanguage: "auto",
        targetLanguage: "zh",
        status: "idle", // idle | translating | success | error
        error: null,
        metadata: {
          timestamp: null,
          duration: null,
          model: null,
          template: "general",
        },
      },

      history: [],
      historyLimit: 1000,
      favorites: [],
      queue: [], // 批量翻译队列
      isProcessingQueue: false,

      // OCR 状态
      ocrStatus: {
        isProcessing: false,
        engine: "tesseract",
        lastResult: null,
        error: null,
      },

      // 统计数据
      statistics: {
        totalTranslations: 0,
        totalCharacters: 0,
        todayTranslations: 0,
        weekTranslations: 0,
        mostUsedLanguagePair: null,
        averageTranslationTime: 0,
        lastUpdated: new Date().toISOString(),
      },

      // 临时剪贴板
      clipboard: {
        source: "",
        translated: "",
        timestamp: null,
      },

      // ==================== 2. Actions  ====================
      setTranslationMode: (mode) =>
        set((state) => {
          state.translationMode = mode;
        }),
      setSourceText: (text) =>
        set((state) => {
          state.currentTranslation.sourceText = text;
          state.currentTranslation.status = "idle";
          state.currentTranslation.error = null;
        }),

      setTranslatedText: (text) =>
        set((state) => {
          state.currentTranslation.translatedText = text;
        }),

      setLanguages: (source, target) =>
        set((state) => {
          if (source) state.currentTranslation.sourceLanguage = source;
          if (target) state.currentTranslation.targetLanguage = target;
        }),

      swapLanguages: () =>
        set((state) => {
          if (state.currentTranslation.sourceLanguage === "auto") return;

          const temp = state.currentTranslation.sourceLanguage;
          state.currentTranslation.sourceLanguage =
            state.currentTranslation.targetLanguage;
          state.currentTranslation.targetLanguage = temp;

          const tempText = state.currentTranslation.sourceText;
          state.currentTranslation.sourceText =
            state.currentTranslation.translatedText;
          state.currentTranslation.translatedText = tempText;
        }),

      // 核心翻译逻辑
      translate: async (options = {}) => {
        const state = get();
        const mode = state.translationMode;
        const { sourceText, sourceLanguage, targetLanguage } =
          state.currentTranslation;

        if (!sourceText.trim()) {
          return { success: false, error: "请输入要翻译的文本" };
        }

        set((state) => {
          state.currentTranslation.status = "translating";
          state.currentTranslation.error = null;
          state.currentTranslation.id = uuidv4();
        });

        const startTime = Date.now();

        try {
          const result = await translator.translate(sourceText, {
            from: sourceLanguage,
            to: targetLanguage,
            template:
              options.template || state.currentTranslation.metadata.template,
            ...options,
          });

          // ========== 🔴 关键修复：结果清洗逻辑 ==========
          let finalTranslatedText = "";
          let finalModel = null;

          // 确保提取出纯字符串，防止 React 渲染对象报错
          if (result && result.translated) {
            finalTranslatedText =
              typeof result.translated === "string"
                ? result.translated
                : JSON.stringify(result.translated);
            finalModel = result.model;
          } else if (typeof result === "string") {
            finalTranslatedText = result;
          } else {
            finalTranslatedText = JSON.stringify(result);
          }
          // ==============================================

          if (result.success || finalTranslatedText) {
            const duration = Date.now() - startTime;

            set((state) => {
              state.currentTranslation.translatedText = finalTranslatedText;
              state.currentTranslation.status = "success";
              state.currentTranslation.metadata = {
                timestamp: Date.now(),
                duration,
                model: finalModel,
                template:
                  options.template ||
                  state.currentTranslation.metadata.template,
              };

              // 添加到历史
              if (mode !== "secure") {
                // 添加到历史
                const historyItem = {
                  id: state.currentTranslation.id,
                  sourceText: sourceText,
                  translatedText: finalTranslatedText,
                  sourceLanguage: result.from || sourceLanguage,
                  targetLanguage: targetLanguage,
                  timestamp: Date.now(),
                  duration,
                  model: finalModel,
                };

                state.history.unshift(historyItem);

                if (state.history.length > state.historyLimit) {
                  state.history = state.history.slice(0, state.historyLimit);
                }

                state.statistics.totalTranslations++;
                state.statistics.totalCharacters += sourceText.length;
              }
              // 🔴 结束修改

              // 更新今日统计 (如果无痕模式不计入统计，这部分也要放进 if 里，或者单独处理)
              const today = new Date().toDateString();
              const historyToday = state.history.filter(
                (item) => new Date(item.timestamp).toDateString() === today
              );
              state.statistics.todayTranslations = historyToday.length;
            });

            return { success: true, translated: finalTranslatedText };
          } else {
            throw new Error(result.error || "翻译失败");
          }
        } catch (error) {
          console.error("Translation error:", error);
          set((state) => {
            state.currentTranslation.status = "error";
            state.currentTranslation.error = error.message;
          });
          return { success: false, error: error.message };
        }
      },

      // 批量翻译 (保留)
      batchTranslate: async (texts, options = {}) => {
        set((state) => {
          state.queue = texts.map((text) => ({
            id: uuidv4(),
            text,
            status: "pending",
            result: null,
          }));
          state.isProcessingQueue = true;
        });

        const results = [];
        // 获取最新的队列快照
        const queueIds = get().queue.map((q) => q.id);

        for (let i = 0; i < queueIds.length; i++) {
          const id = queueIds[i];

          set((state) => {
            const item = state.queue.find((q) => q.id === id);
            if (item) item.status = "processing";
          });

          // 获取当前项的最新文本（虽然这里一般不变，但是个好习惯）
          const currentItem = get().queue.find((q) => q.id === id);
          if (!currentItem) continue;

          try {
            // 直接调用翻译服务，避免 translate() 的副作用影响 UI 状态
            const result = await translator.translate(currentItem.text, {
              from: get().currentTranslation.sourceLanguage,
              to: get().currentTranslation.targetLanguage,
              ...options,
            });

            // 清洗结果
            const finalText =
              result && result.translated
                ? typeof result.translated === "string"
                  ? result.translated
                  : JSON.stringify(result.translated)
                : JSON.stringify(result);

            set((state) => {
              const item = state.queue.find((q) => q.id === id);
              if (item) {
                item.status = "completed";
                item.result = finalText;
              }
            });
            results.push({ success: true, text: finalText });
          } catch (error) {
            set((state) => {
              const item = state.queue.find((q) => q.id === id);
              if (item) {
                item.status = "error";
                item.error = error.message;
              }
            });
            results.push({ success: false, error: error.message });
          }

          if (options.onProgress) options.onProgress(i + 1, texts.length);
        }

        set((state) => {
          state.isProcessingQueue = false;
        });
        return results;
      },

      // OCR 识别 (保留)
      recognizeImage: async (image, options = {}) => {
        // 如果 OCR 模块还没初始化，防止报错
        if (!ocrManager)
          return { success: false, error: "OCR not initialized" };

        set((state) => {
          state.ocrStatus.isProcessing = true;
          state.ocrStatus.error = null;
        });

        try {
          const result = await ocrManager.recognize(image, {
            engine: get().ocrStatus.engine,
            ...options,
          });

          if (result.success) {
            set((state) => {
              state.ocrStatus.isProcessing = false;
              state.ocrStatus.lastResult = result;
              if (options.autoSetSource !== false) {
                state.currentTranslation.sourceText = result.text;
              }
            });
            return { success: true, text: result.text };
          } else {
            throw new Error(result.error);
          }
        } catch (error) {
          set((state) => {
            state.ocrStatus.isProcessing = false;
            state.ocrStatus.error = error.message;
          });
          return { success: false, error: error.message };
        }
      },

      setOcrEngine: (engine) =>
        set((state) => {
          state.ocrStatus.engine = engine;
        }),

      addToFavorites: (item = null) =>
        set((state) => {
          const favoriteItem = item || {
            id: uuidv4(),
            sourceText: state.currentTranslation.sourceText,
            translatedText: state.currentTranslation.translatedText,
            sourceLanguage: state.currentTranslation.sourceLanguage,
            targetLanguage: state.currentTranslation.targetLanguage,
            timestamp: Date.now(),
            tags: [],
          };
          const exists = state.favorites.some(
            (f) =>
              f.sourceText === favoriteItem.sourceText &&
              f.targetLanguage === favoriteItem.targetLanguage
          );
          if (!exists) state.favorites.unshift(favoriteItem);
        }),

      removeFromFavorites: (id) =>
        set((state) => {
          state.favorites = state.favorites.filter((f) => f.id !== id);
        }),
        
      updateFavoriteItem: (id, updates) =>
        set((state) => {
          const item = state.favorites.find((f) => f.id === id);
          if (item) {
            Object.assign(item, updates);
          }
        }),

      clearCurrent: () =>
        set((state) => {
          state.currentTranslation.sourceText = "";
          state.currentTranslation.translatedText = "";
          state.currentTranslation.status = "idle";
          state.currentTranslation.error = null;
        }),

      clearHistory: () =>
        set((state) => {
          state.history = [];
          state.statistics.totalTranslations = 0;
          state.statistics.totalCharacters = 0;
        }),

      removeFromHistory: (id) =>
        set((state) => {
          state.history = state.history.filter((item) => item.id !== id);
        }),

      restoreFromHistory: (id) =>
        set((state) => {
          const item = state.history.find((h) => h.id === id);
          if (item) {
            state.currentTranslation.sourceText = item.sourceText;
            state.currentTranslation.translatedText = item.translatedText;
            state.currentTranslation.sourceLanguage = item.sourceLanguage;
            state.currentTranslation.targetLanguage = item.targetLanguage;
          }
        }),

      copyToClipboard: (type = "translated") => {
        const state = get();
        const text =
          type === "source"
            ? state.currentTranslation.sourceText
            : state.currentTranslation.translatedText;
        if (text) {
          if (window.electron) window.electron.clipboard.writeText(text);
          else navigator.clipboard.writeText(text);

          set((state) => {
            state.clipboard = {
              source: type === "source" ? text : state.clipboard.source,
              translated:
                type === "translated" ? text : state.clipboard.translated,
              timestamp: Date.now(),
            };
          });
          return true;
        }
        return false;
      },

      pasteFromClipboard: async () => {
        try {
          let text;
          if (window.electron)
            text = await window.electron.clipboard.readText();
          else text = await navigator.clipboard.readText();

          if (text) {
            set((state) => {
              state.currentTranslation.sourceText = text;
              state.currentTranslation.status = "idle";
            });
            return true;
          }
        } catch (error) {
          console.error("Paste error:", error);
        }
        return false;
      },

      exportHistory: (format = "json") => {
        const data = get().history;
        return data; // 仅返回数据，让组件处理下载逻辑
      },

      importHistory: async (file) => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            set((state) => {
              const existingIds = new Set(state.history.map((h) => h.id));
              const newItems = data.filter((item) => !existingIds.has(item.id));
              state.history = [...newItems, ...state.history].slice(
                0,
                state.historyLimit
              );
            });
            return { success: true, count: data.length };
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },

      searchHistory: (query) => {
        const searchTerm = query.toLowerCase();
        return get().history.filter(
          (item) =>
            item.sourceText.toLowerCase().includes(searchTerm) ||
            item.translatedText.toLowerCase().includes(searchTerm)
        );
      },

      getStatistics: () => {
        const state = get();
        // 简单触发一次状态更新以刷新时间
        set((state) => {
          state.statistics.lastUpdated = new Date().toISOString();
        });
        return state.statistics;
      },

      reset: () =>
        set((state) => {
          const { sourceLanguage, targetLanguage } = state.currentTranslation;
          state.currentTranslation.sourceText = "";
          state.currentTranslation.translatedText = "";
          state.history = [];
          state.favorites = [];
        }),
    })),
    {
      name: "translation-store",
      // Electron 环境下 localStorage 也是持久化的，且同步加载，不会闪屏
      storage: createJSONStorage(() => localStorage),
      merge: (persistedState, currentState) => {
        return {
          ...currentState,
          ...persistedState,
          currentTranslation: {
            ...currentState.currentTranslation,
            ...(persistedState.currentTranslation || {}),
            // 强制兜底：如果硬盘里没有 sourceText，就用初始值的空字符串
            sourceText:
              persistedState.currentTranslation?.sourceText ||
              currentState.currentTranslation.sourceText ||
              "",
            translatedText:
              persistedState.currentTranslation?.translatedText ||
              currentState.currentTranslation.translatedText ||
              "",
          },
        };
      },
      partialize: (state) => ({
        history: state.history,
        favorites: state.favorites,
        statistics: state.statistics,
        currentTranslation: {
          sourceLanguage: state.currentTranslation.sourceLanguage,
          targetLanguage: state.currentTranslation.targetLanguage,
          sourceText: state.currentTranslation.sourceText,
          translatedText: state.currentTranslation.translatedText,
          metadata: state.currentTranslation.metadata,
        },
        ocrStatus: { engine: state.ocrStatus.engine },
      }),
    }
  )
);

export default useTranslationStore;
