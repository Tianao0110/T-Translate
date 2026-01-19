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
      // 尝试实际翻译一个简单文本，比直接访问首页更可靠
      const result = await this.translate('test', 'en', 'zh');
      
      if (result.success) {
        return { success: true, message: 'Google 翻译可用' };
      } else {
        return { success: false, message: result.error || '翻译测试失败' };
      }
    } catch (error) {
      // 检查是否是网络问题
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        return { 
          success: false, 
          message: `无法连接 (${this.config.domain})，请检查网络或尝试其他服务器` 
        };
      }
      return { success: false, message: error.message || '连接失败' };
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
      
      // 构建请求 URL - 注意 dt 参数需要多次添加
      const baseUrl = `https://translate.google.${this.config.domain}`;
      const params = new URLSearchParams();
      params.append('client', 'gtx');
      params.append('sl', sl);
      params.append('tl', tl);
      params.append('hl', tl);
      params.append('dt', 't');   // 翻译文本
      params.append('dt', 'bd');  // 词典
      params.append('dt', 'at');  // 替代翻译
      params.append('ie', 'UTF-8');
      params.append('oe', 'UTF-8');
      params.append('tk', tk);
      params.append('q', text);

      // 对于长文本使用 POST
      const usePost = text.length > 1500;
      
      let response;
      if (usePost) {
        const paramsWithoutQ = new URLSearchParams(params);
        paramsWithoutQ.delete('q');
        response = await fetch(`${baseUrl}/translate_a/single?${paramsWithoutQ.toString()}`, {
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
      const detectedLang = data[2] || sourceLang;

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
    if (!data) return '';
    
    // 尝试多种解析方式
    let result = '';
    
    // 方式 1: 标准格式 data[0] 是句子数组
    if (Array.isArray(data[0])) {
      for (const sentence of data[0]) {
        if (Array.isArray(sentence) && sentence[0]) {
          result += sentence[0];
        }
      }
    }
    
    // 方式 2: 直接字符串
    if (!result && typeof data[0] === 'string') {
      result = data[0];
    }
    
    // 方式 3: 嵌套更深
    if (!result && data[0]?.[0]?.[0]) {
      result = data[0][0][0];
    }
    
    return result.trim();
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
