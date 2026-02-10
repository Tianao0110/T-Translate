// src/providers/ocr/ocrspace.js
// OCR.space API 引擎

import { BaseOCREngine } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('OCRSpace');

/**
 * OCR.space API 引擎
 * https://ocr.space/ocrapi
 */
class OCRSpaceEngine extends BaseOCREngine {
  static metadata = {
    id: 'ocrspace',
    name: 'OCR.space',
    description: '免费在线 OCR API，支持多种语言',
    type: 'online',
    tier: 3,
    priority: 30,
    isOnline: true,
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'K1234567890...',
        encrypted: true,
      },
      language: {
        type: 'select',
        label: '识别语言',
        default: 'chs',
        options: [
          { value: 'chs', label: '简体中文' },
          { value: 'cht', label: '繁体中文' },
          { value: 'eng', label: 'English' },
          { value: 'jpn', label: '日本語' },
          { value: 'kor', label: '한국어' },
        ],
      },
    },
    helpUrl: 'https://ocr.space/ocrapi#free',
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      language: 'chs',
      ...config,
    });
  }

  async isAvailable() {
    return !!this.config.apiKey;
  }

  async recognize(input, options = {}) {
    const { apiKey, language } = this.config;
    
    if (!apiKey) {
      return { success: false, error: '请配置 OCR.space API Key' };
    }

    try {
      const base64Data = this.ensureBase64(input);
      
      // 构建 FormData
      const formData = new FormData();
      formData.append('apikey', apiKey);
      formData.append('language', options.language || language);
      formData.append('base64Image', base64Data);
      formData.append('isOverlayRequired', 'false');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('OCREngine', '2'); // 使用 OCR Engine 2（更准确）

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.IsErroredOnProcessing) {
        throw new Error(data.ErrorMessage?.[0] || 'OCR 处理失败');
      }

      const parsedResults = data.ParsedResults || [];
      if (parsedResults.length === 0) {
        return { success: false, error: '未识别到文字' };
      }

      const text = parsedResults.map(r => r.ParsedText).join('\n');
      
      return {
        success: true,
        text: this.cleanText(text),
        engine: 'ocrspace',
        confidence: parsedResults[0]?.TextOverlay?.Lines?.[0]?.MaxHeight || null,
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default OCRSpaceEngine;
