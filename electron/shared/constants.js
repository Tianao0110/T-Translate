// electron/shared/constants.js
// ============================================================
// 🔴 单一数据源 - 配置常量定义
// ============================================================
// 格式: CommonJS (主进程使用)
// 
// ⚠️ 同步要求:
// - 修改此文件后，必须同步更新 src/config/constants.js (ESM 版本)
// - 运行 npm run check:constants 验证同步状态
// ============================================================

const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  STRICT: 'strict',
  SECURE: 'secure',
};

const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto',
};

const OCR_ENGINES = {
  LLM_VISION: 'llm-vision',
  RAPID_OCR: 'rapid-ocr',
  PADDLE_OCR: 'paddle-ocr',
  WINDOWS_OCR: 'windows-ocr',
  OCRSPACE: 'ocrspace',
  GOOGLE_VISION: 'google-vision',
  AZURE_OCR: 'azure-ocr',
  BAIDU_OCR: 'baidu-ocr',
};

const TEMPLATE_KEYS = {
  OCR: 'ocr',
  PRECISE: 'precise',
  NATURAL: 'natural',
  FORMAL: 'formal',
};

const TRANSLATION_STATUS = {
  IDLE: 'idle',
  TRANSLATING: 'translating',
  SUCCESS: 'success',
  ERROR: 'error',
};

// 语言代码（与前端 src/config/constants.js 保持同步）
const LANGUAGE_CODES = {
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
  PA: 'pa',   // Punjabi
  PT: 'pt',   // Portuguese
  IT: 'it',   // Italian
  AR: 'ar',   // Arabic
  TH: 'th',   // Thai
  VI: 'vi',   // Vietnamese
};

const DEFAULTS = {
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

const PROVIDER_IDS = {
  LOCAL_LLM: 'local-llm',
  OPENAI: 'openai',
  DEEPL: 'deepl',
  GEMINI: 'gemini',
  DEEPSEEK: 'deepseek',
  GOOGLE_TRANSLATE: 'google-translate',
};

module.exports = {
  PRIVACY_MODES,
  THEMES,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
};
