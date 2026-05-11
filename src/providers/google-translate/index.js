// Google Translate via the unofficial translate.google.com web API (no key needed).

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';
const logger = createLogger('GoogleTranslate');

class GoogleTranslateProvider extends BaseProvider {

  static metadata = {
    id: 'google-translate',
    name: 'Google Translate',
    description: 'Free to use, many languages, fast',
    icon: icon,
    color: '#4285f4',
    type: 'traditional',
    helpUrl: 'https://translate.google.com',

    configSchema: {
      domain: {
        type: 'select',
        label: 'Server',
        default: 'com',
        options: [
          { value: 'com', label: 'google.com (International)' },
          { value: 'cn', label: 'google.cn (China)' },
          { value: 'com.hk', label: 'google.com.hk (Hong Kong)' },
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

    // TKK seed — the unofficial API derives tk from this. '0.0' works for most
    // request volumes; a real scraper would fetch it from translate.google.com
    this._tkk = '0.0';
  }

  get latencyLevel() {
    return 'fast';
  }

  get requiresNetwork() {
    return true;
  }

  async testConnection() {
    try {
      // Round-trip an actual translation — homepage probes don't catch API blocks
      const result = await this.translate('test', 'en', 'zh');

      if (result.success) {
        return { success: true, message: 'Google 翻译可用' };
      } else {
        return { success: false, message: result.error || '翻译测试失败' };
      }
    } catch (error) {
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        return {
          success: false,
          message: `无法连接 (${this.config.domain})，请检查网络或尝试其他服务器`
        };
      }
      return { success: false, message: error.message || '连接失败' };
    }
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    try {
      const sl = this._mapLanguageCode(sourceLang);
      const tl = this._mapLanguageCode(targetLang);

      const tk = this._generateTk(text);

      const baseUrl = `https://translate.google.${this.config.domain}`;
      const params = new URLSearchParams();
      params.append('client', 'gtx');
      params.append('sl', sl);
      params.append('tl', tl);
      params.append('hl', tl);
      // Repeated dt= asks the API for: translation text, dictionary, alternates
      params.append('dt', 't');
      params.append('dt', 'bd');
      params.append('dt', 'at');
      params.append('ie', 'UTF-8');
      params.append('oe', 'UTF-8');
      params.append('tk', tk);
      params.append('q', text);

      // URL length limit for GET: switch to POST for long bodies
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

      const translatedText = this._parseResponse(data);

      if (!translatedText) {
        return { success: false, error: '无翻译结果' };
      }

      // data[2] holds the auto-detected source language
      const detectedLang = data[2] || sourceLang;

      return {
        success: true,
        text: translatedText,
        provider: 'google-translate',
        detectedLang: detectedLang,
      };
    } catch (error) {
      logger.error('Translation error:', error);
      return { success: false, error: error.message };
    }
  }

  // Response shape varies — older API versions return nested arrays of sentence
  // chunks, newer return concatenated string. Handle all three observed forms.
  _parseResponse(data) {
    if (!data) return '';

    let result = '';

    if (Array.isArray(data[0])) {
      for (const sentence of data[0]) {
        if (Array.isArray(sentence) && sentence[0]) {
          result += sentence[0];
        }
      }
    }

    if (!result && typeof data[0] === 'string') {
      result = data[0];
    }

    if (!result && data[0]?.[0]?.[0]) {
      result = data[0][0][0];
    }

    return result.trim();
  }

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

  // tk parameter computation. Reverse-engineered from translate.google.com's
  // bundled JS (QTranslate's implementation). Don't touch the bit-magic — the
  // algorithm has to match Google's exactly or the API returns 403.
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
