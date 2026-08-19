// The numbers in these fixtures are measured, not invented: each one is what
// the local engine actually returned for a rendered sample of that script
// (PP-OCRv6 small, bundled base pack). If a threshold is ever retuned, these
// are the cases it has to keep getting right.

import { describe, it, expect } from 'vitest';
import { isUsableResult, textDensity } from '../../src/stack/ocr/result-quality.js';

// One line of text, `chars` characters wide-ish, in a box of the given size.
const line = (text, width = 700, height = 25) => ({
  text,
  confidence: 0.99,
  bbox: { x: 0, y: 0, width, height },
});

const result = (over = {}) => ({
  success: true,
  text: 'x',
  confidence: 0.99,
  blocks: [line('x')],
  ...over,
});

describe('OCR result quality', () => {
  describe('results the chain must accept', () => {
    const good = [
      ['English', 0.992, 58, 700, 25.6],
      ['Chinese', 1.0, 29, 700, 24.7],
      ['Polish', 0.986, 50, 700, 29.4],
      ['11px text', 0.995, 64, 700, 22.5],
      ['blurred text', 0.993, 60, 700, 34.1],
    ];

    for (const [name, confidence, chars, w, h] of good) {
      it(`accepts ${name}`, () => {
        const r = result({
          confidence,
          text: 'x'.repeat(chars),
          blocks: [{ text: 'x'.repeat(chars), confidence, bbox: { x: 0, y: 0, width: w, height: h } }],
        });
        expect(isUsableResult(r, 'rapid-ocr')).toBe(true);
      });
    }

    it('accepts a short label, where density is naturally low', () => {
      // "OK" measured 1.59 — the box hugs the text, so two characters is fine.
      const r = result({ confidence: 1, text: 'OK', blocks: [line('OK', 40, 32)] });
      expect(isUsableResult(r, 'rapid-ocr')).toBe(true);
    });
  });

  describe('results the chain must walk past', () => {
    it('rejects Korean/Arabic/Devanagari — no blocks, empty text, success true', () => {
      const r = result({ text: '', confidence: 0, blocks: [] });
      expect(isUsableResult(r, 'rapid-ocr')).toBe(false);
    });

    it('rejects Thai — confidence 0.62', () => {
      const r = result({ confidence: 0.619, text: 'ulanauauu', blocks: [line('ulanauauu', 700, 34.7)] });
      expect(isUsableResult(r, 'rapid-ocr')).toBe(false);
    });

    it('rejects Hebrew — confidence 0.64', () => {
      const r = result({ confidence: 0.635, text: 'p2 l"D TD at', blocks: [line('p2 l"D TD at', 700, 34.8)] });
      expect(isUsableResult(r, 'rapid-ocr')).toBe(false);
    });

    it('rejects Russian without its pack — high confidence, one comma per line', () => {
      // The case confidence alone cannot catch: 0.861, well above the floor.
      const r = result({ confidence: 0.861, text: ',', blocks: [line(',', 700, 24.6)] });
      expect(isUsableResult(r, 'rapid-ocr')).toBe(false);
    });

    it('rejects whitespace-only text', () => {
      expect(isUsableResult(result({ text: '   \n ' }), 'rapid-ocr')).toBe(false);
    });

    it('rejects a failed result outright', () => {
      expect(isUsableResult({ success: false, text: 'x' }, 'rapid-ocr')).toBe(false);
    });
  });

  describe('other engines', () => {
    it('only checks emptiness — their confidence means something else', () => {
      // Cloud engines default per-block confidence to 0.9 when their API omits
      // one, and Windows OCR reports a flat 0.9. Neither number is calibrated.
      const weak = result({ confidence: 0.2, text: 'real text', blocks: [line('real text')] });
      expect(isUsableResult(weak, 'azure-ocr')).toBe(true);
      expect(isUsableResult(weak, 'rapid-ocr')).toBe(false);
    });

    it('still rejects a blank read from Windows OCR', () => {
      expect(isUsableResult(result({ text: '', confidence: 0 }), 'windows-ocr')).toBe(false);
    });
  });

  describe('textDensity', () => {
    it('is null when no block carries usable geometry', () => {
      expect(textDensity([])).toBeNull();
      expect(textDensity([{ text: 'x' }])).toBeNull();
      expect(textDensity([{ text: 'x', bbox: { width: 0, height: 0 } }])).toBeNull();
    });

    it('ignores whitespace when counting characters', () => {
      expect(textDensity([line('ab cd', 100, 50)])).toBe(2);
    });

    it('sums across blocks rather than averaging ratios', () => {
      const d = textDensity([line('abcd', 100, 50), line('', 100, 50)]);
      expect(d).toBe(1);
    });
  });
});
