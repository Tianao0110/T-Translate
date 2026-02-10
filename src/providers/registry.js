// src/providers/registry.js
// 翻译源注册表 - 管理所有翻译源的注册、实例化、配置
//
// 职责（纯工具）：
// - 维护 Provider 类注册表
// - 创建/缓存 Provider 实例
// - 管理 Provider 配置
// - 提供元信息查询
//
// 不负责（属于 Service 层）：
// - Fallback 逻辑
// - 优先级选择
// - 翻译调度

import LocalLLMProvider from './local-llm';
import OpenAIProvider from './openai';
import DeepLProvider from './deepl';
import GeminiProvider from './gemini';
import DeepSeekProvider from './deepseek';
import GoogleTranslateProvider from './google-translate';
import createLogger from '../utils/logger.js';

// 日志实例
const logger = createLogger('Registry');

// ========== 注册表 ==========

/**
 * 所有已注册的翻译源类
 */
const providerClasses = {
  'local-llm': LocalLLMProvider,
  'openai': OpenAIProvider,
  'deepl': DeepLProvider,
  'gemini': GeminiProvider,
  'deepseek': DeepSeekProvider,
  'google-translate': GoogleTranslateProvider,
};

/**
 * 默认优先级顺序（供 Service 层参考）
 */
export const DEFAULT_PRIORITY = {
  normal: ['local-llm', 'openai', 'gemini', 'deepseek', 'google-translate', 'deepl'],
};

// ========== 实例缓存 ==========

/**
 * Provider 实例缓存
 * @type {Map<string, BaseProvider>}
 */
const instances = new Map();

/**
 * Provider 配置缓存
 * @type {Map<string, object>}
 */
const configs = new Map();

// ========== 查询方法 ==========

/**
 * 获取所有已注册的 Provider ID
 * @returns {string[]}
 */
export function getAllProviderIds() {
  return Object.keys(providerClasses);
}

/**
 * 获取 Provider 类
 * @param {string} id - Provider ID
 * @returns {class|null}
 */
export function getProviderClass(id) {
  return providerClasses[id] || null;
}

/**
 * 检查 Provider 是否存在
 * @param {string} id - Provider ID
 * @returns {boolean}
 */
export function hasProvider(id) {
  return !!providerClasses[id];
}

/**
 * 获取单个 Provider 的元信息
 * @param {string} id - Provider ID
 * @returns {object|null}
 */
export function getProviderMetadata(id) {
  const ProviderClass = providerClasses[id];
  if (!ProviderClass?.metadata) return null;
  return { id, ...ProviderClass.metadata };
}

/**
 * 获取所有 Provider 的元信息列表
 * @returns {Array<object>}
 */
export function getAllProviderMetadata() {
  return Object.entries(providerClasses).map(([id, ProviderClass]) => ({
    id,
    ...ProviderClass.metadata,
  }));
}

// ========== 实例管理 ==========

/**
 * 获取或创建 Provider 实例
 * @param {string} id - Provider ID
 * @param {object} config - 可选配置（如果提供会更新配置）
 * @returns {BaseProvider|null}
 */
export function getProvider(id, config = null) {
  // 如果提供了新配置，先更新
  if (config !== null) {
    updateProviderConfig(id, config);
  }
  
  // 尝试返回缓存的实例
  if (instances.has(id)) {
    return instances.get(id);
  }
  
  // 创建新实例
  const ProviderClass = providerClasses[id];
  if (!ProviderClass) {
    logger.error(`Unknown provider: ${id}`);
    return null;
  }
  
  const savedConfig = configs.get(id) || {};
  const instance = new ProviderClass(savedConfig);
  instances.set(id, instance);
  
  logger.debug(`Created instance: ${id}`);
  return instance;
}

/**
 * 创建新的 Provider 实例（不缓存）
 * 用于临时测试等场景
 * @param {string} id - Provider ID
 * @param {object} config - 配置
 * @returns {BaseProvider|null}
 */
export function createProvider(id, config = {}) {
  const ProviderClass = providerClasses[id];
  if (!ProviderClass) {
    logger.error(`Unknown provider: ${id}`);
    return null;
  }
  return new ProviderClass(config);
}

/**
 * 检查 Provider 是否已配置（可用）
 * @param {string} id - Provider ID
 * @returns {boolean}
 */
export function isProviderConfigured(id) {
  const instance = getProvider(id);
  return instance?.isConfigured() ?? false;
}

/**
 * 获取 Provider 缺失的配置项
 * @param {string} id - Provider ID
 * @returns {string[]}
 */
export function getMissingConfig(id) {
  const instance = getProvider(id);
  return instance?.getMissingConfig() ?? [];
}

// ========== 配置管理 ==========

/**
 * 更新 Provider 配置
 * @param {string} id - Provider ID
 * @param {object} config - 新配置（会合并）
 */
export function updateProviderConfig(id, config) {
  const existingConfig = configs.get(id) || {};
  const newConfig = { ...existingConfig, ...config };
  configs.set(id, newConfig);
  
  // 如果实例已存在，更新它
  if (instances.has(id)) {
    instances.get(id).updateConfig(newConfig);
  }
  
  logger.debug(`Updated config for ${id}`);
}

/**
 * 获取 Provider 配置
 * @param {string} id - Provider ID
 * @returns {object}
 */
export function getProviderConfig(id) {
  return configs.get(id) || {};
}

/**
 * 批量初始化配置
 * @param {object} allConfigs - { providerId: config }
 * @param {boolean} clearExisting - 是否清除现有实例（默认 true）
 */
export function initConfigs(allConfigs, clearExisting = true) {
  // 清除现有实例，强制下次重新创建
  if (clearExisting) {
    instances.clear();
  }
  
  for (const [id, config] of Object.entries(allConfigs)) {
    if (config && Object.keys(config).length > 0) {
      configs.set(id, config);
    }
  }
  logger.debug(`Initialized configs for: ${Object.keys(allConfigs).join(', ')}`);
}

/**
 * 导出所有配置（用于保存）
 * @returns {object}
 */
export function exportConfigs() {
  const result = {};
  configs.forEach((config, id) => {
    result[id] = config;
  });
  return result;
}

// ========== 状态查询 ==========

/**
 * 获取所有 Provider 的状态
 * @returns {Array<{id, name, configured, config}>}
 */
export function getAllProvidersStatus() {
  return getAllProviderMetadata().map(meta => {
    const instance = instances.get(meta.id);
    const configured = instance?.isConfigured() ?? false;
    
    return {
      ...meta,
      configured,
      available: configured,
      config: configs.get(meta.id) || {},
    };
  });
}

// ========== 动态注册 ==========

/**
 * 注册新的 Provider（用于插件系统）
 * @param {string} id - Provider ID
 * @param {class} ProviderClass - Provider 类
 */
export function registerProvider(id, ProviderClass) {
  if (providerClasses[id]) {
    logger.warn(`Provider ${id} already exists, overwriting...`);
  }
  providerClasses[id] = ProviderClass;
}

/**
 * 清除实例缓存（用于测试或重新初始化）
 */
export function clearInstances() {
  instances.clear();
  logger.debug(' Cleared all instances');
}

// ========== 默认导出 ==========

export default {
  // 查询
  getAllProviderIds,
  getProviderClass,
  hasProvider,
  getProviderMetadata,
  getAllProviderMetadata,
  
  // 实例
  getProvider,
  createProvider,
  isProviderConfigured,
  getMissingConfig,
  
  // 配置
  updateProviderConfig,
  getProviderConfig,
  initConfigs,
  exportConfigs,
  
  // 状态
  getAllProvidersStatus,
  
  // 动态注册
  registerProvider,
  clearInstances,
  
  // 常量
  DEFAULT_PRIORITY,
};
