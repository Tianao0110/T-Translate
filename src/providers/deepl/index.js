// DeepL translation provider.

import { BaseProvider, _t } from '../base.js';
import icon from './icon.svg';

class DeepLProvider extends BaseProvider {

  static metadata = {
    id: 'deepl',
    name: 'DeepL',
    description: 'Professional translation API, excellent quality',
    icon: icon,
    color: '#0f2b46',
    type: 'api',
    helpUrl: 'https://www.deepl.com/pro-api',

    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
        encrypted: true,
      },
      useFreeApi: {
        type: 'checkbox',
        label: 'Use Free API (Key ending with :fx)',
        default: true,
        required: false,
      },
    },
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      useFreeApi: true,
      ...config,
    });
  }

  get latencyLevel() {
    return 'fast';
  }

  get requiresNetwork() {
    return true;
  }

  get supportsStreaming() {
    return false;
  }

  // Free-tier keys end in ":fx" and use a different host. Treat either explicit
  // useFreeApi flag or the :fx suffix as free.
  get baseUrl() {
    const isFreeKey = this.config.apiKey?.endsWith(':fx');
    const useFree = this.config.useFreeApi || isFreeKey;

    return useFree
      ? 'https://api-free.deepl.com/v2'
      : 'https://api.deepl.com/v2';
  }

  _convertLangCode(code, isTarget = false) {
    const mapping = {
      'auto': null,
      'zh': 'ZH',
      'zh-TW': 'ZH', // DeepL has no Traditional Chinese — both map to ZH
      'en': isTarget ? 'EN-US' : 'EN', // target needs an explicit regional variant
      'ja': 'JA',
      'ko': 'KO',
      'fr': 'FR',
      'de': 'DE',
      'es': 'ES',
      'ru': 'RU',
      'pt': isTarget ? 'PT-BR' : 'PT',
      'it': 'IT',
      'nl': 'NL',
      'pl': 'PL',
      'ar': 'AR',
      'th': 'TH',
      'vi': 'VI',
    };

    // Unmapped (e.g. Punjabi) returns null — the caller reports a friendly
    // "unsupported language" instead of blindly upper-casing and 400-ing.
    return mapping[code] ?? null;
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: _t('providerError.emptyText', '文本为空') };
    }

    if (!this.config.apiKey) {
      return { success: false, error: _t('providerError.notConfigured', '未配置 API Key') };
    }

    // Reject languages DeepL doesn't support before spending a request. Flagged
    // skipFailureCount so one unsupported pick (e.g. Punjabi) doesn't rack up
    // failures and get DeepL benched for every other language this session.
    const targetCode = this._convertLangCode(targetLang, true);
    if (!targetCode) {
      return { success: false, error: _t('providerError.unsupportedTargetLang', '所选目标语言不受支持'), skipFailureCount: true };
    }
    let sourceCode = null;
    if (sourceLang !== 'auto') {
      sourceCode = this._convertLangCode(sourceLang, false);
      if (!sourceCode) {
        return { success: false, error: _t('providerError.unsupportedSourceLang', '所选源语言不受支持'), skipFailureCount: true };
      }
    }

    try {
      const params = new URLSearchParams();
      params.append('text', text);
      params.append('target_lang', targetCode);

      // Omit source_lang for auto-detect
      if (sourceCode) {
        params.append('source_lang', sourceCode);
      }

      const response = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: AbortSignal.timeout(15000),
      });

      if (response.status === 403) {
        return { success: false, error: _t('providerError.keyInvalidExpired', 'API Key 无效或已过期') };
      }

      // DeepL-specific: 456 = quota exhausted (unique to their API)
      if (response.status === 456) {
        return { success: false, error: _t('providerError.quotaExhausted', '配额已用完') };
      }

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: _t('providerError.providerErrorStatus', `DeepL 错误: ${response.status}`, { provider: 'DeepL', status: response.status }) + ` - ${errorText}` };
      }

      const data = await response.json();
      const translatedText = data.translations?.[0]?.text;

      if (!translatedText) {
        return { success: false, error: _t('providerError.noResult', '翻译结果为空') };
      }

      return {
        success: true,
        text: translatedText,
        detectedLang: data.translations?.[0]?.detected_source_language,
      };
    } catch (error) {
      this._lastError = error;

      // AbortSignal.timeout() rejects with a TimeoutError (not AbortError),
      // so the old AbortError check never matched and timeouts fell through
      // to the generic branch.
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return { success: false, error: _t('providerError.timeout', '请求超时') };
      }

      return {
        success: false,
        error: error.message || _t('providerError.unknownError', '未知错误'),
      };
    }
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: _t('providerError.notConfigured', '未配置 API Key') };
    }

    try {
      // /usage is the cheapest endpoint and surfaces quota info as a bonus
      const response = await fetch(`${this.baseUrl}/usage`, {
        method: 'GET',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 403) {
        return { success: false, message: _t('providerError.keyInvalid', 'API Key 无效') };
      }

      if (!response.ok) {
        return { success: false, message: _t('providerError.connectFailedStatus', `连接失败: ${response.status}`, { status: response.status }) };
      }

      const data = await response.json();
      const used = data.character_count || 0;
      const limit = data.character_limit || 0;
      const remaining = limit - used;

      return {
        success: true,
        message: `${_t('providerError.connectSuccess', '连接成功')} (${remaining.toLocaleString()} / ${limit.toLocaleString()})`,
        usage: { used, limit, remaining },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || _t('providerError.connectFailed', '连接失败'),
      };
    }
  }

  async getUsage() {
    if (!this.config.apiKey) return null;

    try {
      const response = await fetch(`${this.baseUrl}/usage`, {
        method: 'GET',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        used: data.character_count || 0,
        limit: data.character_limit || 0,
        remaining: (data.character_limit || 0) - (data.character_count || 0),
      };
    } catch {
      return null;
    }
  }

  async getSupportedLanguages() {
    if (!this.config.apiKey) return [];

    try {
      const response = await fetch(`${this.baseUrl}/languages`, {
        method: 'GET',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.map(lang => ({
        code: lang.language,
        name: lang.name,
        supportsFormality: lang.supports_formality || false,
      }));
    } catch {
      return [];
    }
  }
}

export default DeepLProvider;
