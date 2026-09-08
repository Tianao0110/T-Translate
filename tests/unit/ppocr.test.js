// The forked PP-OCR pipeline's pure pieces: binary-map components, the
// rotated rectangle, tensor layout, CTC decoding and the 90-degree turn.
// The model-bound path is covered by scripts/smoke-ocr.js.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { findComponents, minAreaRect } = require('../../electron/services/ocr-host/ppocr/cv.js');
const { normalizeCHW } = require('../../electron/services/ocr-host/ppocr/tensor.js');
const { parseDict, decode } = require('../../electron/services/ocr-host/ppocr/rec.js');
const image = require('../../electron/services/ocr-host/ppocr/image.js');

describe('ppocr cv', () => {
  it('groups 8-connected pixels and keeps only boundary pixels', () => {
    // 6x4: a 3x2 block joined diagonally to (3,2); (5,3) stands alone.
    const rows = ['111000', '111000', '000100', '000001'];
    const bit = Uint8Array.from(rows.join(''), (c) => Number(c));
    const comps = findComponents(bit, 6, 4);
    expect(comps).toHaveLength(2);
    // Interior/edge-only pixels (0,0) and (1,0) have no background
    // 4-neighbour inside the image and are not boundary pixels.
    const byRaster = (a, b) => a.y - b.y || a.x - b.x;
    expect([...comps[0]].sort(byRaster)).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
    ]);
    expect(comps[1]).toEqual([{ x: 5, y: 3 }]);
  });

  it('minAreaRect of an axis-aligned rectangle', () => {
    const pts = [];
    for (let x = 0; x <= 9; x++) for (let y = 0; y <= 3; y++) pts.push({ x, y });
    const r = minAreaRect(pts);
    expect(r.size.width).toBeCloseTo(9);
    expect(r.size.height).toBeCloseTo(3);
    expect(r.center.x).toBeCloseTo(4.5);
    expect(r.center.y).toBeCloseTo(1.5);
    expect(r.angle).toBeCloseTo(0);
  });

  it('minAreaRect recovers a 45-degree square', () => {
    const r = minAreaRect([
      { x: 0, y: 2 },
      { x: 2, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 4 },
    ]);
    expect(r.size.width).toBeCloseTo(Math.SQRT2 * 2);
    expect(r.size.height).toBeCloseTo(Math.SQRT2 * 2);
    expect(r.angle).toBeCloseTo(135);
  });
});

describe('ppocr tensor', () => {
  it('lays out blue, green, red planes with per-channel normalisation', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
    const out = normalizeCHW(img, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(Array.from(out)).toEqual([-1, 1, -1, -1, 1, -1]);
  });
});

describe('ppocr rec', () => {
  it('parseDict maps the trailing newline to the space class', () => {
    expect(parseDict('a\nb')).toEqual(['a', 'b', ' ']);
    expect(parseDict('a\r\nb\n')).toEqual(['a', 'b', ' ']);
  });

  it('decode drops blanks and repeats, keeps the runner-up per step', () => {
    const dict = ['a', 'b', ' '];
    const steps = [
      [0.1, 0.8, 0.1, 0], // a
      [0.1, 0.8, 0.1, 0], // repeat of a: dropped
      [0.9, 0.05, 0.05, 0], // blank
      [0.1, 0.7, 0.2, 0], // a again after a blank: kept
      [0.2, 0.1, 0.7, 0], // b
    ];
    const out = decode({ data: Float32Array.from(steps.flat()), dims: [1, 5, 4] }, dict);
    expect(out.map((c) => c[0].t)).toEqual(['a', 'a', 'b']);
    // Ties between the two 0.1 classes go to the earlier one (blank ->
    // the space class), as upstream.
    expect(out[0][1].t).toBe(' ');
    expect(out[2][1].t).toBe(' ');
    expect(out[2][1].mean).toBeCloseTo(0.2);
  });
});

describe('ppocr image', () => {
  it('rotateImg turns a 3x1 strip into a 1x3 column', () => {
    class ImageData {
      constructor(data, w, h) {
        this.data = data;
        this.width = w;
        this.height = h;
      }
    }
    image.setCanvasKit({ ImageData });
    const src = new ImageData(new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255]), 3, 1);
    const out = image.rotateImg(src, -90);
    expect([out.width, out.height]).toEqual([1, 3]);
    expect([out.data[0], out.data[4], out.data[8]]).toEqual([3, 2, 1]);
    expect(image.rotateImg(src, 0)).toBe(src);
  });
});
