// Baidu Translate API (https://fanyi-api.baidu.com).
// Free tier: 50k chars/month standard, 1M chars/month advanced.
// Reachable inside mainland China without a proxy.
// Stack port of src/providers/baidu-translate/index.js — metadata from the
// shared table, network via rtFetch; the MD5 reference impl is untouched (any
// change breaks the request signature).

import { BaseProvider, _t } from './base.js';
import { PROVIDER_METADATA } from './metadata.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';

const logger = createLogger('BaiduTranslate');

class BaiduTranslateProvider extends BaseProvider {

  static metadata = PROVIDER_METADATA['baidu-translate'];

  constructor(config = {}) {
    super({
      appId: '',
      secretKey: '',
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

  // Baidu uses some non-BCP-47 codes (jp instead of ja, fra instead of fr, etc.)
  _mapLanguageCode(code) {
    const mapping = {
      'auto': 'auto',
      'zh': 'zh',
      'zh-TW': 'cht',
      'en': 'en',
      'ja': 'jp',
      'ko': 'kor',
      'fr': 'fra',
      'de': 'de',
      'es': 'spa',
      'ru': 'ru',
      'pt': 'pt',
      'it': 'it',
      'ar': 'ara',
      'th': 'th',
      'vi': 'vie',
      'pa': 'pan',
    };
    return mapping[code] || code;
  }

  // Standard MD5 reference impl. Don't refactor — the algorithm is fixed and
  // any change breaks the request signature.
  _md5Manual(string) {
    function md5cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function md51(s) {
      const n = s.length;
      let state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= n; i += 64) {
        md5cycle(state, md5blk(s.substring(i - 64, i)));
      }
      s = s.substring(i - 64);
      const tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { md5cycle(state, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }
    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      }
      return md5blks;
    }
    const hex_chr = '0123456789abcdef'.split('');
    function rhex(n) {
      let s = '';
      for (let j = 0; j < 4; j++) s += hex_chr[(n >> (j * 8 + 4)) & 0x0f] + hex_chr[(n >> (j * 8)) & 0x0f];
      return s;
    }
    function hex(x) { for (let i = 0; i < x.length; i++) x[i] = rhex(x[i]); return x.join(''); }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }

    // Baidu's sign field is computed over UTF-8 bytes, not raw JS strings
    const utf8 = unescape(encodeURIComponent(string));
    return hex(md51(utf8));
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: _t('providerError.emptyText', '文本为空') };
    }
    if (!this.config.appId || !this.config.secretKey) {
      return { success: false, error: _t('providerError.notConfiguredBaidu', '未配置 APP ID 或密钥') };
    }

    try {
      const from = this._mapLanguageCode(sourceLang);
      const to = this._mapLanguageCode(targetLang);
      const salt = Date.now().toString();
      // Sign formula per API docs: md5(appId + q + salt + secretKey)
      const sign = this._md5Manual(`${this.config.appId}${text}${salt}${this.config.secretKey}`);

      const params = new URLSearchParams({
        q: text,
        from,
        to,
        appid: this.config.appId,
        salt,
        sign,
      });

      // Long text as a GET query string blows the URL length limit (and hits
      // Baidu's long-query rate cap). Baidu accepts the same params as a POST
      // body, so switch over once the text is large. Threshold mirrors the
      // google provider's URL-length guard.
      const usesPost = text.length > 1500;
      const response = await rtFetch(
        usesPost
          ? 'https://fanyi-api.baidu.com/api/trans/vip/translate'
          : `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`,
        {
          method: usesPost ? 'POST' : 'GET',
          ...(usesPost
            ? {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
              }
            : {}),
          signal: AbortSignal.timeout(this.config.timeout),
        }
      );

      if (!response.ok) {
        return { success: false, error: _t('providerError.httpError', `HTTP ${response.status}`, { status: response.status }) };
      }

      const data = await response.json();

      // Baidu error codes → localized messages (providerError.baiduCode.*).
      if (data.error_code) {
        const mapped = _t(`providerError.baiduCode.${data.error_code}`, '');
        return {
          success: false,
          error: mapped || `${_t('providerError.providerErrorStatus', `百度 错误: ${data.error_code}`, { provider: 'Baidu', status: data.error_code })} - ${data.error_msg}`,
        };
      }

      // trans_result is one entry per paragraph; join with newlines to round-trip
      const translatedText = data.trans_result?.map(r => r.dst).join('\n');

      if (!translatedText) {
        return { success: false, error: _t('providerError.noResult', '无翻译结果') };
      }

      return {
        success: true,
        text: translatedText,
        provider: 'baidu-translate',
        detectedLang: data.from,
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
    if (!this.config.appId || !this.config.secretKey) {
      return { success: false, message: _t('providerError.notConfiguredBaidu', '未配置 APP ID 或密钥') };
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

export default BaiduTranslateProvider;
