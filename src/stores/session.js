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
 * 玻璃板显示模式
 */
export const DISPLAY_MODE = {
  UNIFIED: 'unified',      // 整体模式：结果显示在内容区
  SCATTERED: 'scattered',  // 散点模式：子玻璃板覆盖原文位置
};

/**
 * 子玻璃板状态
 */
export const CHILD_PANE_STATUS = {
  PENDING: 'pending',      // 等待翻译
  TRANSLATING: 'translating',
  DONE: 'done',
  ERROR: 'error',
};

/**
 * 生成唯一 ID
 */
const generateId = () => `pane-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

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
  
  // ========== 子玻璃板状态 ==========
  displayMode: DISPLAY_MODE.UNIFIED,  // 当前显示模式
  childPanes: [],                      // 子玻璃板数组
  frozenPanes: [],                     // 已冻结的子玻璃板（最多8个）
  
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
  
  // ========== 子玻璃板管理 ==========
  
  /**
   * 设置显示模式
   */
  setDisplayMode: (mode) => set({ displayMode: mode }),
  
  /**
   * 设置子玻璃板（从 OCR 结果创建）
   * @param {Array} blocks - OCR 返回的文本块数组 [{ text, bbox: {x,y,width,height} }]
   * @returns {Array} 创建的子玻璃板数组
   */
  setChildPanes: (blocks) => {
    const panes = blocks.map((block, index) => ({
      id: generateId(),
      index,
      sourceText: block.text,
      translatedText: '',
      bbox: block.bbox,  // { x, y, width, height } 相对于截图区域
      status: CHILD_PANE_STATUS.PENDING,
      error: null,
      isFrozen: false,
    }));
    set({ childPanes: panes });
    return panes;  // 返回创建的 panes，供调用者使用
  },
  
  /**
   * 更新单个子玻璃板
   */
  updateChildPane: (id, updates) => {
    set((state) => ({
      childPanes: state.childPanes.map((pane) =>
        pane.id === id ? { ...pane, ...updates } : pane
      ),
    }));
  },
  
  /**
   * 更新子玻璃板位置（拖动后）
   * 同时支持 childPanes 和 frozenPanes
   */
  updateChildPanePosition: (id, position) => {
    set((state) => {
      // 检查是否在 childPanes 中
      const inChildPanes = state.childPanes.some(p => p.id === id);
      if (inChildPanes) {
        return {
          childPanes: state.childPanes.map((pane) =>
            pane.id === id ? { ...pane, bbox: { ...pane.bbox, ...position } } : pane
          ),
        };
      }
      
      // 检查是否在 frozenPanes 中
      const inFrozenPanes = state.frozenPanes.some(p => p.id === id);
      if (inFrozenPanes) {
        return {
          frozenPanes: state.frozenPanes.map((pane) =>
            pane.id === id ? { ...pane, bbox: { ...pane.bbox, ...position } } : pane
          ),
        };
      }
      
      return {};
    });
  },
  
  /**
   * 冻结子玻璃板（拖出母板时）
   */
  freezeChildPane: (id) => {
    const state = get();
    const pane = state.childPanes.find((p) => p.id === id);
    
    if (!pane) return;
    
    // 检查冻结数量限制（最多8个）
    if (state.frozenPanes.length >= 8) {
      console.warn('已达到最大冻结数量 (8个)');
      return;
    }
    
    // 从 childPanes 移除，添加到 frozenPanes
    set({
      childPanes: state.childPanes.filter((p) => p.id !== id),
      frozenPanes: [...state.frozenPanes, { ...pane, isFrozen: true }],
    });
  },
  
  /**
   * 关闭冻结的子玻璃板
   */
  closeFrozenPane: (id) => {
    set((state) => ({
      frozenPanes: state.frozenPanes.filter((p) => p.id !== id),
    }));
  },
  
  /**
   * 清除所有未冻结的子玻璃板
   */
  clearChildPanes: () => {
    set({ childPanes: [], displayMode: DISPLAY_MODE.UNIFIED });
  },
  
  /**
   * 清除所有（包括冻结的）
   */
  clearAllPanes: () => {
    set({ childPanes: [], frozenPanes: [], displayMode: DISPLAY_MODE.UNIFIED });
  },
  
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
