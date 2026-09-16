// OCR.space API engine — https://ocr.space/ocrapi

import { BaseOCREngine, _t } from './base.js';
import { unionRects, makeBlocks } from './blocks.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';
const logger = createLogger('OCRSpace');

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

  // Settings codes (zh-Hans, en, ...) -> the API's 3-letter codes; unknown /
  // auto falls back to the engine's auto behavior.
  static LANG_MAP = {
    'zh-Hans': 'chs', 'zh-Hant': 'cht', 'en': 'eng', 'ja': 'jpn', 'ko': 'kor',
    'fr': 'fre', 'de': 'ger', 'es': 'spa', 'ru': 'rus', 'ar': 'ara',
    // already-native codes pass through
    'chs': 'chs', 'cht': 'cht', 'eng': 'eng', 'jpn': 'jpn', 'kor': 'kor',
  };

  async recognize(input, options = {}) {
    const { apiKey, language } = this.config;

    if (!apiKey) {
      return { success: false, error: _t('providerError.ocrNotConfigured', '请配置该 OCR 引擎的密钥') };
    }

    try {
      const base64Data = this.ensureBase64(input);
      const rawLang = options.language || language;
      const apiLang = OCRSpaceEngine.LANG_MAP[rawLang] || 'eng';

      const formData = new FormData();
      formData.append('apikey', apiKey);
      formData.append('language', apiLang);
      formData.append('base64Image', base64Data);
      // Overlay carries the per-word boxes (response size only, no credits).
      formData.append('isOverlayRequired', 'true');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      // Engine 2: better on small / styled text.
      formData.append('OCREngine', '2');

      const response = await rtFetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.IsErroredOnProcessing) {
        throw new Error(data.ErrorMessage?.[0] || _t('providerError.ocrProcessFailed', 'OCR 处理失败'));
      }

      const parsedResults = data.ParsedResults || [];
      if (parsedResults.length === 0) {
        return { success: false, error: _t('providerError.ocrNoText', '未识别到文字') };
      }

      const text = parsedResults.map(r => r.ParsedText).join('\n');

      return {
        success: true,
        text: this.cleanText(text),
        ...this._overlayBlocks(parsedResults),
        engine: 'ocrspace',
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }

  // TextOverlay boxes words, not lines: each line's box is the union of its
  // words (blocks.js contract). Coordinates outside the capture frame are
  // dropped downstream.
  _overlayBlocks(parsedResults) {
    const lines = [];
    for (const result of parsedResults) {
      for (const line of result?.TextOverlay?.Lines || []) {
        const rects = (line.Words || []).map(w => ({
          x: w.Left, y: w.Top, width: w.Width, height: w.Height,
        }));
        lines.push({
          text: line.LineText || (line.Words || []).map(w => w.WordText).join(' '),
          bbox: unionRects(rects),
        });
      }
    }
    const blocks = makeBlocks(lines);
    return blocks.length ? { blocks, rawBlocks: blocks } : {};
  }
}

export default OCRSpaceEngine;
