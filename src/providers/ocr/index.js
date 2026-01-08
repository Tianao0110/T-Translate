// src/providers/ocr/index.js
// OCR 引擎注册表

import RapidOCREngine from './rapid.js';
import LLMVisionEngine from './llm-vision.js';

/**
 * 所有已注册的 OCR 引擎
 */
const engines = {
  'rapid-ocr': RapidOCREngine,
  'llm-vision': LLMVisionEngine,
};

/**
 * 默认优先级（从高到低）
 */
export const DEFAULT_OCR_PRIORITY = ['rapid-ocr', 'llm-vision'];

/**
 * 获取所有 OCR 引擎元信息
 */
export function getAllOCREngines() {
  return Object.entries(engines).map(([id, Engine]) => ({
    id,
    ...Engine.metadata,
  }));
}

/**
 * 获取 OCR 引擎类
 */
export function getOCREngineClass(id) {
  return engines[id] || null;
}

/**
 * 创建 OCR 引擎实例
 */
export function createOCREngine(id, config = {}) {
  const EngineClass = engines[id];
  if (!EngineClass) {
    console.error(`[OCR Registry] Unknown engine: ${id}`);
    return null;
  }
  return new EngineClass(config);
}

/**
 * OCR 引擎管理器
 * 管理实例、自动 fallback
 */
class OCREngineManager {
  constructor() {
    this.instances = {};
    this.configs = {};
    this.priority = [...DEFAULT_OCR_PRIORITY];
  }

  /**
   * 初始化
   */
  async init(configs = {}) {
    this.configs = configs;
    
    // 预创建常用引擎
    for (const id of this.priority) {
      this.getOrCreate(id);
    }
  }

  /**
   * 获取或创建引擎实例
   */
  getOrCreate(id) {
    if (this.instances[id]) {
      return this.instances[id];
    }
    
    const instance = createOCREngine(id, this.configs[id] || {});
    if (instance) {
      this.instances[id] = instance;
    }
    return instance;
  }

  /**
   * 设置优先级
   */
  setPriority(priority) {
    this.priority = priority;
  }

  /**
   * 识别（带自动 fallback）
   */
  async recognize(input, options = {}) {
    const { engine: preferredEngine } = options;
    
    // 如果指定了引擎，只用那个
    if (preferredEngine) {
      const instance = this.getOrCreate(preferredEngine);
      if (instance) {
        return instance.recognize(input, options);
      }
    }

    // 按优先级尝试
    for (const id of this.priority) {
      const instance = this.getOrCreate(id);
      if (!instance) continue;

      try {
        const available = await instance.isAvailable();
        if (!available) continue;

        const result = await instance.recognize(input, options);
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.warn(`[OCR Manager] Engine ${id} failed:`, error);
      }
    }

    return { success: false, error: '所有 OCR 引擎均失败' };
  }

  /**
   * 获取最佳可用引擎
   */
  async getBestEngine() {
    for (const id of this.priority) {
      const instance = this.getOrCreate(id);
      if (instance && await instance.isAvailable()) {
        return instance;
      }
    }
    return null;
  }
}

// 单例导出
export const ocrManager = new OCREngineManager();

export default ocrManager;
