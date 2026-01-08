// src/stores/session.js
// 会话存储 - 运行时状态（不持久化）
// 翻译结果, loading状态, 历史记录等

import { create } from 'zustand';

/**
 * 翻译状态
 */
export const STATUS = {
  IDLE: 'idle',
  CAPTURING: 'capturing',
  OCR_PROCESSING: 'ocr_processing',
  TRANSLATING: 'translating',
  SUCCESS: 'success',
  ERROR: 'error',
};

/**
 * 会话 Store
 * 存储运行时状态（不持久化）
 */
const useSessionStore = create((set, get) => ({
  // ========== 翻译状态 ==========
  status: STATUS.IDLE,
  sourceText: '',
  translatedText: '',
  error: null,
  
  // 当前使用的引擎
  currentProvider: null,  // 'local-llm' | 'openai' | ...
  currentOcrEngine: null,
  
  // 翻译元信息
  metadata: {
    timestamp: null,
    duration: null,
    sourceLang: null,
    targetLang: null,
  },
  
  // ========== 字幕模式状态 ==========
  subtitleMode: false,
  subtitleStatus: 'idle',  // idle | listening | recognizing | translating | editing
  subtitleStats: {
    processed: 0,
    skipped: 0,
  },
  prevSubtitle: '',
  currSubtitle: '',
  
  // ========== 历史记录（内存缓存）==========
  recentHistory: [],  // 最近的翻译记录（内存中保留最近 100 条）
  
  // ========== Actions ==========
  
  // 设置状态
  setStatus: (status) => set({ status }),
  
  // 设置源文本
  setSourceText: (text) => set({ sourceText: text }),
  
  // 设置翻译结果
  setResult: (text, provider = null) => set({
    translatedText: text,
    currentProvider: provider,
    status: STATUS.SUCCESS,
    metadata: {
      ...get().metadata,
      timestamp: Date.now(),
    },
  }),
  
  // 设置错误
  setError: (error) => set({
    error,
    status: STATUS.ERROR,
  }),
  
  // 清除状态
  clear: () => set({
    status: STATUS.IDLE,
    sourceText: '',
    translatedText: '',
    error: null,
    currentProvider: null,
    metadata: {
      timestamp: null,
      duration: null,
      sourceLang: null,
      targetLang: null,
    },
  }),
  
  // ========== 字幕模式 ==========
  
  setSubtitleMode: (enabled) => set({ 
    subtitleMode: enabled,
    subtitleStatus: enabled ? 'listening' : 'idle',
  }),
  
  setSubtitleStatus: (status) => set({ subtitleStatus: status }),
  
  updateSubtitleStats: (updates) => set((state) => ({
    subtitleStats: { ...state.subtitleStats, ...updates },
  })),
  
  setSubtitle: (text) => {
    const prev = get().currSubtitle;
    if (prev && prev !== text) {
      set({ prevSubtitle: prev });
    }
    set({ currSubtitle: text });
  },
  
  clearSubtitle: () => set({
    prevSubtitle: '',
    currSubtitle: '',
    subtitleStats: { processed: 0, skipped: 0 },
  }),
  
  // ========== 历史记录 ==========
  
  addToHistory: (item) => set((state) => {
    const newHistory = [
      {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        ...item,
      },
      ...state.recentHistory,
    ].slice(0, 100);  // 只保留最近 100 条
    
    return { recentHistory: newHistory };
  }),
  
  clearHistory: () => set({ recentHistory: [] }),
  
  // ========== 开始翻译流程 ==========
  
  startCapture: () => set({
    status: STATUS.CAPTURING,
    error: null,
  }),
  
  startOcr: () => set({
    status: STATUS.OCR_PROCESSING,
  }),
  
  startTranslation: () => set({
    status: STATUS.TRANSLATING,
  }),
}));

export default useSessionStore;
export { useSessionStore };
