// src/config/defaults.js
// ============================================================
// 配置中心化 - 桥接层 (前端入口)
// ============================================================

import {
  PRIVACY_MODES,
  THEMES,
  PRESET_ACCENT_COLORS,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
  // 语言相关
  LANGUAGES,
  getLanguageOptions,
  getLanguageList,
  getLanguageByCode,
} from './constants.js';

// ==================== 重新导出常量 ====================

export {
  PRIVACY_MODES,
  THEMES,
  PRESET_ACCENT_COLORS,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
  // 语言相关
  LANGUAGES,
  getLanguageOptions,
  getLanguageList,
  getLanguageByCode,
};

// ==================== 便捷访问对象 ====================

export const translationDefaults = {
  targetLanguage: DEFAULTS.TARGET_LANGUAGE,
  sourceLanguage: DEFAULTS.SOURCE_LANGUAGE,
  template: DEFAULTS.DEFAULT_TEMPLATE,
};

export const uiDefaults = {
  theme: DEFAULTS.THEME,
  fontSize: DEFAULTS.FONT_SIZE,
  window: {
    width: DEFAULTS.WINDOW_WIDTH,
    height: DEFAULTS.WINDOW_HEIGHT,
    minWidth: DEFAULTS.WINDOW_MIN_WIDTH,
    minHeight: DEFAULTS.WINDOW_MIN_HEIGHT,
  },
};

export const selectionDefaults = {
  triggerTimeout: DEFAULTS.SELECTION_TRIGGER_TIMEOUT,
  minChars: DEFAULTS.SELECTION_MIN_CHARS,
  maxChars: DEFAULTS.SELECTION_MAX_CHARS,
  minDistance: DEFAULTS.SELECTION_MIN_DISTANCE,
  minDuration: DEFAULTS.SELECTION_MIN_DURATION,
  maxDuration: DEFAULTS.SELECTION_MAX_DURATION,
};

export const llmDefaults = {
  endpoint: DEFAULTS.LLM_ENDPOINT,
  timeout: DEFAULTS.LLM_TIMEOUT,
  temperature: DEFAULTS.LLM_TEMPERATURE,
  maxTokens: DEFAULTS.LLM_MAX_TOKENS,
};

// ==================== TTS 默认配置 ====================

export const ttsDefaults = {
  enabled: true,
  engine: 'web-speech',
  rate: 1.0,
  pitch: 1.0,
  volume: 0.8,
  voiceId: '',  // 空表示自动选择
};

// ==================== 默认导出 ====================

export default {
  PRIVACY_MODES,
  THEMES,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
  LANGUAGES,
  getLanguageOptions,
  getLanguageList,
  getLanguageByCode,
};
