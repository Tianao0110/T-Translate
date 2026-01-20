// electron/utils/text-merger.js
// 智能段落合并算法（主进程版本）
// 将 OCR 碎片化结果合并为自然段落

/**
 * 智能合并 OCR 文本块为段落
 * 
 * @param {Array} blocks - OCR 返回的文本块数组
 *   每项格式: { text: string, bbox: { x, y, width, height } }
 * @param {Object} options - 合并选项
 * @param {number} options.lineGapThreshold - 行间距阈值（相对于行高的倍数），默认 1.5
 * @param {number} options.xOverlapRatio - X 方向最小重叠比例，默认 0.3
 * @returns {Array} 合并后的段落数组
 */
function smartMerge(blocks, options = {}) {
  if (!blocks || blocks.length === 0) {
    return [];
  }
  
  if (blocks.length === 1) {
    return [...blocks];
  }
  
  const {
    lineGapThreshold = 1.5,
    xOverlapRatio = 0.3,
  } = options;
  
  // 过滤有效项并按 Y 坐标排序
  const validBlocks = blocks.filter(item => 
    item && 
    item.text && 
    item.text.trim() && 
    item.bbox && 
    item.bbox.height > 0
  );
  
  if (validBlocks.length === 0) {
    return [];
  }
  
  const sorted = [...validBlocks].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.bbox.x - b.bbox.x;
  });
  
  // 合并算法
  const paragraphs = [];
  let current = createBlock(sorted[0]);
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const nextBbox = next.bbox;
    
    const currentBottom = current.bbox.y + current.bbox.height;
    const yGap = nextBbox.y - currentBottom;
    const avgHeight = (current.bbox.height + nextBbox.height) / 2;
    
    // 条件1: Y 距离在阈值内
    const isYClose = yGap < avgHeight * lineGapThreshold;
    
    // 条件2: X 方向有重叠
    const hasXOverlap = checkXOverlap(current.bbox, nextBbox, xOverlapRatio);
    
    // 条件3: 同一行延续
    const isSameLine = Math.abs(nextBbox.y - current.bbox.y) < avgHeight * 0.5;
    
    const shouldMerge = (isYClose && hasXOverlap) || isSameLine;
    
    if (shouldMerge) {
      mergeBlocks(current, next, isSameLine);
    } else {
      paragraphs.push(finalizeBlock(current));
      current = createBlock(next);
    }
  }
  
  paragraphs.push(finalizeBlock(current));
  return paragraphs;
}

/**
 * 创建合并工作块
 */
function createBlock(item) {
  return {
    text: item.text.trim(),
    bbox: { ...item.bbox },
    confidence: item.confidence || 0.9,
    _count: 1,
  };
}

/**
 * 合并两个块
 */
function mergeBlocks(target, source, isSameLine = false) {
  const separator = isSameLine ? ' ' : '\n';
  target.text = target.text + separator + source.text.trim();
  
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
  
  // 平均置信度
  const newCount = target._count + 1;
  target.confidence = ((target.confidence * target._count) + (source.confidence || 0.9)) / newCount;
  target._count = newCount;
}

/**
 * 完成块处理
 */
function finalizeBlock(block) {
  return {
    text: block.text,
    bbox: block.bbox,
    confidence: block.confidence,
    mergedCount: block._count,
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
  
  const overlapLeft = Math.max(left1, left2);
  const overlapRight = Math.min(right1, right2);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  
  const minWidth = Math.min(bbox1.width, bbox2.width);
  const overlapRatio = minWidth > 0 ? overlapWidth / minWidth : 0;
  
  return overlapRatio >= minOverlapRatio;
}

/**
 * 将合并后的 blocks 转换为文本
 * @param {Array} mergedBlocks - 合并后的块数组
 * @returns {string} 合并后的文本
 */
function mergedBlocksToText(mergedBlocks) {
  if (!mergedBlocks || mergedBlocks.length === 0) {
    return '';
  }
  // 段落之间用双换行分隔
  return mergedBlocks.map(b => b.text).join('\n\n');
}

module.exports = {
  smartMerge,
  mergedBlocksToText,
};
