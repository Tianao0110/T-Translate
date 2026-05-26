// Paragraph-merge algorithm for OCR output — turns fragmented blocks into natural paragraphs.

/**
 * Merge OCR text blocks into paragraphs.
 *
 * @param {Array} blocks  - OCR blocks: each `{ text, bbox: { x, y, width, height } }`
 * @param {Object} options
 * @param {number} options.lineGapThreshold - Y-gap tolerance as a multiple of line height (default 1.5)
 * @param {number} options.xOverlapRatio    - Min X-overlap ratio between consecutive blocks (default 0.3)
 * @returns {Array} merged paragraph blocks
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

  // Drop invalid entries and sort top-to-bottom, left-to-right.
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

  const paragraphs = [];
  let current = createBlock(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const nextBbox = next.bbox;

    const currentBottom = current.bbox.y + current.bbox.height;
    const yGap = nextBbox.y - currentBottom;
    const avgHeight = (current.bbox.height + nextBbox.height) / 2;

    // Three merge signals — any one is sufficient combined with the right partner.
    const isYClose = yGap < avgHeight * lineGapThreshold;
    const hasXOverlap = checkXOverlap(current.bbox, nextBbox, xOverlapRatio);
    const isSameLine = Math.abs(nextBbox.y - current.bbox.y) < avgHeight * 0.5;

    // Same line → continuation; nearby lines that overlap horizontally → same paragraph.
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

function createBlock(item) {
  return {
    text: item.text.trim(),
    bbox: { ...item.bbox },
    confidence: item.confidence || 0.9,
    _count: 1,
  };
}

// Merge `source` into `target`. Same-line gets a space separator; cross-line gets \n.
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

  // Running average confidence — weighted by current count.
  const newCount = target._count + 1;
  target.confidence = ((target.confidence * target._count) + (source.confidence || 0.9)) / newCount;
  target._count = newCount;
}

function finalizeBlock(block) {
  return {
    text: block.text,
    bbox: block.bbox,
    confidence: block.confidence,
    mergedCount: block._count,
  };
}

// X-axis overlap ratio relative to the narrower block's width.
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

// Join merged paragraphs with a blank line between them.
function mergedBlocksToText(mergedBlocks) {
  if (!mergedBlocks || mergedBlocks.length === 0) {
    return '';
  }
  return mergedBlocks.map(b => b.text).join('\n\n');
}

module.exports = {
  smartMerge,
  mergedBlocksToText,
};
