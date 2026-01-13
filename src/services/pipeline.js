// src/services/pipeline.js
// 翻译流水线 - 核心大脑
// 串联：截图 -> OCR -> 翻译
// 支持隐私模式检查

import { ocrManager } from '../providers/ocr/index.js';
import translationService from './translation.js';
import useSessionStore from '../stores/session.js';
import useConfigStore from '../stores/config.js';
import { calculateHash } from '../utils/image.js';
import { detectLanguage, cleanTranslationOutput, shouldTranslateText } from '../utils/text.js';
import { isProviderAllowed, isOcrEngineAllowed } from '../config/privacy-modes.js';

// ========== 状态缓存 ==========
let lastImageHash = '';
let lastText = '';

/**
 * 获取当前隐私模式
 * 从主进程或本地存储获取
 */
async function getPrivacyMode() {
  try {
    if (window.electron?.privacy?.getMode) {
      return await window.electron.privacy.getMode();
    }
  } catch (e) {
    console.log('[Pipeline] Failed to get privacy mode from main:', e);
  }
  return 'standard';
}

/**
 * 翻译流水线类
 */
class TranslationPipeline {
  constructor() {
    this._initialized = false;
  }

  /**
   * 初始化
   */
  async init() {
    if (this._initialized) return;
    
    console.log('[Pipeline] Initializing...');
    
    // 初始化 OCR 管理器
    const config = useConfigStore.getState();
    await ocrManager.init({
      'rapid-ocr': {},
      'llm-vision': { endpoint: 'http://localhost:1234/v1' },
    });
    ocrManager.setPriority(config.ocrPriority);
    
    // 初始化翻译源管理器
    // 配置从 electron store 加载（在 GlassTranslator 中已处理）
    
    this._initialized = true;
    console.log('[Pipeline] Initialized');
  }

  /**
   * 执行翻译任务（完整流程：截图区域 -> OCR -> 翻译）
   * @param {object} captureOptions - 截图选项
   */
  async runFromCapture(captureOptions = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      // 1. 截图
      session.startCapture();
      
      const captureResult = await window.electron?.glass?.captureRegion?.(captureOptions);
      if (!captureResult?.success) {
        throw new Error(captureResult?.error || '截图失败');
      }
      
      // 2. 运行 OCR -> 翻译
      return await this.runFromImage(captureResult.imageData);
      
    } catch (error) {
      console.error('[Pipeline] Capture error:', error);
      session.setError(error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从图片执行翻译（OCR -> 翻译）
   * @param {string} imageData - base64 图片数据
   */
  async runFromImage(imageData) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      // 1. 图片去重检查
      const hash = await calculateHash(imageData);
      if (hash === lastImageHash) {
        console.log('[Pipeline] Image unchanged, skipping');
        return { success: true, skipped: true };
      }
      lastImageHash = hash;
      
      // 2. OCR 识别
      session.startOcr();
      
      const ocrResult = await ocrManager.recognize(imageData, {
        engine: config.ocrEngine,
      });
      
      if (!ocrResult.success) {
        throw new Error(ocrResult.error || 'OCR 失败');
      }
      
      const text = ocrResult.text?.trim();
      if (!text) {
        session.setResult('（未识别到文字）');
        return { success: true, text: '' };
      }
      
      // 3. 文本去重检查
      if (text === lastText) {
        console.log('[Pipeline] Text unchanged, skipping');
        return { success: true, skipped: true };
      }
      lastText = text;
      
      // 4. 检查是否值得翻译
      if (!shouldTranslateText(text)) {
        session.setResult(text);  // 直接显示原文
        return { success: true, text };
      }
      
      session.setSourceText(text);
      
      // 5. 翻译
      return await this.runFromText(text);
      
    } catch (error) {
      console.error('[Pipeline] Image processing error:', error);
      session.setError(error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 从文本执行翻译
   * @param {string} text - 要翻译的文本
   * @param {object} options - 选项
   */
  async runFromText(text, options = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      session.startTranslation();
      
      // 检测源语言
      const sourceLang = detectLanguage(text);
      
      // 确定目标语言
      let targetLang = config.targetLanguage;
      if (!config.lockTargetLang && sourceLang === targetLang) {
        targetLang = targetLang === 'zh' ? 'en' : 'zh';
      }
      
      const mode = options.mode || 'normal';
      
      // 获取隐私模式
      const privacyMode = await getPrivacyMode();
      
      // 离线模式下检查翻译源
      if (privacyMode === 'offline') {
        console.log('[Pipeline] Offline mode - using local-llm only');
      }
      
      // 调用翻译（传递隐私模式）
      const result = await translationService.translate(text, {
        sourceLang,
        targetLang,
        mode,
        privacyMode, // 传递隐私模式
      });
      
      if (!result.success) {
        throw new Error(result.error || '翻译失败');
      }
      
      // 清理输出
      const cleaned = cleanTranslationOutput(result.text, text);
      
      if (cleaned) {
        session.setResult(cleaned, result.provider);
        
        // 添加到历史
        session.addToHistory({
          source: text,
          translated: cleaned,
          sourceLang,
          targetLang,
          provider: result.provider,
        });
      }
      
      return { success: true, text: cleaned, provider: result.provider };
      
    } catch (error) {
      console.error('[Pipeline] Translation error:', error);
      session.setError(error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 字幕模式：处理单帧
   * @param {string} imageData - base64 图片数据
   */
  async processSubtitleFrame(imageData) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      // 1. 图片去重
      const hash = await calculateHash(imageData);
      if (hash === lastImageHash) {
        session.updateSubtitleStats({ skipped: session.subtitleStats.skipped + 1 });
        return { success: true, skipped: true };
      }
      lastImageHash = hash;
      
      // 2. OCR
      session.setSubtitleStatus('recognizing');
      
      const ocrResult = await ocrManager.recognize(imageData, {
        engine: 'rapid-ocr',  // 字幕模式强制用快速引擎
      });
      
      if (!ocrResult.success || !ocrResult.text?.trim()) {
        session.setSubtitleStatus('listening');
        return { success: true, text: '' };
      }
      
      const text = ocrResult.text.trim();
      
      // 3. 文本去重
      if (text === lastText) {
        session.setSubtitleStatus('listening');
        return { success: true, skipped: true };
      }
      lastText = text;
      
      // 4. 检查是否值得翻译
      if (!shouldTranslateText(text)) {
        session.setSubtitleStatus('listening');
        return { success: true, text };
      }
      
      // 5. 翻译（使用字幕模式优先级）
      session.setSubtitleStatus('translating');
      
      const sourceLang = detectLanguage(text);
      let targetLang = config.targetLanguage;
      if (!config.lockTargetLang && sourceLang === targetLang) {
        targetLang = targetLang === 'zh' ? 'en' : 'zh';
      }
      
      const result = await translationService.translate(text, {
        sourceLang,
        targetLang,
        mode: 'subtitle',
      });
      
      if (result.success && result.text) {
        const cleaned = cleanTranslationOutput(result.text, text);
        if (cleaned) {
          session.setSubtitle(cleaned);
          session.updateSubtitleStats({ processed: session.subtitleStats.processed + 1 });
        }
      }
      
      session.setSubtitleStatus('listening');
      return { success: true, text: result.text };
      
    } catch (error) {
      console.error('[Pipeline] Subtitle frame error:', error);
      session.setSubtitleStatus('listening');
      return { success: false, error: error.message };
    }
  }

  /**
   * 重置缓存
   */
  resetCache() {
    lastImageHash = '';
    lastText = '';
  }
}

// 单例导出
const pipeline = new TranslationPipeline();

export default pipeline;
export { TranslationPipeline, calculateHash, detectLanguage, cleanTranslationOutput, shouldTranslateText };
