// Layout model output parsing in the OCR host (electron/services/ocr-host/layout.js).

import { describe, it, expect } from 'vitest';

const { parseRows, LABELS } = await import('../../../electron/services/ocr-host/layout.js');

const id = (label) => LABELS.indexOf(label);

describe('parseRows', () => {
  it('orders V3 rows by their reading-order column and returns page fractions', () => {
    // [class, score, x1, y1, x2, y2, order] on a 1000 × 2000 image.
    const rows = [
      id('text'), 0.95, 100, 1000, 900, 1400, 30,
      id('paragraph_title'), 0.9, 100, 800, 500, 850, 10,
      id('header'), 0.4, 0, 0, 1000, 50, 1,
    ];
    const blocks = parseRows(Float32Array.from(rows), 7, 3, 1000, 2000);
    expect(blocks.map((b) => [b.label, b.order])).toEqual([['paragraph_title', 0], ['text', 1]]);
    expect(blocks[1].box).toEqual([0.1, 0.5, 0.9, 0.7]);
  });

  it('sorts V2 rows by the first key ascending, then the second descending', () => {
    const rows = [
      id('text'), 0.9, 0, 0, 10, 10, 2, 5,
      id('image'), 0.9, 0, 0, 10, 10, 1, 1,
      id('table'), 0.9, 0, 0, 10, 10, 2, 9,
    ];
    const blocks = parseRows(Float32Array.from(rows), 8, 3, 100, 100);
    expect(blocks.map((b) => b.label)).toEqual(['image', 'table', 'text']);
  });

  it('clamps to the image and drops empty boxes and rows past the count', () => {
    const rows = [
      id('text'), 0.9, -50, 10, 150, 90, 0,
      id('text'), 0.9, 40, 40, 40, 90, 1,
      id('chart'), 0.9, 0, 0, 50, 50, 2,
    ];
    const blocks = parseRows(Float32Array.from(rows), 7, 2, 100, 100);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].box).toEqual([0, 0.1, 1, 0.9]);
  });
});
