// src/components/GlassTranslator/utils.js
// 玻璃板工具函数

import { DISPLAY_MODE } from '../../stores/session.js';

/**
 * 根据 OCR 结果判断显示模式
 * 
 * 规则：
 * 1. 只有1个文本块 → 整体模式
 * 2. 多个文本块垂直排列紧密（间距<平均行高*1.5） → 整体模式
 * 3. 文本块分散或水平错开较大 → 散点模式
 * 
 * @param {Array} blocks - OCR 文本块数组 [{ text, bbox: {x,y,width,height} }]
 * @returns {string} 'unified' | 'scattered'
 */
export function detectDisplayMode(blocks) {
  if (!blocks || blocks.length === 0) {
    return DISPLAY_MODE.UNIFIED;
  }
  
  // 单个文本块 → 整体模式
  if (blocks.length === 1) {
    return DISPLAY_MODE.UNIFIED;
  }
  
  // 计算平均行高
  const avgHeight = blocks.reduce((sum, b) => sum + b.bbox.height, 0) / blocks.length;
  
  // 按 Y 坐标排序
  const sorted = [...blocks].sort((a, b) => a.bbox.y - b.bbox.y);
  
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
    
    // 如果垂直间距过大（超过1.5倍行高）或有重叠
    if (verticalGap > avgHeight * 1.5 || verticalGap < -avgHeight * 0.5) {
      isVerticallyAligned = false;
      break;
    }
  }
  
  // 如果水平偏移过大（超过平均宽度的50%），认为是散点
  const avgWidth = blocks.reduce((sum, b) => sum + b.bbox.width, 0) / blocks.length;
  if (maxHorizontalOffset > avgWidth * 0.5) {
    isVerticallyAligned = false;
  }
  
  return isVerticallyAligned ? DISPLAY_MODE.UNIFIED : DISPLAY_MODE.SCATTERED;
}

/**
 * 合并紧密排列的文本块为一个整体
 * @param {Array} blocks - OCR 文本块数组
 * @returns {string} 合并后的文本
 */
export function mergeBlocksToText(blocks) {
  if (!blocks || blocks.length === 0) return '';
  
  // 按 Y 坐标排序，然后按 X 排序
  const sorted = [...blocks].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    // 如果 Y 坐标接近（在同一行），按 X 排序
    if (Math.abs(yDiff) < a.bbox.height * 0.5) {
      return a.bbox.x - b.bbox.x;
    }
    return yDiff;
  });
  
  return sorted.map(b => b.text).join('\n');
}

/**
 * 检查子玻璃板是否拖出了母玻璃板
 * @param {Object} paneRect - 子玻璃板位置 {x, y, width, height}
 * @param {Object} parentRect - 母玻璃板位置 {x, y, width, height}
 * @returns {boolean}
 */
export function isPaneOutsideParent(paneRect, parentRect) {
  // 计算子玻璃板中心点
  const paneCenterX = paneRect.x + paneRect.width / 2;
  const paneCenterY = paneRect.y + paneRect.height / 2;
  
  // 检查中心点是否在母玻璃板外
  return (
    paneCenterX < parentRect.x ||
    paneCenterX > parentRect.x + parentRect.width ||
    paneCenterY < parentRect.y ||
    paneCenterY > parentRect.y + parentRect.height
  );
}

/**
 * 计算子玻璃板的屏幕绝对位置
 * @param {Object} relativeRect - 相对于截图区域的位置
 * @param {Object} captureOffset - 截图区域在屏幕上的偏移 {x, y}
 * @returns {Object} 屏幕绝对位置
 */
export function calculateAbsolutePosition(relativeRect, captureOffset) {
  return {
    x: relativeRect.x + captureOffset.x,
    y: relativeRect.y + captureOffset.y,
    width: relativeRect.width,
    height: relativeRect.height,
  };
}

/**
 * 限制位置在屏幕范围内
 * @param {Object} rect - 位置 {x, y, width, height}
 * @param {Object} screenBounds - 屏幕边界 {width, height}
 * @returns {Object} 调整后的位置
 */
export function clampToScreen(rect, screenBounds) {
  return {
    x: Math.max(0, Math.min(rect.x, screenBounds.width - rect.width)),
    y: Math.max(0, Math.min(rect.y, screenBounds.height - rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 自动调整子玻璃板大小以适应翻译文本
 * @param {string} text - 翻译文本
 * @param {Object} originalRect - 原始位置
 * @param {number} fontSize - 字体大小（默认14）
 * @returns {Object} 调整后的位置
 */
export function autoResizePane(text, originalRect, fontSize = 14) {
  if (!text) return originalRect;
  
  // 估算文本宽度和高度
  const charWidth = fontSize * 0.6;  // 平均字符宽度
  const lineHeight = fontSize * 1.5;
  
  // 计算每行字符数（保持原宽度）
  const charsPerLine = Math.floor(originalRect.width / charWidth);
  
  // 计算需要的行数
  const lines = text.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    totalLines += Math.ceil(line.length / charsPerLine) || 1;
  }
  
  // 计算新高度（最小保持原高度）
  const newHeight = Math.max(originalRect.height, totalLines * lineHeight + 16);  // +16 for padding
  
  return {
    ...originalRect,
    height: newHeight,
  };
}
