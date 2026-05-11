// Base class for all translation providers.

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

// Cross-provider language code reference. Each entry holds the display name
// plus mappings for DeepL / Google (other providers map inline in their files).
export const LANGUAGE_CODES = {
  'auto': { name: '自动检测', deepl: null, google: 'auto' },
  'zh': { name: '中文', deepl: 'ZH', google: 'zh-CN' },
  'zh-TW': { name: '繁体中文', deepl: 'ZH', google: 'zh-TW' },
  'en': { name: 'English', deepl: 'EN', google: 'en' },
  'ja': { name: '日本語', deepl: 'JA', google: 'ja' },
  'ko': { name: '한국어', deepl: 'KO', google: 'ko' },
  'fr': { name: 'Français', deepl: 'FR', google: 'fr' },
  'de': { name: 'Deutsch', deepl: 'DE', google: 'de' },
  'es': { name: 'Español', deepl: 'ES', google: 'es' },
  'ru': { name: 'Русский', deepl: 'RU', google: 'ru' },
  'pt': { name: 'Português', deepl: 'PT', google: 'pt' },
  'it': { name: 'Italiano', deepl: 'IT', google: 'it' },
  'ar': { name: 'العربية', deepl: null, google: 'ar' },
  'th': { name: 'ไทย', deepl: null, google: 'th' },
  'vi': { name: 'Tiếng Việt', deepl: null, google: 'vi' },
  'pa': { name: 'ਪੰਜਾਬੀ', deepl: null, google: 'pa' },
};

export function getLanguageName(code) {
  return LANGUAGE_CODES[code]?.name || code;
}

export default BaseProvider;
