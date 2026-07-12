// Scattered-vs-unified display decision for the floating window.
// Pure geometry — no store/IPC deps so the heuristic stays unit-testable.

// Tunables, from typical OCR line boxes; revisit with real captures.
const PILE_MIN_BLOCKS = 4; // fewer blocks never count as a word pile
const PILE_MAX_ASPECT = 6; // median width/height ≤ this reads "words", not "lines"
const PILE_COLLAPSE_RATIO = 0.6; // merge shrinking a pile below this share = blob
const COLUMN_MAX_GAP = 2; // vertical gap beyond this × line height breaks a column
const COLUMN_MAX_OVERLAP = 0.3; // vertical overlap beyond this × line height breaks a column
const ALIGN_MAX_DEVIATION = 0.25; // median edge deviation beyond this × avg width = no column

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

export function shouldUseScatteredMode(blocks) {
  if (!blocks || blocks.length < 2) return false;
  const valid = positioned(blocks);
  if (valid.length < 2) return false;

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

// Which blocks become panes. Layout-merged paragraphs give one pane per
// bubble/paragraph (far less pane overlap than per-line boxes) — except when
// the merge collapses a word pile into a blob, which would lose the per-word
// positioning that makes scattered mode useful there.
export function pickScatterBlocks(rawBlocks, mergedBlocks) {
  const merged = positioned(mergedBlocks);
  if (!merged.length) return rawBlocks;
  const raw = positioned(rawBlocks);
  if (isWordPile(rawBlocks) && merged.length < raw.length * PILE_COLLAPSE_RATIO) {
    return rawBlocks;
  }
  return mergedBlocks;
}

// Manual pref ('scattered'|'unified') overrides the heuristic ('auto').
// Forced scattered still needs positioned text blocks — engines that return
// no box coordinates (e.g. LLM vision) fall back to unified instead of
// rendering zero panes and dropping the text.
export function resolveDisplayMode(pref, rawBlocks, mergedBlocks) {
  if (pref === 'unified') return { useScattered: false, fellBack: false, blocks: null };
  if (pref === 'scattered') {
    const hasPositioned = positioned(rawBlocks).some(b => b.text?.trim());
    return hasPositioned
      ? { useScattered: true, fellBack: false, blocks: pickScatterBlocks(rawBlocks, mergedBlocks) }
      : { useScattered: false, fellBack: true, blocks: null };
  }
  const useScattered = shouldUseScatteredMode(rawBlocks);
  return {
    useScattered,
    fellBack: false,
    blocks: useScattered ? pickScatterBlocks(rawBlocks, mergedBlocks) : null,
  };
}
