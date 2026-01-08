// src/providers/ocr/base.js
// OCR 引擎基类

/**
 * OCR 引擎基类
 * 所有 OCR 引擎必须继承此类
 */
export class BaseOCREngine {
  constructor(config = {}) {
    this.config = config;
    this._initialized = false;
  }

  /**
   * 元信息（子类必须定义）
   */
  static metadata = {
    id: 'base',
    name: 'Base OCR',
    description: '',
    type: 'local',      // 'local' | 'online'
    tier: 1,            // 1=本地首选, 2=视觉模型, 3=在线API
    priority: 0,
    isOnline: false,
  };

  /**
   * 初始化引擎（可选实现）
   */
  async init() {
    this._initialized = true;
    return { success: true };
  }

  /**
   * 识别图片中的文字（必须实现）
   * @param {string|Uint8Array} input - base64 图片或二进制数据
   * @param {object} options - 识别选项
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async recognize(input, options = {}) {
    throw new Error('recognize() must be implemented by subclass');
  }

  /**
   * 检查引擎是否可用
   */
  async isAvailable() {
    return true;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 辅助：确保输入是 base64 格式
   */
  ensureBase64(input) {
    if (typeof input === 'string') {
      // 已经是 base64
      if (input.startsWith('data:')) {
        return input;
      }
      return `data:image/png;base64,${input}`;
    }
    
    if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:image/png;base64,${btoa(binary)}`;
    }
    
    return input;
  }

  /**
   * 辅助：清理 OCR 输出文本
   */
  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\r\n/g, '\n')           // 统一换行符
      .replace(/[ \t]+/g, ' ')          // 合并多个空格
      .replace(/\n{3,}/g, '\n\n')       // 最多两个连续换行
      .trim();
  }
}

export default BaseOCREngine;
