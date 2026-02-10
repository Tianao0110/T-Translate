// src/config/constants.js
// ============================================================
// 🔵 同步副本 - 前端常量 (ESM 版本)
// ============================================================
// 格式: ESM (渲染进程使用)
//
// ⚠️ 同步要求:
// - 此文件从 electron/shared/constants.js 同步
// - 修改常量请先修改源文件，然后同步到此处
// - 运行 npm run check:constants 验证同步状态
// ============================================================

// ==================== 隐私模式 ====================
export const PRIVACY_MODES = {
  STANDARD: 'standard',
  OFFLINE: 'offline',
  STRICT: 'strict',
  SECURE: 'secure',
};

// ==================== 主题 ====================
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  FRESH: 'fresh',  // 清新（青绿色）
};

// 预设主题色（用于自定义强调色）
export const PRESET_ACCENT_COLORS = [
  { id: 'blue', name: '蓝色', color: '#3b82f6' },
  { id: 'green', name: '绿色', color: '#10b981' },
  { id: 'purple', name: '紫色', color: '#8b5cf6' },
  { id: 'orange', name: '橙色', color: '#f97316' },
  { id: 'pink', name: '粉色', color: '#ec4899' },
  { id: 'cyan', name: '青色', color: '#06b6d4' },
  { id: 'red', name: '红色', color: '#ef4444' },
  { id: 'amber', name: '琥珀', color: '#f59e0b' },
];

// ==================== OCR 引擎 ====================
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

// ==================== 翻译模板 ====================
export const TEMPLATE_KEYS = {
  OCR: 'ocr',
  PRECISE: 'precise',
  NATURAL: 'natural',
  FORMAL: 'formal',
};

// ==================== 翻译状态 ====================
export const TRANSLATION_STATUS = {
  IDLE: 'idle',
  TRANSLATING: 'translating',
  SUCCESS: 'success',
  ERROR: 'error',
};

// ==================== 语言代码 ====================
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

// ==================== 语言列表（单一数据源）====================
// 所有组件从这里获取语言选项
export const LANGUAGES = [
  { code: 'auto', name: '自动检测', nativeName: 'Auto Detect', flag: '🌐' },
  { code: 'zh', name: '中文', nativeName: '中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁体中文', nativeName: '繁體中文', flag: '🇹🇼' },
  { code: 'en', name: '英语', nativeName: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日语', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '韩语', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'fr', name: '法语', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: '德语', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: '西班牙语', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'ru', name: '俄语', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'pa', name: '旁遮普语', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'pt', name: '葡萄牙语', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'it', name: '意大利语', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'ar', name: '阿拉伯语', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'th', name: '泰语', nativeName: 'ไทย', flag: '🇹🇭' },
  { code: 'vi', name: '越南语', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
];

// ==================== 语言选项转换函数 ====================

/**
 * 获取设置面板用的语言选项 (value/label 格式)
 * @param {boolean} includeAuto - 是否包含"自动检测"选项
 */
export const getLanguageOptions = (includeAuto = true) => {
  return LANGUAGES
    .filter(lang => includeAuto || lang.code !== 'auto')
    .map(lang => ({
      value: lang.code,
      label: `${lang.flag} ${lang.name}`,
    }));
};

/**
 * 获取翻译面板用的语言列表 (code/name/flag 格式)
 * @param {boolean} includeAuto - 是否包含"自动检测"选项
 */
export const getLanguageList = (includeAuto = true) => {
  return LANGUAGES
    .filter(lang => includeAuto || lang.code !== 'auto')
    .map(lang => ({
      code: lang.code,
      name: lang.nativeName,  // 使用原生语言名
      flag: lang.flag,
    }));
};

/**
 * 根据语言代码获取语言信息
 */
export const getLanguageByCode = (code) => {
  return LANGUAGES.find(lang => lang.code === code);
};

// ==================== 默认配置 ====================
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

// ==================== 翻译源 ID ====================
export const PROVIDER_IDS = {
  LOCAL_LLM: 'local-llm',
  OPENAI: 'openai',
  DEEPL: 'deepl',
  GEMINI: 'gemini',
  DEEPSEEK: 'deepseek',
  GOOGLE_TRANSLATE: 'google-translate',
};
