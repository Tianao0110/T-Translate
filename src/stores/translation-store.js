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

// 从配置中心导入常量
import { PRIVACY_MODES, TRANSLATION_STATUS, LANGUAGE_CODES, DEFAULTS, PROVIDER_IDS } from "@config/defaults";
import { getModeFeatures } from "@config/privacy-modes";
import createLogger from '../utils/logger.js';
const logger = createLogger('TranslationStore');

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
      translationMode: PRIVACY_MODES.STANDARD, // 'standard' | 'secure' | 'offline'
      useStreamOutput: true, // 是否使用流式输出（打字机效果）
      autoTranslate: false, // 是否自动翻译
      autoTranslateDelay: 500, // 自动翻译延迟（毫秒）
      currentTranslation: {
        id: null,
        sourceText: "",
        translatedText: "",
        sourceLanguage: LANGUAGE_CODES.AUTO,
        targetLanguage: LANGUAGE_CODES.ZH,
        status: TRANSLATION_STATUS.IDLE, // idle | translating | success | error
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
      
      // 无痕模式暂存区（不持久化）
      _savedHistory: null,
      _savedStatistics: null,

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
          const previousMode = state.translationMode;
          state.translationMode = mode;
          
          // 切换到无痕模式：暂存当前历史，使用空白历史
          if (mode === PRIVACY_MODES.SECURE && previousMode !== PRIVACY_MODES.SECURE) {
            // 保存当前历史和统计到暂存区
            state._savedHistory = [...state.history];
            state._savedStatistics = { ...state.statistics };
            // 使用空白历史（无痕期间的记录不保存）
            state.history = [];
            state.statistics = {
              totalTranslations: 0,
              totalCharacters: 0,
              todayTranslations: 0,
              weekTranslations: 0,
              mostUsedLanguagePair: null,
              averageTranslationTime: 0,
              lastUpdated: new Date().toISOString(),
            };
          }
          
          // 退出无痕模式：恢复之前的历史
          if (mode !== PRIVACY_MODES.SECURE && previousMode === PRIVACY_MODES.SECURE) {
            if (state._savedHistory) {
              state.history = state._savedHistory;
              state._savedHistory = null;
            }
            if (state._savedStatistics) {
              state.statistics = state._savedStatistics;
              state._savedStatistics = null;
            }
          }
        }),

      // 检查当前模式下某功能是否可用
      isFeatureEnabled: (featureName) => {
        const mode = get().translationMode;
        const features = getModeFeatures(mode);
        return features[featureName] !== false;
      },

      // 检查翻译源是否在当前模式下可用
      isProviderAllowed: (providerId) => {
        const mode = get().translationMode;
        if (mode !== PRIVACY_MODES.OFFLINE) return true;
        // 离线模式仅允许本地LLM
        return providerId === PROVIDER_IDS.LOCAL_LLM;
      },

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

      // ==================== 隐私模式辅助方法 ====================
      // 检查当前模式下是否允许保存历史
      canSaveHistory: () => {
        const state = get();
        return state.translationMode !== PRIVACY_MODES.SECURE;
      },
      
      // 检查当前模式下是否允许使用在线API
      canUseOnlineApi: () => {
        const state = get();
        return state.translationMode !== PRIVACY_MODES.OFFLINE;
      },
      
      // 检查当前模式下是否允许使用缓存
      canUseCache: () => {
        const state = get();
        return state.translationMode !== PRIVACY_MODES.SECURE;
      },
      
      // 获取当前模式配置
      getModeConfig: () => {
        const state = get();
        const configs = {
          standard: {
            saveHistory: true,
            useCache: true,
            onlineApi: true,
            analytics: true,
          },
          secure: {
            saveHistory: false,
            useCache: false,
            onlineApi: true,
            analytics: false,
          },
          offline: {
            saveHistory: true,
            useCache: true,
            onlineApi: false,
            analytics: true,
            allowedProviders: [PROVIDER_IDS.LOCAL_LLM],
            allowedOcrEngines: ['llm-vision', 'rapid-ocr', 'windows-ocr'],
          }
        };
        return configs[state.translationMode] || configs.standard;
      },

      // 添加到历史记录（供外部调用，如玻璃窗口）
      // 自动检查隐私模式
      addToHistory: (item) =>
        set((state) => {
          // 无痕模式下不保存历史
          if (state.translationMode === PRIVACY_MODES.SECURE) {
            // logger.debug(' Secure mode - history not saved');
            return;
          }
          
          const historyItem = {
            id: item.id || uuidv4(),
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
            // 更新统计（标准模式和离线模式都统计）
            if (state.translationMode !== PRIVACY_MODES.SECURE) {
              state.statistics.totalTranslations++;
              state.statistics.totalCharacters += (historyItem.sourceText?.length || 0);
            }
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
          logger.error("Paste error:", error);
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

      /**
       * 获取术语表（从收藏的术语库文件夹中提取）
       * @returns {Array<{source: string, target: string}>} 术语列表
       */
      getGlossaryTerms: () => {
        const state = get();
        return state.favorites
          .filter(item => item.folderId === 'glossary')
          .map(item => ({
            source: item.sourceText,
            target: item.translatedText,
          }))
          .filter(term => term.source && term.target);
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
          // 恢复隐私模式
          translationMode: persistedState.translationMode || currentState.translationMode,
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
        // 持久化隐私模式
        translationMode: state.translationMode,
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
