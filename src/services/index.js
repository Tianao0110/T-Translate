// src/services/index.js
// 服务层统一入口（重构版）
//
// 导出所有 Service 层模块
// 
// 重构说明：
// - translationService 现在是唯一的翻译入口（门面模式）
// - translator.js 已废弃，保留导出仅为兼容性
// - mainTranslation 负责主窗口 UI 状态管理
// - pipeline 负责玻璃窗口的 OCR → 翻译流程

// ========== 核心服务 ==========

// 翻译服务（门面入口 - 推荐使用）
export { default as translationService, TranslationService } from './translation.js';

// 主窗口翻译服务（UI 状态管理）
export { default as mainTranslation, MainTranslationService } from './main-translation.js';

// 缓存服务（L2 持久化）
export { default as translationCache, TranslationCache } from './cache.js';

// 流水线（玻璃窗口专用）
export { default as pipeline, TranslationPipeline } from './pipeline.js';

// ========== 废弃的导出（兼容性）==========

/**
 * @deprecated 请直接使用 translationService
 * translator.js 将在未来版本中移除
 */
export { default as translator, Translator, SUPPORTED_LANGUAGES } from './translator.js';

// ========== 快捷方法 ==========

/**
 * 快速翻译（便捷方法）
 * @param {string} text - 要翻译的文本
 * @param {object} options - 选项
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 * 
 * @example
 * import { translate } from '@/services';
 * const result = await translate('Hello', { targetLang: 'zh' });
 */
export async function translate(text, options = {}) {
  const { default: translationService } = await import('./translation.js');
  return translationService.translate(text, options);
}

/**
 * 流式翻译（便捷方法）
 * @param {string} text - 要翻译的文本
 * @param {object} options - 选项
 * @param {function} onChunk - 回调
 */
export async function translateStream(text, options = {}, onChunk) {
  const { default: translationService } = await import('./translation.js');
  return translationService.translateStream(text, options, onChunk);
}
