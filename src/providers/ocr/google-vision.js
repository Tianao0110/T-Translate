// src/providers/ocr/google-vision.js
// Google Cloud Vision OCR 引擎

import { BaseOCREngine } from './base.js';

/**
 * Google Cloud Vision OCR 引擎
 * https://cloud.google.com/vision/docs/ocr
 */
class GoogleVisionEngine extends BaseOCREngine {
  static metadata = {
    id: 'google-vision',
    name: 'Google Vision',
    description: 'Google Cloud Vision API，识别精度高',
    type: 'online',
    tier: 3,
    priority: 31,
    isOnline: true,
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'AIzaSy...',
        encrypted: true,
      },
    },
    helpUrl: 'https://cloud.google.com/vision/docs/setup',
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      ...config,
    });
  }

  async isAvailable() {
    return !!this.config.apiKey;
  }

  async recognize(input, options = {}) {
    const { apiKey } = this.config;
    
    if (!apiKey) {
      return { success: false, error: '请配置 Google Vision API Key' };
    }

    try {
      const base64Data = this.ensureBase64(input);
      // 移除 data URL 前缀
      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

      const requestBody = {
        requests: [
          {
            image: {
              content: pureBase64,
            },
            features: [
              {
                type: 'TEXT_DETECTION',
                maxResults: 1,
              },
            ],
            imageContext: {
              languageHints: options.languages || ['zh', 'en', 'ja'],
            },
          },
        ],
      };

      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.responses?.[0];

      if (result?.error) {
        throw new Error(result.error.message);
      }

      const textAnnotations = result?.textAnnotations;
      if (!textAnnotations || textAnnotations.length === 0) {
        return { success: false, error: '未识别到文字' };
      }

      // 第一个 annotation 是完整文本
      const fullText = textAnnotations[0]?.description || '';

      return {
        success: true,
        text: this.cleanText(fullText),
        engine: 'google-vision',
        locale: textAnnotations[0]?.locale,
      };
    } catch (error) {
      console.error('[GoogleVision] Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default GoogleVisionEngine;
