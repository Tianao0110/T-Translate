/**
 * Whether an OCR result is worth stopping the fallback chain for: the local
 * engine reports success on scripts its dictionary cannot represent, with
 * nothing or with confident nonsense. Confidence and density are both
 * needed; the thresholds and the measurements behind them are in
 * docs/design/stack.md §5.
 */

const MIN_CONFIDENCE = 0.7;
const MIN_DENSITY = 0.5;

/**
 * Recognized characters per line-height of detected text box: a real result
 * lands near or above 1, an unread one near 0.
 */
export function textDensity(blocks) {
  let chars = 0;
  let room = 0;
  for (const b of blocks || []) {
    const w = b?.bbox?.width;
    const h = b?.bbox?.height;
    if (!(w > 0) || !(h > 0)) continue;
    chars += (b.text || '').replace(/\s/g, '').length;
    room += w / h;
  }
  return room > 0 ? chars / room : null;
}

/**
 * @param {object} result an engine's successful result
 * @param {string} engineId which engine produced it
 * @returns {boolean} false when the chain should keep looking
 */
export function isUsableResult(result, engineId) {
  if (!result?.success) return false;
  // Empty text is unusable whoever produced it.
  if (!String(result.text || '').trim()) return false;

  // The thresholds below are calibrated on the local engine only.
  if (engineId !== 'rapid-ocr') return true;

  if (Number.isFinite(result.confidence) && result.confidence < MIN_CONFIDENCE) return false;

  const density = textDensity(result.blocks);
  if (density !== null && density < MIN_DENSITY) return false;

  return true;
}

