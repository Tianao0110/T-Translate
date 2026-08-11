// Google Cloud Vision OCR — https://cloud.google.com/vision/docs/ocr
// Stack port of src/providers/ocr/google-vision.js — network via rtFetch.

import { BaseOCREngine, _t } from './base.js';
import { rectFromPoints, makeBlocks } from './blocks.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';
const logger = createLogger('GoogleVision');

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
      return { success: false, error: _t('providerError.ocrNotConfigured', '请配置该 OCR 引擎的密钥') };
    }

    try {
      const base64Data = this.ensureBase64(input);
      // Vision API wants bare base64 — no data: URL wrapper
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

      const response = await rtFetch(
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
        return { success: false, error: _t('providerError.ocrNoText', '未识别到文字') };
      }

      // textAnnotations[0] is the concatenated full text; [1..] are per-word boxes
      const fullText = textAnnotations[0]?.description || '';

      return {
        success: true,
        text: this.cleanText(fullText),
        ...this._paragraphBlocks(result?.fullTextAnnotation),
        engine: 'google-vision',
        locale: textAnnotations[0]?.locale,
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }

  // Blocks come from fullTextAnnotation (returned alongside TEXT_DETECTION),
  // not from textAnnotations[1..]: those are per-WORD, and word boxes are about
  // as tall as they are wide, so the scattered-mode heuristic would read every
  // paragraph of prose as a word pile. Paragraph boxes are the coarsest
  // granularity Vision structures for us and need no line reassembly.
  _paragraphBlocks(fullTextAnnotation) {
    const items = [];
    for (const page of fullTextAnnotation?.pages || []) {
      for (const block of page.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          items.push({
            text: paragraphText(paragraph),
            bbox: rectFromPoints(paragraph.boundingBox?.vertices),
            confidence: paragraph.confidence,
          });
        }
      }
    }
    const blocks = makeBlocks(items);
    return blocks.length ? { blocks, rawBlocks: blocks } : {};
  }
}

// Vision gives paragraphs no text field — it has to be rebuilt from symbols,
// with detectedBreak carrying the whitespace the symbols themselves omit.
function paragraphText(paragraph) {
  let out = '';
  for (const word of paragraph?.words || []) {
    for (const symbol of word.symbols || []) {
      out += symbol.text || '';
      const type = symbol.property?.detectedBreak?.type;
      if (type === 'SPACE' || type === 'SURE_SPACE') out += ' ';
      else if (type === 'EOL_SURE_SPACE' || type === 'LINE_BREAK') out += '\n';
      else if (type === 'HYPHEN') out += '-';
    }
  }
  return out.trim();
}

export default GoogleVisionEngine;
