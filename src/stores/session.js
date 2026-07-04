// Floating-window session store — runtime state only (not persisted).
// Tracks translation status, child panes, recent history.

import { create } from 'zustand';

export const STATUS = {
  IDLE: 'idle',
  CAPTURING: 'capturing',
  OCR_PROCESSING: 'ocr_processing',
  TRANSLATING: 'translating',
  SUCCESS: 'success',
  ERROR: 'error',
};

export const DISPLAY_MODE = {
  UNIFIED: 'unified',     // single result block
  SCATTERED: 'scattered', // one child pane per OCR text block, overlaid in-place
};

export const CHILD_PANE_STATUS = {
  PENDING: 'pending',
  TRANSLATING: 'translating',
  DONE: 'done',
  ERROR: 'error',
};

const generateId = () => `pane-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

const useSessionStore = create((set, get) => ({
  status: STATUS.IDLE,
  sourceText: '',
  translatedText: '',
  error: null,

  currentProvider: null,
  currentOcrEngine: null,

  metadata: {
    timestamp: null,
    duration: null,
    sourceLang: null,
    targetLang: null,
  },

  displayMode: DISPLAY_MODE.UNIFIED,
  childPanes: [],
  frozenPanes: [], // pinned panes the user dragged out (cap of 15)

  setStatus: (status) => set({ status }),

  setSourceText: (text) => set({ sourceText: text }),

  setResult: (text, provider = null) => set({
    translatedText: text,
    currentProvider: provider,
    status: STATUS.SUCCESS,
    metadata: {
      ...get().metadata,
      timestamp: Date.now(),
    },
  }),

  setError: (error) => set({
    error,
    status: STATUS.ERROR,
  }),

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

  setDisplayMode: (mode) => set({ displayMode: mode }),

  // Returns the created panes so the caller can iterate without re-reading state
  setChildPanes: (blocks) => {
    const panes = blocks.map((block, index) => ({
      id: generateId(),
      index,
      sourceText: block.text,
      translatedText: '',
      // bbox in CSS pixels, relative to capture area (already scaled by DPR in pipeline)
      bbox: block.bbox,
      status: CHILD_PANE_STATUS.PENDING,
      error: null,
      isFrozen: false,
    }));
    set({ childPanes: panes });
    return panes;
  },

  updateChildPane: (id, updates) => {
    set((state) => ({
      childPanes: state.childPanes.map((pane) =>
        pane.id === id ? { ...pane, ...updates } : pane
      ),
    }));
  },

  // Handles drag in either pane bucket; caller doesn't need to know which one
  updateChildPanePosition: (id, position) => {
    set((state) => {
      const inChildPanes = state.childPanes.some(p => p.id === id);
      if (inChildPanes) {
        return {
          childPanes: state.childPanes.map((pane) =>
            pane.id === id ? { ...pane, bbox: { ...pane.bbox, ...position } } : pane
          ),
        };
      }

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

  // viewportPos {x,y} is required for correct placement: live panes hold
  // container-relative coords while frozen panes render position:fixed
  // (viewport space) — copying bbox unchanged would teleport the pane by the
  // container's offset.
  freezeChildPane: (id, viewportPos) => {
    const state = get();
    const pane = state.childPanes.find((p) => p.id === id);

    if (!pane) return;

    // FIFO eviction at the cap of 15 frozen panes
    let newFrozenPanes = [...state.frozenPanes];
    while (newFrozenPanes.length >= 15) {
      newFrozenPanes.shift();
    }

    const frozenBbox = viewportPos
      ? { ...pane.bbox, x: viewportPos.x, y: viewportPos.y }
      : pane.bbox;

    set({
      childPanes: state.childPanes.filter((p) => p.id !== id),
      frozenPanes: [...newFrozenPanes, { ...pane, bbox: frozenBbox, isFrozen: true }],
    });
  },

  // Used when a pane is promoted to its own OS-level BrowserWindow
  removeChildPane: (id) => {
    set((state) => ({
      childPanes: state.childPanes.filter((p) => p.id !== id),
    }));
  },

  closeFrozenPane: (id) => {
    set((state) => ({
      frozenPanes: state.frozenPanes.filter((p) => p.id !== id),
    }));
  },

  clearChildPanes: () => {
    set({ childPanes: [], displayMode: DISPLAY_MODE.UNIFIED });
  },

  clearAllPanes: () => {
    set({ childPanes: [], frozenPanes: [], displayMode: DISPLAY_MODE.UNIFIED });
  },

  // Used by pipeline / service layer to surface fallback notices to floating-window UI
  notification: null, // { message, type: 'info'|'warning'|'error'|'success' }

  setNotification: (notification) => set({ notification }),
  clearNotification: () => set({ notification: null }),

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
