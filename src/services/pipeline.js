// src/services/pipeline.js
// 翻译流水线 - 核心大脑
// 串联：截图 -> OCR -> 翻译
// 支持隐私模式检查
// 支持散点模式（子玻璃板）

import { ocrManager } from '../providers/ocr/index.js';
import translationService from './translation.js';
import useSessionStore, { DISPLAY_MODE, CHILD_PANE_STATUS } from '../stores/session.js';
import useConfigStore from '../stores/config.js';
import { calculateHash } from '../utils/image.js';
import { detectLanguage, cleanTranslationOutput, shouldTranslateText } from '../utils/text.js';
import { isProviderAllowed, isOcrEngineAllowed, PRIVACY_MODE_IDS } from '../config/privacy-modes.js';
import { smartMerge } from '../utils/text-merger.js';
import createLogger from '../utils/logger.js';
import { getShortErrorMessage } from '../utils/error-handler.js';

// 日志实例
const logger = createLogger('Pipeline');

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
    logger.debug('Failed to get privacy mode from main:', e.message);
  }
  return PRIVACY_MODE_IDS.STANDARD;
}

/**
 * 判断是否应使用散点模式
 * @param {Array} blocks - OCR 文本块数组
 * @returns {boolean}
 */
function shouldUseScatteredMode(blocks) {
  if (!blocks || blocks.length === 0) return false;
  if (blocks.length === 1) return false;
  
  // 检查是否有坐标信息
  const hasCoordinates = blocks.some(b => b.bbox && b.bbox.width > 0);
  if (!hasCoordinates) return false;
  
  // 计算平均行高
  const validBlocks = blocks.filter(b => b.bbox && b.bbox.height > 0);
  if (validBlocks.length < 2) return false;
  
  const avgHeight = validBlocks.reduce((sum, b) => sum + b.bbox.height, 0) / validBlocks.length;
  
  // 按 Y 坐标排序
  const sorted = [...validBlocks].sort((a, b) => a.bbox.y - b.bbox.y);
  
  // 检查是否垂直紧密排列
  let isVerticallyAligned = true;
  let maxHorizontalOffset = 0;
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    
    // 计算垂直间距
    const verticalGap = curr.bbox.y - (prev.bbox.y + prev.bbox.height);
    
    // 计算水平偏移
    const horizontalOffset = Math.abs(curr.bbox.x - prev.bbox.x);
    maxHorizontalOffset = Math.max(maxHorizontalOffset, horizontalOffset);
    
    // 如果垂直间距过大（超过2倍行高）或有较大重叠
    if (verticalGap > avgHeight * 2 || verticalGap < -avgHeight * 0.3) {
      isVerticallyAligned = false;
      break;
    }
  }
  
  // 如果水平偏移过大（超过平均宽度的40%），认为是散点
  const avgWidth = validBlocks.reduce((sum, b) => sum + b.bbox.width, 0) / validBlocks.length;
  if (maxHorizontalOffset > avgWidth * 0.4) {
    isVerticallyAligned = false;
  }
  
  return !isVerticallyAligned;
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
    
    logger.debug(' Initializing...');
    
    // 从设置中读取 LLM endpoint
    let llmEndpoint = 'http://localhost:1234/v1';
    try {
      const settings = await window.electron?.store?.get?.('settings') || {};
      llmEndpoint = settings.llm?.endpoint || llmEndpoint;
    } catch (e) {
      logger.debug(' Failed to get LLM endpoint from settings:', e);
    }
    
    // 初始化 OCR 管理器
    const config = useConfigStore.getState();
    await ocrManager.init({
      'rapid-ocr': {},
      'llm-vision': { endpoint: llmEndpoint },
    });
    ocrManager.setPriority(config.ocrPriority);
    
    // 初始化翻译源管理器
    // 配置从 electron store 加载（在 GlassTranslator 中已处理）
    
    this._initialized = true;
    logger.debug(' Initialized');
  }

  /**
   * 执行翻译任务（完整流程：截图区域 -> OCR -> 翻译）
   * @param {object} captureOptions - 截图选项
   */
  async runFromCapture(captureOptions = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      // 清除之前的子玻璃板（保留冻结的）
      session.clearChildPanes();
      
      // 重置图片缓存，允许重新识别相同图片
      lastImageHash = '';
      lastText = '';
      
      // 1. 截图
      session.startCapture();
      
      const captureResult = await window.electron?.glass?.captureRegion?.(captureOptions);
      if (!captureResult?.success) {
        throw new Error(captureResult?.error || '截图失败');
      }
      
      // 2. 运行 OCR -> 翻译
      return await this.runFromImage(captureResult.imageData, captureOptions);
      
    } catch (error) {
      logger.error('Capture error:', error);
      const errorMsg = getShortErrorMessage(error);
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 从图片执行翻译（OCR -> 翻译）
   * @param {string} imageData - base64 图片数据
   * @param {object} captureOptions - 截图选项（用于计算坐标偏移）
   */
  async runFromImage(imageData, captureOptions = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      // 1. 图片去重检查
      const hash = await calculateHash(imageData);
      if (hash === lastImageHash) {
        logger.debug(' Image unchanged, skipping');
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
      
      // 3. 判断显示模式
      // 玻璃板需要覆盖原文，使用原始块（rawBlocks）保持每行独立
      // 合并块（blocks）用于整体翻译模式的文本
      const mergedBlocks = ocrResult.blocks || [];
      const rawBlocks = ocrResult.rawBlocks || mergedBlocks;
      const useScattered = shouldUseScatteredMode(rawBlocks);
      
      logger.debug(` Display mode: ${useScattered ? 'scattered' : 'unified'}`);
      logger.debug(` Raw blocks: ${rawBlocks.length}, Merged blocks: ${mergedBlocks.length}`);
      if (rawBlocks.length > 0) {
        logger.debug(' First raw block bbox:', rawBlocks[0]?.bbox);
        logger.debug(' Capture options:', captureOptions);
      }
      
      if (useScattered && rawBlocks.length > 0) {
        // 散点模式：使用原始块（每行独立），覆盖在原文位置
        return await this.runScatteredMode(rawBlocks, captureOptions);
      }
      
      // 整体模式：继续原有流程
      // 4. 文本去重检查
      if (text === lastText) {
        logger.debug(' Text unchanged, skipping');
        return { success: true, skipped: true };
      }
      lastText = text;
      
      // 5. 检查是否值得翻译
      if (!shouldTranslateText(text)) {
        session.setResult(text);  // 直接显示原文
        return { success: true, text };
      }
      
      session.setSourceText(text);
      
      // 6. 翻译
      return await this.runFromText(text);
      
    } catch (error) {
      logger.error('Image processing error:', error);
      const errorMsg = getShortErrorMessage(error, { context: 'ocr' });
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 散点模式：为每个文本块创建子玻璃板并翻译
   * @param {Array} blocks - OCR 文本块数组（已合并）
   * @param {object} captureOptions - 截图选项
   */
  async runScatteredMode(blocks, captureOptions = {}) {
    const session = useSessionStore.getState();
    const config = useConfigStore.getState();
    
    try {
      // 获取 DPI 缩放因子
      const scaleFactor = window.devicePixelRatio || 1;
      logger.debug(` ScaleFactor for coordinate conversion: ${scaleFactor}`);
      
      // 1. 过滤有效的文本块（有坐标且有文字）
      // 同时将物理像素坐标转换为逻辑像素坐标
      const validBlocks = blocks
        .filter(b => 
          b.text?.trim() && 
          b.bbox && 
          b.bbox.width > 0 && 
          b.bbox.height > 0
        )
        .map(b => ({
          ...b,
          // OCR 返回的是物理像素坐标，需要转换为 CSS 逻辑像素
          bbox: {
            x: Math.round(b.bbox.x / scaleFactor),
            y: Math.round(b.bbox.y / scaleFactor),
            width: Math.round(b.bbox.width / scaleFactor),
            height: Math.round(b.bbox.height / scaleFactor),
          }
        }));
      
      if (validBlocks.length === 0) {
        session.setResult('（未识别到有效文字）');
        return { success: true, text: '' };
      }
      
      logger.debug(` Valid blocks count: ${validBlocks.length}`);
      if (validBlocks.length > 0) {
        logger.debug(` First block:`, {
          text: validBlocks[0].text?.substring(0, 50),
          bbox: validBlocks[0].bbox,
          mergedCount: validBlocks[0].mergedCount,
        });
      }
      
      // 2. 设置为散点模式，创建子玻璃板
      // 注意：传入的 blocks 已经在主进程合并过了
      session.setDisplayMode(DISPLAY_MODE.SCATTERED);
      const createdPanes = session.setChildPanes(validBlocks);
      session.setStatus('translating');
      
      // 3. 获取翻译配置
      const privacyMode = await getPrivacyMode();
      
      // 4. 限制并发翻译数量（每次最多2个，避免卡顿）
      const CONCURRENCY_LIMIT = 2;
      const translatePane = async (pane, index) => {
        const paneId = pane.id;
        
        try {
          // 更新状态为翻译中
          session.updateChildPane(paneId, { status: CHILD_PANE_STATUS.TRANSLATING });
          
          const text = pane.sourceText.trim();
          
          // 检查是否值得翻译
          if (!shouldTranslateText(text)) {
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.DONE,
              translatedText: text,  // 直接显示原文
            });
            return;
          }
          
          // 检测源语言
          const sourceLang = detectLanguage(text);
          
          // 确定目标语言
          let targetLang = config.targetLanguage;
          if (!config.lockTargetLang && sourceLang === targetLang) {
            targetLang = targetLang === 'zh' ? 'en' : 'zh';
          }
          
          // 执行翻译
          const result = await translationService.translate(text, {
            sourceLang,
            targetLang,
            mode: 'normal',
            privacyMode,
          });
          
          if (result.success && result.text) {
            const cleaned = cleanTranslationOutput(result.text, text);
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.DONE,
              translatedText: cleaned || result.text,
            });
          } else {
            session.updateChildPane(paneId, {
              status: CHILD_PANE_STATUS.ERROR,
              error: result.error || '翻译失败',
            });
          }
        } catch (error) {
          logger.error(`Block ${index} translation error:`, error);
          session.updateChildPane(paneId, {
            status: CHILD_PANE_STATUS.ERROR,
            error: getShortErrorMessage(error),
          });
        }
      };
      
      // 分批执行翻译，每批最多 CONCURRENCY_LIMIT 个
      for (let i = 0; i < createdPanes.length; i += CONCURRENCY_LIMIT) {
        const batch = createdPanes.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map((pane, idx) => translatePane(pane, i + idx)));
      }
      
      // 5. 设置整体状态为完成
      session.setStatus('success');
      
      // 6. 添加到历史记录（合并所有文本）
      const currentState = useSessionStore.getState();
      const allSource = createdPanes.map(p => p.sourceText).join('\n');
      const allTranslated = currentState.childPanes
        .map(p => p.translatedText)
        .filter(Boolean)
        .join('\n');
      
      if (allTranslated) {
        currentState.addToHistory({
          source: allSource,
          translated: allTranslated,
          mode: 'scattered',
          blockCount: createdPanes.length,
        });
      }
      
      return { success: true, mode: 'scattered', blockCount: createdPanes.length };
      
    } catch (error) {
      logger.error('Scattered mode error:', error);
      const errorMsg = getShortErrorMessage(error);
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
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
      if (privacyMode === PRIVACY_MODE_IDS.OFFLINE) {
        logger.debug(' Offline mode - using local-llm only');
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
      logger.error('Translation error:', error);
      const errorMsg = getShortErrorMessage(error, { context: 'translation' });
      session.setError(errorMsg);
      return { success: false, error: errorMsg };
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
      logger.error('Subtitle frame error:', error);
      session.setSubtitleStatus('listening');
      const errorMsg = getShortErrorMessage(error);
      return { success: false, error: errorMsg };
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
