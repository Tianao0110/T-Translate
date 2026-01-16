// src/config/constants.js
// 前端常量 (ESM) - 与 electron/shared/constants.js 保持同步

export const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  STRICT: 'strict',
  SECURE: 'secure',
};

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto',
};

export const OCR_ENGINES = {
  LLM_VISION: 'llm-vision',
  RAPID_OCR: 'rapid-ocr',
  PADDLE_OCR: 'paddle-ocr',
  WINDOWS_OCR: 'windows-ocr',
  OCRSPACE: 'ocrspace',
  GOOGLE_VISION: 'google-vision',
  AZURE_OCR: 'azure-ocr',
  BAIDU_OCR: 'baidu-ocr',
};

export const TEMPLATE_KEYS = {
  OCR: 'ocr',
  PRECISE: 'precise',
  NATURAL: 'natural',
  FORMAL: 'formal',
};

export const TRANSLATION_STATUS = {
  IDLE: 'idle',
  TRANSLATING: 'translating',
  SUCCESS: 'success',
  ERROR: 'error',
};

export const LANGUAGE_CODES = {
  AUTO: 'auto',
  ZH: 'zh',
  ZH_TW: 'zh-TW',
  EN: 'en',
  JA: 'ja',
  KO: 'ko',
  FR: 'fr',
  DE: 'de',
  ES: 'es',
  RU: 'ru',
};

export const DEFAULTS = {
  LLM_ENDPOINT: 'http://localhost:1234/v1',
  LLM_TIMEOUT: 60000,
  LLM_TEMPERATURE: 0.7,
  LLM_MAX_TOKENS: 2000,
  TARGET_LANGUAGE: 'zh',
  SOURCE_LANGUAGE: 'auto',
  DEFAULT_TEMPLATE: TEMPLATE_KEYS.NATURAL,
  SHORTCUT_CAPTURE: 'CommandOrControl+Shift+T',
  SHORTCUT_QUICK_TRANSLATE: 'CommandOrControl+Q',
  SHORTCUT_TOGGLE_WINDOW: 'CommandOrControl+Shift+W',
  SHORTCUT_SETTINGS: 'CommandOrControl+,',
  THEME: THEMES.LIGHT,
  FONT_SIZE: 14,
  WINDOW_WIDTH: 1200,
  WINDOW_HEIGHT: 800,
  WINDOW_MIN_WIDTH: 800,
  WINDOW_MIN_HEIGHT: 600,
  SELECTION_TRIGGER_TIMEOUT: 4000,
  SELECTION_MIN_CHARS: 2,
  SELECTION_MAX_CHARS: 500,
  SELECTION_MIN_DISTANCE: 10,
  SELECTION_MIN_DURATION: 150,
  SELECTION_MAX_DURATION: 5000,
  HISTORY_MAX_ITEMS: 1000,
  CACHE_MAX_SIZE: 100,
  CACHE_TTL: 7 * 24 * 60 * 60 * 1000,
};

export const PROVIDER_IDS = {
  LOCAL_LLM: 'local-llm',
  OPENAI: 'openai',
  DEEPL: 'deepl',
  GEMINI: 'gemini',
  DEEPSEEK: 'deepseek',
  GOOGLE_TRANSLATE: 'google-translate',
};
