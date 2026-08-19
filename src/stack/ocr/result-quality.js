/**
 * Whether an OCR result is worth stopping the fallback chain for.
 *
 * The chain used to advance only when an engine reported failure, but the local
 * engine does not fail on scripts its dictionary cannot represent. It returns
 * `success: true` with nothing, or with confident nonsense, and the engines
 * behind it — Windows OCR, the cloud APIs, LLM vision — never run.
 *
 * Measured on rendered samples (PP-OCRv6 small, bundled base pack):
 *
 *   correct        en 0.99 / zh 1.00 / Polish 0.99 / 11px 1.00 / blurred 0.99
 *                  density 1.02 (CJK) to 2.92
 *   Korean         0 blocks, empty text, success: true
 *   Arabic         same
 *   Devanagari     same
 *   Thai           confidence 0.62, "ulanauauu"
 *   Hebrew         confidence 0.64, garbage
 *   Russian, no    confidence 0.86 — but one comma for a full line of text,
 *   Cyrillic pack  density 0.04
 *
 * Confidence alone would miss the Russian case; density alone would miss
 * Hebrew. Both are needed, and both stay far from the correct samples: the
 * lowest correct confidence measured is 0.986 against a 0.70 floor, and the
 * lowest correct density is 1.02 against a 0.50 floor. A blurred or 11px
 * capture scores 0.99 — this engine's confidence tracks "are these glyphs in
 * my dictionary", not image quality, which is what makes the gate safe.
 *
 * Two failure modes are NOT detectable here and are not claimed: Vietnamese
 * (0.985, every tone mark silently dropped) and Greek (0.90, accents dropped)
 * both look like ordinary text. Only the right model fixes those, which is why
 * neither language is offered for local OCR.
 */

const MIN_CONFIDENCE = 0.7;
const MIN_DENSITY = 0.5;

/**
 * Recognized characters per line-height of detected text box. A line of text
 * holds roughly one CJK glyph, or two Latin ones, per line-height — so a real
 * result lands near or above 1, and a recognizer that found the text but could
 * not read it lands near 0.
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
  // Empty text is unusable whoever produced it, and Windows OCR reports
  // success on a blank read.
  if (!String(result.text || '').trim()) return false;

  // The thresholds below were calibrated on the local engine. Other engines
  // report confidence with different semantics — several default it to 0.9
  // when their API omits one — so gating them would be guesswork.
  if (engineId !== 'rapid-ocr') return true;

  if (Number.isFinite(result.confidence) && result.confidence < MIN_CONFIDENCE) return false;

  const density = textDensity(result.blocks);
  if (density !== null && density < MIN_DENSITY) return false;

  return true;
}

export const QUALITY_THRESHOLDS = { MIN_CONFIDENCE, MIN_DENSITY };
