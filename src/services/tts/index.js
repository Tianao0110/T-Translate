// src/services/tts/index.js
// TTS 服务管理器 - 统一接口

import { TTS_STATUS } from './base.js';
import WebSpeechEngine from './web-speech.js';

// 导出基础类型
export { BaseTTSEngine, TTS_STATUS } from './base.js';
export { WebSpeechEngine } from './web-speech.js';

/**
 * 注册的 TTS 引擎
 */
const engines = {
  'web-speech': WebSpeechEngine,
  // 预留云端引擎位置
  // 'azure-tts': AzureTTSEngine,
  // 'google-tts': GoogleTTSEngine,
};

/**
 * TTS 服务管理器
 * 单例模式，统一管理所有 TTS 引擎
 */
class TTSManager {
  constructor() {
    this._engines = new Map();
    this._currentEngine = null;
    this._currentEngineId = null;
    this._config = {
      defaultEngine: 'web-speech',
      rate: 1,
      pitch: 1,
      volume: 1,
    };
    this._onStatusChange = null;
  }

  /**
   * 初始化管理器
   * @param {Object} config - 配置
   */
  async init(config = {}) {
    this._config = { ...this._config, ...config };
    
    // 初始化默认引擎
    await this.setEngine(this._config.defaultEngine);
    
    return this;
  }

  /**
   * 获取所有可用引擎列表
   */
  getEngineList() {
    return Object.entries(engines).map(([id, Engine]) => ({
      id,
      ...Engine.metadata,
    }));
  }

  /**
   * 获取引擎实例
   * @param {string} engineId - 引擎 ID
   */
  async getEngine(engineId) {
    if (this._engines.has(engineId)) {
      return this._engines.get(engineId);
    }
    
    const EngineClass = engines[engineId];
    if (!EngineClass) {
      throw new Error(`Unknown TTS engine: ${engineId}`);
    }
    
    const engine = new EngineClass(this._config);
    
    // 检查可用性
    const available = await engine.isAvailable();
    if (!available) {
      throw new Error(`TTS engine not available: ${engineId}`);
    }
    
    this._engines.set(engineId, engine);
    return engine;
  }

  /**
   * 设置当前使用的引擎
   * @param {string} engineId - 引擎 ID
   */
  async setEngine(engineId) {
    // 停止当前引擎
    if (this._currentEngine) {
      this._currentEngine.stop();
    }
    
    this._currentEngine = await this.getEngine(engineId);
    this._currentEngineId = engineId;
    
    // 绑定状态回调
    if (this._onStatusChange) {
      this._currentEngine.onStatusChange(this._onStatusChange);
    }
    
    return this._currentEngine;
  }

  /**
   * 获取当前引擎
   */
  get currentEngine() {
    return this._currentEngine;
  }

  /**
   * 获取当前引擎 ID
   */
  get currentEngineId() {
    return this._currentEngineId;
  }

  /**
   * 获取当前状态
   */
  get status() {
    return this._currentEngine?.status || TTS_STATUS.IDLE;
  }

  /**
   * 设置状态变化回调
   * @param {Function} callback
   */
  onStatusChange(callback) {
    this._onStatusChange = callback;
    if (this._currentEngine) {
      this._currentEngine.onStatusChange(callback);
    }
  }

  /**
   * 获取可用语音列表
   */
  async getVoices() {
    if (!this._currentEngine) {
      await this.setEngine(this._config.defaultEngine);
    }
    return this._currentEngine.getVoices();
  }

  /**
   * 朗读文本
   * @param {string} text - 文本
   * @param {Object} options - 选项
   */
  async speak(text, options = {}) {
    if (!this._currentEngine) {
      await this.setEngine(this._config.defaultEngine);
    }
    
    const mergedOptions = {
      rate: this._config.rate,
      pitch: this._config.pitch,
      volume: this._config.volume,
      ...options,
    };
    
    return this._currentEngine.speak(text, mergedOptions);
  }

  /**
   * 暂停
   */
  pause() {
    this._currentEngine?.pause();
  }

  /**
   * 恢复
   */
  resume() {
    this._currentEngine?.resume();
  }

  /**
   * 停止
   */
  stop() {
    this._currentEngine?.stop();
  }

  /**
   * 更新配置
   * @param {Object} config
   */
  updateConfig(config) {
    this._config = { ...this._config, ...config };
  }

  /**
   * 释放所有资源
   */
  dispose() {
    for (const engine of this._engines.values()) {
      engine.dispose();
    }
    this._engines.clear();
    this._currentEngine = null;
  }
}

// 单例
const ttsManager = new TTSManager();

export default ttsManager;
