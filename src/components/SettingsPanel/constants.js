// Shared constants for SettingsPanel: defaults, nav, settings shape, migrations.

import {
  Globe, Shield, Zap, Moon, Sun,
  Info, Wifi, Eye, Lock, Volume2,
  Code2, Palette, Layers, MousePointer, Server,
  FileText
} from 'lucide-react';

import { PRIVACY_MODES, getModeFeatures, isFeatureEnabled, isProviderAllowed as isProviderAllowedByMode, PRIVACY_MODE_IDS } from '@config/privacy-modes';
import { getLanguageOptions } from '@config/defaults';

export const defaultConfig = {
  llm: { endpoint: 'http://localhost:1234/v1', timeout: 60000 },
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh', batch: { maxLength: 5000 } },
  ocr: { defaultEngine: 'llm-vision', windowsLanguage: 'zh-Hans' },
  ui: { theme: 'light', fontSize: 14 },
  logging: { level: 'info' },
  shortcuts: {
    translate: 'Ctrl+Enter',
    swapLanguages: 'Ctrl+L',
    clear: 'Ctrl+Shift+C',
    paste: 'Ctrl+V',
    copy: 'Ctrl+C',
    screenshot: 'Alt+Q',
    toggleWindow: 'Ctrl+Shift+W',
    glassWindow: 'Ctrl+Alt+G',
    selectionTranslate: 'Ctrl+Shift+T',
  },
  dev: { debugMode: false },
  storage: { cache: { maxSize: 100 }, history: { maxItems: 1000 } }
};

export const SHORTCUT_LABELS = {
  translate: '执行翻译',
  swapLanguages: '切换语言',
  clear: '清空内容',
  paste: '粘贴文本',
  copy: '复制结果',
  screenshot: '📷 截图翻译',
  toggleWindow: '🪟 显示/隐藏窗口',
  glassWindow: '🔮 玻璃窗口',
  selectionTranslate: '✏️ 划词翻译开关',
};

export const GLOBAL_SHORTCUT_KEYS = ['screenshot', 'toggleWindow', 'glassWindow', 'selectionTranslate'];

// `basic: true` flags items shown in the simplified settings view.
// `keywords` powers the in-settings search.
export const NAV_ITEMS = [
  { id: 'providers', icon: Server, group: 'translation', basic: true, keywords: ['provider', 'openai', 'deepl', 'gemini', 'deepseek', 'local', 'api', '翻译源', '本地'] },
  { id: 'translation', icon: Globe, group: 'translation', basic: true, keywords: ['language', 'source', 'target', 'auto', 'stream', '翻译', '语言', '流式'] },
  { id: 'selection', icon: MousePointer, group: 'translation', keywords: ['selection', 'mouse', 'trigger', 'button', '划词', '选中', '鼠标'] },
  { id: 'glassWindow', icon: Layers, group: 'translation', keywords: ['glass', 'floating', 'overlay', 'pin', '玻璃', '透明', '置顶'] },
  { id: 'document', icon: FileText, group: 'translation', keywords: ['document', 'pdf', 'docx', 'epub', 'srt', 'subtitle', '文档', '字幕'] },
  { id: 'ocr', icon: Eye, group: 'system', keywords: ['ocr', 'recognize', 'screenshot', 'image', 'rapidocr', 'llm', '识别', '截图'] },
  { id: 'tts', icon: Volume2, group: 'system', keywords: ['tts', 'speech', 'voice', 'volume', 'rate', '朗读', '语音', '语速'] },
  { id: 'interface', icon: Palette, group: 'system', basic: true, keywords: ['theme', 'dark', 'light', 'font', 'appearance', '界面', '主题', '外观'] },
  { id: 'privacy', icon: Shield, group: 'system', keywords: ['privacy', 'security', 'mode', 'history', '隐私', '安全', '记录'] },
  { id: 'about', icon: Info, group: 'system', basic: true, keywords: ['about', 'version', 'info', '关于', '版本'] },
];

export const DEFAULT_SETTINGS = {
  connection: {
    endpoint: defaultConfig.llm.endpoint,
    timeout: defaultConfig.llm.timeout,
    model: '',
  },

  translation: {
    defaultSourceLang: defaultConfig.translation.sourceLanguage,
    defaultTargetLang: defaultConfig.translation.targetLanguage,
    providers: [],
    providerConfigs: {},
    subtitleProvider: null,
  },

  // Flat top-level aliases preserved for backward compat with older code paths
  sourceLanguage: defaultConfig.translation.sourceLanguage,
  targetLanguage: defaultConfig.translation.targetLanguage,
  autoTranslate: false,
  streamOutput: true,
  contextMemory: false,
  termCorrection: true,

  document: {
    preserveFormatting: true,
    translateHeaders: true,
    translateFooters: false,
    translateCaptions: true,
    maxParagraphLength: 1000,
    batchSize: 5,
    retryOnError: true,
    outputFormat: 'same',
    showProgress: true,
  },

  glass: {
    width: 400,
    height: 300,
    opacity: 0.95,
    alwaysOnTop: true,
    autoTranslate: true,
    fontSize: 14,
    showSourceText: false,
  },

  selection: {
    enabled: false,
    showButton: true,
    autoTranslate: false,
    buttonPosition: 'cursor',
    buttonDelay: 0,
    minDistance: 10,
    minDuration: 150,
    maxDuration: 5000,
    triggerTimeout: 4000,
    showSourceByDefault: false,
    autoCloseOnCopy: false,
    minChars: 2,
    maxChars: 500,
    windowOpacity: 95,
    // CapsLock-direct mode: bypass trigger UI when CapsLock is on
    stickyViaCapsLock: false,
    stickyWarningShown: false,
  },

  theme: defaultConfig.ui.theme,
  fontSize: defaultConfig.ui.fontSize,

  shortcuts: { ...defaultConfig.shortcuts },

  privacyMode: PRIVACY_MODE_IDS.STANDARD,

  saveHistory: true,
  maxHistory: defaultConfig.storage.history.maxItems,
  cacheEnabled: true,
  maxCache: defaultConfig.storage.cache.maxSize,

  ocr: {
    engine: defaultConfig.ocr.defaultEngine,
    language: defaultConfig.ocr.windowsLanguage,
    preprocess: true,
    autoDetect: true,
    confidence: 0.6,
  },

  tts: {
    enabled: true,
    engine: 'web-speech',
    rate: 1.0,
    pitch: 1.0,
    volume: 0.8,
    voiceId: '',
  },

  screenshot: {
    outputMode: 'bubble', // 'bubble' | 'main'
  },

  debugMode: defaultConfig.dev.debugMode,
};

export const LANGUAGE_OPTIONS = getLanguageOptions(true);

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
    connection: {
      ...DEFAULT_SETTINGS.connection,
      ...(savedSettings.connection || {}),
    },
    translation: {
      ...DEFAULT_SETTINGS.translation,
      ...(savedSettings.translation || {}),
    },
    document: {
      ...DEFAULT_SETTINGS.document,
      ...(savedSettings.document || {}),
    },
    glass: {
      ...DEFAULT_SETTINGS.glass,
      ...(savedSettings.glass || {}),
    },
    selection: {
      ...DEFAULT_SETTINGS.selection,
      ...(savedSettings.selection || {}),
    },
    ocr: {
      ...DEFAULT_SETTINGS.ocr,
      ...(savedSettings.ocr || {}),
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

  // Pre-v0.2 flat endpoint -> connection object
  if (savedSettings.endpoint && !savedSettings.connection) {
    migrated.connection = {
      endpoint: savedSettings.endpoint,
      timeout: savedSettings.timeout || DEFAULT_SETTINGS.connection.timeout,
      model: savedSettings.model || '',
    };
  }

  // settings.providers (old) -> settings.translation.providers
  if (savedSettings.providers?.list && !savedSettings.translation?.providers) {
    migrated.translation = {
      ...migrated.translation,
      providers: savedSettings.providers.list,
      providerConfigs: savedSettings.providers.configs,
      subtitleProvider: savedSettings.providers.subtitleProvider,
    };
    delete migrated.providers;
  }

  // Pre-v0.2 flat selectionXxx -> selection nested object
  if (!savedSettings.selection || typeof savedSettings.selection !== 'object') {
    migrated.selection = {
      ...DEFAULT_SETTINGS.selection,
      enabled: savedSettings.selectionEnabled || false,
      showButton: savedSettings.selectionShowButton ?? true,
      autoTranslate: savedSettings.selectionAutoTranslate || false,
      buttonPosition: savedSettings.selectionButtonPosition || 'cursor',
      buttonDelay: savedSettings.selectionButtonDelay || 0,
      minDistance: savedSettings.selectionMinDistance || 10,
      minDuration: savedSettings.selectionMinDuration || 150,
      maxDuration: savedSettings.selectionMaxDuration || 5000,
    };
  }

  // Pre-v0.2 flat glassXxx -> glass nested object
  if (!savedSettings.glass || typeof savedSettings.glass !== 'object') {
    migrated.glass = {
      ...DEFAULT_SETTINGS.glass,
      width: savedSettings.glassWidth || 400,
      height: savedSettings.glassHeight || 300,
      opacity: savedSettings.glassOpacity || 0.95,
      alwaysOnTop: savedSettings.glassAlwaysOnTop ?? true,
      autoTranslate: savedSettings.glassAutoTranslate ?? true,
      fontSize: savedSettings.glassFontSize || 14,
      showSourceText: savedSettings.glassShowSourceText || false,
    };
  }

  return migrated;
};

export { PRIVACY_MODES, getModeFeatures, isFeatureEnabled, isProviderAllowedByMode as isProviderAllowed, PRIVACY_MODE_IDS };
