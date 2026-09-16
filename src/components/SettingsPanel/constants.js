// Shared constants for SettingsPanel: defaults, nav, settings shape, migrations.

import {
  Globe, Shield, Info, Eye, Palette, Layers, MousePointer, Server,
  FileText, Sparkles, AudioLines, Cpu
} from 'lucide-react';

import { PRIVACY_MODES, getModeFeatures, isFeatureEnabled, isProviderAllowed as isProviderAllowedByMode, PRIVACY_MODE_IDS } from '../../stack/privacy-modes.js';
import { DEFAULT_TTS_CONFIG } from '../../tts/index.js';

export const defaultConfig = {
  llm: { endpoint: 'http://localhost:1234/v1', timeout: 60000 },
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh', batch: { maxLength: 5000 } },
  ocr: { defaultEngine: 'llm-vision', windowsLanguage: 'zh-Hans' },
  ui: { theme: 'light', fontSize: 14 },
  logging: { level: 'info' },
  // Only the global (OS-level) shortcuts are configurable.
  shortcuts: {
    screenshot: 'Alt+Q',
    toggleWindow: 'Ctrl+Shift+W',
    floatingWindow: 'Ctrl+Alt+G',
    selectionTranslate: 'Ctrl+Shift+T',
    floatingCapture: 'Ctrl+Alt+Space',
  },
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
  { id: 'llm', icon: Cpu, group: 'system', keywords: ['llm', 'model', 'built-in', 'local', 'gguf', 'qwen', 'tengine', '内置', '模型', '本地', '大模型'] },
  { id: 'ocr', icon: Eye, group: 'system', keywords: ['ocr', 'recognize', 'screenshot', 'image', 'rapidocr', 'llm', '识别', '截图'] },
  // Listen (recognition models) and speech (read-aloud) live under one entry;
  // the keyword halves still route a search to the right sub-page (index.jsx).
  { id: 'audio', icon: AudioLines, group: 'system', keywords: ['audio', 'tts', 'speech', 'voice', 'volume', 'rate', '朗读', '语音', '语速', '音色', 'listen', 'asr', 'subtitle', 'caption', 'model', 'sensevoice', '听译', '字幕', '识别', '模型', '语音识别', '音频'] },
  { id: 'interface', icon: Palette, group: 'system', basic: true, keywords: ['theme', 'dark', 'light', 'font', 'appearance', '界面', '主题', '外观'] },
  { id: 'privacy', icon: Shield, group: 'system', keywords: ['privacy', 'security', 'mode', 'history', '隐私', '安全', '记录'] },
  { id: 'about', icon: Info, group: 'system', basic: true, keywords: ['about', 'version', 'info', '关于', '版本'] },
];

export const DEFAULT_SETTINGS = {
  // Theme / language; owned here so the shape is always present.
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

  // Document translator. Single source of truth: keys here must match what
  // DocumentTranslator reads at parse / translate time.
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

  // No history / cache keys here: the history cap lives in
  // translation-store.historyLimit, the cache cap in the main-process stack.
  privacy: {
    autoDeleteDays: 0,
  },

  // Built-in model (T-Engine). `pack` is the whitelisted pack id the
  // translation source runs; the developer switches open the model folder
  // to files outside the whitelist and let their trial log carry text.
  llm: {
    pack: 'qwen3-1.7b',
    allowUnlistedModels: false,
    trialLogText: false,
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
    // OpenAI-compatible endpoint for the LLM-Vision OCR engine.
    llmEndpoint: defaultConfig.llm.endpoint,
    // Optional explicit vision model. Blank = server's currently-loaded model.
    llmModel: '',
  },

  // User-imported AI action configs (config/ai-actions.js defines the shape).
  // Data, not code: the app ships a framework plus two neutral built-ins, and
  // anything beyond that is a file the user chose to import.
  aiActions: {
    imported: [],
    // When "Summarize" is offered. One number: the Latin-word bar derives
    // from it (config/ai-actions.js).
    longFormChars: 150,
  },

  // Single source of truth for TTS defaults is tts/index.js
  // (electron/state.js keeps a value-identical copy — main process can't
  // import renderer ESM).
  tts: { ...DEFAULT_TTS_CONFIG },

  screenshot: {
    outputMode: 'bubble', // 'bubble' | 'main'
  },
};

// Pre-0.2.9 settings.document keys: batchMaxSegments maps onto concurrency,
// the rest are dropped.
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
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...(savedSettings.llm || {}),
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

  // Old settings.connection.endpoint -> ocr.llmEndpoint (explicit value wins).
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
  // Drop the bucket unconditionally (old installs carry an empty one).
  delete migrated.providers;

  // Retired floatingWindow.lockTargetLang -> sameLanguageBehavior 'original'.
  if (savedSettings.floatingWindow?.lockTargetLang === true
      && !savedSettings.translation?.sameLanguageBehavior) {
    migrated.translation.sameLanguageBehavior = 'original';
  }
  delete migrated.floatingWindow.lockTargetLang;

  // Pre-v0.2 flat selectionXxx -> selection nested object (only `enabled`).
  if (!savedSettings.selection || typeof savedSettings.selection !== 'object') {
    migrated.selection = {
      ...DEFAULT_SETTINGS.selection,
      enabled: savedSettings.selectionEnabled || false,
    };
  }

  // Legacy `settings.glass` bucket -> `floatingWindow` (only `opacity`).
  if (savedSettings.glass && typeof savedSettings.glass === 'object') {
    if (savedSettings.floatingWindow?.defaultOpacity === undefined &&
        typeof savedSettings.glass.opacity === 'number') {
      migrated.floatingWindow.defaultOpacity = savedSettings.glass.opacity;
    }
    delete migrated.glass;
  }

  // Retired 'paddle-ocr' engine id -> 'rapid-ocr'.
  if (migrated.ocr?.engine === 'paddle-ocr') {
    migrated.ocr.engine = 'rapid-ocr';
  }

  // Dead keys from the pre-0.2.9 privacy plumbing.
  delete migrated.privacyMode;
  if (migrated.privacy) delete migrated.privacy.mode;

  return migrated;
};

export { PRIVACY_MODES, getModeFeatures, isFeatureEnabled, isProviderAllowedByMode as isProviderAllowed, PRIVACY_MODE_IDS };
