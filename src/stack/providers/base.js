// Base class for all translation providers.

import { _t } from '../i18n.js';
import { LANGUAGES } from '../../config/languages.js';

export { _t };

export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this._lastError = null;
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    throw new Error('translate() must be implemented by subclass');
  }

  // Default fallback when a provider doesn't override: do a one-shot and emit
  // the full result as one chunk
  async translateStream(text, sourceLang, targetLang, onChunk) {
    const result = await this.translate(text, sourceLang, targetLang);
    if (result.success && onChunk) {
      onChunk(result.text);
    }
    return result;
  }

  async testConnection() {
    return { success: true, message: 'Not implemented' };
  }

  async getModels() {
    return [];
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  get lastError() {
    return this._lastError;
  }

  get supportsStreaming() {
    return false;
  }

  // 'fast' = <500ms online API; 'medium' = 500ms-2s; 'slow' = >2s local LLM
  get latencyLevel() {
    return 'medium';
  }

  get requiresNetwork() {
    return true;
  }

  // Walks configSchema for required: true fields
  isConfigured() {
    const schema = this.constructor.metadata?.configSchema || {};
    for (const [key, field] of Object.entries(schema)) {
      if (field.required && !this.config[key]) {
        return false;
      }
    }
    return true;
  }

  getMissingConfig() {
    const schema = this.constructor.metadata?.configSchema || {};
    const missing = [];
    for (const [key, field] of Object.entries(schema)) {
      if (field.required && !this.config[key]) {
        missing.push(field.label || key);
      }
    }
    return missing;
  }
}

// English language names for LLM prompts, derived from the shared catalogue
// so every picker language has one.
export const LANGUAGE_CODES = Object.fromEntries(
  LANGUAGES.map((lang) => [lang.code, { name: lang.en, nativeName: lang.nativeName }])
);

export function getLanguageName(code) {
  return LANGUAGE_CODES[code]?.name || code;
}

// Chat messages for a translation request. `options.systemPrompt` is a string
// or `{ content, mode }`; mode 'user' folds the instruction into the user
// turn for small translation-only models whose templates have no system role.
export function buildTranslationMessages(text, targetLang, options = {}) {
  let prompt = options.systemPrompt;
  let mode = 'system';
  if (prompt && typeof prompt === 'object') {
    mode = prompt.mode || 'system';
    prompt = prompt.content;
  }
  if (!prompt) {
    prompt = `You are a professional translator. Translate the following text to ${getLanguageName(targetLang)}. Output only the translation, nothing else.`;
  }
  return mode === 'user'
    ? [{ role: 'user', content: `${prompt}\n\n${text}` }]
    : [{ role: 'system', content: prompt }, { role: 'user', content: text }];
}

// Fetch signal for providers with a fixed per-request timeout: the caller's
// abort signal combined with the provider's own timeout.
export function combineSignal(external, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

// For providers that manage their own AbortController (idle watchdogs):
// propagate an external abort into it, an already-aborted signal included.
export function linkAbort(external, controller) {
  if (!external) return;
  if (external.aborted) {
    controller.abort();
    return;
  }
  external.addEventListener('abort', () => controller.abort(), { once: true });
}

export default BaseProvider;
