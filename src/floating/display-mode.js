// Scattered-vs-unified display decision for the floating window.
// Pure geometry — no store/IPC deps so the heuristic stays unit-testable.

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

// A pile of standalone words/labels (vocab lists, UI grids, manga SFX):
// many boxes nearly as tall as wide. Paragraph lines are far wider than tall,
// so aspect ratio separates "words" from "lines" without reading the text.
export function isWordPile(blocks) {
  const valid = positioned(blocks);
  if (valid.length < PILE_MIN_BLOCKS) return false;
  return median(valid.map(b => b.bbox.width / b.bbox.height)) <= PILE_MAX_ASPECT;
}

// Text islands floating in imagery (manga bubbles, sparse labels): the blocks
// cover a tiny share of the captured frame. A "clear paragraph" capture fills
// it. Frame is the capture size in the same pixel space as the boxes.
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

  // Islands over imagery want in-place bubbles even when a single bubble's
  // lines form a perfect centered column (the manga case).
  if (isSparseCoverage(blocks, frame)) return true;

  if (valid.length < 2 || blocks.length < 2) return false;

  // Standalone words want one bubble each even when they line up in a column
  // (the old column test merged vocab lists into a single blob).
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

  // Alignment via median deviation — robust to one indented or short line,
  // unlike the old consecutive-pair distance which an indent tripped.
  // Left-aligned paragraphs and centered stanzas both count as one column.
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

// Does this lib-merged block read as ONE visual unit (bubble/paragraph)?
// Constituents must be aligned (center or left), of comparable width, and
// tightly stacked. List rows glued with their neighbors' badges/indices fail
// these and get split back to raw lines.
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

// Which blocks become panes. Lib-merged paragraphs give one pane per bubble —
// but the merge is audited per block: only merges whose raw constituents look
// like one unit are kept, the rest are split back to their raw lines (dense
// UI/list content glues neighboring rows together otherwise). Word piles skip
// merging entirely: per-word positioning is the point there.
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

// Boxes must sit inside the frame they were read from. Engines report in their
// own coordinate space, and a whole-set overshoot means that space isn't
// source-image pixels — scattering on those numbers would paste translations
// far from the text they belong to. Distrusting the set degrades to unified,
// which is what these engines did before they reported boxes at all. The
// tolerance absorbs edge-clipped boxes and rounding, not a 2× scale error.
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
// Scattered mode needs positioned text blocks either way — engines that return
// no box coordinates (LLM vision) fall back to unified instead of rendering
// zero panes and dropping the text. `fellBack` drives the badge's "engine gave
// no coordinates" hint, and auto mode raises it too: silently landing on
// unified reads as "the heuristic chose this", when the truth is it never got
// to choose.
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
