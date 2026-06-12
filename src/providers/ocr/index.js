// OCR engine registry + manager with auto-fallback chain.

import RapidOCREngine from './rapid.js';
import WindowsOCREngine from './windows.js';
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

const engines = {
  'rapid-ocr': RapidOCREngine,
  'windows-ocr': WindowsOCREngine,
  'llm-vision': LLMVisionEngine,
  'ocrspace': OCRSpaceEngine,
  'google-vision': GoogleVisionEngine,
  'azure-ocr': AzureOCREngine,
  'baidu-ocr': BaiduOCREngine,
};

// Local engines first (no network, no quota), then online APIs by general
// quality/availability
export const DEFAULT_OCR_PRIORITY = [
  'rapid-ocr',
  'windows-ocr',
  'llm-vision',
  'ocrspace',
  'google-vision',
  'azure-ocr',
  'baidu-ocr',
];

export function getAllOCREngines() {
  return Object.entries(engines).map(([id, Engine]) => ({
    id,
    ...Engine.metadata,
  }));
}

export function getOCREngineClass(id) {
  return engines[id] || null;
}

export function createOCREngine(id, config = {}) {
  const EngineClass = engines[id];
  if (!EngineClass) {
    return null;
  }
  return new EngineClass(config);
}

// LLM Vision auto-degrade:
// - If llm-vision fails with "vision unsupported" we transparently retry on
//   rapid-ocr (the local fallback) and notify the user.
// - After 2 consecutive failures we *lock* — llm-vision is skipped entirely
//   until the user re-enables it from settings. This avoids hammering an
//   incompatible model on every capture.
class OCREngineManager {
  constructor() {
    this.instances = {};
    this.configs = {};
    this.priority = [...DEFAULT_OCR_PRIORITY];

    this._visionFailCount = 0;
    this._visionFailThreshold = 2;
    this._visionLocked = false;
    this._onFallbackNotify = null;
    // Walked in order when llm-vision degrades or local models are missing:
    // PP-OCR first, Windows OCR as the zero-download bedrock.
    this._localFallbackChain = ['rapid-ocr', 'windows-ocr'];
  }

  async init(settings = {}) {
    this.configs = this._buildConfigs(settings);
    this.instances = {};
  }

  // Callback signature: (message, type: 'info' | 'warning') => void
  setFallbackNotify(callback) {
    this._onFallbackNotify = callback;
  }

  resetVisionFallback() {
    this._visionFailCount = 0;
    this._visionLocked = false;
    logger.info('LLM Vision fallback state reset');
  }

  isVisionLocked() {
    return this._visionLocked;
  }

  _buildConfigs(settings) {
    return {
      'rapid-ocr': {},
      'windows-ocr': {},
      'llm-vision': {}, // reuses the active translation provider
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

  updateConfigs(settings) {
    this.configs = this._buildConfigs(settings);
    this.instances = {};
  }

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

  setPriority(priority) {
    this.priority = priority;
  }

  async recognize(input, options = {}) {
    const { allowedEngines } = options;
    let { engine: preferredEngine } = options;

    // Privacy modes pass an engine allowlist (null/undefined = unrestricted).
    // A disallowed preferred engine falls through to the filtered chain
    // instead of failing outright.
    if (preferredEngine && allowedEngines && !allowedEngines.includes(preferredEngine)) {
      logger.debug(`Preferred engine ${preferredEngine} not allowed in current privacy mode`);
      preferredEngine = null;
    }

    if (preferredEngine === 'llm-vision' && this._visionLocked) {
      logger.info('LLM Vision locked due to repeated failures, using local OCR');
      return this._recognizeWithLocalChain(input, options);
    }

    if (preferredEngine) {
      const result = await this._recognizeWithEngine(preferredEngine, input, options);

      if (!result.success && preferredEngine === 'llm-vision') {
        if (this._isVisionUnsupportedError(result.error)) {
          return this._handleVisionFallback(input, options, result.error);
        }
      }

      // Local models missing/corrupt -> degrade to Windows OCR instead of
      // failing the capture; the result carries fallbackFrom for a UI notice.
      if (!result.success && preferredEngine === 'rapid-ocr' &&
          result.errorCode === 'BASE_MODELS_MISSING') {
        const fallback = await this._recognizeWithEngine('windows-ocr', input, options);
        if (fallback.success) {
          fallback.fallbackFrom = 'rapid-ocr';
          fallback.fallbackReason = result.error;
          return fallback;
        }
        return result;
      }

      // Success resets the fail counter so transient errors don't accumulate forever
      if (result.success && preferredEngine === 'llm-vision') {
        if (this._visionFailCount > 0) {
          this._visionFailCount = 0;
          logger.debug('LLM Vision succeeded, reset fail count');
        }
      }

      return result;
    }

    // No engine specified — walk the priority list, skipping locked vision
    for (const id of this.priority) {
      if (id === 'llm-vision' && this._visionLocked) continue;
      if (allowedEngines && !allowedEngines.includes(id)) continue;

      const instance = this.getOrCreate(id);
      if (!instance) continue;

      try {
        const available = await instance.isAvailable();
        if (!available) continue;

        const result = await instance.recognize(input, options);
        if (result.success) {
          return result;
        }

        // Walk-the-priority path still counts toward the vision lock threshold
        if (id === 'llm-vision' && this._isVisionUnsupportedError(result.error)) {
          this._incrementVisionFail();
        }
      } catch (error) {
        logger.warn(`Engine ${id} failed:`, error.message);
      }
    }

    return { success: false, error: _t('ocr.allEnginesFailed', 'All OCR engines failed') };
  }

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

  // String-match against known "model doesn't speak images" failure modes
  // from OpenAI-compatible servers, LM Studio, and timeout cases.
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

  async _handleVisionFallback(input, options, originalError) {
    this._incrementVisionFail();

    if (this._onFallbackNotify) {
      if (this._visionLocked) {
        this._onFallbackNotify('llm-vision-locked', 'warning');
      } else {
        this._onFallbackNotify('llm-vision-fallback', 'info');
      }
    }

    logger.info(`LLM Vision failed (${this._visionFailCount}/${this._visionFailThreshold}), falling back to local chain`);

    const fallbackResult = await this._recognizeWithLocalChain(input, options);

    // Caller (main-translation) reads these to surface a "we switched engines" notice
    if (fallbackResult.success) {
      fallbackResult.fallbackFrom = 'llm-vision';
      fallbackResult.fallbackReason = originalError;
    }

    return fallbackResult;
  }

  // Walk rapid-ocr -> windows-ocr; first success wins. Last failure is
  // returned so the caller still sees a meaningful error.
  async _recognizeWithLocalChain(input, options) {
    let lastResult = null;
    for (const engineId of this._localFallbackChain) {
      const instance = this.getOrCreate(engineId);
      if (!instance || !(await instance.isAvailable())) continue;

      lastResult = await this._recognizeWithEngine(engineId, input, options);
      if (lastResult.success) return lastResult;
    }
    return lastResult || { success: false, error: _t('ocr.allEnginesFailed', 'All OCR engines failed') };
  }

  _incrementVisionFail() {
    this._visionFailCount++;
    if (this._visionFailCount >= this._visionFailThreshold) {
      this._visionLocked = true;
      logger.warn(`LLM Vision locked after ${this._visionFailCount} failures. User must re-enable in settings.`);
    }
  }

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

export const ocrManager = new OCREngineManager();

export default ocrManager;
