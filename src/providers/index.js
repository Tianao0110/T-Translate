// src/providers/index.js
// 翻译源模块主入口

export { BaseProvider, LANGUAGE_CODES, getLanguageName } from './base.js';
export { default as providerManager, ProviderManager } from './manager.js';
export { 
  getAllProviders,
  getProviderClass,
  getProviderMetadata,
  getAllProviderMetadata,
  createProvider,
  registerProvider,
  hasProvider,
  DEFAULT_PRIORITY,
} from './registry.js';

// 导出各翻译源类（可选，用于直接实例化）
export { default as LocalLLMProvider } from './local-llm/index.js';
export { default as OpenAIProvider } from './openai/index.js';
export { default as DeepLProvider } from './deepl/index.js';
