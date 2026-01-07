// src/providers/base.js
// 翻译源基类 - 所有翻译源必须继承此类

/**
 * 翻译源基类
 * 定义了所有翻译源必须实现的标准接口
 */
export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this._lastError = null;
  }

  /**
   * 翻译文本（必须实现）
   * @param {string} text - 要翻译的文本
   * @param {string} sourceLang - 源语言代码（'auto' 表示自动检测）
   * @param {string} targetLang - 目标语言代码
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    throw new Error('translate() must be implemented by subclass');
  }

  /**
   * 流式翻译（可选实现）
   * @param {string} text - 要翻译的文本
   * @param {string} sourceLang - 源语言代码
   * @param {string} targetLang - 目标语言代码
   * @param {function} onChunk - 接收每个文本块的回调
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async translateStream(text, sourceLang, targetLang, onChunk) {
    // 默认实现：不支持流式，直接调用普通翻译
    const result = await this.translate(text, sourceLang, targetLang);
    if (result.success && onChunk) {
      onChunk(result.text);
    }
    return result;
  }

  /**
   * 测试连接（可选实现）
   * @returns {Promise<{success: boolean, message?: string, models?: string[]}>}
   */
  async testConnection() {
    return { success: true, message: 'Not implemented' };
  }

  /**
   * 获取可用模型列表（LLM 类型用）
   * @returns {Promise<string[]>}
   */
  async getModels() {
    return [];
  }

  /**
   * 更新配置
   * @param {object} newConfig - 新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取最后一次错误
   */
  get lastError() {
    return this._lastError;
  }

  /**
   * 是否支持流式输出
   */
  get supportsStreaming() {
    return false;
  }

  /**
   * 预估延迟等级
   * 'fast' - <500ms（在线 API）
   * 'medium' - 500ms-2s
   * 'slow' - >2s（本地大模型）
   */
  get latencyLevel() {
    return 'medium';
  }

  /**
   * 是否需要网络
   */
  get requiresNetwork() {
    return true;
  }

  /**
   * 检查配置是否完整
   * @returns {boolean}
   */
  isConfigured() {
    const schema = this.constructor.metadata?.configSchema || {};
    for (const [key, field] of Object.entries(schema)) {
      if (field.required && !this.config[key]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取缺失的必填配置字段
   * @returns {string[]}
   */
  getMissingConfig() {
    const schema = this.constructor.metadata?.configSchema || {};
    const missing = [];
    for (const [key, field] of Object.entries(schema)) {
      if (field.required && !this.config[key]) {
        missing.push(field.label || key);
      }
    }
    return missing;
  }
}

/**
 * 语言代码映射
 * 用于统一不同翻译服务的语言代码
 */
export const LANGUAGE_CODES = {
  'auto': { name: '自动检测', deepl: null, google: 'auto' },
  'zh': { name: '中文', deepl: 'ZH', google: 'zh-CN' },
  'zh-TW': { name: '繁体中文', deepl: 'ZH', google: 'zh-TW' },
  'en': { name: 'English', deepl: 'EN', google: 'en' },
  'ja': { name: '日本語', deepl: 'JA', google: 'ja' },
  'ko': { name: '한국어', deepl: 'KO', google: 'ko' },
  'fr': { name: 'Français', deepl: 'FR', google: 'fr' },
  'de': { name: 'Deutsch', deepl: 'DE', google: 'de' },
  'es': { name: 'Español', deepl: 'ES', google: 'es' },
  'ru': { name: 'Русский', deepl: 'RU', google: 'ru' },
  'pt': { name: 'Português', deepl: 'PT', google: 'pt' },
  'it': { name: 'Italiano', deepl: 'IT', google: 'it' },
};

/**
 * 获取语言名称
 */
export function getLanguageName(code) {
  return LANGUAGE_CODES[code]?.name || code;
}

export default BaseProvider;
