// src/providers/baidu-translate/index.js
// 百度翻译 API
// 免费额度：标准版每月 5 万字符，高级版每月 100 万字符
// 国内无需代理

import { BaseProvider } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';

const logger = createLogger('BaiduTranslate');

/**
 * 百度翻译 API
 * 使用通用翻译 API
 */
class BaiduTranslateProvider extends BaseProvider {

  static metadata = {
    id: 'baidu-translate',
    name: 'Baidu Translate',
    description: 'Baidu Translate API, direct access in China, free tier',
    icon: icon,
    color: '#3385ff',
    type: 'api',
    helpUrl: 'https://fanyi-api.baidu.com/',

    configSchema: {
      appId: {
        type: 'text',
        label: 'APP ID',
        default: '',
        required: true,
        placeholder: 'Baidu Translate APP ID',
      },
      secretKey: {
        type: 'password',
        label: 'Secret Key',
        default: '',
        required: true,
        placeholder: 'Baidu Translate Secret Key',
        encrypted: true,
      },
    },
  };

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

  // ========== 语言代码映射 ==========

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

  // ========== MD5 签名 ==========

  async _md5(str) {
    // 使用 Web Crypto API 计算 MD5
    // 注意: MD5 不在 SubtleCrypto 中，回退到手动实现
    return this._md5Manual(str);
  }

  /**
   * 简易 MD5 实现（百度 API 签名用）
   */
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

    // 百度要求 UTF-8 编码，先转换
    const utf8 = unescape(encodeURIComponent(string));
    return hex(md51(utf8));
  }

  // ========== 翻译 ==========

  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }
    if (!this.config.appId || !this.config.secretKey) {
      return { success: false, error: '未配置 APP ID 或密钥' };
    }

    try {
      const from = this._mapLanguageCode(sourceLang);
      const to = this._mapLanguageCode(targetLang);
      const salt = Date.now().toString();
      const sign = this._md5Manual(`${this.config.appId}${text}${salt}${this.config.secretKey}`);

      const params = new URLSearchParams({
        q: text,
        from,
        to,
        appid: this.config.appId,
        salt,
        sign,
      });

      const response = await fetch(
        `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(this.config.timeout),
        }
      );

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();

      // 百度 API 错误码
      if (data.error_code) {
        const errorMessages = {
          '52001': '请求超时',
          '52002': '系统错误',
          '52003': '未授权用户 (APP ID 无效)',
          '54000': '必填参数为空',
          '54001': '签名错误 (请检查密钥)',
          '54003': '访问频率受限',
          '54004': '账户余额不足',
          '54005': '长 query 频率限制',
          '58000': '客户端 IP 非法',
          '58001': '语言方向不支持',
          '58002': '服务已关闭',
          '90107': '认证未通过或未生效',
        };
        return {
          success: false,
          error: errorMessages[data.error_code] || `百度 API 错误: ${data.error_code} - ${data.error_msg}`,
        };
      }

      const translatedText = data.trans_result?.map(r => r.dst).join('\n');

      if (!translatedText) {
        return { success: false, error: '无翻译结果' };
      }

      return {
        success: true,
        text: translatedText,
        provider: 'baidu-translate',
        detectedLang: data.from,
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
    if (!this.config.appId || !this.config.secretKey) {
      return { success: false, message: '未配置 APP ID 或密钥' };
    }

    try {
      const result = await this.translate('test', 'en', 'zh');
      if (result.success) {
        return { success: true, message: '百度翻译连接成功' };
      }
      return { success: false, message: result.error || '测试失败' };
    } catch (error) {
      return { success: false, message: error.message || '连接失败' };
    }
  }
}

export default BaiduTranslateProvider;
