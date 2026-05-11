// Merge OCR fragments back into paragraphs. Shared by glass / screenshot /
// selection translate paths.

// Merge algorithm: sort top-to-bottom, then walk adjacent blocks deciding
// whether each pair belongs to the same paragraph based on vertical gap and
// horizontal overlap. Same-line blocks (Y within half a line height) always merge.
export function smartMerge(ocrItems, options = {}) {
  if (!ocrItems || ocrItems.length === 0) {
    return [];
  }

  if (ocrItems.length === 1) {
    return [...ocrItems];
  }

  const {
    // Vertical gap > 1.5 line heights => paragraph break
    lineGapThreshold = 1.5,
    // Horizontal overlap < 30% of narrower block => paragraph break
    xOverlapRatio = 0.3,
    preserveLineBreaks = true,
  } = options;

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
    const yDiff = a.bbox.y - b.bbox.y;
    // 5px tolerance: blocks within a few pixels of each other are "same row" -> sort by X
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.bbox.x - b.bbox.x;
  });

  const paragraphs = [];
  let currentBlock = createMergeBlock(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const nextBbox = next.bbox;

    const currentBottom = currentBlock.bbox.y + currentBlock.bbox.height;
    const yGap = nextBbox.y - currentBottom;
    const avgHeight = (currentBlock.bbox.height + nextBbox.height) / 2;

    const isYClose = yGap < avgHeight * lineGapThreshold;
    const hasXOverlap = checkXOverlap(currentBlock.bbox, nextBbox, xOverlapRatio);
    // Same-line catches the case where two blocks on the same row weren't
    // captured as one (e.g. OCR split mid-line)
    const isSameLine = Math.abs(nextBbox.y - currentBlock.bbox.y) < avgHeight * 0.5;

    const shouldMerge = (isYClose && hasXOverlap) || isSameLine;

    if (shouldMerge) {
      mergeBlocks(currentBlock, next, { preserveLineBreaks, isSameLine });
    } else {
      paragraphs.push(finalizeBlock(currentBlock));
      currentBlock = createMergeBlock(next);
    }
  }

  paragraphs.push(finalizeBlock(currentBlock));

  return paragraphs;
}

function createMergeBlock(item) {
  return {
    text: item.text.trim(),
    bbox: { ...item.bbox },
    _sourceBlocks: [item],
  };
}

function mergeBlocks(target, source, options = {}) {
  const { preserveLineBreaks = true, isSameLine = false } = options;

  // Same line = space join; different lines = newline (or space if explicitly disabled)
  const separator = isSameLine ? ' ' : (preserveLineBreaks ? '\n' : ' ');
  target.text = target.text + separator + source.text.trim();

  // Grow bbox to encompass both
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

  target._sourceBlocks.push(source);
}

function finalizeBlock(block) {
  return {
    text: block.text,
    bbox: block.bbox,
    mergedCount: block._sourceBlocks?.length || 1,
  };
}

// Overlap = shared X range / narrower block width. Using min width matches the
// intuition that a short word lined up under a longer one counts as same-column.
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

// Cheap variant: vertical-only merge. Good enough for subtitle-style input
// where everything is one column.
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
      current.text += '\n' + next.text;
      current.bbox.height = (next.bbox.y + next.bbox.height) - current.bbox.y;
      current.bbox.width = Math.max(current.bbox.width, next.bbox.width);
    } else {
      result.push(current);
      current = { ...next, bbox: { ...next.bbox } };
    }
  }

  result.push(current);
  return result;
}

// Heuristic for picking glass display mode. If any two blocks are >50px apart
// (center-to-center), it's likely a scattered layout (e.g. UI labels) rather
// than a single paragraph.
export function shouldUseScatteredMode(blocks, options = {}) {
  if (!blocks || blocks.length === 0) return false;
  if (blocks.length === 1) return false;

  const { minDistance = 50 } = options;

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const b1 = blocks[i].bbox;
      const b2 = blocks[j].bbox;

      const cx1 = b1.x + b1.width / 2;
      const cy1 = b1.y + b1.height / 2;
      const cx2 = b2.x + b2.width / 2;
      const cy2 = b2.y + b2.height / 2;

      const distance = Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);

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
