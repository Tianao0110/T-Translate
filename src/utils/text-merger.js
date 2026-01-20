// src/utils/text-merger.js
// 智能段落合并算法 - 将 OCR 碎片化结果合并为自然段落
// 全局通用：玻璃板翻译、截图翻译、划词翻译等

/**
 * 智能合并 OCR 文本块为段落
 * 
 * 核心逻辑：
 * 1. 按 Y 坐标排序（从上到下）
 * 2. 判断相邻行是否属于同一段落：
 *    - Y 距离 < 行高的阈值倍数
 *    - X 方向有重叠（左边距接近）
 * 3. 合并同段落的文本和边界框
 * 
 * @param {Array} ocrItems - OCR 返回的文本块数组
 *   每项格式: { text: string, bbox: { x, y, width, height } }
 * @param {Object} options - 合并选项
 * @param {number} options.lineGapThreshold - 行间距阈值（相对于行高的倍数），默认 1.5
 * @param {number} options.xOverlapRatio - X 方向最小重叠比例，默认 0.3
 * @param {boolean} options.preserveLineBreaks - 合并时是否保留换行符，默认 true
 * @returns {Array} 合并后的段落数组
 */
export function smartMerge(ocrItems, options = {}) {
  if (!ocrItems || ocrItems.length === 0) {
    return [];
  }
  
  // 只有一个块，直接返回
  if (ocrItems.length === 1) {
    return [...ocrItems];
  }
  
  const {
    lineGapThreshold = 1.5,   // 行间距超过行高的 1.5 倍视为新段落
    xOverlapRatio = 0.3,      // X 方向至少 30% 重叠才合并
    preserveLineBreaks = true, // 合并时保留换行符
  } = options;
  
  // 1. 过滤无效项并按 Y 坐标排序（从上到下）
  const validItems = ocrItems.filter(item => 
    item && 
    item.text && 
    item.text.trim() && 
    item.bbox && 
    item.bbox.height > 0
  );
  
  if (validItems.length === 0) {
    return [];
  }
  
  const sorted = [...validItems].sort((a, b) => {
    // 主排序：Y 坐标
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) > 5) return yDiff;
    // 次排序：X 坐标（同一行从左到右）
    return a.bbox.x - b.bbox.x;
  });
  
  // 2. 合并算法
  const paragraphs = [];
  let currentBlock = createMergeBlock(sorted[0]);
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const nextBbox = next.bbox;
    
    // 计算当前块的底部 Y 坐标
    const currentBottom = currentBlock.bbox.y + currentBlock.bbox.height;
    
    // 计算 Y 方向间距
    const yGap = nextBbox.y - currentBottom;
    
    // 计算平均行高
    const avgHeight = (currentBlock.bbox.height + nextBbox.height) / 2;
    
    // 条件 1: Y 距离是否在阈值内
    const isYClose = yGap < avgHeight * lineGapThreshold;
    
    // 条件 2: X 方向是否有足够重叠
    const hasXOverlap = checkXOverlap(currentBlock.bbox, nextBbox, xOverlapRatio);
    
    // 条件 3: 检查是否是同一行的延续（Y 坐标非常接近）
    const isSameLine = Math.abs(nextBbox.y - currentBlock.bbox.y) < avgHeight * 0.5;
    
    // 判断是否属于同一段落
    const shouldMerge = (isYClose && hasXOverlap) || isSameLine;
    
    if (shouldMerge) {
      // ✅ 合并：拼接文本，扩展边界框
      mergeBlocks(currentBlock, next, { preserveLineBreaks, isSameLine });
    } else {
      // ❌ 断开：保存当前段落，开始新段落
      paragraphs.push(finalizeBlock(currentBlock));
      currentBlock = createMergeBlock(next);
    }
  }
  
  // 保存最后一个段落
  paragraphs.push(finalizeBlock(currentBlock));
  
  return paragraphs;
}

/**
 * 创建合并工作块
 */
function createMergeBlock(item) {
  return {
    text: item.text.trim(),
    bbox: { ...item.bbox },
    // 保存原始块用于调试
    _sourceBlocks: [item],
  };
}

/**
 * 合并两个块
 */
function mergeBlocks(target, source, options = {}) {
  const { preserveLineBreaks = true, isSameLine = false } = options;
  
  // 合并文本
  const separator = isSameLine ? ' ' : (preserveLineBreaks ? '\n' : ' ');
  target.text = target.text + separator + source.text.trim();
  
  // 扩展边界框
  const newRight = Math.max(
    target.bbox.x + target.bbox.width,
    source.bbox.x + source.bbox.width
  );
  const newBottom = Math.max(
    target.bbox.y + target.bbox.height,
    source.bbox.y + source.bbox.height
  );
  
  target.bbox.x = Math.min(target.bbox.x, source.bbox.x);
  target.bbox.y = Math.min(target.bbox.y, source.bbox.y);
  target.bbox.width = newRight - target.bbox.x;
  target.bbox.height = newBottom - target.bbox.y;
  
  // 记录源块
  target._sourceBlocks.push(source);
}

/**
 * 完成块处理（移除内部属性）
 */
function finalizeBlock(block) {
  return {
    text: block.text,
    bbox: block.bbox,
    // 可选：保留合并了多少个原始块的信息
    mergedCount: block._sourceBlocks?.length || 1,
  };
}

/**
 * 检查 X 方向重叠
 */
function checkXOverlap(bbox1, bbox2, minOverlapRatio) {
  const left1 = bbox1.x;
  const right1 = bbox1.x + bbox1.width;
  const left2 = bbox2.x;
  const right2 = bbox2.x + bbox2.width;
  
  // 计算重叠区域
  const overlapLeft = Math.max(left1, left2);
  const overlapRight = Math.min(right1, right2);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  
  // 计算较小宽度
  const minWidth = Math.min(bbox1.width, bbox2.width);
  
  // 重叠比例
  const overlapRatio = minWidth > 0 ? overlapWidth / minWidth : 0;
  
  return overlapRatio >= minOverlapRatio;
}

/**
 * 快速合并：只按 Y 坐标合并相邻行
 * 适用于简单场景（如字幕）
 * 
 * @param {Array} ocrItems - OCR 文本块数组
 * @param {number} maxGap - 最大行间距（像素）
 * @returns {Array} 合并后的段落数组
 */
export function quickMerge(ocrItems, maxGap = 20) {
  if (!ocrItems || ocrItems.length === 0) return [];
  if (ocrItems.length === 1) return [...ocrItems];
  
  const sorted = [...ocrItems].sort((a, b) => a.bbox.y - b.bbox.y);
  const result = [];
  let current = { ...sorted[0], bbox: { ...sorted[0].bbox } };
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const gap = next.bbox.y - (current.bbox.y + current.bbox.height);
    
    if (gap < maxGap) {
      // 合并
      current.text += '\n' + next.text;
      current.bbox.height = (next.bbox.y + next.bbox.height) - current.bbox.y;
      current.bbox.width = Math.max(current.bbox.width, next.bbox.width);
    } else {
      // 断开
      result.push(current);
      current = { ...next, bbox: { ...next.bbox } };
    }
  }
  
  result.push(current);
  return result;
}

/**
 * 判断文本块数组是否应该使用散点模式
 * 
 * @param {Array} blocks - 文本块数组
 * @param {Object} options - 判断选项
 * @returns {boolean} true = 散点模式，false = 整体模式
 */
export function shouldUseScatteredMode(blocks, options = {}) {
  if (!blocks || blocks.length === 0) return false;
  if (blocks.length === 1) return false;  // 单块用整体模式
  
  const { minDistance = 50 } = options;
  
  // 检查块之间是否有足够的距离
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const b1 = blocks[i].bbox;
      const b2 = blocks[j].bbox;
      
      // 计算中心点距离
      const cx1 = b1.x + b1.width / 2;
      const cy1 = b1.y + b1.height / 2;
      const cx2 = b2.x + b2.width / 2;
      const cy2 = b2.y + b2.height / 2;
      
      const distance = Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);
      
      // 如果有块之间距离足够远，使用散点模式
      if (distance > minDistance) {
        return true;
      }
    }
  }
  
  return false;
}

export default {
  smartMerge,
  quickMerge,
  shouldUseScatteredMode,
};
