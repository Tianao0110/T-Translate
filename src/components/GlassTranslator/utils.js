// Geometry helpers for the glass overlay — display-mode detection, block
// merging, pane positioning.

import { DISPLAY_MODE } from '../../stores/session.js';

// Picks display mode from OCR block layout.
//   single block -> unified
//   tight vertical column (gaps < 1.5x line height, horizontal jitter < 50% width) -> unified
//   anything else -> scattered (one pane per block)
export function detectDisplayMode(blocks) {
  if (!blocks || blocks.length === 0) {
    return DISPLAY_MODE.UNIFIED;
  }

  if (blocks.length === 1) {
    return DISPLAY_MODE.UNIFIED;
  }

  const avgHeight = blocks.reduce((sum, b) => sum + b.bbox.height, 0) / blocks.length;

  const sorted = [...blocks].sort((a, b) => a.bbox.y - b.bbox.y);

  let isVerticallyAligned = true;
  let maxHorizontalOffset = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const verticalGap = curr.bbox.y - (prev.bbox.y + prev.bbox.height);

    const horizontalOffset = Math.abs(curr.bbox.x - prev.bbox.x);
    maxHorizontalOffset = Math.max(maxHorizontalOffset, horizontalOffset);

    if (verticalGap > avgHeight * 1.5 || verticalGap < -avgHeight * 0.5) {
      isVerticallyAligned = false;
      break;
    }
  }

  const avgWidth = blocks.reduce((sum, b) => sum + b.bbox.width, 0) / blocks.length;
  if (maxHorizontalOffset > avgWidth * 0.5) {
    isVerticallyAligned = false;
  }

  return isVerticallyAligned ? DISPLAY_MODE.UNIFIED : DISPLAY_MODE.SCATTERED;
}

export function mergeBlocksToText(blocks) {
  if (!blocks || blocks.length === 0) return '';

  // Reading-order sort: top-to-bottom, then left-to-right within a row.
  // Row threshold = 50% of block height; smaller Y diffs count as same row.
  const sorted = [...blocks].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) < a.bbox.height * 0.5) {
      return a.bbox.x - b.bbox.x;
    }
    return yDiff;
  });

  return sorted.map(b => b.text).join('\n');
}

// Center-point hit test — used to detect "dragged out of parent" for freeze
export function isPaneOutsideParent(paneRect, parentRect) {
  const paneCenterX = paneRect.x + paneRect.width / 2;
  const paneCenterY = paneRect.y + paneRect.height / 2;

  return (
    paneCenterX < parentRect.x ||
    paneCenterX > parentRect.x + parentRect.width ||
    paneCenterY < parentRect.y ||
    paneCenterY > parentRect.y + parentRect.height
  );
}

export function calculateAbsolutePosition(relativeRect, captureOffset) {
  return {
    x: relativeRect.x + captureOffset.x,
    y: relativeRect.y + captureOffset.y,
    width: relativeRect.width,
    height: relativeRect.height,
  };
}

export function clampToScreen(rect, screenBounds) {
  return {
    x: Math.max(0, Math.min(rect.x, screenBounds.width - rect.width)),
    y: Math.max(0, Math.min(rect.y, screenBounds.height - rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

// Estimates the size needed to fit `text` at default font metrics.
// Width is preserved (caller picks); only height grows. ~0.6 char-width and
// 1.5x line-height match typical sans-serif rendering well enough for a hint.
export function autoResizePane(text, originalRect, fontSize = 14) {
  if (!text) return originalRect;

  const charWidth = fontSize * 0.6;
  const lineHeight = fontSize * 1.5;

  const charsPerLine = Math.floor(originalRect.width / charWidth);

  const lines = text.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    totalLines += Math.ceil(line.length / charsPerLine) || 1;
  }

  // +16 padding budget; never shrink below original height
  const newHeight = Math.max(originalRect.height, totalLines * lineHeight + 16);

  return {
    ...originalRect,
    height: newHeight,
  };
}
