// src/providers/index.js
// 翻译源和 OCR 模块主入口

// ========== LLM 翻译引擎 ==========
export { BaseProvider, LANGUAGE_CODES, getLanguageName } from './base.js';
export { 
  getAllProviderIds,
  getProviderClass,
  getProviderMetadata,
  getAllProviderMetadata,
  getProvider,
  createProvider,
  isProviderConfigured,
  getMissingConfig,
  updateProviderConfig,
  getProviderConfig,
  initConfigs,
  exportConfigs,
  getAllProvidersStatus,
  registerProvider,
  hasProvider,
  clearInstances,
  DEFAULT_PRIORITY,
} from './registry.js';

// 导出各翻译源类
export { default as LocalLLMProvider } from './local-llm/index.js';
export { default as OpenAIProvider } from './openai/index.js';
export { default as DeepLProvider } from './deepl/index.js';
export { default as GeminiProvider } from './gemini/index.js';
export { default as DeepSeekProvider } from './deepseek/index.js';
export { default as GoogleTranslateProvider } from './google-translate/index.js';

// ========== OCR 引擎 ==========
export { BaseOCREngine } from './ocr/base.js';
export { 
  ocrManager,
  getAllOCREngines,
  getOCREngineClass,
  createOCREngine,
  DEFAULT_OCR_PRIORITY,
} from './ocr/index.js';
export { default as RapidOCREngine } from './ocr/rapid.js';
export { default as LLMVisionEngine } from './ocr/llm-vision.js';

