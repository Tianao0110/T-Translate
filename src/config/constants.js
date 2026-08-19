// Renderer-side mirror of electron/shared/constants.js.
// IMPORTANT: keep in sync with the source — `npm run check:constants` verifies.

export const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  SECURE: 'secure',
};

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  FRESH: 'fresh',
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
  PA: 'pa',
  PT: 'pt',
  IT: 'it',
  NL: 'nl',
  PL: 'pl',
  AR: 'ar',
  TH: 'th',
  VI: 'vi',
};

// The catalogue lives in config/languages.js so the stack can import the same
// table (service.js already imports config/filters.js). One table, no drift.
import { LANGUAGES } from './languages.js';
export { LANGUAGES };

// {value, label} shape — for native <select> usage in settings panel
export const getLanguageOptions = (includeAuto = true) => {
  return LANGUAGES
    .filter(lang => includeAuto || lang.code !== 'auto')
    .map(lang => ({
      value: lang.code,
      // Code as a compact label — flags were retired: most of the catalogue
      // has none, and a language is not a country.
      label: lang.code === 'auto' ? lang.name : `${lang.code.toUpperCase()} ${lang.name}`,
    }));
};

// {code, name} shape — uses nativeName for translation panel display
export const getLanguageList = (includeAuto = true) => {
  return LANGUAGES
    .filter(lang => includeAuto || lang.code !== 'auto')
    .map(lang => ({
      code: lang.code,
      name: lang.nativeName,
    }));
};

export const getLanguageByCode = (code) => {
  return LANGUAGES.find(lang => lang.code === code);
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
  OLLAMA: 'ollama',
  ANTHROPIC: 'anthropic',
  MICROSOFT_TRANSLATOR: 'microsoft-translator',
  BAIDU_TRANSLATE: 'baidu-translate',
};
