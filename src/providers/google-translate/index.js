// src/providers/google-translate/index.js
// Google Translate 免费翻译源
// 使用非官方 API，无需 Key

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';

/**
 * Google Translate 免费翻译源
 * 使用 translate.google.com 的非官方 API
 */
class GoogleTranslateProvider extends BaseProvider {
  
  static metadata = {
    id: 'google-translate',
    name: 'Google 翻译',
    description: '免费使用，支持语言多，速度快',
    icon: icon,
    color: '#4285f4',
    type: 'traditional',
    helpUrl: 'https://translate.google.com',
    
    configSchema: {
      domain: {
        type: 'select',
        label: '服务器',
        default: 'com',
        options: [
          { value: 'com', label: 'google.com (国际)' },
          { value: 'cn', label: 'google.cn (中国)' },
          { value: 'com.hk', label: 'google.com.hk (香港)' },
        ],
      },
    },
  };

  constructor(config = {}) {
    super({
      domain: 'com',
      timeout: 15000,
      ...config,
    });
    
    // TKK 参数缓存
    this._tkk = '0.0';
  }

  get latencyLevel() {
    return 'fast';
  }

  get requiresNetwork() {
    return true;
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const response = await fetch(`https://translate.google.${this.config.domain}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      return { success: response.ok, message: response.ok ? 'Google 翻译可用' : '连接失败' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 翻译文本
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    try {
      const sl = this._mapLanguageCode(sourceLang);
      const tl = this._mapLanguageCode(targetLang);
      
      // 计算 tk 参数
      const tk = this._generateTk(text);
      
      // 构建请求 URL
      const baseUrl = `https://translate.google.${this.config.domain}`;
      const params = new URLSearchParams({
        client: 'gtx',
        sl: sl,
        tl: tl,
        hl: tl,
        dt: 't',      // 翻译结果
        dt: 'bd',     // 词典
        ie: 'UTF-8',
        oe: 'UTF-8',
        tk: tk,
        q: text,
      });

      // 对于长文本使用 POST
      const usePost = text.length > 1500;
      
      let response;
      if (usePost) {
        response = await fetch(`${baseUrl}/translate_a/single?${params.toString().replace(/&q=[^&]*/, '')}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `q=${encodeURIComponent(text)}`,
          signal: AbortSignal.timeout(this.config.timeout),
        });
      } else {
        response = await fetch(`${baseUrl}/translate_a/single?${params.toString()}`, {
          method: 'GET',
          signal: AbortSignal.timeout(this.config.timeout),
        });
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      
      // 解析响应
      const translatedText = this._parseResponse(data);
      
      if (!translatedText) {
        return { success: false, error: '无翻译结果' };
      }

      // 检测到的源语言
      const detectedLang = data[8]?.[0]?.[0] || sourceLang;

      return {
        success: true,
        text: translatedText,
        provider: 'google-translate',
        detectedLang: detectedLang,
      };
    } catch (error) {
      console.error('[GoogleTranslate] Translation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 解析翻译响应
   */
  _parseResponse(data) {
    if (!data || !data[0]) return '';

    let result = '';
    const sentences = data[0];
    
    for (const sentence of sentences) {
      if (sentence && sentence[0]) {
        result += sentence[0];
      }
    }

    return result;
  }

  /**
   * 映射语言代码
   */
  _mapLanguageCode(code) {
    const mapping = {
      'auto': 'auto',
      'zh': 'zh-CN',
      'zh-TW': 'zh-TW',
      'en': 'en',
      'ja': 'ja',
      'ko': 'ko',
      'es': 'es',
      'fr': 'fr',
      'de': 'de',
      'ru': 'ru',
      'ar': 'ar',
      'pt': 'pt',
      'it': 'it',
      'vi': 'vi',
      'th': 'th',
    };
    return mapping[code] || code;
  }

  /**
   * 生成 tk 参数
   * 基于 QTranslate 的实现
   */
  _generateTk(text) {
    const tkk = this._tkk.split('.');
    const a = Number(tkk[0]) || 0;
    
    const b = [];
    let d = 0;
    
    for (let e = 0; e < text.length; e++) {
      let f = text.charCodeAt(e);
      
      if (128 > f) {
        b[d++] = f;
      } else if (2048 > f) {
        b[d++] = (f >> 6) | 192;
        b[d++] = (f & 63) | 128;
      } else if (
        55296 === (f & 64512) &&
        e + 1 < text.length &&
        56320 === (text.charCodeAt(e + 1) & 64512)
      ) {
        f = 65536 + ((f & 1023) << 10) + (text.charCodeAt(++e) & 1023);
        b[d++] = (f >> 18) | 240;
        b[d++] = ((f >> 12) & 63) | 128;
        b[d++] = ((f >> 6) & 63) | 128;
        b[d++] = (f & 63) | 128;
      } else {
        b[d++] = (f >> 12) | 224;
        b[d++] = ((f >> 6) & 63) | 128;
        b[d++] = (f & 63) | 128;
      }
    }

    let result = a;
    for (let i = 0; i < b.length; i++) {
      result += b[i];
      result = this._xr(result, '+-a^+6');
    }
    result = this._xr(result, '+-3^+b+-f');
    result ^= Number(tkk[1]) || 0;
    
    if (0 > result) {
      result = (result & 2147483647) + 2147483648;
    }
    
    result %= 1e6;
    return result.toString() + '.' + (result ^ a);
  }

  /**
   * tk 辅助函数
   */
  _xr(a, b) {
    for (let c = 0; c < b.length - 2; c += 3) {
      let d = b.charAt(c + 2);
      d = 'a' <= d ? d.charCodeAt(0) - 87 : Number(d);
      d = '+' === b.charAt(c + 1) ? a >>> d : a << d;
      a = '+' === b.charAt(c) ? (a + d) & 4294967295 : a ^ d;
    }
    return a;
  }
}

export default GoogleTranslateProvider;
