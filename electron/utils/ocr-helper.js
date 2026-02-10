// electron/utils/ocr-helper.js
// OCR 工具函数 - 供主进程各模块调用
// 基于 RapidOCR (PaddleOCR)，不依赖 Tesseract

const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./logger')('OCR-Helper');
const { smartMerge, mergedBlocksToText } = require('./text-merger');

/**
 * 使用 RapidOCR 识别图片中的文字
 * 
 * @param {string|Buffer} imageData - base64 图片数据或 Buffer
 * @param {Object} options - 选项
 * @param {boolean} options.withBlocks - 是否返回文本块坐标
 * @param {boolean} options.merge - 是否智能合并段落，默认 true
 * @returns {Promise<{success: boolean, text?: string, blocks?: Array, error?: string}>}
 */
async function recognizeWithRapidOCR(imageData, options = {}) {
  const { withBlocks = false, merge = true } = options;
  
  let tempFile = null;
  
  try {
    // 准备图片数据
    let imageBuffer;
    if (Buffer.isBuffer(imageData)) {
      imageBuffer = imageData;
    } else if (typeof imageData === 'string') {
      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      return { success: false, error: '无效的图片数据格式' };
    }
    
    // 写入临时文件
    tempFile = path.join(os.tmpdir(), `t-translate-ocr-${Date.now()}.png`);
    fs.writeFileSync(tempFile, imageBuffer);
    
    let result = null;
    let lastError = null;
    
    // 尝试 multilingual-purejs-ocr
    try {
      const pureJsModule = await import('multilingual-purejs-ocr');
      const OcrClass = pureJsModule.Ocr || pureJsModule.default?.Ocr || pureJsModule.default;
      
      if (typeof OcrClass === 'function') {
        if (!global.pureJsOcrInstance) {
          global.pureJsOcrInstance = new OcrClass();
        }
        
        const imgBuffer = fs.readFileSync(tempFile);
        result = await global.pureJsOcrInstance.recognize(imgBuffer);
        
        if (result) {
          let text = typeof result === 'string' ? result : result.text || '';
          if (Array.isArray(result)) {
            text = result.map(item => item.text || item[1]?.[0] || String(item)).join('\n');
          }
          
          if (text) {
            cleanupTempFile(tempFile);
            return {
              success: true,
              text: text.trim(),
              confidence: 0.9,
              engine: 'purejs-ocr',
            };
          }
        }
      }
    } catch (e) {
      lastError = e;
      logger.debug('purejs-ocr failed:', e.message);
    }
    
    // 尝试 @gutenye/ocr-node
    try {
      const ocrModule = await import('@gutenye/ocr-node');
      let Ocr = ocrModule.default;
      if (!Ocr?.create) Ocr = ocrModule.Ocr;
      if (!Ocr?.create && typeof ocrModule.create === 'function') Ocr = ocrModule;
      
      if (Ocr?.create) {
        if (!global.gutenyeOcrInstance) {
          global.gutenyeOcrInstance = await Ocr.create();
        }
        
        result = await global.gutenyeOcrInstance.detect(tempFile);
        
        if (result?.length > 0) {
          // 提取文本块
          const blocks = result.map((item, index) => {
            let bbox = null;
            
            if (item.box || item.bbox || item.position) {
              const box = item.box || item.bbox || item.position;
              if (Array.isArray(box) && box.length >= 4) {
                const xs = box.map(p => p[0] || p.x || 0);
                const ys = box.map(p => p[1] || p.y || 0);
                bbox = {
                  x: Math.min(...xs),
                  y: Math.min(...ys),
                  width: Math.max(...xs) - Math.min(...xs),
                  height: Math.max(...ys) - Math.min(...ys),
                };
              }
            }
            
            return {
              text: item.text,
              confidence: item.score || 0.9,
              bbox: bbox,
              index,
            };
          });
          
          // 智能段落合并
          let finalBlocks = blocks;
          let fullText;
          
          if (merge) {
            finalBlocks = smartMerge(blocks, {
              lineGapThreshold: 1.5,
              xOverlapRatio: 0.3,
            });
            fullText = mergedBlocksToText(finalBlocks);
            logger.debug(`OCR merge: ${blocks.length} -> ${finalBlocks.length} paragraphs`);
          } else {
            fullText = blocks.map(b => b.text).join('\n');
          }
          
          cleanupTempFile(tempFile);
          
          const response = {
            success: true,
            text: fullText.trim(),
            confidence: finalBlocks.reduce((sum, b) => sum + (b.confidence || 0.9), 0) / finalBlocks.length,
            engine: 'gutenye-ocr',
          };
          
          if (withBlocks) {
            response.blocks = finalBlocks;
            response.rawBlocks = blocks;
          }
          
          return response;
        }
      }
    } catch (e) {
      lastError = lastError || e;
      logger.debug('gutenye-ocr failed:', e.message);
    }
    
    cleanupTempFile(tempFile);
    
    if (lastError) {
      return { success: false, error: `OCR 引擎加载失败: ${lastError.message}` };
    }
    
    return { success: true, text: '', confidence: 0, engine: 'none' };
    
  } catch (error) {
    logger.error('RapidOCR failed:', error);
    cleanupTempFile(tempFile);
    return { success: false, error: error.message };
  }
}

/**
 * 清理临时文件
 */
function cleanupTempFile(filePath) {
  if (filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // 忽略
    }
  }
}

module.exports = {
  recognizeWithRapidOCR,
};
