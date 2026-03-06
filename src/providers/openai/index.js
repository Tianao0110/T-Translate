// src/providers/openai/index.js
// OpenAI 翻译源 - 支持 GPT-4/3.5
// 继承 OpenAICompatibleProvider，需要 API Key

import OpenAICompatibleProvider from '../openai-compatible.js';
import icon from './icon.svg';

/**
 * OpenAI 翻译源
 * 支持 GPT-4、GPT-3.5-turbo 等模型
 */
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
      // 将 baseUrl 映射到基类的 endpoint
      endpoint: config.baseUrl || 'https://api.openai.com/v1',
      ...config,
    });
    // 确保 baseUrl 变更也同步到 endpoint
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

  /**
   * 需要 API Key
   */
  _checkApiKey() {
    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }
    return null;
  }

  /**
   * 配置更新时同步 baseUrl → endpoint
   */
  updateConfig(newConfig) {
    super.updateConfig(newConfig);
    if (this.config.baseUrl) {
      this.config.endpoint = this.config.baseUrl;
    }
  }

  /**
   * 获取模型列表 - 过滤 GPT 模型
   */
  async getModels() {
    const allModels = await super.getModels();
    return allModels.filter(m => m.includes('gpt'));
  }

  /**
   * 测试连接 - 增加 401 检查
   */
  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    const result = await super.testConnection();
    
    // 过滤显示 GPT 模型数量
    if (result.success && result.models) {
      const gptModels = result.models.filter(m => m.includes('gpt'));
      result.message = `连接成功，检测到 ${gptModels.length} 个 GPT 模型`;
      result.models = gptModels;
    }

    return result;
  }
}

export default OpenAIProvider;
