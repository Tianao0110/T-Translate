// Microsoft Translator (Azure Cognitive Services).
// Free tier: 2M chars/month.
// Stack port of src/providers/microsoft-translator/index.js — metadata from the
// shared table, network via rtFetch; logic byte-identical.

import { BaseProvider, _t, combineSignal } from './base.js';
import { PROVIDER_METADATA } from './metadata.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';

const logger = createLogger('MicrosoftTranslator');

class MicrosoftTranslatorProvider extends BaseProvider {

  static metadata = PROVIDER_METADATA['microsoft-translator'];

  constructor(config = {}) {
    super({
      apiKey: '',
      region: 'global',
      timeout: 15000,
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

  _mapLanguageCode(code) {
    const mapping = {
      'auto': '', // Empty string == let API auto-detect
      'zh': 'zh-Hans',
      'zh-TW': 'zh-Hant',
      'en': 'en',
      'ja': 'ja',
      'ko': 'ko',
      'fr': 'fr',
      'de': 'de',
      'es': 'es',
      'ru': 'ru',
      'pt': 'pt',
      'it': 'it',
      'nl': 'nl',
      'pl': 'pl',
      'ar': 'ar',
      'th': 'th',
      'vi': 'vi',
      'pa': 'pa',
    };
    return mapping[code] || code;
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!text?.trim()) {
      return { success: false, error: _t('providerError.emptyText', '文本为空') };
    }
    if (!this.config.apiKey) {
      return { success: false, error: _t('providerError.notConfigured', '未配置 API Key') };
    }

    try {
      const from = this._mapLanguageCode(sourceLang);
      const to = this._mapLanguageCode(targetLang);

      const params = new URLSearchParams({
        'api-version': '3.0',
        'to': to,
      });
      if (from) {
        params.append('from', from);
      }

      const headers = {
        'Ocp-Apim-Subscription-Key': this.config.apiKey,
        'Content-Type': 'application/json',
      };
      // Region-bound keys require the region header; global keys don't
      if (this.config.region && this.config.region !== 'global') {
        headers['Ocp-Apim-Subscription-Region'] = this.config.region;
      }

      const response = await rtFetch(
        `https://api.cognitive.microsofttranslator.com/translate?${params.toString()}`,
        {
          method: 'POST',
          headers,
          // Body is an array — Azure supports batch in one call
          body: JSON.stringify([{ Text: text }]),
          signal: combineSignal(options.signal, this.config.timeout),
        }
      );

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: _t('providerError.keyInvalid', 'API Key 无效') };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.error?.message || _t('providerError.httpError', `HTTP ${response.status}`, { status: response.status }),
        };
      }

      const data = await response.json();
      const translatedText = data[0]?.translations?.[0]?.text;

      if (!translatedText) {
        return { success: false, error: _t('providerError.noResult', '无翻译结果') };
      }

      return {
        success: true,
        text: translatedText,
        provider: 'microsoft-translator',
        detectedLang: data[0]?.detectedLanguage?.language,
      };
    } catch (error) {
      logger.error('Translation error:', error);
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return { success: false, error: _t('providerError.timeout', '请求超时') };
      }
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: _t('providerError.notConfigured', '未配置 API Key') };
    }

    try {
      const result = await this.translate('test', 'en', 'zh');
      if (result.success) {
        return { success: true, message: _t('providerError.connectSuccess', '连接成功') };
      }
      return { success: false, message: result.error || _t('providerError.translateFailed', '测试失败') };
    } catch (error) {
      return { success: false, message: error.message || _t('providerError.connectFailed', '连接失败') };
    }
  }
}

export default MicrosoftTranslatorProvider;
