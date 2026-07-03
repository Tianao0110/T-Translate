// Translation provider registry: classes, instances, and configs.
// Pure storage — fallback/priority/scheduling live in the service layer.

import OpenAICompatibleProvider from './openai-compatible.js';
import { PRESETS, createPresetProviderClass } from './openai-compatible/presets.js';
import DeepLProvider from './deepl';
import GeminiProvider from './gemini';
import GoogleTranslateProvider from './google-translate';
import AnthropicProvider from './anthropic';
import MicrosoftTranslatorProvider from './microsoft-translator';
import BaiduTranslateProvider from './baidu-translate';
import createLogger from '../utils/logger.js';

const logger = createLogger('Registry');

// OpenAI-compatible providers come from presets — one wrapper class per preset.
// Adding a new compatible provider = add an entry to presets.js, no class file needed.
const presetClasses = Object.fromEntries(
  PRESETS.map(preset => {
    try {
      return [preset.id, createPresetProviderClass(preset, OpenAICompatibleProvider)];
    } catch (err) {
      logger.error(`Failed to register preset ${preset.id}:`, err);
      return null;
    }
  }).filter(Boolean)
);

const providerClasses = {
  ...presetClasses,
  'deepl': DeepLProvider,
  'gemini': GeminiProvider,
  'google-translate': GoogleTranslateProvider,
  'anthropic': AnthropicProvider,
  'microsoft-translator': MicrosoftTranslatorProvider,
  'baidu-translate': BaiduTranslateProvider,
};

// Service layer reads this when no user-defined priority is set
export const DEFAULT_PRIORITY = {
  normal: ['local-llm', 'ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'google-translate', 'microsoft-translator', 'baidu-translate', 'deepl'],
};

const instances = new Map();
const configs = new Map();

export function getAllProviderIds() {
  return Object.keys(providerClasses);
}

export function getProviderClass(id) {
  return providerClasses[id] || null;
}

export function getProviderMetadata(id) {
  const ProviderClass = providerClasses[id];
  if (!ProviderClass?.metadata) return null;
  return { id, ...ProviderClass.metadata };
}

export function getAllProviderMetadata() {
  return Object.entries(providerClasses).map(([id, ProviderClass]) => ({
    id,
    ...ProviderClass.metadata,
  }));
}

// Lazily instantiates and caches the singleton for `id`. If `config` is passed,
// merges it in first so callers don't have to update-then-get.
export function getProvider(id, config = null) {
  if (config !== null) {
    updateProviderConfig(id, config);
  }

  if (instances.has(id)) {
    return instances.get(id);
  }

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

// Bypasses the instance cache — used by the "test connection" flow so an
// unsaved config doesn't pollute the live singleton.
export function createProvider(id, config = {}) {
  const ProviderClass = providerClasses[id];
  if (!ProviderClass) {
    logger.error(`Unknown provider: ${id}`);
    return null;
  }
  return new ProviderClass(config);
}

export function isProviderConfigured(id) {
  const instance = getProvider(id);
  return instance?.isConfigured() ?? false;
}

export function getMissingConfig(id) {
  const instance = getProvider(id);
  return instance?.getMissingConfig() ?? [];
}

// Merges into existing config (does not replace). Live instances get updated in-place.
export function updateProviderConfig(id, config) {
  const existingConfig = configs.get(id) || {};
  const newConfig = { ...existingConfig, ...config };
  configs.set(id, newConfig);

  if (instances.has(id)) {
    instances.get(id).updateConfig(newConfig);
  }

  logger.debug(`Updated config for ${id}`);
}

export function getProviderConfig(id) {
  return configs.get(id) || {};
}

// Clears instance cache by default — config changes during init require fresh instances
export function initConfigs(allConfigs, clearExisting = true) {
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

export default {
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

  getAllProvidersStatus,

  DEFAULT_PRIORITY,
};
