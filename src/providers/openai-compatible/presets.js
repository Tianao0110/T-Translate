// src/providers/openai-compatible/presets.js
// Preset definitions for all OpenAI-compatible providers.
// Each preset = metadata (UI-facing) + defaults (constructor config) + hooks (behavior overrides).
// To add a new OpenAI-compatible provider: append one entry here, no new class file needed.

import openaiIcon from './icons/openai.svg';
import deepseekIcon from './icons/deepseek.svg';
import ollamaIcon from './icons/ollama.svg';
import localLlmIcon from './icons/local-llm.svg';

export const PRESETS = [
  {
    id: 'openai',
    metadata: {
      name: 'OpenAI',
      description: 'GPT models, high quality and fast',
      icon: openaiIcon,
      color: '#10a37f',
      type: 'llm',
      helpUrl: 'https://platform.openai.com/api-keys',
      configSchema: {
        apiKey: {
          type: 'password',
          label: 'API Key',
          required: true,
          placeholder: 'sk-...',
          encrypted: true,
        },
        baseUrl: {
          type: 'text',
          label: 'API Endpoint',
          default: 'https://api.openai.com/v1',
          required: false,
          placeholder: 'https://api.openai.com/v1',
        },
        model: {
          type: 'text',
          label: 'Model Name',
          default: 'gpt-4o-mini',
          required: false,
          placeholder: 'gpt-4o-mini',
        },
      },
    },
    defaults: {
      apiKey: '',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
      timeout: 15000,
    },
    latencyLevel: 'fast',
    requiresNetwork: true,
    hooks: {
      requireApiKey: true,
      // OpenAI configSchema uses 'baseUrl', base class uses 'endpoint' — keep them in sync
      fieldAdapter: (cfg) => (cfg.baseUrl ? { ...cfg, endpoint: cfg.baseUrl } : cfg),
      filterModels: (models) => models.filter(m => m.includes('gpt')),
      testConnectionMessage: (count) => `连接成功，检测到 ${count} 个 GPT 模型`,
    },
  },
  {
    id: 'deepseek',
    metadata: {
      name: 'DeepSeek',
      description: 'DeepSeek AI, affordable, excellent for Chinese',
      icon: deepseekIcon,
      color: '#5b6ef8',
      type: 'llm',
      helpUrl: 'https://platform.deepseek.com',
      configSchema: {
        apiKey: {
          type: 'password',
          label: 'API Key',
          default: '',
          required: true,
          placeholder: 'sk-...',
          encrypted: true,
        },
        model: {
          type: 'text',
          label: 'Model',
          default: 'deepseek-chat',
          required: false,
          placeholder: 'deepseek-chat',
        },
        endpoint: {
          type: 'text',
          label: 'API Endpoint',
          default: 'https://api.deepseek.com/v1',
          required: false,
          placeholder: 'https://api.deepseek.com/v1',
        },
      },
    },
    defaults: {
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
      timeout: 30000,
    },
    latencyLevel: 'medium',
    requiresNetwork: true,
    hooks: {
      requireApiKey: true,
      apiKeyErrorMessage: '请配置 DeepSeek API Key',
      testConnectionMessage: () => 'DeepSeek 连接成功',
    },
  },
  {
    id: 'ollama',
    metadata: {
      name: 'Ollama (Local)',
      description: 'Local LLM via Ollama, private and free',
      icon: ollamaIcon,
      color: '#ffffff',
      type: 'llm',
      helpUrl: 'https://ollama.com/',
      configSchema: {
        endpoint: {
          type: 'text',
          label: 'API Endpoint',
          default: 'http://localhost:11434/v1',
          required: true,
          placeholder: 'http://localhost:11434/v1',
        },
        model: {
          type: 'text',
          label: 'Model Name',
          default: '',
          required: false,
          placeholder: 'Leave empty to auto-detect (e.g. llama3, qwen2)',
        },
        timeout: {
          type: 'number',
          label: 'Timeout (ms)',
          default: 120000,
          required: false,
          placeholder: '120000',
        },
      },
    },
    defaults: {
      endpoint: 'http://localhost:11434/v1',
      model: '',
      timeout: 120000,
    },
    latencyLevel: 'slow',
    requiresNetwork: false,
    hooks: {
      requireApiKey: false,
      // Ollama may return {models:[{name}]} via /api/tags when /v1/models is empty
      modelsFallbackEndpoint: '/api/tags',
      testConnectionMessage: (count) => `Ollama 连接成功，检测到 ${count} 个模型`,
    },
  },
  {
    id: 'local-llm',
    metadata: {
      name: 'LM Studio (Local)',
      description: 'Local LLM translation, private and free',
      icon: localLlmIcon,
      color: '#10b981',
      type: 'llm',
      helpUrl: 'https://lmstudio.ai/',
      configSchema: {
        endpoint: {
          type: 'text',
          label: 'API Endpoint',
          default: 'http://localhost:1234/v1',
          required: true,
          placeholder: 'http://localhost:1234/v1',
        },
        model: {
          type: 'text',
          label: 'Model Name',
          default: '',
          required: false,
          placeholder: 'Leave empty to auto-detect',
        },
        timeout: {
          type: 'number',
          label: 'Timeout (ms)',
          default: 60000,
          required: false,
          placeholder: '60000',
        },
      },
    },
    defaults: {
      endpoint: 'http://localhost:1234/v1',
      model: '',
      timeout: 60000,
    },
    latencyLevel: 'slow',
    requiresNetwork: false,
    hooks: {
      requireApiKey: false,
    },
  },
];

/**
 * Build a Provider subclass for a given preset.
 * The wrapper exists only so registry.js can keep its `class.metadata` contract
 * (BaseProvider.isConfigured() / getMissingConfig() read constructor.metadata.configSchema).
 */
export function createPresetProviderClass(preset, OpenAICompatibleProvider) {
  class PresetProvider extends OpenAICompatibleProvider {
    static metadata = { id: preset.id, ...preset.metadata };
    constructor(config = {}) {
      super({ ...preset.defaults, ...config }, preset);
    }
  }
  // Give the function a recognizable name for debug tooling
  Object.defineProperty(PresetProvider, 'name', {
    value: `${preset.id}-presetProvider`,
  });
  return PresetProvider;
}
