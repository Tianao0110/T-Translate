// src/providers/deepseek/index.js
// DeepSeek AI 翻译源
// OpenAI 兼容 API，价格便宜

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';
const logger = createLogger('DeepSeek');

/**
 * DeepSeek AI 翻译源
 * 国产大模型，OpenAI 兼容接口
 */
class DeepSeekProvider extends BaseProvider {
  
  static metadata = {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '国产 AI 大模型，价格实惠，中文翻译质量好',
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
        label: '模型',
        default: 'deepseek-chat',
        required: false,
        placeholder: 'deepseek-chat',
      },
      endpoint: {
        type: 'text',
        label: 'API 地址',
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

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, error: '请配置 API Key' };
    }

    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { success: true, message: 'DeepSeek 连接成功' };
      } else {
        const error = await response.json();
        return { success: false, error: error.error?.message || `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 翻译文本
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '请配置 DeepSeek API Key' };
    }

    try {
      const targetName = LANGUAGE_CODES[targetLang]?.name || targetLang;

      const systemPrompt = `You are a professional translator. Translate the following text to ${targetName}. Output only the translation, no explanations or additional text.`;

      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error?.message || `HTTP ${response.status}` };
      }

      const data = await response.json();
      const translatedText = data.choices?.[0]?.message?.content;

      if (!translatedText) {
        return { success: false, error: '无翻译结果' };
      }

      return {
        success: true,
        text: translatedText.trim(),
        provider: 'deepseek',
        model: this.config.model,
        usage: data.usage,
      };
    } catch (error) {
      logger.error('Translation error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default DeepSeekProvider;
