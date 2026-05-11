// DeepSeek AI — OpenAI-compatible endpoint.

import OpenAICompatibleProvider from '../openai-compatible.js';
import icon from './icon.svg';

class DeepSeekProvider extends OpenAICompatibleProvider {

  static metadata = {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek AI, affordable, excellent for Chinese',
    icon: icon,
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
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
      timeout: 30000,
      ...config,
    });
  }

  get latencyLevel() {
    return 'medium';
  }

  get requiresNetwork() {
    return true;
  }

  _checkApiKey() {
    if (!this.config.apiKey) {
      return { success: false, error: '请配置 DeepSeek API Key' };
    }
    return null;
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '请配置 API Key' };
    }

    const result = await super.testConnection();
    if (result.success) {
      result.message = 'DeepSeek 连接成功';
    }
    return result;
  }
}

export default DeepSeekProvider;
