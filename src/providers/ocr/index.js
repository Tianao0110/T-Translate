// src/providers/ocr/index.js
// OCR 引擎注册表

import RapidOCREngine from './rapid.js';
import LLMVisionEngine from './llm-vision.js';
import OCRSpaceEngine from './ocrspace.js';
import GoogleVisionEngine from './google-vision.js';
import AzureOCREngine from './azure-ocr.js';
import BaiduOCREngine from './baidu-ocr.js';

/**
 * 所有已注册的 OCR 引擎
 */
const engines = {
  'rapid-ocr': RapidOCREngine,
  'llm-vision': LLMVisionEngine,
  'ocrspace': OCRSpaceEngine,
  'google-vision': GoogleVisionEngine,
  'azure-ocr': AzureOCREngine,
  'baidu-ocr': BaiduOCREngine,
};

/**
 * 默认优先级（从高到低）
 * 本地引擎优先，然后是在线 API
 */
export const DEFAULT_OCR_PRIORITY = [
  'rapid-ocr',      // 本地 - 最快
  'llm-vision',     // 本地 LLM - 高质量
  'ocrspace',       // 在线 - 免费
  'google-vision',  // 在线 - 高质量
  'azure-ocr',      // 在线 - 高质量
  'baidu-ocr',      // 在线 - 中文优化
];

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
    // logger.error(`[OCR Registry] Unknown engine: ${id}`);
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
   * @param {object} settings - settings.ocr 配置对象
   */
  async init(settings = {}) {
    // 从 settings 构建各引擎配置
    this.configs = this._buildConfigs(settings);
    
    // logger.debug('[OCR Manager] Initialized with configs:', Object.keys(this.configs));
    
    // 清除旧实例
    this.instances = {};
  }

  /**
   * 从 settings.ocr 构建各引擎配置
   */
  _buildConfigs(settings) {
    return {
      'rapid-ocr': {
        // RapidOCR 通常不需要额外配置
      },
      'llm-vision': {
        // LLM Vision 使用翻译源的配置
      },
      'ocrspace': {
        apiKey: settings.ocrspaceKey || '',
        language: settings.recognitionLanguage || 'chs',
      },
      'google-vision': {
        apiKey: settings.googleVisionKey || '',
      },
      'azure-ocr': {
        apiKey: settings.azureKey || '',
        endpoint: settings.azureEndpoint || '',
      },
      'baidu-ocr': {
        apiKey: settings.baiduApiKey || '',
        secretKey: settings.baiduSecretKey || '',
      },
    };
  }

  /**
   * 更新配置
   */
  updateConfigs(settings) {
    this.configs = this._buildConfigs(settings);
    // 清除实例，下次使用时重新创建
    this.instances = {};
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
        // logger.warn(`[OCR Manager] Engine ${id} failed:`, error);
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
