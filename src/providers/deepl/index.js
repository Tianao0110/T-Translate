// src/providers/deepl/index.js
// DeepL 翻译源 - 专业翻译 API

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';

/**
 * DeepL 翻译源
 * 专业翻译 API，质量极高
 */
class DeepLProvider extends BaseProvider {
  
  static metadata = {
    id: 'deepl',
    name: 'DeepL',
    description: '专业翻译 API，翻译质量极高',
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
        label: '使用免费 API（Key 以 :fx 结尾）',
        default: true,
        required: false,
      },
    },
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      useFreeApi: true,
      formality: 'default',
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
    return false;  // DeepL API 不支持流式
  }

  /**
   * 获取 API 基础地址
   */
  get baseUrl() {
    // 检查是否是免费 API Key（以 :fx 结尾）
    const isFreeKey = this.config.apiKey?.endsWith(':fx');
    const useFree = this.config.useFreeApi || isFreeKey;
    
    return useFree 
      ? 'https://api-free.deepl.com/v2'
      : 'https://api.deepl.com/v2';
  }

  /**
   * 转换语言代码为 DeepL 格式
   */
  _convertLangCode(code, isTarget = false) {
    const mapping = {
      'auto': null,
      'zh': 'ZH',
      'zh-TW': 'ZH',  // DeepL 不区分简繁
      'en': isTarget ? 'EN-US' : 'EN',  // 目标语言需要指定变体
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
    };
    
    return mapping[code] || code?.toUpperCase();
  }

  /**
   * 翻译文本
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }

    try {
      const params = new URLSearchParams();
      params.append('text', text);
      params.append('target_lang', this._convertLangCode(targetLang, true));
      
      // 源语言（auto 时不传）
      if (sourceLang !== 'auto') {
        params.append('source_lang', this._convertLangCode(sourceLang, false));
      }
      
      // 正式程度（仅部分语言支持）
      if (this.config.formality && this.config.formality !== 'default') {
        params.append('formality', this.config.formality);
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
        return { success: false, error: 'API Key 无效或已过期' };
      }

      if (response.status === 456) {
        return { success: false, error: '配额已用完' };
      }

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `DeepL 错误: ${response.status} - ${errorText}` };
      }

      const data = await response.json();
      const translatedText = data.translations?.[0]?.text;

      if (!translatedText) {
        return { success: false, error: '翻译结果为空' };
      }

      return {
        success: true,
        text: translatedText,
        detectedLang: data.translations?.[0]?.detected_source_language,
      };
    } catch (error) {
      this._lastError = error;
      
      if (error.name === 'AbortError') {
        return { success: false, error: '请求超时' };
      }
      
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/usage`, {
        method: 'GET',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 403) {
        return { success: false, message: 'API Key 无效' };
      }

      if (!response.ok) {
        return { success: false, message: `连接失败: ${response.status}` };
      }

      const data = await response.json();
      const used = data.character_count || 0;
      const limit = data.character_limit || 0;
      const remaining = limit - used;
      
      return {
        success: true,
        message: `连接成功，剩余字符: ${remaining.toLocaleString()} / ${limit.toLocaleString()}`,
        usage: { used, limit, remaining },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || '连接失败',
      };
    }
  }

  /**
   * 获取使用量
   */
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

  /**
   * 获取支持的语言列表
   */
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
