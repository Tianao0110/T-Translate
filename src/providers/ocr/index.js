// src/providers/ocr/index.js
// OCR 引擎注册表

import RapidOCREngine from './rapid.js';
import LLMVisionEngine from './llm-vision.js';
import OCRSpaceEngine from './ocrspace.js';
import GoogleVisionEngine from './google-vision.js';
import AzureOCREngine from './azure-ocr.js';
import BaiduOCREngine from './baidu-ocr.js';
import createLogger from '../../utils/logger.js';
import i18n from '../../i18n.js';

const logger = createLogger('OCRManager');

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

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
 * 
 * LLM Vision 自动降级机制：
 * - llm-vision 识别失败（模型不支持视觉）时自动切换到本地 OCR (rapid-ocr)
 * - 连续失败 2 次后锁定为本地 OCR，不再尝试 llm-vision
 * - 用户需要去设置里手动重新启用 llm-vision
 */
class OCREngineManager {
  constructor() {
    this.instances = {};
    this.configs = {};
    this.priority = [...DEFAULT_OCR_PRIORITY];
    
    // LLM Vision 降级状态
    this._visionFailCount = 0;           // 连续失败次数
    this._visionFailThreshold = 2;       // 超过此次数锁定为本地 OCR
    this._visionLocked = false;          // 是否已锁定（不再尝试 llm-vision）
    this._onFallbackNotify = null;       // 降级通知回调
    this._localFallbackEngine = 'rapid-ocr';  // 降级目标引擎
  }

  /**
   * 初始化
   * @param {object} settings - settings.ocr 配置对象
   */
  async init(settings = {}) {
    // 从 settings 构建各引擎配置
    this.configs = this._buildConfigs(settings);
    
    // 清除旧实例
    this.instances = {};
  }

  /**
   * 设置降级通知回调
   * @param {function} callback - (message: string, type: 'info'|'warning') => void
   */
  setFallbackNotify(callback) {
    this._onFallbackNotify = callback;
  }

  /**
   * 重置 LLM Vision 降级状态（用户在设置里重新启用时调用）
   */
  resetVisionFallback() {
    this._visionFailCount = 0;
    this._visionLocked = false;
    logger.info('LLM Vision fallback state reset');
  }

  /**
   * 检查 LLM Vision 是否因多次失败而被锁定
   */
  isVisionLocked() {
    return this._visionLocked;
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
   * 
   * 当 llm-vision 被指定但失败时：
   * 1. 检测是否为"模型不支持视觉"类错误
   * 2. 是 → 通知用户 + 自动切换到本地 OCR 重试
   * 3. 累计失败 2 次 → 锁定为本地 OCR，后续不再尝试 llm-vision
   */
  async recognize(input, options = {}) {
    const { engine: preferredEngine } = options;
    
    // 如果指定了 llm-vision 但已被锁定，直接用本地 OCR
    if (preferredEngine === 'llm-vision' && this._visionLocked) {
      logger.info('LLM Vision locked due to repeated failures, using local OCR');
      return this._recognizeWithEngine(this._localFallbackEngine, input, options);
    }
    
    // 如果指定了引擎，尝试使用该引擎
    if (preferredEngine) {
      const result = await this._recognizeWithEngine(preferredEngine, input, options);
      
      // 如果是 llm-vision 且失败了，检查是否可以降级
      if (!result.success && preferredEngine === 'llm-vision') {
        if (this._isVisionUnsupportedError(result.error)) {
          return this._handleVisionFallback(input, options, result.error);
        }
      }
      
      // llm-vision 成功则重置失败计数
      if (result.success && preferredEngine === 'llm-vision') {
        if (this._visionFailCount > 0) {
          this._visionFailCount = 0;
          logger.debug('LLM Vision succeeded, reset fail count');
        }
      }
      
      return result;
    }

    // 按优先级尝试
    for (const id of this.priority) {
      // 跳过已锁定的 llm-vision
      if (id === 'llm-vision' && this._visionLocked) continue;
      
      const instance = this.getOrCreate(id);
      if (!instance) continue;

      try {
        const available = await instance.isAvailable();
        if (!available) continue;

        const result = await instance.recognize(input, options);
        if (result.success) {
          return result;
        }
        
        // 优先级循环中 llm-vision 失败也触发降级计数
        if (id === 'llm-vision' && this._isVisionUnsupportedError(result.error)) {
          this._incrementVisionFail();
        }
      } catch (error) {
        logger.warn(`Engine ${id} failed:`, error.message);
      }
    }

    return { success: false, error: _t('ocr.allEnginesFailed', 'All OCR engines failed') };
  }
  
  /**
   * 用指定引擎执行识别
   */
  async _recognizeWithEngine(engineId, input, options) {
    const instance = this.getOrCreate(engineId);
    if (!instance) {
      return { success: false, error: `Engine ${engineId} not available` };
    }
    try {
      return await instance.recognize(input, options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 检测是否为"模型不支持视觉"类错误
   */
  _isVisionUnsupportedError(errorMsg) {
    if (!errorMsg) return false;
    const lower = errorMsg.toLowerCase();
    return lower.includes('does not support vision') ||
           lower.includes('does not support') ||
           lower.includes('不支持图片') ||
           lower.includes('不支持视觉') ||
           lower.includes('multimodal') ||
           lower.includes('image_url') ||
           lower.includes('content type') ||
           lower.includes('timeout') ||
           lower.includes('超时');
  }
  
  /**
   * 处理 LLM Vision 降级：通知用户 + 切换到本地 OCR 重试
   */
  async _handleVisionFallback(input, options, originalError) {
    this._incrementVisionFail();
    
    // 通知用户
    if (this._onFallbackNotify) {
      if (this._visionLocked) {
        this._onFallbackNotify(
          'llm-vision-locked',
          'warning'
        );
      } else {
        this._onFallbackNotify(
          'llm-vision-fallback',
          'info'
        );
      }
    }
    
    logger.info(`LLM Vision failed (${this._visionFailCount}/${this._visionFailThreshold}), falling back to ${this._localFallbackEngine}`);
    
    // 用本地 OCR 重试
    const fallbackResult = await this._recognizeWithEngine(this._localFallbackEngine, input, options);
    
    // 标记使用了降级引擎
    if (fallbackResult.success) {
      fallbackResult.fallbackFrom = 'llm-vision';
      fallbackResult.fallbackReason = originalError;
    }
    
    return fallbackResult;
  }
  
  /**
   * 增加 vision 失败计数，达到阈值则锁定
   */
  _incrementVisionFail() {
    this._visionFailCount++;
    if (this._visionFailCount >= this._visionFailThreshold) {
      this._visionLocked = true;
      logger.warn(`LLM Vision locked after ${this._visionFailCount} failures. User must re-enable in settings.`);
    }
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
