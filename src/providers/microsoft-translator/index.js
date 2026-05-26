// Microsoft Translator (Azure Cognitive Services).
// Free tier: 2M chars/month.

import { BaseProvider } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';

const logger = createLogger('MicrosoftTranslator');

class MicrosoftTranslatorProvider extends BaseProvider {

  static metadata = {
    id: 'microsoft-translator',
    name: 'Microsoft Translator',
    description: 'Microsoft Translator API, 2M chars/month free',
    icon: icon,
    color: '#0078d4',
    type: 'api',
    helpUrl: 'https://learn.microsoft.com/azure/cognitive-services/translator/',

    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        default: '',
        required: true,
        placeholder: 'Azure Translator API Key',
        encrypted: true,
      },
      region: {
        type: 'text',
        label: 'Region',
        default: 'global',
        required: false,
        placeholder: 'global (or eastasia, westus2, etc.)',
      },
    },
  };

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
      'ar': 'ar',
      'th': 'th',
      'vi': 'vi',
      'pa': 'pa',
    };
    return mapping[code] || code;
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }
    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
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

      const response = await fetch(
        `https://api.cognitive.microsofttranslator.com/translate?${params.toString()}`,
        {
          method: 'POST',
          headers,
          // Body is an array — Azure supports batch in one call
          body: JSON.stringify([{ Text: text }]),
          signal: AbortSignal.timeout(this.config.timeout),
        }
      );

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: 'API Key 无效或权限不足' };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.error?.message || `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const translatedText = data[0]?.translations?.[0]?.text;

      if (!translatedText) {
        return { success: false, error: '无翻译结果' };
      }

      return {
        success: true,
        text: translatedText,
        provider: 'microsoft-translator',
        detectedLang: data[0]?.detectedLanguage?.language,
      };
    } catch (error) {
      logger.error('Translation error:', error);
      if (error.name === 'AbortError') {
        return { success: false, error: '请求超时' };
      }
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    try {
      const result = await this.translate('test', 'en', 'zh');
      if (result.success) {
        return { success: true, message: 'Microsoft 翻译连接成功' };
      }
      return { success: false, message: result.error || '测试失败' };
    } catch (error) {
      return { success: false, message: error.message || '连接失败' };
    }
  }
}

export default MicrosoftTranslatorProvider;
