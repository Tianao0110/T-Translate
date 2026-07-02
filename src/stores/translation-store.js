// Main-window translation store. Owns source/translated text, versions,
// history, favorites, OCR status, and privacy-mode behavior.
// Floating window uses a separate stores/session.js + services/pipeline.js.

import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { v4 as uuidv4 } from "uuid";

import { PRIVACY_MODES, TRANSLATION_STATUS, LANGUAGE_CODES, DEFAULTS, PROVIDER_IDS, LANGUAGES } from "@config/defaults";
import { getModeFeatures } from "@config/privacy-modes";
import createLogger from '../utils/logger.js';
const logger = createLogger('TranslationStore');

const VALID_LANG_CODES = new Set(LANGUAGES.map(l => l.code));

// zustand persist re-serializes the partialized state — history alone can hold
// 1000 entries — on EVERY setState: per keystroke and, while streaming, per
// flush. Throttle the stringify+write; beforeunload covers the tail.
const PERSIST_WRITE_MS = 1000;

function createThrottledJSONStorage(interval = PERSIST_WRITE_MS) {
  let timer = null;
  let pending = null; // [name, value]

  const write = () => {
    timer = null;
    if (!pending) return;
    const [name, value] = pending;
    pending = null;
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch (e) {
      logger.error('Persist write failed:', e);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', write);
  }

  return {
    getItem: (name) => {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      // Immer snapshots are immutable — holding the latest reference is safe;
      // stringify is deferred to write time.
      pending = [name, value];
      if (timer === null) timer = setTimeout(write, interval);
    },
    removeItem: (name) => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      localStorage.removeItem(name);
    },
  };
}

// Import paths must tolerate hand-edited JSON: missing ids get generated,
// bad timestamps fall back to now, text-less entries are dropped.
// Exported for tests.
export function normalizeHistoryItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sourceText = typeof raw.sourceText === 'string' ? raw.sourceText : '';
  const translatedText = typeof raw.translatedText === 'string' ? raw.translatedText : '';
  if (!sourceText && !translatedText) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uuidv4(),
    sourceText,
    translatedText,
    sourceLanguage: typeof raw.sourceLanguage === 'string' ? raw.sourceLanguage : 'auto',
    targetLanguage: typeof raw.targetLanguage === 'string' ? raw.targetLanguage : 'zh',
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    source: typeof raw.source === 'string' ? raw.source : 'import',
  };
}

// Lazy-bound to avoid circular dep with main-translation service
let _mainTranslation = null;
const getMainTranslation = async () => {
  if (!_mainTranslation) {
    const module = await import("../services/main-translation.js");
    _mainTranslation = module.default;
  }
  return _mainTranslation;
};

const useTranslationStore = create(
  // subscribeWithSelector: sync-to-electron.js subscribes with (selector,
  // listener, options) — without this middleware vanilla subscribe treats the
  // selector as the listener and the whole sync layer silently no-ops.
  subscribeWithSelector(persist(
    immer((set, get) => ({
      translationMode: PRIVACY_MODES.STANDARD,
      useStreamOutput: true,
      autoTranslate: false,
      autoTranslateDelay: 500,
      currentTranslation: {
        id: null,
        sourceText: "",
        translatedText: "",
        sourceLanguage: LANGUAGE_CODES.AUTO,
        targetLanguage: LANGUAGE_CODES.ZH,
        status: TRANSLATION_STATUS.IDLE,
        error: null,
        metadata: {
          timestamp: null,
          duration: null,
          model: null,
          template: "general",
        },
        // [{ id, type, text, createdAt, styleRef?, styleName?, styleStrength? }]
        versions: [],
        currentVersionId: null,
        // { replacements: [{from, to}], originalText } — drives the undo hint in UI
        glossaryApplied: null,
      },

      history: [],
      historyLimit: 1000,
      favorites: [],
      queue: [],
      isProcessingQueue: false,

      // Stash for Secure mode — not persisted, restored on mode exit
      _savedHistory: null,
      _savedStatistics: null,

      ocrStatus: {
        isProcessing: false,
        engine: "llm-vision",
        lastResult: null,
        error: null,
        // Set when LLM-Vision auto-fell-back to a local OCR engine
        fallbackNotice: null,
      },

      pendingScreenshot: null,

      statistics: {
        totalTranslations: 0,
        totalCharacters: 0,
        todayTranslations: 0,
        weekTranslations: 0,
        mostUsedLanguagePair: null,
        averageTranslationTime: 0,
        lastUpdated: new Date().toISOString(),
      },

      clipboard: {
        source: "",
        translated: "",
        timestamp: null,
      },

      // ===== Actions =====

      // Secure-mode round-trip: on enter, stash history/stats and run with
      // empty ones; on exit, restore the stash so Secure-mode entries never
      // bleed into persistent history.
      setTranslationMode: (mode) =>
        set((state) => {
          const previousMode = state.translationMode;
          state.translationMode = mode;

          if (mode === PRIVACY_MODES.SECURE && previousMode !== PRIVACY_MODES.SECURE) {
            state._savedHistory = [...state.history];
            state._savedStatistics = { ...state.statistics };
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

      isFeatureEnabled: (featureName) => {
        const mode = get().translationMode;
        const features = getModeFeatures(mode);
        return features[featureName] !== false;
      },

      // Offline mode only permits local LLM + Ollama
      isProviderAllowed: (providerId) => {
        const mode = get().translationMode;
        if (mode !== PRIVACY_MODES.OFFLINE) return true;
        return providerId === PROVIDER_IDS.LOCAL_LLM || providerId === PROVIDER_IDS.OLLAMA;
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
          if (source && !VALID_LANG_CODES.has(source)) {
            logger.warn(`Invalid source language code: ${source}, ignoring`);
            source = null;
          }
          if (target && !VALID_LANG_CODES.has(target)) {
            logger.warn(`Invalid target language code: ${target}, falling back to default`);
            target = DEFAULTS.TARGET_LANGUAGE;
          }
          if (source) state.currentTranslation.sourceLanguage = source;
          if (target) state.currentTranslation.targetLanguage = target;
          // Stale translation in the wrong language is worse than empty
          state.currentTranslation.translatedText = '';
          state.currentTranslation.status = TRANSLATION_STATUS.IDLE;
          state.currentTranslation.error = null;
        }),

      setTargetLanguage: (target) =>
        set((state) => {
          if (target && !VALID_LANG_CODES.has(target)) {
            logger.warn(`Invalid target language code: ${target}, falling back to default`);
            target = DEFAULTS.TARGET_LANGUAGE;
          }
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

      // ===== Translation delegates to service =====

      streamTranslate: async (options = {}) => {
        const service = await getMainTranslation();
        return service.streamTranslate(options);
      },

      translate: async (options = {}) => {
        const service = await getMainTranslation();
        return service.translate(options);
      },

      batchTranslate: async (texts, options = {}) => {
        const service = await getMainTranslation();
        return service.batchTranslate(texts, options);
      },

      recognizeImage: async (image, options = {}) => {
        const service = await getMainTranslation();
        return service.recognizeImage(image, options);
      },

      setOcrEngine: (engine) =>
        set((state) => {
          state.ocrStatus.engine = engine;
        }),

      setPendingScreenshot: (dataURL) =>
        set((state) => {
          state.pendingScreenshot = dataURL;
        }),

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
          if (item && isStyleReference) {
            favoriteItem.folderId = 'style_library';
            favoriteItem.isStyleReference = true;
          }
          // De-dupe on (source, targetLanguage) so the same phrase isn't favorited twice
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

      // ===== Versions =====
      // Style-rewrite and user-edit are tracked as separate versions so the
      // user can flip between them. We collapse repeats: a second style rewrite
      // overwrites the existing style version (same for user edits).

      addStyleVersion: (text, styleRef, styleName, styleStrength) =>
        set((state) => {
          const versions = state.currentTranslation.versions || [];

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
            versions[existingStyleIndex] = newVersion;
          } else {
            versions.push(newVersion);
          }

          state.currentTranslation.versions = versions;
          state.currentTranslation.currentVersionId = newVersion.id;
          state.currentTranslation.translatedText = text;
        }),

      addUserEditVersion: (text) =>
        set((state) => {
          const versions = state.currentTranslation.versions || [];

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

      switchVersion: (versionId) =>
        set((state) => {
          const version = state.currentTranslation.versions?.find(v => v.id === versionId);
          if (version) {
            state.currentTranslation.currentVersionId = versionId;
            state.currentTranslation.translatedText = version.text;
          }
        }),

      getCurrentVersion: () => {
        const state = get();
        const { versions, currentVersionId } = state.currentTranslation;
        return versions?.find(v => v.id === currentVersionId) || null;
      },

      clearCurrent: () =>
        set((state) => {
          // Null id makes an in-flight stream fail its identity check instead
          // of resurrecting text into the cleared panel
          state.currentTranslation.id = null;
          state.currentTranslation.sourceText = "";
          state.currentTranslation.translatedText = "";
          state.currentTranslation.status = "idle";
          state.currentTranslation.error = null;
          state.currentTranslation.versions = [];
          state.currentTranslation.currentVersionId = null;
          state.currentTranslation.glossaryApplied = null;
        }),

      clearHistory: () =>
        set((state) => {
          state.history = [];
          state.statistics.totalTranslations = 0;
          state.statistics.totalCharacters = 0;
        }),

      // ===== Privacy mode helpers =====

      canSaveHistory: () => {
        const state = get();
        return state.translationMode !== PRIVACY_MODES.SECURE;
      },

      canUseOnlineApi: () => {
        const state = get();
        return state.translationMode !== PRIVACY_MODES.OFFLINE;
      },

      canUseCache: () => {
        const state = get();
        return state.translationMode !== PRIVACY_MODES.SECURE;
      },

      // Single source for the privacy fields every translationService call
      // must carry — the service defaults privacyMode to STANDARD, which has
      // twice shipped offline/secure-mode leaks from call sites forgetting it.
      getPrivacyOptions: () => {
        const mode = get().translationMode;
        return {
          privacyMode: mode,
          useCache: mode !== PRIVACY_MODES.SECURE,
        };
      },

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
            allowedProviders: [PROVIDER_IDS.LOCAL_LLM, PROVIDER_IDS.OLLAMA],
            allowedOcrEngines: ['llm-vision', 'rapid-ocr', 'windows-ocr'],
          }
        };
        return configs[state.translationMode] || configs.standard;
      },

      // External callers (e.g. floating window) route through this, so privacy
      // gating happens here rather than at each call site.
      addToHistory: (item) =>
        set((state) => {
          if (state.translationMode === PRIVACY_MODES.SECURE) {
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

          // De-dupe on (sourceText, translatedText) so retries don't double-log
          const exists = state.history.some(
            h => h.sourceText === historyItem.sourceText &&
                 h.translatedText === historyItem.translatedText
          );

          if (!exists) {
            state.history.unshift(historyItem);
            if (state.history.length > state.historyLimit) {
              state.history = state.history.slice(0, state.historyLimit);
            }
            state.statistics.totalTranslations++;
            state.statistics.totalCharacters += (historyItem.sourceText?.length || 0);
            // Keep the status-bar "today" count honest for selection/floating
            // window entries too (main-panel path recomputes it the same way).
            const today = new Date().toDateString();
            state.statistics.todayTranslations = state.history.filter(
              (h) => new Date(h.timestamp).toDateString() === today
            ).length;
          }
        }),

      removeFromHistory: (id) =>
        set((state) => {
          state.history = state.history.filter((item) => item.id !== id);
        }),

      // Backs the privacy-page auto-delete setting; invoked once at startup.
      pruneHistoryOlderThan: (days) =>
        set((state) => {
          if (!days || days <= 0) return;
          const cutoff = Date.now() - days * 86400000;
          state.history = state.history.filter((h) => (h.timestamp || 0) >= cutoff);
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

      exportHistory: () => ({
        version: 1,
        exportedAt: new Date().toISOString(),
        items: get().history,
      }),

      importHistory: async (file) => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          // Accept the 0.2.9 wrapped form and the legacy bare array.
          const rawItems = Array.isArray(data) ? data
            : Array.isArray(data?.items) ? data.items
            : null;
          if (!rawItems) {
            return { success: false, error: 'Unrecognized history format' };
          }

          let added = 0;
          set((state) => {
            const existingIds = new Set(state.history.map((h) => h.id));
            const seenContent = new Set(
              state.history.map((h) => `${h.sourceText}|${h.translatedText}`)
            );
            const newItems = [];
            for (const raw of rawItems) {
              const item = normalizeHistoryItem(raw);
              if (!item) continue;
              const contentKey = `${item.sourceText}|${item.translatedText}`;
              if (existingIds.has(item.id) || seenContent.has(contentKey)) continue;
              existingIds.add(item.id);
              seenContent.add(contentKey);
              newItems.push(item);
            }
            added = newItems.length;
            state.history = [...newItems, ...state.history].slice(
              0,
              state.historyLimit
            );
          });
          // Real insert count — the old code reported the file's row count
          // even when everything was a duplicate.
          return { success: true, count: added };
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
        // Bump lastUpdated so observers get a fresh value
        set((state) => {
          state.statistics.lastUpdated = new Date().toISOString();
        });
        return state.statistics;
      },

      // Glossary terms live in the favorites pile under folderId === 'glossary'
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
      // localStorage works in Electron and loads synchronously (no flash)
      storage: createThrottledJSONStorage(),
      merge: (persistedState, currentState) => {
        return {
          ...currentState,
          ...persistedState,
          // 'strict' was removed in 0.2.9 — its core promise (no network) maps to offline
          translationMode: persistedState.translationMode === 'strict'
            ? PRIVACY_MODES.OFFLINE
            : (persistedState.translationMode || currentState.translationMode),
          // Persist langs only — never restore in-flight translation text
          currentTranslation: {
            ...currentState.currentTranslation,
            sourceLanguage: persistedState.currentTranslation?.sourceLanguage || currentState.currentTranslation.sourceLanguage,
            targetLanguage: persistedState.currentTranslation?.targetLanguage || currentState.currentTranslation.targetLanguage,
            sourceText: "",
            translatedText: "",
          },
        };
      },
      partialize: (state) => ({
        history: state.history,
        favorites: state.favorites,
        statistics: state.statistics,
        translationMode: state.translationMode,
        autoTranslate: state.autoTranslate,
        useStreamOutput: state.useStreamOutput,
        autoTranslateDelay: state.autoTranslateDelay,
        // Secure-mode stash must survive a quit-while-secure: without these,
        // the emptied history/statistics are what lands on disk and the real
        // data is unrecoverable after restart.
        _savedHistory: state._savedHistory,
        _savedStatistics: state._savedStatistics,
        currentTranslation: {
          sourceLanguage: state.currentTranslation.sourceLanguage,
          targetLanguage: state.currentTranslation.targetLanguage,
        },
        ocrStatus: { engine: state.ocrStatus.engine },
      }),
    }
  ))
);

export default useTranslationStore;
