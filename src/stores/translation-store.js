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
      useStreamOutput: true, // 是否使用流式输出（打字机效果）
      autoTranslate: false, // 是否自动翻译
      autoTranslateDelay: 500, // 自动翻译延迟（毫秒）
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
        // 版本管理
        versions: [], // [{ id, type, text, createdAt, styleRef?, styleName?, styleStrength? }]
        currentVersionId: null,
      },

      history: [],
      historyLimit: 1000,
      favorites: [],
      queue: [], // 批量翻译队列
      isProcessingQueue: false,

      // OCR 状态
      ocrStatus: {
        isProcessing: false,
        engine: "llm-vision",  // 默认使用 LLM Vision
        lastResult: null,
        error: null,
      },

      // 截图数据（用于跨组件传递）
      pendingScreenshot: null,

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

      setUseStreamOutput: (value) =>
        set((state) => {
          state.useStreamOutput = value;
        }),

      setAutoTranslate: (value) =>
        set((state) => {
          state.autoTranslate = value;
        }),

      setAutoTranslateDelay: (value) =>
        set((state) => {
          state.autoTranslateDelay = value;
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

      // ==================== 流式翻译 (打字机效果) ====================
      streamTranslate: async (options = {}) => {
        const state = get();
        const mode = state.translationMode;
        const { sourceText, sourceLanguage, targetLanguage } =
          state.currentTranslation;

        if (!sourceText.trim()) {
          return { success: false, error: "请输入要翻译的文本" };
        }

        const startTime = Date.now();

        set((state) => {
          state.currentTranslation.status = "translating";
          state.currentTranslation.error = null;
          state.currentTranslation.translatedText = ""; // 清空之前的译文
          state.currentTranslation.id = uuidv4();
        });

        try {
          // 调用 translator 的流式翻译
          const stream = translator.streamTranslate(sourceText, {
            from: sourceLanguage,
            to: targetLanguage,
            template: options.template || state.currentTranslation.metadata.template,
            saveHistory: mode !== "secure",
          });

          let fullText = "";

          // 逐步接收 chunk 并更新 UI
          for await (const chunk of stream) {
            if (chunk.error) {
              throw new Error(chunk.error);
            }

            if (chunk.chunk) {
              fullText = chunk.fullText;
              // 实时更新译文
              set((state) => {
                state.currentTranslation.translatedText = fullText;
              });
            }

            if (chunk.done) {
              break;
            }
          }

          const duration = Date.now() - startTime;

          // 完成后更新状态和历史
          set((state) => {
            state.currentTranslation.status = "success";
            state.currentTranslation.metadata = {
              timestamp: Date.now(),
              duration,
              model: null,
              template: options.template || state.currentTranslation.metadata.template,
            };

            // 初始化版本管理 - 原始翻译作为 v1
            const originalVersion = {
              id: 'v1',
              type: 'original',
              text: fullText,
              createdAt: Date.now(),
            };
            state.currentTranslation.versions = [originalVersion];
            state.currentTranslation.currentVersionId = 'v1';

            // 添加到历史（非无痕模式）
            if (mode !== "secure" && fullText) {
              const historyItem = {
                id: state.currentTranslation.id,
                sourceText: sourceText,
                translatedText: fullText,
                sourceLanguage: sourceLanguage,
                targetLanguage: targetLanguage,
                timestamp: Date.now(),
                duration,
                model: null,
              };

              state.history.unshift(historyItem);

              if (state.history.length > state.historyLimit) {
                state.history = state.history.slice(0, state.historyLimit);
              }

              state.statistics.totalTranslations++;
              state.statistics.totalCharacters += sourceText.length;

              // 更新今日统计
              const today = new Date().toDateString();
              const historyToday = state.history.filter(
                (item) => new Date(item.timestamp).toDateString() === today
              );
              state.statistics.todayTranslations = historyToday.length;
            }
          });

          return { success: true, translated: fullText };
        } catch (error) {
          console.error("Stream translation error:", error);
          set((state) => {
            state.currentTranslation.status = "error";
            state.currentTranslation.error = error.message;
          });
          return { success: false, error: error.message };
        }
      },

      // 核心翻译逻辑（非流式，保留兼容）
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

              // 初始化版本管理 - 原始翻译作为 v1
              const originalVersion = {
                id: 'v1',
                type: 'original',
                text: finalTranslatedText,
                createdAt: Date.now(),
              };
              state.currentTranslation.versions = [originalVersion];
              state.currentTranslation.currentVersionId = 'v1';

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

      // 设置待处理的截图数据
      setPendingScreenshot: (dataURL) =>
        set((state) => {
          state.pendingScreenshot = dataURL;
        }),

      // 清除待处理的截图数据
      clearPendingScreenshot: () =>
        set((state) => {
          state.pendingScreenshot = null;
        }),

      addToFavorites: (item = null, isStyleReference = false) =>
        set((state) => {
          const favoriteItem = item || {
            id: uuidv4(),
            sourceText: state.currentTranslation.sourceText,
            translatedText: state.currentTranslation.translatedText,
            sourceLanguage: state.currentTranslation.sourceLanguage,
            targetLanguage: state.currentTranslation.targetLanguage,
            timestamp: Date.now(),
            tags: [],
            folderId: isStyleReference ? 'style_library' : null,
            isStyleReference: isStyleReference,
          };
          // 如果传入的 item 需要标记为风格参考
          if (item && isStyleReference) {
            favoriteItem.folderId = 'style_library';
            favoriteItem.isStyleReference = true;
          }
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

      // ==================== 版本管理 ====================
      // 添加风格改写版本
      addStyleVersion: (text, styleRef, styleName, styleStrength) =>
        set((state) => {
          const versions = state.currentTranslation.versions || [];
          
          // 查找是否已有风格改写版本
          const existingStyleIndex = versions.findIndex(v => v.type === 'style_rewrite');
          
          const newVersion = {
            id: existingStyleIndex >= 0 ? versions[existingStyleIndex].id : `v${versions.length + 1}`,
            type: 'style_rewrite',
            text,
            createdAt: Date.now(),
            styleRef,
            styleName,
            styleStrength,
          };
          
          if (existingStyleIndex >= 0) {
            // 覆盖已有的风格版本
            versions[existingStyleIndex] = newVersion;
          } else {
            // 添加新版本
            versions.push(newVersion);
          }
          
          state.currentTranslation.versions = versions;
          state.currentTranslation.currentVersionId = newVersion.id;
          state.currentTranslation.translatedText = text;
        }),

      // 添加用户编辑版本
      addUserEditVersion: (text) =>
        set((state) => {
          const versions = state.currentTranslation.versions || [];
          
          // 查找是否已有用户编辑版本
          const existingEditIndex = versions.findIndex(v => v.type === 'user_edit');
          
          const newVersion = {
            id: existingEditIndex >= 0 ? versions[existingEditIndex].id : `v${versions.length + 1}`,
            type: 'user_edit',
            text,
            createdAt: Date.now(),
          };
          
          if (existingEditIndex >= 0) {
            versions[existingEditIndex] = newVersion;
          } else {
            versions.push(newVersion);
          }
          
          state.currentTranslation.versions = versions;
          state.currentTranslation.currentVersionId = newVersion.id;
          state.currentTranslation.translatedText = text;
        }),

      // 切换版本
      switchVersion: (versionId) =>
        set((state) => {
          const version = state.currentTranslation.versions?.find(v => v.id === versionId);
          if (version) {
            state.currentTranslation.currentVersionId = versionId;
            state.currentTranslation.translatedText = version.text;
          }
        }),

      // 获取当前版本信息
      getCurrentVersion: () => {
        const state = get();
        const { versions, currentVersionId } = state.currentTranslation;
        return versions?.find(v => v.id === currentVersionId) || null;
      },

      clearCurrent: () =>
        set((state) => {
          state.currentTranslation.sourceText = "";
          state.currentTranslation.translatedText = "";
          state.currentTranslation.status = "idle";
          state.currentTranslation.error = null;
          state.currentTranslation.versions = [];
          state.currentTranslation.currentVersionId = null;
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
