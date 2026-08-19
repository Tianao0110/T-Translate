// OCR engine registry + manager with auto-fallback chain.
// Stack port of src/providers/ocr/index.js. Deliberate differences:
//   - priority is a per-request option (the floating window used to setPriority
//     on ITS manager instance; with one shared instance that would leak its
//     ordering into every window — dead setPriority/setFallbackNotify/
//     getAllOCREngines had zero callers and are dropped)
//   - vision lock state is global by construction (one instance for all three
//     windows — locking once benefits everyone), and fallback results carry
//     `visionLocked` so renderers can word their notice without an extra IPC
//   - configs load through the injected loader (flat settings.ocr bucket with
//     vault secrets merged main-side)

import { RapidOCREngine, WindowsOCREngine } from './local-bridge.js';
import LLMVisionEngine from './llm-vision.js';
import OCRSpaceEngine from './ocrspace.js';
import GoogleVisionEngine from './google-vision.js';
import AzureOCREngine from './azure-ocr.js';
import BaiduOCREngine from './baidu-ocr.js';
import { isUsableResult } from './result-quality.js';
import { _t } from '../i18n.js';
import createLogger from '../logger.js';

const logger = createLogger('OCRManager');

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

export function createOCREngine(id, config = {}) {
  const EngineClass = engines[id];
  if (!EngineClass) {
    return null;
  }
  return new EngineClass(config);
}

// Mirrors LLMVisionEngine's own default — the manager has to answer "is this
// endpoint local?" before an instance exists.
const DEFAULT_VISION_ENDPOINT = 'http://localhost:1234/v1';

// Offline mode allows llm-vision only while it points at this machine. Host
// names are matched exactly: a "localhost.evil.com" must not read as local.
export function isLoopbackEndpoint(endpoint) {
  try {
    const host = new URL(endpoint).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

// LLM Vision auto-degrade:
// - If llm-vision fails with "vision unsupported" we transparently retry on
//   rapid-ocr (the local fallback) and the result carries fallbackFrom.
// - After 2 consecutive failures we *lock* — llm-vision is skipped entirely
//   until the user re-enables it from settings. This avoids hammering an
//   incompatible model on every capture.
export class OCREngineManager {
  /**
   * @param {object} deps
   * @param {() => Promise<object>} [deps.loadConfigs] Returns the flat
   *   settings.ocr bucket with vault secrets already merged (main process
   *   owns decryption).
   */
  constructor(deps = {}) {
    this._deps = deps;
    this.instances = {};
    this.configs = {};

    this._visionFailCount = 0;
    this._visionFailThreshold = 2;
    this._visionLocked = false;
    // Walked in order when llm-vision degrades or local models are missing:
    // PP-OCR first, Windows OCR as the zero-download bedrock.
    this._localFallbackChain = ['rapid-ocr', 'windows-ocr'];
  }

  async init() {
    let settings = {};
    try {
      settings = (await this._deps.loadConfigs?.()) || {};
    } catch (e) {
      logger.warn('OCR config load failed:', e.message);
    }
    this.configs = this._buildConfigs(settings);
    this.instances = {};
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
      // Same OpenAI-compatible endpoint the local-LLM provider uses — the
      // engine fetches it directly and never routes through the service.
      // model is independent of endpoint: users on LM Studio's default port
      // (blank endpoint) still need to pin a vision model when multiple load.
      'llm-vision': (settings.llmEndpoint || settings.llmModel)
        ? {
            ...(settings.llmEndpoint ? { endpoint: settings.llmEndpoint } : {}),
            ...(settings.llmModel ? { model: settings.llmModel } : {}),
          }
        : {},
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

  async recognize(input, options = {}) {
    const { allowedEngines, priority } = options;
    let { engine: preferredEngine } = options;

    // Privacy modes pass an engine allowlist (null/undefined = unrestricted) —
    // injected by the IPC facade from the live mode, never by a renderer.
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
    const order = priority || DEFAULT_OCR_PRIORITY;
    // Best result that reported success but read as unusable. Held so a capture
    // every engine struggles with still returns something.
    let weakest = null;
    for (const id of order) {
      if (id === 'llm-vision' && this._visionLocked) continue;
      if (allowedEngines && !allowedEngines.includes(id)) continue;

      const instance = this.getOrCreate(id);
      if (!instance) continue;

      try {
        const available = await instance.isAvailable();
        if (!available) continue;

        const result = await instance.recognize(input, options);
        if (result.success) {
          if (isUsableResult(result, id)) return result;
          // An engine that cannot read this script does not report failure —
          // it returns nothing, or nonsense. Keep walking so the engines
          // behind it get their turn.
          logger.debug(`Engine ${id} returned nothing usable, trying the next one`);
          if (!weakest || (result.confidence || 0) > (weakest.confidence || 0)) weakest = result;
          continue;
        }

        // Walk-the-priority path still counts toward the vision lock threshold
        if (id === 'llm-vision' && this._isVisionUnsupportedError(result.error)) {
          this._incrementVisionFail();
        }
      } catch (error) {
        logger.warn(`Engine ${id} failed:`, error.message);
      }
    }

    if (weakest) return { ...weakest, lowQuality: true };
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

  // Path B for AI actions: hand the capture straight to the vision model with
  // the action's own prompt. Shares the engine, the config and the
  // image-dropped detection with recognize(), and counts toward the same
  // vision lock — a model that cannot see images fails both ways.
  async visionChat(messages, imageData, options = {}) {
    const capability = this.getVisionCapability(options);
    if (!capability.available) {
      return { success: false, error: capability.reason, visionUnsupported: true };
    }

    const instance = this.getOrCreate('llm-vision');
    if (!instance) {
      return { success: false, error: _t('ocr.allEnginesFailed', '所有 OCR 引擎均失败'), visionUnsupported: true };
    }

    const result = await instance.chat(messages, imageData, options);
    if (result.success) {
      this._visionFailCount = 0;
      return result;
    }
    if (result.visionUnsupported || this._isVisionUnsupportedError(result.error)) {
      this._incrementVisionFail();
      result.visionUnsupported = true;
    }
    return result;
  }

  // Whether path B may run at all. Deliberately does NOT probe the network:
  // reachability says nothing about whether a VISION model is loaded, that is
  // only knowable from the reply, so the caller degrades on failure instead.
  getVisionCapability(options = {}) {
    const { allowedEngines, requireLocalVision = false } = options;

    if (allowedEngines && !allowedEngines.includes('llm-vision')) {
      return { available: false, reason: _t('ocr.visionBlockedByPrivacy', '当前隐私模式已禁用视觉模型') };
    }
    if (this._visionLocked) {
      return { available: false, reason: _t('ocr.visionLocked', 'LLM 视觉识别已因多次失败被禁用') };
    }

    const endpoint = this.configs['llm-vision']?.endpoint || DEFAULT_VISION_ENDPOINT;
    const local = isLoopbackEndpoint(endpoint);
    // Offline mode's promise is that nothing leaves the machine, and a capture
    // leaks far more than a line of text — a remote vision endpoint is refused
    // rather than silently used.
    if (requireLocalVision && !local) {
      return { available: false, reason: _t('ocr.visionNotLocal', '离线模式只允许本机视觉模型') };
    }

    return { available: true, local, endpoint, model: this.configs['llm-vision']?.model || '' };
  }

  // String-match against known "model doesn't speak images" failure modes
  // from OpenAI-compatible servers, LM Studio, and timeout cases. Endpoint-level
  // "nothing loaded" also degrades: hammering an empty server helps nobody and
  // the local chain serves the capture instead.
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
           lower.includes('no models loaded') ||
           lower.includes('no model loaded') ||
           lower.includes('timeout') ||
           lower.includes('超时');
  }

  async _handleVisionFallback(input, options, originalError) {
    this._incrementVisionFail();

    logger.info(`LLM Vision failed (${this._visionFailCount}/${this._visionFailThreshold}), falling back to local chain`);

    const fallbackResult = await this._recognizeWithLocalChain(input, options);

    // Callers read these to surface a "we switched engines" notice; the lock
    // flag rides along so the notice can say "disabled until re-enabled"
    // without a second IPC round trip.
    if (fallbackResult.success) {
      fallbackResult.fallbackFrom = 'llm-vision';
      fallbackResult.fallbackReason = originalError;
      fallbackResult.visionLocked = this._visionLocked;
    }

    return fallbackResult;
  }

  // Walk rapid-ocr -> windows-ocr; first usable result wins. Last failure is
  // returned so the caller still sees a meaningful error.
  async _recognizeWithLocalChain(input, options) {
    let lastResult = null;
    let weakest = null;
    for (const engineId of this._localFallbackChain) {
      const instance = this.getOrCreate(engineId);
      if (!instance || !(await instance.isAvailable())) continue;

      lastResult = await this._recognizeWithEngine(engineId, input, options);
      if (!lastResult.success) continue;
      if (isUsableResult(lastResult, engineId)) return lastResult;
      if (!weakest || (lastResult.confidence || 0) > (weakest.confidence || 0)) weakest = lastResult;
    }
    if (weakest) return { ...weakest, lowQuality: true };
    return lastResult || { success: false, error: _t('ocr.allEnginesFailed', 'All OCR engines failed') };
  }

  _incrementVisionFail() {
    this._visionFailCount++;
    if (this._visionFailCount >= this._visionFailThreshold) {
      this._visionLocked = true;
      logger.warn(`LLM Vision locked after ${this._visionFailCount} failures. User must re-enable in settings.`);
    }
  }
}

export default OCREngineManager;
