// Scattered-vs-unified display decision for the floating window.
// Pure geometry — no store/IPC deps so the heuristic stays unit-testable.

// Heuristic: are the OCR blocks scattered (e.g. UI labels, code annotations)
// vs a single vertically-aligned paragraph? Scattered => overlay one bubble per block.
export function shouldUseScatteredMode(blocks) {
  if (!blocks || blocks.length === 0) return false;
  if (blocks.length === 1) return false;

  const hasCoordinates = blocks.some(b => b.bbox && b.bbox.width > 0);
  if (!hasCoordinates) return false;

  const validBlocks = blocks.filter(b => b.bbox && b.bbox.height > 0);
  if (validBlocks.length < 2) return false;

  const avgHeight = validBlocks.reduce((sum, b) => sum + b.bbox.height, 0) / validBlocks.length;

  const sorted = [...validBlocks].sort((a, b) => a.bbox.y - b.bbox.y);

  let isVerticallyAligned = true;
  let maxHorizontalOffset = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const verticalGap = curr.bbox.y - (prev.bbox.y + prev.bbox.height);

    const horizontalOffset = Math.abs(curr.bbox.x - prev.bbox.x);
    maxHorizontalOffset = Math.max(maxHorizontalOffset, horizontalOffset);

    // Gap > 2x line height OR significant overlap (-0.3 line height) breaks the column
    if (verticalGap > avgHeight * 2 || verticalGap < -avgHeight * 0.3) {
      isVerticallyAligned = false;
      break;
    }
  }

  // Horizontal scatter > 40% of avg block width means it's not a column
  const avgWidth = validBlocks.reduce((sum, b) => sum + b.bbox.width, 0) / validBlocks.length;
  if (maxHorizontalOffset > avgWidth * 0.4) {
    isVerticallyAligned = false;
  }

  return !isVerticallyAligned;
}

// Manual pref ('scattered'|'unified') overrides the heuristic ('auto').
// Forced scattered still needs positioned text blocks — engines that return
// no box coordinates (e.g. LLM vision) fall back to unified instead of
// rendering zero panes and dropping the text.
export function resolveDisplayMode(pref, blocks) {
  if (pref === 'unified') return { useScattered: false, fellBack: false };
  if (pref === 'scattered') {
    const positioned = (blocks || []).some(
      b => b.text?.trim() && b.bbox && b.bbox.width > 0 && b.bbox.height > 0
    );
    return positioned
      ? { useScattered: true, fellBack: false }
      : { useScattered: false, fellBack: true };
  }
  return { useScattered: shouldUseScatteredMode(blocks), fellBack: false };
}
