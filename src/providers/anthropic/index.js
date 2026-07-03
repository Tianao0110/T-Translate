// Anthropic Messages API provider (not OpenAI-compatible).

import { BaseProvider, LANGUAGE_CODES, _t } from '../base.js';
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

  // Shared guard for translate/translateStream (they used to carry verbatim copies).
  _checkInput(text) {
    if (!text?.trim()) {
      return { success: false, error: _t('providerError.emptyText', '文本为空') };
    }
    if (!this.config.apiKey) {
      return { success: false, error: _t('providerError.notConfigured', '未配置 API Key') };
    }
    return null;
  }

  // Supports both legacy string and `{ content, mode }` from services/translation.js
  _resolveSystemPrompt(options, targetLang) {
    const promptOpt = options.systemPrompt;
    return (promptOpt && typeof promptOpt === 'object' ? promptOpt.content : promptOpt) ||
      `You are a professional translator. Translate the following text to ${LANGUAGE_CODES[targetLang]?.name || targetLang}. Output only the translation, nothing else.`;
  }

  _buildBody(text, systemPrompt, stream = false) {
    return JSON.stringify({
      model: this.config.model,
      max_tokens: 4096,
      ...(stream ? { stream: true } : {}),
      system: systemPrompt,
      messages: [
        { role: 'user', content: text },
      ],
    });
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    const guard = this._checkInput(text);
    if (guard) return guard;

    try {
      const systemPrompt = this._resolveSystemPrompt(options, targetLang);

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: this._buildBody(text, systemPrompt),
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
        return { success: false, error: _t('providerError.noResult', '无翻译结果') };
      }

      // max_tokens => the model was cut off mid-translation. Returning it as
      // success would cache and display a truncated translation as if complete.
      if (data.stop_reason === 'max_tokens') {
        return { success: false, error: _t('providerError.truncated', '翻译结果被截断（超出最大长度）') };
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
    const guard = this._checkInput(text);
    if (guard) return guard;

    try {
      const systemPrompt = this._resolveSystemPrompt(options, targetLang);

      // Idle watchdog, not a total-duration timeout: AbortSignal.timeout(30s)
      // would abort a long-but-healthy stream at 30s. Reset the timer on each
      // chunk so it only fires when the connection actually stalls.
      const controller = new AbortController();
      let idleTimer;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), this.config.timeout);
      };
      resetIdle();

      let response;
      try {
        response = await fetch(`${this.config.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: this._buildHeaders(),
          body: this._buildBody(text, systemPrompt, true),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let stopReason = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdle();

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
              } else if (json.type === 'message_delta' && json.delta?.stop_reason) {
                stopReason = json.delta.stop_reason;
              }
            } catch {}
          }
        }

        if (stopReason === 'max_tokens') {
          return { success: false, error: _t('providerError.truncated', '翻译结果被截断（超出最大长度）') };
        }

        return { success: true, text: fullText.trim() };
      } finally {
        clearTimeout(idleTimer);
      }
    } catch (error) {
      this._lastError = error;
      return { success: false, error: error.message || _t('providerError.streamFailed', '流式翻译失败') };
    }
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: _t('providerError.notConfigured', '未配置 API Key') };
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
        return { success: false, message: _t('providerError.keyInvalid', 'API Key 无效') };
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return { success: false, message: error.error?.message || _t('providerError.httpError', `HTTP ${response.status}`, { status: response.status }) };
      }

      return {
        success: true,
        message: `${_t('providerError.connectSuccess', '连接成功')} (${this.config.model})`,
      };
    } catch (error) {
      return { success: false, message: error.message || _t('providerError.connectFailed', '连接失败') };
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
