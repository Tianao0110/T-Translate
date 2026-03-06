// src/providers/ollama/index.js
// Ollama 翻译源 - 本地大模型（OpenAI 兼容 API）

import OpenAICompatibleProvider from '../openai-compatible.js';
import icon from './icon.svg';

/**
 * Ollama 翻译源
 * 本地部署的大模型服务，通过 OpenAI 兼容 API 调用
 */
class OllamaProvider extends OpenAICompatibleProvider {

  static metadata = {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Local LLM via Ollama, private and free',
    icon: icon,
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
  };

  constructor(config = {}) {
    super({
      endpoint: 'http://localhost:11434/v1',
      model: '',
      timeout: 120000,
      ...config,
    });
  }

  get latencyLevel() {
    return 'slow';
  }

  get requiresNetwork() {
    return false;
  }

  /**
   * Ollama 的 /v1/models 返回格式可能和标准 OpenAI 不同
   * 覆盖以兼容两种格式
   */
  async testConnection() {
    try {
      // 先尝试 OpenAI 兼容 /v1/models
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        const models = data.data?.map(m => m.id) || data.models?.map(m => m.name) || [];
        return {
          success: true,
          message: `Ollama 连接成功，检测到 ${models.length} 个模型`,
          models,
        };
      }

      // 回退尝试 Ollama 原生 /api/tags
      const baseUrl = this.config.endpoint.replace(/\/v1$/, '');
      const fallback = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (fallback.ok) {
        const data = await fallback.json();
        const models = data.models?.map(m => m.name) || [];
        return {
          success: true,
          message: `Ollama 连接成功，检测到 ${models.length} 个模型`,
          models,
        };
      }

      return { success: false, message: `连接失败: ${response.status}` };
    } catch (error) {
      return { success: false, message: error.message || '连接失败，请确认 Ollama 是否在运行' };
    }
  }

  async getModels() {
    try {
      // 先尝试 OpenAI 兼容接口
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        return data.data?.map(m => m.id) || data.models?.map(m => m.name) || [];
      }

      // 回退 Ollama 原生接口
      const baseUrl = this.config.endpoint.replace(/\/v1$/, '');
      const fallback = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (fallback.ok) {
        const data = await fallback.json();
        return data.models?.map(m => m.name) || [];
      }

      return [];
    } catch {
      return [];
    }
  }
}

export default OllamaProvider;
