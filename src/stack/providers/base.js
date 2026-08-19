// Base class for all translation providers (main-process stack port of
// src/providers/base.js — only the _t source changed: stack i18n instead of
// the renderer react-i18next instance).

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

// Derived from the shared catalogue so a language can never exist in the
// picker without a name here — the six LLM providers put this name straight
// into the prompt (`Translate the following text to X`).
//
// English, not the endonym the old hand-written table used: the prompt around
// it is English, and `Translate to Meiteilon` is something a model can act on
// while the same request written in an unfamiliar script is not.
export const LANGUAGE_CODES = Object.fromEntries(
  LANGUAGES.map((lang) => [lang.code, { name: lang.en, nativeName: lang.nativeName }])
);

export function getLanguageName(code) {
  return LANGUAGE_CODES[code]?.name || code;
}

// Fetch signal for providers with a fixed per-request timeout: combines the
// caller's abort signal (facade requestId -> AbortController, P2-34) with the
// provider's own timeout. Either firing cancels the HTTP request.
export function combineSignal(external, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

// For providers that manage their own AbortController (idle watchdogs):
// propagate an external abort into it. The aborted-check matters — an abort
// listener on an already-aborted signal never fires (fallback chain hands the
// same signal to the NEXT provider after the first one died).
export function linkAbort(external, controller) {
  if (!external) return;
  if (external.aborted) {
    controller.abort();
    return;
  }
  external.addEventListener('abort', () => controller.abort(), { once: true });
}

export default BaseProvider;
