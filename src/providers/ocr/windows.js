// Windows OCR — system engine via Windows.Media.Ocr (main process drives a
// PowerShell script). Zero download; quality depends on installed Windows
// language packs. Serves as the local fallback when PP-OCR models are missing.

import { BaseOCREngine } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('WindowsOCR');

class WindowsOCREngine extends BaseOCREngine {

  static metadata = {
    id: 'windows-ocr',
    name: 'Windows OCR',
    description: 'Windows built-in OCR (Windows.Media.Ocr)',
    type: 'system',
    tier: 1,
    priority: 2,
    isOnline: false,
  };

  async isAvailable() {
    return !!(window.electron?.ocr?.recognizeWithWindowsOCR) &&
           /Windows/i.test(navigator.userAgent);
  }

  async recognize(input, options = {}) {
    try {
      if (!(await this.isAvailable())) {
        return { success: false, error: 'Windows OCR not available' };
      }

      const imageData = this.ensureBase64(input);
      const result = await window.electron.ocr.recognizeWithWindowsOCR(imageData, options);

      if (!result.success) {
        return { success: false, error: result.error || 'Windows OCR failed' };
      }

      return {
        success: true,
        text: this.cleanText(result.text),
        raw: result.text,
        blocks: [],
        rawBlocks: [],
        engine: 'windows-ocr',
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default WindowsOCREngine;
