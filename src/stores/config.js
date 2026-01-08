// src/stores/config.js
// 配置存储 - 持久化的用户设置
// API Key, 翻译源选择, 目标语言等

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 配置 Store
 * 存储用户偏好设置（持久化）
 */
const useConfigStore = create(
  persist(
    (set, get) => ({
      // ========== 翻译设置 ==========
      sourceLanguage: 'auto',
      targetLanguage: 'zh',
      lockTargetLang: true,       // 锁定目标语言（避免回译）
      
      // ========== 翻译源设置 ==========
      translationEngine: 'local-llm',  // 当前选中的翻译引擎
      subtitleEngine: null,            // 字幕模式专用引擎（null=自动）
      providerPriority: ['local-llm', 'openai', 'deepl'],
      
      // ========== OCR 设置 ==========
      ocrEngine: 'rapid-ocr',
      ocrPriority: ['rapid-ocr', 'llm-vision'],
      
      // ========== 界面设置 ==========
      theme: 'light',
      glassOpacity: 0.85,
      fontSize: 14,
      
      // ========== 玻璃窗设置 ==========
      glassWindow: {
        autoPin: true,
        rememberPosition: true,
        smartDetect: true,
      },
      
      // ========== 字幕模式设置 ==========
      subtitle: {
        refreshInterval: 1000,
        hashThreshold: 10,
        textThreshold: 80,
      },
      
      // ========== Actions ==========
      setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
      setTargetLanguage: (lang) => set({ targetLanguage: lang }),
      setLockTargetLang: (lock) => set({ lockTargetLang: lock }),
      
      setTranslationEngine: (engine) => set({ translationEngine: engine }),
      setSubtitleEngine: (engine) => set({ subtitleEngine: engine }),
      setProviderPriority: (priority) => set({ providerPriority: priority }),
      
      setOcrEngine: (engine) => set({ ocrEngine: engine }),
      setOcrPriority: (priority) => set({ ocrPriority: priority }),
      
      setTheme: (theme) => set({ theme }),
      setGlassOpacity: (opacity) => set({ glassOpacity: opacity }),
      
      updateGlassWindow: (updates) => set((state) => ({
        glassWindow: { ...state.glassWindow, ...updates }
      })),
      
      updateSubtitle: (updates) => set((state) => ({
        subtitle: { ...state.subtitle, ...updates }
      })),
      
      // 重置为默认值
      reset: () => set({
        sourceLanguage: 'auto',
        targetLanguage: 'zh',
        lockTargetLang: true,
        translationEngine: 'local-llm',
        subtitleEngine: null,
        providerPriority: ['local-llm', 'openai', 'deepl'],
        ocrEngine: 'rapid-ocr',
        ocrPriority: ['rapid-ocr', 'llm-vision'],
        theme: 'light',
        glassOpacity: 0.85,
        fontSize: 14,
      }),
    }),
    {
      name: 't-translate-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // 只持久化这些字段
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage,
        lockTargetLang: state.lockTargetLang,
        translationEngine: state.translationEngine,
        subtitleEngine: state.subtitleEngine,
        providerPriority: state.providerPriority,
        ocrEngine: state.ocrEngine,
        ocrPriority: state.ocrPriority,
        theme: state.theme,
        glassOpacity: state.glassOpacity,
        fontSize: state.fontSize,
        glassWindow: state.glassWindow,
        subtitle: state.subtitle,
      }),
    }
  )
);

export default useConfigStore;
export { useConfigStore };
