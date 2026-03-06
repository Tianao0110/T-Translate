// src/providers/openai-compatible.js
// OpenAI 兼容 API 基类
// 适用于: local-llm, openai, deepseek, ollama 等所有 OpenAI 兼容接口
//
// 子类只需提供 metadata / constructor / 可选覆盖 testConnection / getModels

import { BaseProvider, LANGUAGE_CODES } from './base.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('OpenAICompat');

/**
 * OpenAI 兼容 API Provider 基类
 * 封装了 chat/completions 的普通和流式调用
 */
class OpenAICompatibleProvider extends BaseProvider {

  constructor(config = {}) {
    super({
      endpoint: '',
      apiKey: '',
      model: '',
      timeout: 30000,
      ...config,
    });
  }

  get supportsStreaming() {
    return true;
  }

  // ========== 翻译接口 ==========

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    const keyCheck = this._checkApiKey();
    if (keyCheck) return keyCheck;

    try {
      const systemContent = options.systemPrompt || 
        `You are a professional translator. Translate the following text to ${LANGUAGE_CODES[targetLang]?.name || targetLang}. Output only the translation, nothing else.`;

      const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: text },
      ];

      const response = await this._chatCompletion(messages);

      if (response.success && response.content) {
        return { success: true, text: response.content.trim() };
      }

      return { success: false, error: response.error || '翻译失败' };
    } catch (error) {
      this._lastError = error;
      return { success: false, error: error.message || '未知错误' };
    }
  }

  async translateStream(text, sourceLang, targetLang, onChunk, options = {}) {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    const keyCheck = this._checkApiKey();
    if (keyCheck) return keyCheck;

    try {
      const systemContent = options.systemPrompt || 
        `You are a professional translator. Translate the following text to ${LANGUAGE_CODES[targetLang]?.name || targetLang}. Output only the translation, nothing else.`;

      const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: text },
      ];

      let fullText = '';

      await this._chatCompletionStream(messages, (chunk) => {
        fullText += chunk;
        if (onChunk) onChunk(chunk);
      });

      return { success: true, text: fullText.trim() };
    } catch (error) {
      this._lastError = error;
      return { success: false, error: error.message || '流式翻译失败' };
    }
  }

  // ========== 连接测试 ==========

  async testConnection() {
    const keyCheck = this._checkApiKey();
    if (keyCheck) return { success: false, message: keyCheck.error };

    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: this._buildHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401) {
        return { success: false, message: 'API Key 无效' };
      }

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
      return { success: false, message: error.message || '连接失败' };
    }
  }

  async getModels() {
    const keyCheck = this._checkApiKey();
    if (keyCheck) return [];

    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        headers: this._buildHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.data?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }

  // ========== 通用聊天（用于 AI 分析、风格改写等）==========

  async chat(messages, options = {}) {
    try {
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model || undefined,
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

      return { success: true, content, usage: data.usage, model: data.model };
    } catch (error) {
      logger.error('Chat error:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== 内部方法 ==========

  /**
   * 构建请求头（子类可覆盖）
   */
  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  /**
   * 检查 API Key（需要 key 的子类覆盖返回逻辑）
   * @returns {null | {success: false, error: string}} null 表示通过
   */
  _checkApiKey() {
    // 默认不检查（local-llm / ollama 不需要 key）
    return null;
  }

  /**
   * Chat Completion（非流式）
   */
  async _chatCompletion(messages) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildHeaders(),
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
   * Chat Completion（流式）
   */
  async _chatCompletionStream(messages, onChunk) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildHeaders(),
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
}

export default OpenAICompatibleProvider;
