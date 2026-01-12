// src/stores/translation-store.js
// 翻译状态管理 - 主窗口用
// 
// 架构说明 (M-V-S-P):
// TranslationPanel (V) → mainTranslation (S) → translator/translation (S) → registry (P)
//                      ↘ translation-store (M) ← 写入结果
// 
// 职责 (Model 层)：
// - 管理主窗口的翻译状态（sourceText, translatedText, status）
// - 版本管理（多版本译文、风格改写）
// - 历史记录、收藏功能
// - 流式输出状态管理
//
// 注意：玻璃窗口使用独立的 stores/session.js + services/pipeline.js

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { v4 as uuidv4 } from "uuid";

// Service 引用（延迟绑定，避免循环依赖）
let _mainTranslation = null;
const getMainTranslation = async () => {
  if (!_mainTranslation) {
    const module = await import("../services/main-translation.js");
    _mainTranslation = module.default;
  }
  return _mainTranslation;
};

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

      // 单独设置目标语言（供玻璃窗口同步使用）
      setTargetLanguage: (target) =>
        set((state) => {
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

      // ==================== 流式翻译 (委托给 Service) ====================
      streamTranslate: async (options = {}) => {
        // 委托给 main-translation service
        const service = await getMainTranslation();
        return service.streamTranslate(options);
      },

      // 核心翻译逻辑（委托给 Service）
      translate: async (options = {}) => {
        const service = await getMainTranslation();
        return service.translate(options);
      },

      // 批量翻译（委托给 Service）
      batchTranslate: async (texts, options = {}) => {
        const service = await getMainTranslation();
        return service.batchTranslate(texts, options);
      },

      // OCR 识别（委托给 Service）
      recognizeImage: async (image, options = {}) => {
        const service = await getMainTranslation();
        return service.recognizeImage(image, options);
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

      // 添加到历史记录（供外部调用，如玻璃窗口）
      addToHistory: (item) =>
        set((state) => {
          const historyItem = {
            id: item.id || uuidv4(),  // 使用 UUID 避免重复
            sourceText: item.sourceText || '',
            translatedText: item.translatedText || '',
            sourceLanguage: item.sourceLanguage || 'auto',
            targetLanguage: item.targetLanguage || 'zh',
            timestamp: item.timestamp || Date.now(),
            source: item.source || 'unknown'
          };
          
          // 检查是否已存在相同内容
          const exists = state.history.some(
            h => h.sourceText === historyItem.sourceText && 
                 h.translatedText === historyItem.translatedText
          );
          
          if (!exists) {
            state.history.unshift(historyItem);
            if (state.history.length > state.historyLimit) {
              state.history = state.history.slice(0, state.historyLimit);
            }
            // 更新统计
            state.statistics.totalTranslations++;
            state.statistics.totalCharacters += (historyItem.sourceText?.length || 0);
          }
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
          // 只恢复语言设置，不恢复翻译内容
          currentTranslation: {
            ...currentState.currentTranslation,
            sourceLanguage: persistedState.currentTranslation?.sourceLanguage || currentState.currentTranslation.sourceLanguage,
            targetLanguage: persistedState.currentTranslation?.targetLanguage || currentState.currentTranslation.targetLanguage,
            // 翻译内容始终为空
            sourceText: "",
            translatedText: "",
          },
        };
      },
      partialize: (state) => ({
        // 持久化历史、收藏、统计
        history: state.history,
        favorites: state.favorites,
        statistics: state.statistics,
        // 只持久化语言设置，不持久化翻译内容
        currentTranslation: {
          sourceLanguage: state.currentTranslation.sourceLanguage,
          targetLanguage: state.currentTranslation.targetLanguage,
        },
        ocrStatus: { engine: state.ocrStatus.engine },
      }),
    }
  )
);

export default useTranslationStore;
