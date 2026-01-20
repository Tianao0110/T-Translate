// src/providers/ocr/rapid.js
// RapidOCR 引擎 - 本地首选，基于 PP-OCRv4

import { BaseOCREngine } from './base.js';

/**
 * RapidOCR 引擎
 * 本地 OCR，毫秒级响应，基于 PaddleOCR
 */
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

  /**
   * 检查是否可用
   */
  async isAvailable() {
    // 检查 Electron API 是否存在
    return !!(window.electron?.ocr?.recognizeWithPaddleOCR);
  }

  /**
   * 识别图片
   * @param {string} input - base64 图片数据
   * @param {object} options - 选项
   * @returns {Promise<{success, text, blocks?, engine}>}
   */
  async recognize(input, options = {}) {
    try {
      // 检查 API
      if (!window.electron?.ocr?.recognizeWithPaddleOCR) {
        return { success: false, error: 'RapidOCR API 不可用' };
      }

      // 确保是 base64 格式
      const imageData = this.ensureBase64(input);

      // 调用 Electron API
      const result = await window.electron.ocr.recognizeWithPaddleOCR(imageData, options);

      if (!result.success) {
        return { success: false, error: result.error || 'OCR 识别失败' };
      }

      // 清理文本
      const cleanedText = this.cleanText(result.text);

      // 返回结果，包含坐标信息
      return {
        success: true,
        text: cleanedText,
        raw: result.text,
        blocks: result.blocks || [],      // 合并后的文本块数组
        rawBlocks: result.rawBlocks || result.blocks || [],  // 原始文本块数组
        engine: 'rapid-ocr',
      };
    } catch (error) {
      console.error('[RapidOCR] Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default RapidOCREngine;
