// Local OCR engines as stack classes. Unlike the renderer originals (thin IPC
// bridges to ocr:paddle-ocr / ocr:windows-ocr), these call the main-process
// recognizers directly through the injected runtime capability — same engine
// code, one hop less. Engine ids stay 'rapid-ocr'/'windows-ocr' for
// stored-settings compatibility.

import { BaseOCREngine, _t } from './base.js';
import { getLocalOcr } from '../runtime.js';
import createLogger from '../logger.js';

const logger = createLogger('LocalOCR');

export class RapidOCREngine extends BaseOCREngine {

  static metadata = {
    id: 'rapid-ocr',
    name: 'Local OCR (PP-OCRv6)',
    description: 'Local PP-OCRv6 engine with downloadable language packs',
    type: 'local',
    tier: 1,
    priority: 1,
    isOnline: false,
  };

  async isAvailable() {
    // Callable whenever the recognizer is injected; missing models surface as
    // BASE_MODELS_MISSING from recognize(), which the manager degrades on.
    return !!getLocalOcr()?.paddle;
  }

  async recognize(input, options = {}) {
    try {
      const local = getLocalOcr();
      if (!local?.paddle) {
        return { success: false, error: _t('providerError.ocrApiUnavailable', 'OCR 服务不可用') };
      }

      const imageData = this.ensureBase64(input);
      const result = await local.paddle(imageData, options);

      if (!result.success) {
        return {
          success: false,
          error: result.error || _t('providerError.ocrRecognizeFailed', 'OCR 识别失败'),
          errorCode: result.errorCode,
        };
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
        // pack metadata: which model pack served this + language-pack fallback hint
        pack: result.pack,
        packFallback: result.packFallback || false,
        requestedLanguage: result.requestedLanguage,
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export class WindowsOCREngine extends BaseOCREngine {

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
    const local = getLocalOcr();
    return !!local?.windows && !!local?.isWindows;
  }

  async recognize(input, options = {}) {
    try {
      if (!(await this.isAvailable())) {
        return { success: false, error: 'Windows OCR not available' };
      }

      const imageData = this.ensureBase64(input);
      const result = await getLocalOcr().windows(imageData, options);

      if (!result.success) {
        return { success: false, error: result.error || 'Windows OCR failed' };
      }

      return {
        success: true,
        text: this.cleanText(result.text),
        raw: result.text,
        // Windows.Media.Ocr boxes every word; the driver unions them per line.
        blocks: result.blocks || [],
        rawBlocks: result.rawBlocks || result.blocks || [],
        engine: 'windows-ocr',
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
}
