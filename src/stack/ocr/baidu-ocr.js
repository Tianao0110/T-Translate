// Baidu OCR — https://ai.baidu.com/tech/ocr
// Stack port of src/providers/ocr/baidu-ocr.js — network via rtFetch.

import { BaseOCREngine, _t } from './base.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';
const logger = createLogger('BaiduOCR');

class BaiduOCREngine extends BaseOCREngine {
  static metadata = {
    id: 'baidu-ocr',
    name: '百度 OCR',
    description: '百度智能云文字识别，中文识别效果好',
    type: 'online',
    tier: 3,
    priority: 33,
    isOnline: true,
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: '24位 API Key',
        encrypted: true,
      },
      secretKey: {
        type: 'password',
        label: 'Secret Key',
        required: true,
        placeholder: '32位 Secret Key',
        encrypted: true,
      },
    },
    helpUrl: 'https://console.bce.baidu.com/ai/#/ai/ocr/overview/index',
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      secretKey: '',
      ...config,
    });
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  async isAvailable() {
    return !!(this.config.apiKey && this.config.secretKey);
  }

  async getAccessToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry) {
      return this._accessToken;
    }

    const { apiKey, secretKey } = this.config;

    const response = await rtFetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      throw new Error(`获取 token 失败: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    this._accessToken = data.access_token;
    // Baidu tokens last 30 days; refresh 1 day early so we don't race the expiry
    this._tokenExpiry = Date.now() + (data.expires_in - 86400) * 1000;

    return this._accessToken;
  }

  async recognize(input, options = {}) {
    const { apiKey, secretKey } = this.config;

    if (!apiKey || !secretKey) {
      return { success: false, error: _t('providerError.ocrNotConfigured', '请配置该 OCR 引擎的密钥') };
    }

    try {
      const accessToken = await this.getAccessToken();
      const base64Data = this.ensureBase64(input);
      // Baidu expects bare base64 form-encoded, not a data: URL
      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

      // accurate_basic = high-accuracy general OCR (slower but more reliable than basicGeneral)
      const apiUrl = `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${accessToken}`;

      const formData = new URLSearchParams();
      formData.append('image', pureBase64);
      formData.append('detect_direction', 'true');
      formData.append('paragraph', 'true');

      const response = await rtFetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.error_code) {
        throw new Error(data.error_msg || `错误码: ${data.error_code}`);
      }

      const wordsResult = data.words_result || [];
      if (wordsResult.length === 0) {
        return { success: false, error: _t('providerError.ocrNoText', '未识别到文字') };
      }

      const text = wordsResult.map(item => item.words).join('\n');

      return {
        success: true,
        text: this.cleanText(text),
        engine: 'baidu-ocr',
        wordsCount: data.words_result_num,
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default BaiduOCREngine;
