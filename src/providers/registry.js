// src/providers/registry.js
// 翻译源注册表 - 管理所有可用的翻译源插件

import LocalLLMProvider from './local-llm';
import OpenAIProvider from './openai';
import DeepLProvider from './deepl';

/**
 * 所有已注册的翻译源
 * key: 插件 ID
 * value: 插件类
 */
const providers = {
  'local-llm': LocalLLMProvider,
  'openai': OpenAIProvider,
  'deepl': DeepLProvider,
};

/**
 * 默认优先级顺序
 * 字幕模式下会优先使用延迟低的在线服务
 */
export const DEFAULT_PRIORITY = {
  normal: ['local-llm', 'openai', 'deepl'],
  subtitle: ['openai', 'deepl', 'local-llm'],
};

/**
 * 获取所有已注册的翻译源
 * @returns {Object} { id: ProviderClass }
 */
export function getAllProviders() {
  return { ...providers };
}

/**
 * 获取翻译源类
 * @param {string} id - 翻译源 ID
 * @returns {class|null}
 */
export function getProviderClass(id) {
  return providers[id] || null;
}

/**
 * 获取翻译源元信息
 * @param {string} id - 翻译源 ID
 * @returns {object|null}
 */
export function getProviderMetadata(id) {
  const ProviderClass = providers[id];
  return ProviderClass?.metadata || null;
}

/**
 * 获取所有翻译源的元信息列表
 * @returns {Array<{id: string, ...metadata}>}
 */
export function getAllProviderMetadata() {
  return Object.entries(providers).map(([id, ProviderClass]) => ({
    id,
    ...ProviderClass.metadata,
  }));
}

/**
 * 创建翻译源实例
 * @param {string} id - 翻译源 ID
 * @param {object} config - 配置
 * @returns {BaseProvider|null}
 */
export function createProvider(id, config = {}) {
  const ProviderClass = providers[id];
  if (!ProviderClass) {
    console.error(`[Registry] Unknown provider: ${id}`);
    return null;
  }
  return new ProviderClass(config);
}

/**
 * 注册新的翻译源（用于动态加载）
 * @param {string} id - 翻译源 ID
 * @param {class} ProviderClass - 翻译源类
 */
export function registerProvider(id, ProviderClass) {
  if (providers[id]) {
    console.warn(`[Registry] Provider ${id} already exists, overwriting...`);
  }
  providers[id] = ProviderClass;
}

/**
 * 检查翻译源是否存在
 * @param {string} id - 翻译源 ID
 * @returns {boolean}
 */
export function hasProvider(id) {
  return !!providers[id];
}

export default {
  getAllProviders,
  getProviderClass,
  getProviderMetadata,
  getAllProviderMetadata,
  createProvider,
  registerProvider,
  hasProvider,
  DEFAULT_PRIORITY,
};
