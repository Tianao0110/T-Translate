// Scattered-vs-unified display decision for the floating window. Pure
// geometry. Design notes: docs/design/renderer.md §4.

// Tunables, from typical OCR line boxes; revisit with real captures.
const PILE_MIN_BLOCKS = 4; // fewer blocks never count as a word pile
const PILE_MAX_ASPECT = 6; // median width/height ≤ this reads "words", not "lines"
const SPARSE_MAX_COVERAGE = 0.1; // text area below this share of the frame = islands over imagery
const COLUMN_MAX_GAP = 2; // vertical gap beyond this × line height breaks a column
const COLUMN_MAX_OVERLAP = 0.3; // vertical overlap beyond this × line height breaks a column
const ALIGN_MAX_DEVIATION = 0.25; // median edge deviation beyond this × avg width = no column
// Merge-audit gates: a lib-merged block is trusted only when its raw
// constituents look like one visual unit (speech bubble / paragraph).
const AUDIT_MAX_EDGE_DEVIATION = 0.2; // center or left MAD vs avg width
const AUDIT_MIN_WIDTH_RATIO = 0.35; // narrowest/widest constituent line
const AUDIT_MAX_LINE_GAP = 0.9; // vertical gap × avg line height between lines

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function positioned(blocks) {
  return (blocks || []).filter(b => b.bbox && b.bbox.width > 0 && b.bbox.height > 0);
}

// A pile of standalone words / labels: many boxes nearly as tall as wide.
export function isWordPile(blocks) {
  const valid = positioned(blocks);
  if (valid.length < PILE_MIN_BLOCKS) return false;
  return median(valid.map(b => b.bbox.width / b.bbox.height)) <= PILE_MAX_ASPECT;
}

// Text islands floating in imagery: the blocks cover a tiny share of the
// captured frame (same pixel space as the boxes).
export function isSparseCoverage(blocks, frame) {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) return false;
  const valid = positioned(blocks);
  if (!valid.length) return false;
  const textArea = valid.reduce((s, b) => s + b.bbox.width * b.bbox.height, 0);
  return textArea / (frame.width * frame.height) < SPARSE_MAX_COVERAGE;
}

export function shouldUseScatteredMode(blocks, frame = null) {
  if (!blocks || blocks.length === 0) return false;
  const valid = positioned(blocks);
  if (!valid.length) return false;

  // Islands over imagery want in-place bubbles.
  if (isSparseCoverage(blocks, frame)) return true;

  if (valid.length < 2 || blocks.length < 2) return false;

  // Standalone words want one bubble each.
  if (isWordPile(blocks)) return true;

  const avgHeight = valid.reduce((s, b) => s + b.bbox.height, 0) / valid.length;
  const sorted = [...valid].sort((a, b) => a.bbox.y - b.bbox.y);

  // Vertical continuity: paragraph lines follow each other within ~line-height.
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].bbox.y - (sorted[i - 1].bbox.y + sorted[i - 1].bbox.height);
    if (gap > avgHeight * COLUMN_MAX_GAP || gap < -avgHeight * COLUMN_MAX_OVERLAP) {
      return true;
    }
  }

  // Alignment via median deviation; left-aligned paragraphs and centered
  // stanzas both count as one column.
  const avgWidth = valid.reduce((s, b) => s + b.bbox.width, 0) / valid.length;
  const lefts = sorted.map(b => b.bbox.x);
  const centers = sorted.map(b => b.bbox.x + b.bbox.width / 2);
  const leftDev = median(lefts.map(x => Math.abs(x - median(lefts))));
  const centerDev = median(centers.map(x => Math.abs(x - median(centers))));
  if (Math.min(leftDev, centerDev) > avgWidth * ALIGN_MAX_DEVIATION) {
    return true;
  }

  return false;
}

function center(b) {
  return { x: b.bbox.x + b.bbox.width / 2, y: b.bbox.y + b.bbox.height / 2 };
}

// Does this lib-merged block read as one visual unit (bubble / paragraph)?
// Constituents must be aligned, of comparable width, and tightly stacked.
function mergeLooksLikeUnit(constituents) {
  if (constituents.length < 2) return true;
  const avgW = constituents.reduce((s, b) => s + b.bbox.width, 0) / constituents.length;
  const avgH = constituents.reduce((s, b) => s + b.bbox.height, 0) / constituents.length;

  const widths = constituents.map(b => b.bbox.width);
  if (Math.min(...widths) / Math.max(...widths) < AUDIT_MIN_WIDTH_RATIO) return false;

  const sorted = [...constituents].sort((a, b) => a.bbox.y - b.bbox.y);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].bbox.y - (sorted[i - 1].bbox.y + sorted[i - 1].bbox.height);
    if (gap > avgH * AUDIT_MAX_LINE_GAP) return false;
  }

  const lefts = constituents.map(b => b.bbox.x);
  const centers = constituents.map(b => b.bbox.x + b.bbox.width / 2);
  const leftDev = median(lefts.map(x => Math.abs(x - median(lefts))));
  const centerDev = median(centers.map(x => Math.abs(x - median(centers))));
  return Math.min(leftDev, centerDev) <= avgW * AUDIT_MAX_EDGE_DEVIATION;
}

// Which blocks become panes: audited lib-merged paragraphs, else their raw
// lines; word piles skip merging entirely.
export function pickScatterBlocks(rawBlocks, mergedBlocks) {
  if (isWordPile(rawBlocks)) return rawBlocks;
  const merged = positioned(mergedBlocks);
  const raw = positioned(rawBlocks);
  if (!merged.length || !raw.length) return rawBlocks;

  const consumed = new Set();
  const result = [];
  for (const m of merged) {
    const constituents = raw.filter(r => {
      if (consumed.has(r)) return false;
      const c = center(r);
      return (
        c.x >= m.bbox.x && c.x <= m.bbox.x + m.bbox.width &&
        c.y >= m.bbox.y && c.y <= m.bbox.y + m.bbox.height
      );
    });
    constituents.forEach(r => consumed.add(r));
    if (constituents.length && !mergeLooksLikeUnit(constituents)) {
      result.push(...constituents);
    } else {
      result.push(m);
    }
  }
  // Raw lines no merged box claimed (shouldn't happen, but never drop text)
  for (const r of raw) {
    if (!consumed.has(r)) result.push(r);
  }
  return result;
}

// Boxes must sit inside the frame they were read from; a whole-set
// overshoot degrades to unified.
const FRAME_OVERSHOOT_TOLERANCE = 0.25;

export function coordsFitFrame(blocks, frame) {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) return true; // nothing to judge against
  const valid = positioned(blocks);
  if (!valid.length) return true;

  const slackX = frame.width * FRAME_OVERSHOOT_TOLERANCE;
  const slackY = frame.height * FRAME_OVERSHOOT_TOLERANCE;
  return valid.every(b =>
    b.bbox.x >= -slackX &&
    b.bbox.y >= -slackY &&
    b.bbox.x + b.bbox.width <= frame.width + slackX &&
    b.bbox.y + b.bbox.height <= frame.height + slackY
  );
}

// Manual pref ('scattered'|'unified') overrides the heuristic ('auto').
// Engines that return no box coordinates fall back to unified; `fellBack`
// drives the badge's hint.
export function resolveDisplayMode(pref, rawBlocks, mergedBlocks, frame = null) {
  if (pref === 'unified') return { useScattered: false, fellBack: false, blocks: null };

  const trusted = coordsFitFrame(rawBlocks, frame);
  const raw = trusted ? rawBlocks : [];
  const merged = trusted ? mergedBlocks : [];
  const hasPositioned = positioned(raw).some(b => b.text?.trim());

  if (pref === 'scattered') {
    return hasPositioned
      ? { useScattered: true, fellBack: false, blocks: pickScatterBlocks(raw, merged) }
      : { useScattered: false, fellBack: true, blocks: null };
  }

  const useScattered = shouldUseScatteredMode(raw, frame);
  return {
    useScattered,
    fellBack: !useScattered && !hasPositioned,
    blocks: useScattered ? pickScatterBlocks(raw, merged) : null,
  };
}
