// Persistent user preferences: languages, engine priorities, theme, glass settings.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import {
  LANGUAGE_CODES,
  THEMES,
  PROVIDER_IDS,
  OCR_ENGINES,
  DEFAULTS
} from '@config/defaults';

const useConfigStore = create(
  persist(
    (set, get) => ({
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

      glassWindow: {
        autoPin: true,
        rememberPosition: true,
        smartDetect: true,
      },

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
