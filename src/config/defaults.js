// src/config/defaults.js
// 配置中心化 - 桥接层 (前端入口)

import {
  PRIVACY_MODES,
  THEMES,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
} from './constants.js';

// 重新导出
export {
  PRIVACY_MODES,
  THEMES,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
};

// 便捷对象
export const translationDefaults = {
  targetLanguage: DEFAULTS.TARGET_LANGUAGE,
  sourceLanguage: DEFAULTS.SOURCE_LANGUAGE,
  template: DEFAULTS.DEFAULT_TEMPLATE,
};

export const selectionDefaults = {
  triggerTimeout: DEFAULTS.SELECTION_TRIGGER_TIMEOUT,
  minChars: DEFAULTS.SELECTION_MIN_CHARS,
  maxChars: DEFAULTS.SELECTION_MAX_CHARS,
};

export default {
  PRIVACY_MODES,
  THEMES,
  OCR_ENGINES,
  TEMPLATE_KEYS,
  TRANSLATION_STATUS,
  LANGUAGE_CODES,
  DEFAULTS,
  PROVIDER_IDS,
};
