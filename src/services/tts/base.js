// src/services/tts/base.js
// TTS 引擎基类 - 定义统一接口

/**
 * TTS 引擎状态
 */
export const TTS_STATUS = {
  IDLE: 'idle',
  SPEAKING: 'speaking',
  PAUSED: 'paused',
  ERROR: 'error',
};

/**
 * TTS 引擎基类
 * 所有 TTS 引擎必须继承此类并实现抽象方法
 */
export class BaseTTSEngine {
  /**
   * 引擎元信息（子类必须覆盖）
   */
  static metadata = {
    id: 'base',               // 唯一标识符
    name: 'Base TTS',         // 显示名称
    description: '',          // 描述
    type: 'local',            // 类型：'local' | 'cloud'
    isOnline: false,          // 是否需要联网
    supportedLanguages: [],   // 支持的语言列表
    configSchema: {},         // 配置字段定义
  };

  constructor(config = {}) {
    this.config = config;
    this._status = TTS_STATUS.IDLE;
    this._currentUtterance = null;
    this._onStatusChange = null;
    this._onProgress = null;
  }

  /**
   * 获取当前状态
   */
  get status() {
    return this._status;
  }

  /**
   * 设置状态变化回调
   * @param {Function} callback - (status: TTS_STATUS) => void
   */
  onStatusChange(callback) {
    this._onStatusChange = callback;
  }

  /**
   * 设置进度回调
   * @param {Function} callback - (progress: { charIndex, charLength, word }) => void
   */
  onProgress(callback) {
    this._onProgress = callback;
  }

  /**
   * 更新状态
   * @protected
   */
  _setStatus(status) {
    this._status = status;
    if (this._onStatusChange) {
      this._onStatusChange(status);
    }
  }

  /**
   * 检查引擎是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    throw new Error('Not implemented: isAvailable');
  }

  /**
   * 获取可用的语音列表
   * @returns {Promise<Array<{ id: string, name: string, lang: string }>>}
   */
  async getVoices() {
    throw new Error('Not implemented: getVoices');
  }

  /**
   * 朗读文本
   * @param {string} text - 要朗读的文本
   * @param {Object} options - 选项
   * @param {string} options.lang - 语言代码
   * @param {string} options.voiceId - 语音 ID
   * @param {number} options.rate - 语速（0.1 - 10，默认 1）
   * @param {number} options.pitch - 音调（0 - 2，默认 1）
   * @param {number} options.volume - 音量（0 - 1，默认 1）
   * @returns {Promise<void>}
   */
  async speak(text, options = {}) {
    throw new Error('Not implemented: speak');
  }

  /**
   * 暂停朗读
   */
  pause() {
    throw new Error('Not implemented: pause');
  }

  /**
   * 恢复朗读
   */
  resume() {
    throw new Error('Not implemented: resume');
  }

  /**
   * 停止朗读
   */
  stop() {
    throw new Error('Not implemented: stop');
  }

  /**
   * 释放资源
   */
  dispose() {
    this.stop();
    this._onStatusChange = null;
    this._onProgress = null;
  }
}

export default BaseTTSEngine;
