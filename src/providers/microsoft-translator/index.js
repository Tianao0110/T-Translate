// src/providers/microsoft-translator/index.js
// Microsoft Translator API 翻译源
// 免费额度：每月 200 万字符

import { BaseProvider } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';

const logger = createLogger('MicrosoftTranslator');

/**
 * Microsoft Translator API
 * Azure Cognitive Services 翻译 API
 */
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

  // ========== 语言代码映射 ==========

  _mapLanguageCode(code) {
    const mapping = {
      'auto': '',  // 空字符串让 API 自动检测
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

  // ========== 翻译 ==========

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
      // 非 global 区域需要加 region header
      if (this.config.region && this.config.region !== 'global') {
        headers['Ocp-Apim-Subscription-Region'] = this.config.region;
      }

      const response = await fetch(
        `https://api.cognitive.microsofttranslator.com/translate?${params.toString()}`,
        {
          method: 'POST',
          headers,
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

  // ========== 测试连接 ==========

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
