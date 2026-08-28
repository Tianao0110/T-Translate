// Shared constants for SettingsPanel: defaults, nav, settings shape, migrations.

import {
  Globe, Shield, Zap, Moon, Sun,
  Info, Wifi, Eye, Lock, Volume2,
  Code2, Palette, Layers, MousePointer, Server,
  FileText, Sparkles
} from 'lucide-react';

import { PRIVACY_MODES, getModeFeatures, isFeatureEnabled, isProviderAllowed as isProviderAllowedByMode, PRIVACY_MODE_IDS } from '@config/privacy-modes';
import { DEFAULT_TTS_CONFIG } from '../../services/tts/index.js';

export const defaultConfig = {
  llm: { endpoint: 'http://localhost:1234/v1', timeout: 60000 },
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh', batch: { maxLength: 5000 } },
  ocr: { defaultEngine: 'llm-vision', windowsLanguage: 'zh-Hans' },
  ui: { theme: 'light', fontSize: 14 },
  logging: { level: 'info' },
  // Only the global (OS-level) shortcuts are configurable. The in-app keys
  // (translate/swap/clear/paste/copy) were editable in the UI but nothing read
  // settings.shortcuts for them — they're hardcoded in the panels — so the
  // rows were pure decoration and have been removed.
  shortcuts: {
    screenshot: 'Alt+Q',
    toggleWindow: 'Ctrl+Shift+W',
    floatingWindow: 'Ctrl+Alt+G',
    selectionTranslate: 'Ctrl+Shift+T',
    floatingCapture: 'Ctrl+Alt+Space',
  },
  dev: { debugMode: false },
};

// `basic: true` flags items shown in the simplified settings view.
// `keywords` powers the in-settings search.
export const NAV_ITEMS = [
  { id: 'providers', icon: Server, group: 'translation', basic: true, keywords: ['provider', 'openai', 'deepl', 'gemini', 'deepseek', 'local', 'api', '翻译源', '本地'] },
  { id: 'translation', icon: Globe, group: 'translation', basic: true, keywords: ['language', 'source', 'target', 'auto', 'stream', '翻译', '语言', '流式'] },
  { id: 'selection', icon: MousePointer, group: 'translation', keywords: ['selection', 'mouse', 'trigger', 'button', '划词', '选中', '鼠标'] },
  { id: 'floatingWindow', icon: Layers, group: 'translation', keywords: ['glass', 'floating', 'overlay', 'pin', '玻璃', '透明', '置顶', '悬浮', '散点', '整段'] },
  { id: 'document', icon: FileText, group: 'translation', keywords: ['document', 'pdf', 'docx', 'epub', 'srt', 'subtitle', '文档', '字幕'] },
  { id: 'aiActions', icon: Sparkles, group: 'translation', keywords: ['ai', 'action', 'summarize', 'explain', 'import', 'prompt', 'AI', '动作', '总结', '讲解', '理解', '导入'] },
  { id: 'ocr', icon: Eye, group: 'system', keywords: ['ocr', 'recognize', 'screenshot', 'image', 'rapidocr', 'llm', '识别', '截图'] },
  { id: 'tts', icon: Volume2, group: 'system', keywords: ['tts', 'speech', 'voice', 'volume', 'rate', '朗读', '语音', '语速'] },
  { id: 'interface', icon: Palette, group: 'system', basic: true, keywords: ['theme', 'dark', 'light', 'font', 'appearance', '界面', '主题', '外观'] },
  { id: 'privacy', icon: Shield, group: 'system', keywords: ['privacy', 'security', 'mode', 'history', '隐私', '安全', '记录'] },
  { id: 'about', icon: Info, group: 'system', basic: true, keywords: ['about', 'version', 'info', '关于', '版本'] },
];

export const DEFAULT_SETTINGS = {
  // Theme/language. Previously only survived via electron-store's build-time
  // defaults leaking through the top-level spread — a fresh install or a
  // reset-all left this bucket undefined and InterfaceSection crashed reading
  // .theme. Owned here now so the shape is always present.
  interface: {
    theme: defaultConfig.ui.theme,
    language: '',
    // OS notification when a long task (document translation / one-click
    // summary) finishes while the window is in the background.
    systemNotifications: true,
  },

  // Startup toggles (auto-enable selection after launch).
  startup: {
    autoEnableSelection: false,
  },

  // Live language keys are settings.translation.sourceLanguage/targetLanguage,
  // mirrored from the zustand store by sync-to-electron.js — the settings page
  // owns neither them nor providers (ProviderSettings does).
  translation: {
    providers: [],
    providerConfigs: {},
    // 'original' shows source text untranslated when it's already in the
    // target language; 'swap' flips zh<->en (legacy). Consumed by the
    // selection window and the floating-window pipeline.
    sameLanguageBehavior: 'original',
  },

  // Document translator. Single source of truth — DocumentTranslator reads
  // this bucket at parse/translate time, so keys here must match what the
  // component consumes (the pre-0.2.9 bucket drifted into three disjoint
  // key sets and every control was dead).
  document: {
    maxCharsPerSegment: 800,
    concurrency: 2,
    displayStyle: 'below',
    filters: {
      skipShort: true,
      minLength: 10,
      skipNumbers: true,
      skipCode: true,
      skipTargetLang: true,
    },
  },

  // Floating window. Single source of truth for its defaults —
  // electron/ipc/floating-window.js GET_SETTINGS fallbacks must stay in sync.
  floatingWindow: {
    defaultOpacity: 0.85,
    // 'auto' | 'scattered' | 'unified' — scattered-vs-unified layout for
    // capture results ('auto' keeps the geometry heuristic)
    displayMode: 'auto',
    // Off = WDA_EXCLUDEFROMCAPTURE (OCR never re-reads our own overlay).
    // On = the window shows up in screenshots/recordings (user opt-in).
    captureVisible: false,
  },

  selection: {
    enabled: false,
    triggerTimeout: 4000,
    showSourceByDefault: false,
    autoCloseOnCopy: false,
    minChars: 2,
    maxChars: 2000,
    windowOpacity: 95,
    // Rainbow signature skin for the selection window across all themes;
    // off = theme-matched skins (fresh ships its own aqua one).
    rainbowWindow: false,
    // CapsLock-direct mode: bypass trigger UI when CapsLock is on
    stickyViaCapsLock: false,
    stickyWarningShown: false,
  },

  shortcuts: { ...defaultConfig.shortcuts },

  // saveHistory/maxHistory/cacheEnabled/maxCache were ghost keys: persisted
  // for several versions but never consumed anywhere (history cap lives in
  // translation-store.historyLimit, cache cap in the main-process stack).
  privacy: {
    autoDeleteDays: 0,
  },

  ocr: {
    engine: defaultConfig.ocr.defaultEngine,
    language: defaultConfig.ocr.windowsLanguage,
    preprocess: true,
    autoDetect: true,
    confidence: 0.6,
    // Local model tier: 'standard' = bundled small models, 'high' = the
    // downloadable medium variant. Applies immediately (silent update +
    // dot-path store write), like theme/language.
    modelTier: 'standard',
    // OpenAI-compatible endpoint for the LLM-Vision OCR engine. Was the
    // orphaned settings.connection.endpoint bucket (no UI); now a real field
    // in the OCR panel's LLM-Vision group.
    llmEndpoint: defaultConfig.llm.endpoint,
    // Optional explicit vision model. Blank = server's currently-loaded model;
    // set it when LM Studio/Ollama holds several models so a non-vision one
    // can't be picked (which silently drops the image → auto-degrade).
    llmModel: '',
  },

  // User-imported AI action configs (config/ai-actions.js defines the shape).
  // Data, not code: the app ships a framework plus two neutral built-ins, and
  // anything beyond that is a file the user chose to import.
  aiActions: {
    imported: [],
    // When "Summarize" is offered. Shipped as an estimate and always meant to
    // be tuned against real documents — now the user does the tuning.
    // One number: the Latin-word bar derives from it, keeping the ratio the
    // built-in default had (150 CJK characters ≈ 120 English words).
    longFormChars: 150,
  },

  // Single source of truth for TTS defaults is services/tts/index.js
  // (electron/state.js keeps a value-identical copy — main process can't
  // import renderer ESM).
  tts: { ...DEFAULT_TTS_CONFIG },

  screenshot: {
    outputMode: 'bubble', // 'bubble' | 'main'
  },
};

// 0.2.9 reshaped settings.document around the keys the translator actually
// reads. Old keys (preserveFormatting/batchSize/maxParagraphLength/...) were
// never consumed; batchMaxTokens belonged to a joined-batch design that was
// never implemented. batchMaxSegments maps onto concurrency to keep the one
// user intent that survives the redesign.
const migrateDocumentSettings = (saved) => {
  const migrated = {
    ...DEFAULT_SETTINGS.document,
    filters: { ...DEFAULT_SETTINGS.document.filters },
  };
  if (!saved || typeof saved !== 'object') return migrated;

  if (typeof saved.maxCharsPerSegment === 'number') {
    migrated.maxCharsPerSegment = saved.maxCharsPerSegment;
  }
  if (typeof saved.concurrency === 'number') {
    migrated.concurrency = saved.concurrency;
  } else if (typeof saved.batchMaxSegments === 'number') {
    migrated.concurrency = Math.min(Math.max(saved.batchMaxSegments, 1), 6);
  }
  if (typeof saved.displayStyle === 'string') {
    migrated.displayStyle = saved.displayStyle;
  }
  if (saved.filters && typeof saved.filters === 'object') {
    for (const key of Object.keys(migrated.filters)) {
      if (saved.filters[key] !== undefined) {
        migrated.filters[key] = saved.filters[key];
      }
    }
  }
  return migrated;
};

// Merges saved settings into the current default shape and rewrites any old
// flat-keyed fields (endpoint, providers, selectionXxx, glassXxx) into the
// current nested object layout.
export const migrateOldSettings = (savedSettings) => {
  if (!savedSettings) return null;

  // Deep-merge each known nested key so a partial saved object still gets all
  // newly-added defaults
  let migrated = {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    interface: {
      ...DEFAULT_SETTINGS.interface,
      ...(savedSettings.interface || {}),
    },
    startup: {
      ...DEFAULT_SETTINGS.startup,
      ...(savedSettings.startup || {}),
    },
    translation: {
      ...DEFAULT_SETTINGS.translation,
      ...(savedSettings.translation || {}),
    },
    document: migrateDocumentSettings(savedSettings.document),
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(savedSettings.privacy || {}),
    },
    floatingWindow: {
      ...DEFAULT_SETTINGS.floatingWindow,
      ...(savedSettings.floatingWindow || {}),
    },
    selection: {
      ...DEFAULT_SETTINGS.selection,
      ...(savedSettings.selection || {}),
    },
    ocr: {
      ...DEFAULT_SETTINGS.ocr,
      ...(savedSettings.ocr || {}),
    },
    aiActions: {
      ...DEFAULT_SETTINGS.aiActions,
      ...(savedSettings.aiActions || {}),
    },
    tts: {
      ...DEFAULT_SETTINGS.tts,
      ...(savedSettings.tts || {}),
    },
    screenshot: {
      ...DEFAULT_SETTINGS.screenshot,
      ...(savedSettings.screenshot || {}),
    },
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...(savedSettings.shortcuts || {}),
    },
  };

  // The old settings.connection bucket only ever fed the LLM-Vision OCR
  // endpoint (its timeout/model were dead). Carry that one live value into
  // ocr.llmEndpoint, preferring an explicit ocr.llmEndpoint if already set.
  const legacyEndpoint = savedSettings.connection?.endpoint || savedSettings.endpoint;
  if (legacyEndpoint && !savedSettings.ocr?.llmEndpoint) {
    migrated.ocr = { ...migrated.ocr, llmEndpoint: legacyEndpoint };
  }
  delete migrated.connection;

  // settings.providers (old) -> settings.translation.providers
  if (savedSettings.providers?.list && !savedSettings.translation?.providers) {
    migrated.translation = {
      ...migrated.translation,
      providers: savedSettings.providers.list,
      providerConfigs: savedSettings.providers.configs,
    };
  }
  // Drop the bucket unconditionally — old installs also carry an empty {}
  // seeded by a former electron-store default, kept alive by the spread above.
  delete migrated.providers;

  // floatingWindow.lockTargetLang (retired 2026-07-10): ON meant "never flip
  // zh<->en", which the unified behavior expresses as 'original'. OFF users
  // get the new default ('original') rather than 'swap' — the flip is now
  // opt-in via settings.translation.sameLanguageBehavior.
  if (savedSettings.floatingWindow?.lockTargetLang === true
      && !savedSettings.translation?.sameLanguageBehavior) {
    migrated.translation.sameLanguageBehavior = 'original';
  }
  delete migrated.floatingWindow.lockTargetLang;

  // Pre-v0.2 flat selectionXxx -> selection nested object (only `enabled`
  // survived; the other flat keys were dead and are no longer seeded).
  if (!savedSettings.selection || typeof savedSettings.selection !== 'object') {
    migrated.selection = {
      ...DEFAULT_SETTINGS.selection,
      enabled: savedSettings.selectionEnabled || false,
    };
  }

  // Legacy `settings.glass` bucket -> `floatingWindow`. Only `opacity` maps to a
  // live key; the rest (width/height/fontSize/...) were dead for several
  // versions. The old bucket is dropped so it never gets re-persisted.
  if (savedSettings.glass && typeof savedSettings.glass === 'object') {
    if (savedSettings.floatingWindow?.defaultOpacity === undefined &&
        typeof savedSettings.glass.opacity === 'number') {
      migrated.floatingWindow.defaultOpacity = savedSettings.glass.opacity;
    }
    delete migrated.glass;
  }

  // 'paddle-ocr' engine id was removed from the registry; without this remap
  // an old persisted value would leave OCR permanently failing (no fallback
  // chain covers an unknown preferred engine).
  if (migrated.ocr?.engine === 'paddle-ocr') {
    migrated.ocr.engine = 'rapid-ocr';
  }

  // Dead keys from the pre-0.2.9 privacy plumbing; privacy.mode would
  // otherwise round-trip through the settings.privacy save forever.
  delete migrated.privacyMode;
  if (migrated.privacy) delete migrated.privacy.mode;

  return migrated;
};

export { PRIVACY_MODES, getModeFeatures, isFeatureEnabled, isProviderAllowedByMode as isProviderAllowed, PRIVACY_MODE_IDS };
