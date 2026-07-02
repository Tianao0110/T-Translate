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
  AR: 'ar',
  TH: 'th',
  VI: 'vi',
};

// Single source of truth for language picker options across UI
export const LANGUAGES = [
  { code: 'auto', name: '自动检测', nativeName: 'Auto Detect', flag: '🌐' },
  { code: 'zh', name: '中文', nativeName: '中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁体中文', nativeName: '繁體中文', flag: '🇨🇳' },
  { code: 'en', name: '英语', nativeName: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日语', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '韩语', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'fr', name: '法语', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: '德语', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: '西班牙语', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'ru', name: '俄语', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'pa', name: '旁遮普语', nativeName: 'ਪੰਜਾਬੀ', flag: 'PA' },
  { code: 'pt', name: '葡萄牙语', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'it', name: '意大利语', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'ar', name: '阿拉伯语', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'th', name: '泰语', nativeName: 'ไทย', flag: '🇹🇭' },
  { code: 'vi', name: '越南语', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
];

// {value, label} shape — for native <select> usage in settings panel
export const getLanguageOptions = (includeAuto = true) => {
  return LANGUAGES
    .filter(lang => includeAuto || lang.code !== 'auto')
    .map(lang => ({
      value: lang.code,
      label: `${lang.flag} ${lang.name}`,
    }));
};

// {code, name, flag} shape — uses nativeName for translation panel display
export const getLanguageList = (includeAuto = true) => {
  return LANGUAGES
    .filter(lang => includeAuto || lang.code !== 'auto')
    .map(lang => ({
      code: lang.code,
      name: lang.nativeName,
      flag: lang.flag,
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
