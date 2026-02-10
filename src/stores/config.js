// src/stores/config.js
// 配置存储 - 持久化的用户设置
// API Key, 翻译源选择, 目标语言等

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 从配置中心导入常量
import { 
  LANGUAGE_CODES, 
  THEMES, 
  PROVIDER_IDS, 
  OCR_ENGINES,
  DEFAULTS 
} from '@config/defaults';

/**
 * 配置 Store
 * 存储用户偏好设置（持久化）
 */
const useConfigStore = create(
  persist(
    (set, get) => ({
      // ========== 翻译设置 ==========
      sourceLanguage: LANGUAGE_CODES.AUTO,
      targetLanguage: LANGUAGE_CODES.ZH,
      lockTargetLang: true,
      
      // ========== 翻译源设置 ==========
      translationEngine: PROVIDER_IDS.LOCAL_LLM,
      providerPriority: [PROVIDER_IDS.LOCAL_LLM, PROVIDER_IDS.OPENAI, PROVIDER_IDS.DEEPL],
      
      // ========== OCR 设置 ==========
      ocrEngine: OCR_ENGINES.RAPID_OCR,
      ocrPriority: [OCR_ENGINES.RAPID_OCR, OCR_ENGINES.LLM_VISION],
      
      // ========== 界面设置 ==========
      theme: THEMES.LIGHT,
      glassOpacity: 0.85,
      fontSize: DEFAULTS.FONT_SIZE,
      
      // ========== 玻璃窗设置 ==========
      glassWindow: {
        autoPin: true,
        rememberPosition: true,
        smartDetect: true,
      },
      
      // ========== Actions ==========
      setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
      setTargetLanguage: (lang) => set({ targetLanguage: lang }),
      setLockTargetLang: (lock) => set({ lockTargetLang: lock }),
      
      setTranslationEngine: (engine) => set({ translationEngine: engine }),
      setProviderPriority: (priority) => set({ providerPriority: priority }),
      
      setOcrEngine: (engine) => set({ ocrEngine: engine }),
      setOcrPriority: (priority) => set({ ocrPriority: priority }),
      
      setTheme: (theme) => set({ theme }),
      setGlassOpacity: (opacity) => set({ glassOpacity: opacity }),
      
      updateGlassWindow: (updates) => set((state) => ({
        glassWindow: { ...state.glassWindow, ...updates }
      })),
      
      
      // 重置为默认值
      reset: () => set({
        sourceLanguage: LANGUAGE_CODES.AUTO,
        targetLanguage: LANGUAGE_CODES.ZH,
        lockTargetLang: true,
        translationEngine: PROVIDER_IDS.LOCAL_LLM,
        providerPriority: [PROVIDER_IDS.LOCAL_LLM, PROVIDER_IDS.OPENAI, PROVIDER_IDS.DEEPL],
        ocrEngine: OCR_ENGINES.RAPID_OCR,
        ocrPriority: [OCR_ENGINES.RAPID_OCR, OCR_ENGINES.LLM_VISION],
        theme: THEMES.LIGHT,
        glassOpacity: 0.85,
        fontSize: DEFAULTS.FONT_SIZE,
      }),
    }),
    {
      name: 't-translate-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage,
        lockTargetLang: state.lockTargetLang,
        translationEngine: state.translationEngine,
        providerPriority: state.providerPriority,
        ocrEngine: state.ocrEngine,
        ocrPriority: state.ocrPriority,
        theme: state.theme,
        glassOpacity: state.glassOpacity,
        fontSize: state.fontSize,
        glassWindow: state.glassWindow,
      }),
    }
  )
);

export default useConfigStore;
export { useConfigStore };
