// Azure Computer Vision OCR (Read API v3.2). Asynchronous: submit, then poll.

import { BaseOCREngine, _t } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('AzureOCR');

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
      return { success: false, error: _t('providerError.ocrNotConfigured', '请配置该 OCR 引擎的密钥') };
    }

    try {
      const base64Data = this.ensureBase64(input);
      // Read API wants raw bytes, not base64
      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const imageBytes = Uint8Array.from(atob(pureBase64), c => c.charCodeAt(0));

      const apiUrl = `${endpoint.replace(/\/$/, '')}/vision/v3.2/read/analyze`;

      // Phase 1: submit. Returns 202 with the result URL in Operation-Location.
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

      const operationLocation = response.headers.get('Operation-Location');
      if (!operationLocation) {
        throw new Error(_t('providerError.ocrProcessFailed', 'OCR 处理失败'));
      }

      // Phase 2: poll. Azure returns 'running' until done; 10s budget at 1s intervals.
      let result;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const resultResponse = await fetch(operationLocation, {
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
          },
        });

        if (!resultResponse.ok) {
          throw new Error(_t('providerError.httpError', `HTTP ${resultResponse.status}`, { status: resultResponse.status }));
        }

        result = await resultResponse.json();

        if (result.status === 'succeeded') {
          break;
        } else if (result.status === 'failed') {
          throw new Error(result.error?.message || _t('providerError.ocrProcessFailed', 'OCR 处理失败'));
        }
      }

      if (result.status !== 'succeeded') {
        throw new Error(_t('providerError.ocrTimeout', 'OCR 处理超时'));
      }

      const readResults = result.analyzeResult?.readResults || [];
      const lines = [];

      for (const page of readResults) {
        for (const line of page.lines || []) {
          lines.push(line.text);
        }
      }

      const text = lines.join('\n');

      if (!text) {
        return { success: false, error: _t('providerError.ocrNoText', '未识别到文字') };
      }

      return {
        success: true,
        text: this.cleanText(text),
        engine: 'azure-ocr',
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default AzureOCREngine;
