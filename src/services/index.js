// src/services/index.js
// 服务层统一入口
//
// 导出所有 Service 层模块

// 翻译服务（核心调度）
export { default as translationService, TranslationService } from './translation.js';

// 主窗口翻译服务（业务逻辑）
export { default as mainTranslation, MainTranslationService } from './main-translation.js';

// 翻译器（模板 + 缓存封装，供 Store 使用）
export { default as translator, Translator, SUPPORTED_LANGUAGES } from './translator.js';

// 缓存服务
export { default as translationCache, TranslationCache } from './cache.js';

// 流水线（玻璃窗用）
export { default as pipeline, TranslationPipeline } from './pipeline.js';
