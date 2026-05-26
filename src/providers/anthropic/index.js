// Anthropic Messages API provider (not OpenAI-compatible).

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';

const logger = createLogger('Anthropic');

class AnthropicProvider extends BaseProvider {

  static metadata = {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude AI, extremely high translation quality',
    icon: icon,
    color: '#d4a27f',
    type: 'llm',
    helpUrl: 'https://console.anthropic.com/settings/keys',

    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        default: '',
        required: true,
        placeholder: 'sk-ant-...',
        encrypted: true,
      },
      model: {
        type: 'text',
        label: 'Model',
        default: 'claude-sonnet-4-20250514',
        required: false,
        placeholder: 'claude-sonnet-4-20250514',
      },
      baseUrl: {
        type: 'text',
        label: 'API Endpoint',
        default: 'https://api.anthropic.com',
        required: false,
        placeholder: 'https://api.anthropic.com',
      },
    },
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com',
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

  get supportsStreaming() {
    return true;
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }
    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }

    try {
      // Support both legacy string and `{ content, mode }` from services/translation.js
      const promptOpt = options.systemPrompt;
      const systemPrompt = (promptOpt && typeof promptOpt === 'object' ? promptOpt.content : promptOpt) ||
        `You are a professional translator. Translate the following text to ${LANGUAGE_CODES[targetLang]?.name || targetLang}. Output only the translation, nothing else.`;

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            { role: 'user', content: text },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          error: error.error?.message || `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const translatedText = data.content?.[0]?.text;

      if (!translatedText) {
        return { success: false, error: '无翻译结果' };
      }

      return {
        success: true,
        text: translatedText.trim(),
        provider: 'anthropic',
        model: data.model,
        usage: data.usage,
      };
    } catch (error) {
      logger.error('Translation error:', error);
      return { success: false, error: error.message };
    }
  }

  async translateStream(text, sourceLang, targetLang, onChunk, options = {}) {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }
    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }

    try {
      // Support both legacy string and `{ content, mode }` from services/translation.js
      const promptOpt = options.systemPrompt;
      const systemPrompt = (promptOpt && typeof promptOpt === 'object' ? promptOpt.content : promptOpt) ||
        `You are a professional translator. Translate the following text to ${LANGUAGE_CODES[targetLang]?.name || targetLang}. Output only the translation, nothing else.`;

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          stream: true,
          system: systemPrompt,
          messages: [
            { role: 'user', content: text },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);

            // Anthropic streams several event types; only content_block_delta carries token text
            if (json.type === 'content_block_delta' && json.delta?.text) {
              fullText += json.delta.text;
              if (onChunk) onChunk(json.delta.text);
            }
          } catch {}
        }
      }

      return { success: true, text: fullText.trim() };
    } catch (error) {
      this._lastError = error;
      return { success: false, error: error.message || '流式翻译失败' };
    }
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    try {
      // Minimum-cost ping: 10 tokens output for "Hi"
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 10,
          messages: [
            { role: 'user', content: 'Hi' },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.status === 401) {
        return { success: false, message: 'API Key 无效' };
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return { success: false, message: error.error?.message || `HTTP ${response.status}` };
      }

      return {
        success: true,
        message: `Claude 连接成功 (${this.config.model})`,
      };
    } catch (error) {
      return { success: false, message: error.message || '连接失败' };
    }
  }

  // anthropic-dangerous-direct-browser-access lets us call from renderer (no CORS proxy)
  _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
}

export default AnthropicProvider;
