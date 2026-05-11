// RapidOCR — local PP-OCRv4-based engine. Lives in main process; renderer
// calls through IPC.

import { BaseOCREngine } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('RapidOCR');

class RapidOCREngine extends BaseOCREngine {

  static metadata = {
    id: 'rapid-ocr',
    name: 'RapidOCR',
    description: '本地 OCR，基于 PP-OCRv4，速度快',
    type: 'local',
    tier: 1,
    priority: 1,
    isOnline: false,
  };

  constructor(config = {}) {
    super(config);
  }

  async isAvailable() {
    return !!(window.electron?.ocr?.recognizeWithPaddleOCR);
  }

  async recognize(input, options = {}) {
    try {
      if (!window.electron?.ocr?.recognizeWithPaddleOCR) {
        return { success: false, error: 'RapidOCR API 不可用' };
      }

      const imageData = this.ensureBase64(input);

      const result = await window.electron.ocr.recognizeWithPaddleOCR(imageData, options);

      if (!result.success) {
        return { success: false, error: result.error || 'OCR 识别失败' };
      }

      const cleanedText = this.cleanText(result.text);

      return {
        success: true,
        text: cleanedText,
        raw: result.text,
        // blocks = paragraph-merged; rawBlocks = per-line. Pipeline uses rawBlocks for scattered mode.
        blocks: result.blocks || [],
        rawBlocks: result.rawBlocks || result.blocks || [],
        engine: 'rapid-ocr',
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default RapidOCREngine;
