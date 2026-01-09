// src/providers/ocr/azure-ocr.js
// Azure Computer Vision OCR 引擎

import { BaseOCREngine } from './base.js';

/**
 * Azure Computer Vision OCR 引擎
 * https://docs.microsoft.com/azure/cognitive-services/computer-vision/overview-ocr
 */
class AzureOCREngine extends BaseOCREngine {
  static metadata = {
    id: 'azure-ocr',
    name: 'Azure OCR',
    description: 'Microsoft Azure Computer Vision OCR',
    type: 'online',
    tier: 3,
    priority: 32,
    isOnline: true,
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: '32位密钥...',
        encrypted: true,
      },
      endpoint: {
        type: 'text',
        label: 'Endpoint',
        required: true,
        placeholder: 'https://xxx.cognitiveservices.azure.com/',
        default: '',
      },
    },
    helpUrl: 'https://azure.microsoft.com/products/ai-services/ai-vision',
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      endpoint: '',
      ...config,
    });
  }

  async isAvailable() {
    return !!(this.config.apiKey && this.config.endpoint);
  }

  async recognize(input, options = {}) {
    const { apiKey, endpoint } = this.config;
    
    if (!apiKey || !endpoint) {
      return { success: false, error: '请配置 Azure OCR API Key 和 Endpoint' };
    }

    try {
      const base64Data = this.ensureBase64(input);
      // 移除 data URL 前缀
      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const imageBytes = Uint8Array.from(atob(pureBase64), c => c.charCodeAt(0));

      // 使用 Read API（OCR 3.2）
      const apiUrl = `${endpoint.replace(/\/$/, '')}/vision/v3.2/read/analyze`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Ocp-Apim-Subscription-Key': apiKey,
        },
        body: imageBytes,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      // 获取操作位置
      const operationLocation = response.headers.get('Operation-Location');
      if (!operationLocation) {
        throw new Error('未获取到操作位置');
      }

      // 轮询获取结果
      let result;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const resultResponse = await fetch(operationLocation, {
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
          },
        });

        if (!resultResponse.ok) {
          throw new Error(`获取结果失败: HTTP ${resultResponse.status}`);
        }

        result = await resultResponse.json();
        
        if (result.status === 'succeeded') {
          break;
        } else if (result.status === 'failed') {
          throw new Error(result.error?.message || 'OCR 处理失败');
        }
      }

      if (result.status !== 'succeeded') {
        throw new Error('OCR 处理超时');
      }

      // 提取文本
      const readResults = result.analyzeResult?.readResults || [];
      const lines = [];
      
      for (const page of readResults) {
        for (const line of page.lines || []) {
          lines.push(line.text);
        }
      }

      const text = lines.join('\n');

      if (!text) {
        return { success: false, error: '未识别到文字' };
      }

      return {
        success: true,
        text: this.cleanText(text),
        engine: 'azure-ocr',
      };
    } catch (error) {
      console.error('[AzureOCR] Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default AzureOCREngine;
