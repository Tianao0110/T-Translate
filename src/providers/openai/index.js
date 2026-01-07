// src/providers/openai/index.js
// OpenAI 翻译源 - 支持 GPT-4/3.5

import { BaseProvider, LANGUAGE_CODES } from '../base.js';

/**
 * OpenAI 翻译源
 * 支持 GPT-4、GPT-3.5-turbo 等模型
 */
class OpenAIProvider extends BaseProvider {
  
  static metadata = {
    id: 'openai',
    name: 'OpenAI',
    description: '使用 GPT 模型翻译，质量高、速度快',
    icon: 'openai',
    type: 'llm',
    
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
        label: 'API 地址',
        default: 'https://api.openai.com/v1',
        required: false,
        placeholder: 'https://api.openai.com/v1',
      },
      model: {
        type: 'text',
        label: '模型名称',
        default: 'gpt-4o-mini',
        required: false,
        placeholder: 'gpt-4o-mini',
      },
      timeout: {
        type: 'number',
        label: '超时时间 (ms)',
        default: 15000,
        required: false,
      },
    },
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      timeout: 15000,
      ...config,
    });
  }

  get latencyLevel() {
    return 'fast';
  }

  get requiresNetwork() {
    return true;
  }

  get supportsStreaming() {
    return true;
  }

  /**
   * 翻译文本
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }

    try {
      const targetName = LANGUAGE_CODES[targetLang]?.name || targetLang;
      
      const messages = [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetName}. Output only the translation, nothing else.`
        },
        {
          role: 'user',
          content: text
        }
      ];

      const response = await this._chatCompletion(messages);
      
      if (response.success && response.content) {
        return {
          success: true,
          text: response.content.trim(),
        };
      }

      return {
        success: false,
        error: response.error || '翻译失败',
      };
    } catch (error) {
      this._lastError = error;
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 流式翻译
   */
  async translateStream(text, sourceLang, targetLang, onChunk) {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }

    try {
      const targetName = LANGUAGE_CODES[targetLang]?.name || targetLang;
      
      const messages = [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetName}. Output only the translation, nothing else.`
        },
        {
          role: 'user',
          content: text
        }
      ];

      let fullText = '';
      
      await this._chatCompletionStream(messages, (chunk) => {
        fullText += chunk;
        if (onChunk) onChunk(chunk);
      });

      return {
        success: true,
        text: fullText.trim(),
      };
    } catch (error) {
      this._lastError = error;
      return {
        success: false,
        error: error.message || '流式翻译失败',
      };
    }
  }

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401) {
        return { success: false, message: 'API Key 无效' };
      }

      if (!response.ok) {
        return { success: false, message: `连接失败: ${response.status}` };
      }

      const data = await response.json();
      const gptModels = data.data?.filter(m => m.id.includes('gpt'))?.map(m => m.id) || [];
      
      return {
        success: true,
        message: `连接成功，检测到 ${gptModels.length} 个 GPT 模型`,
        models: gptModels,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || '连接失败',
      };
    }
  }

  /**
   * 获取模型列表
   */
  async getModels() {
    if (!this.config.apiKey) return [];

    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.data?.filter(m => m.id.includes('gpt'))?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }

  /**
   * 内部方法：Chat Completion
   */
  async _chatCompletion(messages) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `API 错误: ${response.status}`;
        return { success: false, error: errorMsg };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      return { success: true, content };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return { success: false, error: '请求超时' };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * 内部方法：流式 Chat Completion
   */
  async _chatCompletionStream(messages, onChunk) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content && onChunk) {
                onChunk(content);
              }
            } catch {}
          }
        }
      }

      return { success: true };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

export default OpenAIProvider;
