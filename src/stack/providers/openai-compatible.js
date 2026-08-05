// Shared base for all OpenAI-compatible providers (openai / deepseek / ollama / local-llm).
// Main-process stack port of src/providers/openai-compatible.js — changes vs the
// renderer original: _t from stack i18n, logger from stack logger, and every
// network call goes through rtFetch (injected electron net.fetch — Node's
// global fetch would bypass the system proxy).
// Per-provider differences live in presets (./presets.js) as small hooks:
//   - requireApiKey / apiKeyErrorMessage  → _checkApiKey behavior
//   - filterModels                         → post-filter model list (e.g. gpt-* only)
//   - modelsFallbackEndpoint               → secondary models endpoint (e.g. Ollama /api/tags)
//   - fieldAdapter                         → normalize config (e.g. baseUrl → endpoint)
//   - testConnectionMessage                → custom success message

import { BaseProvider, LANGUAGE_CODES, combineSignal, linkAbort } from './base.js';
import { _t } from '../i18n.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';

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

  // ===== Translate =====

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!text?.trim()) {
      return { success: false, error: _t('providerError.emptyText', '文本为空') };
    }

    const keyCheck = this._checkApiKey();
    if (keyCheck) return keyCheck;

    try {
      const messages = this._buildMessages(text, targetLang, options);

      const response = await this._chatCompletion(messages, options.signal);

      if (response.success && response.content?.trim()) {
        return { success: true, text: response.content.trim() };
      }
      // A reply of pure whitespace is not a translation. Reporting success
      // here let an empty string travel on as the result and get cached.
      if (response.success) {
        return { success: false, error: _t('providerError.noResult', '无翻译结果') };
      }

      return { success: false, error: response.error || _t('providerError.translateFailed', '翻译失败') };
    } catch (error) {
      this._lastError = error;
      return { success: false, error: error.message || _t('providerError.unknownError', '未知错误') };
    }
  }

  async translateStream(text, sourceLang, targetLang, onChunk, options = {}) {
    if (!text?.trim()) {
      return { success: false, error: _t('providerError.emptyText', '文本为空') };
    }

    const keyCheck = this._checkApiKey();
    if (keyCheck) return keyCheck;

    let fullText = '';
    try {
      const messages = this._buildMessages(text, targetLang, options);

      await this._chatCompletionStream(messages, (chunk) => {
        fullText += chunk;
        if (onChunk) onChunk(chunk);
      }, options.signal);

      const streamed = fullText.trim();
      if (!streamed) {
        // Stream ended without producing anything — same reasoning as translate().
        return { success: false, error: _t('providerError.noResult', '无翻译结果') };
      }
      return { success: true, text: streamed };
    } catch (error) {
      this._lastError = error;
      if (error.name === 'AbortError') {
        // Distinguish "never started" from "died mid-generation" so the user
        // knows whether to raise the timeout or check the server.
        return {
          success: false,
          error: fullText
            ? _t('providerError.streamStalled', '生成中断：超过超时时间无新内容')
            : _t('providerError.waitTimeout', '等待模型响应超时，可在翻译源设置中调大超时时间'),
        };
      }
      return { success: false, error: error.message || _t('providerError.streamFailed', '流式翻译失败') };
    }
  }

  // ===== Connection test =====

  async testConnection() {
    const keyCheck = this._checkApiKey();
    if (keyCheck) return { success: false, message: keyCheck.error };

    try {
      const models = await this._fetchModelsWithFallback();
      const filtered = this.hooks.filterModels ? this.hooks.filterModels(models) : models;

      const msg = this.hooks.testConnectionMessage
        ? this.hooks.testConnectionMessage(filtered.length)
        : _t('providerError.connectSuccess', '连接成功');

      return { success: true, message: msg, models: filtered };
    } catch (error) {
      if (error.status === 401) return { success: false, message: _t('providerError.keyInvalid', 'API Key 无效') };
      if (error.status) return { success: false, message: _t('providerError.connectFailedStatus', `连接失败: ${error.status}`, { status: error.status }) };
      return { success: false, message: error.message || _t('providerError.connectFailed', '连接失败') };
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
   * Fetch models from /v1/models; if it fails (non-2xx, network error) OR
   * returns empty AND a fallback endpoint is configured (e.g. Ollama's
   * /api/tags), try that too. Catches primary errors so old Ollama setups
   * that only expose /api/tags can still list models.
   */
  async _fetchModelsWithFallback() {
    let primaryError = null;
    let primary = [];

    // Primary: /v1/models (OpenAI-compatible)
    try {
      primary = await this._fetchModelsFrom(`${this.config.endpoint}/models`);
      if (primary.length > 0) return primary;
    } catch (err) {
      primaryError = err;
    }

    // Fallback: vendor-specific endpoint (e.g. Ollama /api/tags off the base URL)
    if (this.hooks.modelsFallbackEndpoint) {
      const baseUrl = this.config.endpoint.replace(/\/v1$/, '');
      try {
        return await this._fetchModelsFrom(`${baseUrl}${this.hooks.modelsFallbackEndpoint}`);
      } catch (fallbackErr) {
        // Surface the primary error if available — usually closer to root cause
        throw primaryError || fallbackErr;
      }
    }

    if (primaryError) throw primaryError;
    return primary;
  }

  async _fetchModelsFrom(url) {
    const response = await rtFetch(url, {
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

  // ===== Generic chat (AI analysis, style rewrite) =====

  async chat(messages, options = {}) {
    try {
      const response = await rtFetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model || undefined,
          messages,
          temperature: options.temperature ?? 0.7,
          ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
          stream: false,
        }),
        signal: combineSignal(options.signal, this.config.timeout || 30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 错误: ${response.status} - ${errorText}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        return { success: false, error: _t('providerError.noResponseContent', '无响应内容') };
      }

      return { success: true, content, usage: data.usage, model: data.model };
    } catch (error) {
      logger.error('Chat error:', error);
      return { success: false, error: error.message };
    }
  }

  // ===== Internals =====

  /**
   * Build chat messages, branching on template mode.
   * `options.systemPrompt` may be a string (legacy) or `{ content, mode }`.
   * - `mode === 'user'` merges instruction + source into one user message;
   *   needed by some translation-only small models whose chat templates don't
   *   expect a system role and would otherwise translate the instruction text.
   * - default `'system'` keeps the standard two-message layout.
   */
  _buildMessages(text, targetLang, options = {}) {
    let prompt = options.systemPrompt;
    let mode = 'system';
    if (prompt && typeof prompt === 'object') {
      mode = prompt.mode || 'system';
      prompt = prompt.content;
    }
    if (!prompt) {
      const langName = LANGUAGE_CODES[targetLang]?.name || targetLang;
      prompt = `You are a professional translator. Translate the following text to ${langName}. Output only the translation, nothing else.`;
    }
    return mode === 'user'
      ? [{ role: 'user', content: `${prompt}\n\n${text}` }]
      : [{ role: 'system', content: prompt }, { role: 'user', content: text }];
  }

  /**
   * Build request headers (overridable by subclasses)
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
      // apiKeyErrorMessage hook may be a plain string or an i18n key.
      const hookMsg = this.hooks.apiKeyErrorMessage;
      return {
        success: false,
        error: hookMsg ? _t(hookMsg, hookMsg) : _t('providerError.notConfigured', '未配置 API Key'),
      };
    }
    return null;
  }

  /**
   * Providers like Ollama require an explicit model name and reject an omitted
   * one. When the field is blank and the preset opts in, resolve the first
   * available model once and cache it onto config so later calls skip the fetch.
   */
  async _ensureModel() {
    if (this.config.model || !this.hooks.autoDetectModel) return;
    try {
      const models = await this._fetchModelsWithFallback();
      const filtered = this.hooks.filterModels ? this.hooks.filterModels(models) : models;
      if (filtered.length > 0) {
        this.config.model = filtered[0];
        logger.debug('Auto-detected model:', this.config.model);
      }
    } catch { /* leave blank; the request will surface a clear error */ }
  }

  /**
   * Chat completion (non-streaming)
   */
  async _chatCompletion(messages, extSignal) {
    await this._ensureModel();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    // External abort (facade requestId mapping, P2-34) cancels the same controller
    linkAbort(extSignal, controller);

    try {
      const response = await rtFetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model || undefined,
          messages,
          temperature: 0.3,
          // No max_tokens unless configured — a fixed cap silently truncates
          // long output (CJK translations expand vs the source text)
          ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
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
        return { success: false, error: _t('providerError.requestTimeout', '请求超时，可在翻译源设置中调大超时时间') };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Chat completion (streaming)
   */
  async _chatCompletionStream(messages, onChunk, extSignal) {
    await this._ensureModel();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    let idleTimer = null;
    // External abort (facade requestId mapping, P2-34) cancels the same controller
    linkAbort(extSignal, controller);

    try {
      const response = await rtFetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify({
          model: this.config.model || undefined,
          messages,
          temperature: 0.3,
          // No max_tokens unless configured — a fixed cap silently truncates
          // long output (CJK translations expand vs the source text)
          ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }

      // Idle watchdog: abort only when the stream goes fully silent for
      // `timeout`. Re-armed on ANY received bytes — reasoning deltas and
      // heartbeats included — so thinking models and slow hardware are never
      // killed while still producing.
      const idleMs = this.config.timeout || 30000;
      const armIdleWatchdog = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), idleMs);
      };
      armIdleWatchdog();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        armIdleWatchdog();
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
    } finally {
      clearTimeout(idleTimer);
    }
  }
}

export default OpenAICompatibleProvider;
