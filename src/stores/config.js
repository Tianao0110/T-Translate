// Persistent user preferences shared by all renderer windows
// (localStorage key 't-translate-config'). Only fields with real consumers
// live here — the floating window + its pipeline read targetLanguage/
// sameLanguageBehavior/ocrEngine/ocrPriority/floatingOpacity/
// floatingDisplayMode.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { LANGUAGE_CODES, OCR_ENGINES } from '@config/defaults';

const useConfigStore = create(
  persist(
    (set) => ({
      targetLanguage: LANGUAGE_CODES.ZH,
      // Configured source language, mirrored so 'swap' knows what to swap back
      // to (the pipeline still auto-detects the actual text language).
      sourceLanguage: 'auto',
      // Mirror of settings.translation.sameLanguageBehavior ('original'|'swap'),
      // synced from the main settings on load and on settings-changed.
      sameLanguageBehavior: 'original',

      ocrEngine: OCR_ENGINES.RAPID_OCR,
      ocrPriority: [OCR_ENGINES.RAPID_OCR, OCR_ENGINES.LLM_VISION],

      floatingOpacity: 0.85,

      // Mirror of settings.floatingWindow.displayMode ('auto'|'scattered'|
      // 'unified'), synced from the main settings on load and on
      // settings-changed — the pipeline reads it per capture.
      floatingDisplayMode: 'auto',

      // Floating-window toggle for understanding-type AI actions. Neutral by
      // construction: it decides nothing about behavior, it only lets the
      // actions marked understandOnly appear — what those actions do is their
      // prompt config, including any the user imports.
      understandMode: false,

      setTargetLanguage: (lang) => set({ targetLanguage: lang }),
      setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
      setSameLanguageBehavior: (behavior) => set({ sameLanguageBehavior: behavior }),
      setOcrEngine: (engine) => set({ ocrEngine: engine }),
      setFloatingOpacity: (opacity) => set({ floatingOpacity: opacity }),
      setFloatingDisplayMode: (mode) => set({ floatingDisplayMode: mode }),
      setUnderstandMode: (on) => set({ understandMode: !!on }),
    }),
    {
      name: 't-translate-config',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        targetLanguage: state.targetLanguage,
        sourceLanguage: state.sourceLanguage,
        sameLanguageBehavior: state.sameLanguageBehavior,
        ocrEngine: state.ocrEngine,
        ocrPriority: state.ocrPriority,
        floatingOpacity: state.floatingOpacity,
        floatingDisplayMode: state.floatingDisplayMode,
        understandMode: state.understandMode,
      }),
    }
  )
);

export default useConfigStore;
export { useConfigStore };
