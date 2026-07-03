// Persistent user preferences shared by all renderer windows
// (localStorage key 't-translate-config'). Only fields with real consumers
// live here — the floating window + its pipeline read targetLanguage/
// lockTargetLang/ocrEngine/ocrPriority/floatingOpacity.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { LANGUAGE_CODES, OCR_ENGINES } from '@config/defaults';

const useConfigStore = create(
  persist(
    (set) => ({
      targetLanguage: LANGUAGE_CODES.ZH,
      // false = flip zh<->en when source equals target (floating window)
      lockTargetLang: false,

      ocrEngine: OCR_ENGINES.RAPID_OCR,
      ocrPriority: [OCR_ENGINES.RAPID_OCR, OCR_ENGINES.LLM_VISION],

      floatingOpacity: 0.85,

      setTargetLanguage: (lang) => set({ targetLanguage: lang }),
      setLockTargetLang: (lock) => set({ lockTargetLang: lock }),
      setOcrEngine: (engine) => set({ ocrEngine: engine }),
      setFloatingOpacity: (opacity) => set({ floatingOpacity: opacity }),
    }),
    {
      name: 't-translate-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        targetLanguage: state.targetLanguage,
        lockTargetLang: state.lockTargetLang,
        ocrEngine: state.ocrEngine,
        ocrPriority: state.ocrPriority,
        floatingOpacity: state.floatingOpacity,
      }),
    }
  )
);

export default useConfigStore;
export { useConfigStore };
