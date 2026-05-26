// src/providers/openai-compatible.js
// Shared base for all OpenAI-compatible providers (openai / deepseek / ollama / local-llm).
// Per-provider differences live in presets (./openai-compatible/presets.js) as small hooks:
//   - requireApiKey / apiKeyErrorMessage  → _checkApiKey behavior
//   - filterModels                         → post-filter model list (e.g. gpt-* only)
//   - modelsFallbackEndpoint               → secondary models endpoint (e.g. Ollama /api/tags)
//   - fieldAdapter                         → normalize config (e.g. baseUrl → endpoint)
//   - testConnectionMessage                → custom success message

import { BaseProvider, LANGUAGE_CODES } from './base.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('OpenAICompat');

// Unified model-list parser — supports both OpenAI shape ({data:[{id}]})
// and Ollama native shape ({models:[{name}]}).
function parseModelList(data) {
  return data.data?.map(m => m.id) || data.models?.map(m => m.name) || [];
}

/**
 * OpenAI-compatible provider base.
 * @param {object} config - runtime config (endpoint, apiKey, model, timeout, ...)
 * @param {object|null} preset - optional preset metadata + hooks (see presets.js)
 */
class OpenAICompatibleProvider extends BaseProvider {

  constructor(config = {}, preset = null) {
    super({
      endpoint: '',
      apiKey: '',
      model: '',
      timeout: 30000,
      ...config,
    });
    this.preset = preset;
    this.hooks = preset?.hooks || {};
    // Apply field adapter (e.g. OpenAI's baseUrl → endpoint mapping)
    if (this.hooks.fieldAdapter) {
      Object.assign(this.config, this.hooks.fieldAdapter(this.config));
    }
  }

  get supportsStreaming() {
    return true;
  }

  get latencyLevel() {
    return this.preset?.latencyLevel || super.latencyLevel;
  }

  get requiresNetwork() {
    return this.preset?.requiresNetwork ?? super.requiresNetwork;
  }

  updateConfig(newConfig) {
    super.updateConfig(newConfig);
    if (this.hooks.fieldAdapter) {
      Object.assign(this.config, this.hooks.fieldAdapter(this.config));
    }
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
      const models = await this._fetchModelsWithFallback();
      const filtered = this.hooks.filterModels ? this.hooks.filterModels(models) : models;

      const msg = this.hooks.testConnectionMessage
        ? this.hooks.testConnectionMessage(filtered.length)
        : `连接成功，检测到 ${filtered.length} 个模型`;

      return { success: true, message: msg, models: filtered };
    } catch (error) {
      if (error.status === 401) return { success: false, message: 'API Key 无效' };
      if (error.status) return { success: false, message: `连接失败: ${error.status}` };
      return { success: false, message: error.message || '连接失败' };
    }
  }

  async getModels() {
    const keyCheck = this._checkApiKey();
    if (keyCheck) return [];

    try {
      const models = await this._fetchModelsWithFallback();
      return this.hooks.filterModels ? this.hooks.filterModels(models) : models;
    } catch {
      return [];
    }
  }

  /**
   * Fetch models from /v1/models; if empty / fails AND a fallback endpoint is
   * configured (e.g. Ollama's /api/tags), try that too.
   */
  async _fetchModelsWithFallback() {
    // Primary: /v1/models (OpenAI-compatible)
    const primary = await this._fetchModelsFrom(`${this.config.endpoint}/models`);
    if (primary.length > 0) return primary;

    // Fallback: vendor-specific endpoint (e.g. Ollama /api/tags off the base URL)
    if (this.hooks.modelsFallbackEndpoint) {
      const baseUrl = this.config.endpoint.replace(/\/v1$/, '');
      return await this._fetchModelsFrom(`${baseUrl}${this.hooks.modelsFallbackEndpoint}`);
    }

    return primary;
  }

  async _fetchModelsFrom(url) {
    const response = await fetch(url, {
      method: 'GET',
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    return parseModelList(data);
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
   * Gated on preset hook. Default = no key required (local-llm / ollama).
   */
  _checkApiKey() {
    if (this.hooks.requireApiKey && !this.config.apiKey) {
      return {
        success: false,
        error: this.hooks.apiKeyErrorMessage || '未配置 API Key',
      };
    }
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
