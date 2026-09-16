// The built-in vision model as an OCR engine: PaddleOCR-VL in T-Engine's
// vision host, through the injected localLlm.recognize. Always the Spotting
// task, so every line comes back with its box in source-image pixels
// (blocks.js contract). The capture goes to the host as bytes and nowhere else.

import { BaseOCREngine, _t } from './base.js';
import { getLocalLlm } from '../runtime.js';
import { makeBlocks } from './blocks.js';
import createLogger from '../logger.js';

const logger = createLogger('TEngineVision');

// data: URL, bare base64 or bytes -> the encoded image bytes mtmd decodes.
export function imageBytes(input) {
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input !== 'string') return null;
  const comma = input.startsWith('data:') ? input.indexOf(',') : -1;
  const b64 = comma >= 0 ? input.slice(comma + 1) : input;
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

// Spotting lines -> the block shape the pipeline consumes. Lines the model
// gave no box for stay in the text but get no block.
export function linesToBlocks(lines) {
  return makeBlocks((lines || []).map((l) => ({
    text: l.text,
    bbox: l.box ? { x: l.box[0], y: l.box[1], width: l.box[2] - l.box[0], height: l.box[3] - l.box[1] } : null,
  })));
}

class TengineVisionEngine extends BaseOCREngine {

  static metadata = {
    id: 'tengine-vision',
    name: 'Built-in vision model',
    description: '程序自带的视觉模型（PaddleOCR-VL），本机运行',
    type: 'local',
    tier: 2,
    priority: 3,
    isOnline: false,
  };

  // Usable once the two-file pack passed its hashes and the vision host is
  // on the GPU (docs/T-ENGINE.md §10).
  async isAvailable() {
    const llm = getLocalLlm();
    if (!llm?.recognize || !llm.visionStatus) return false;
    const v = llm.visionStatus();
    return !!(v && v.available && v.usable);
  }

  async recognize(input, options = {}) {
    try {
      const llm = getLocalLlm();
      if (!llm?.recognize) {
        return { success: false, error: _t('providerError.ocrApiUnavailable', 'OCR 服务不可用') };
      }
      const image = imageBytes(input);
      if (!image || !image.length) {
        return { success: false, error: _t('providerError.ocrRecognizeFailed', 'OCR 识别失败') };
      }
      const g = await llm.recognize({ image, task: 'Spotting' });
      const onAbort = () => g.cancel?.();
      options.signal?.addEventListener?.('abort', onAbort, { once: true });
      let r;
      try {
        r = await g.promise;
      } finally {
        options.signal?.removeEventListener?.('abort', onAbort);
      }
      if (r.stop === 'cancel' || r.stop === 'stall') {
        return { success: false, error: r.stop === 'stall' ? _t('providerError.tengineFailed', '内置模型生成失败') : _t('providerError.tengineCancelled', '已取消') };
      }
      const lines = r.lines || [];
      const blocks = linesToBlocks(lines);
      const text = this.cleanText(lines.map((l) => l.text).join('\n'));
      return {
        success: true,
        text,
        raw: r.text,
        blocks,
        rawBlocks: blocks,
        engine: 'tengine-vision',
        confidence: 0.9,
      };
    } catch (error) {
      // Not installed, or the size was refused: the manager walks on.
      logger.warn('recognize failed:', error.message);
      return { success: false, error: error.message, errorCode: error.code || null };
    }
  }
}

export default TengineVisionEngine;
