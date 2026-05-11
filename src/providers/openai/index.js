// OpenAI provider — GPT-4/4o/3.5 via the OpenAI-compatible base.

import OpenAICompatibleProvider from '../openai-compatible.js';
import icon from './icon.svg';

class OpenAIProvider extends OpenAICompatibleProvider {

  static metadata = {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models, high quality and fast',
    icon: icon,
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
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      model: 'gpt-4o-mini',
      timeout: 15000,
      // Base class uses `endpoint`; our schema exposes `baseUrl`. Map them.
      endpoint: config.baseUrl || 'https://api.openai.com/v1',
      ...config,
    });
    if (this.config.baseUrl) {
      this.config.endpoint = this.config.baseUrl;
    }
  }

  get latencyLevel() {
    return 'fast';
  }

  get requiresNetwork() {
    return true;
  }

  _checkApiKey() {
    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }
    return null;
  }

  updateConfig(newConfig) {
    super.updateConfig(newConfig);
    // Re-sync after merge so a baseUrl-only update reaches `endpoint`
    if (this.config.baseUrl) {
      this.config.endpoint = this.config.baseUrl;
    }
  }

  // /models includes embeddings, whispers, etc. — narrow to GPT entries
  async getModels() {
    const allModels = await super.getModels();
    return allModels.filter(m => m.includes('gpt'));
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    const result = await super.testConnection();

    if (result.success && result.models) {
      const gptModels = result.models.filter(m => m.includes('gpt'));
      result.message = `连接成功，检测到 ${gptModels.length} 个 GPT 模型`;
      result.models = gptModels;
    }

    return result;
  }
}

export default OpenAIProvider;
