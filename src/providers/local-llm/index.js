// src/providers/local-llm/index.js
// 本地 LLM 翻译源 - 通过 LM Studio / Ollama 等本地服务

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';

/**
 * 本地 LLM 翻译源
 * 支持 LM Studio、Ollama 等 OpenAI 兼容 API
 */
class LocalLLMProvider extends BaseProvider {
  
  static metadata = {
    id: 'local-llm',
    name: 'LM Studio (本地)',
    description: '使用本地大模型翻译，隐私安全、免费',
    icon: icon,
    color: '#10b981',
    type: 'llm',
    helpUrl: 'https://lmstudio.ai/',
    
    // 配置字段声明
    configSchema: {
      endpoint: {
        type: 'text',
        label: 'API 地址',
        default: 'http://localhost:1234/v1',
        required: true,
        placeholder: 'http://localhost:1234/v1',
      },
      model: {
        type: 'text',
        label: '模型名称',
        default: '',
        required: false,
        placeholder: '留空自动检测',
      },
    },
  };

  constructor(config = {}) {
    super({
      endpoint: 'http://localhost:1234/v1',
      model: '',
      timeout: 30000,
      ...config,
    });
  }

  get latencyLevel() {
    return 'slow';  // 本地模型通常较慢
  }

  get requiresNetwork() {
    return false;  // 不需要外网
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

    try {
      const targetName = LANGUAGE_CODES[targetLang]?.name || targetLang;
      
      const messages = [
        {
          role: 'system',
          content: `You are a translator. Translate the following text to ${targetName}. Output only the translation, no explanations.`
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

    try {
      const targetName = LANGUAGE_CODES[targetLang]?.name || targetLang;
      
      const messages = [
        {
          role: 'system',
          content: `You are a translator. Translate the following text to ${targetName}. Output only the translation, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ];

      let fullText = '';
      
      const response = await this._chatCompletionStream(messages, (chunk) => {
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
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { success: false, message: `连接失败: ${response.status}` };
      }

      const data = await response.json();
      const models = data.data?.map(m => m.id) || [];
      
      return {
        success: true,
        message: `连接成功，检测到 ${models.length} 个模型`,
        models,
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
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.data?.map(m => m.id) || [];
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
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model || undefined,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 错误: ${response.status} - ${errorText}` };
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
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model || undefined,
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

  /**
   * 通用聊天完成（用于非翻译场景，如 AI 分析、风格改写）
   * @param {Array} messages - OpenAI 格式的消息数组
   * @param {object} options - 选项
   */
  async chat(messages, options = {}) {
    try {
      const model = this.config.model || await this._getFirstModel();
      
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'local-model',
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? 2048,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.config.timeout || 30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 错误: ${response.status} - ${errorText}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        return { success: false, error: '无响应内容' };
      }

      return {
        success: true,
        content,
        usage: data.usage,
        model: data.model,
      };
    } catch (error) {
      console.error('[LocalLLM] Chat error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取第一个可用模型
   */
  async _getFirstModel() {
    try {
      const models = await this.getModels();
      return models?.[0]?.id || null;
    } catch {
      return null;
    }
  }
}

export default LocalLLMProvider;
