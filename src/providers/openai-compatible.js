// OpenAI-compatible chat/completions provider base. Used by local-llm, openai,
// deepseek, ollama, and any other backend exposing /v1/chat/completions.
// Subclasses typically only override metadata + _checkApiKey.

import { BaseProvider, LANGUAGE_CODES } from './base.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('OpenAICompat');

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

  // Probes /models — that's the cheapest endpoint that exercises auth
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

  // Generic chat for AI features (analysis, style rewrite) — higher temperature
  // and token budget than translate()
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

  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  // Local providers (local-llm, ollama) override to always return null;
  // hosted providers override to require a key.
  _checkApiKey() {
    return null;
  }

  // Low temperature for translation (deterministic output preferred over creative)
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

  // SSE parser: data: lines carry JSON, terminator is data: [DONE]
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

        // stream: true keeps multi-byte chars intact across chunk boundaries
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Last element might be partial — save for next iteration
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
